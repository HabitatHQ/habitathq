/**
 * PalladiumEngine — concrete sync engine base class.
 *
 * Provides the high-level API (tx, insert, update, delete, liveQuery, on)
 * on top of a StorageAdapter. Subclasses may override the protected
 * _putRow / _patchRow / _removeRow hooks to intercept writes (e.g. to
 * replicate changes to a remote server).
 */

import type { BlobAdapter } from "./blob-adapter.js";
import { BlobHandle } from "./blob-handle.js";
import { BlobRegistry } from "./blob-registry.js";
import { EventEmitter } from "./event-emitter.js";
import type { Hlc } from "./hlc.js";
import {
  compareHlc,
  createHlc,
  hlcFromString,
  hlcToString,
  isUuidV7,
  isValidHlc,
  recvHlc,
  sendHlc,
} from "./hlc.js";
import { LiveQuery } from "./live-query.js";
import { MemoryBlobAdapter } from "./memory-blob-adapter.js";
import type { SchemaConfig } from "./migration.js";
import { applySchema } from "./migration.js";
import type { SqlQuery } from "./sql.js";
import type { StorageAdapter } from "./storage.js";
import { isTransactable, supportsConstraintDeferral } from "./storage.js";
import type { Op, SchemaMap } from "./tx.js";
import { TxBuilder } from "./tx.js";

export type SyncStatus =
  | "uninitialized"
  | "hydrating"
  | "syncing"
  | "caught_up"
  | "offline"
  | "blocked_auth"
  | "degraded";

function normalizeOps<S extends SchemaMap>(ops: ReadonlyArray<Op<S>>): Op<S>[] {
  type State = { op: Op<S>; order: number };
  const states = new Map<string, State>();
  let order = 0;
  for (const op of ops) {
    const key = `${String(op.table)}\u0000${op.type === "insert" ? op.id : op.id}`;
    const prior = states.get(key);
    if (op.type === "insert") {
      states.set(key, { op: { ...op, data: { ...op.data } }, order: prior?.order ?? order++ });
    } else if (op.type === "delete") {
      states.set(key, { op, order: prior?.order ?? order++ });
    } else if (prior?.op.type === "insert") {
      const insert = prior.op;
      states.set(key, {
        order: prior.order,
        op: { ...insert, data: { ...insert.data, ...op.patch } },
      });
    } else if (prior?.op.type === "update") {
      states.set(key, {
        order: prior.order,
        op: { ...prior.op, patch: { ...prior.op.patch, ...op.patch } },
      });
    } else if (prior?.op.type === "delete") {
    } else {
      states.set(key, { op, order: order++ });
    }
  }
  return [...states.values()].sort((a, b) => a.order - b.order).map(({ op }) => op);
}

function sameOps<S extends SchemaMap>(a: ReadonlyArray<Op<S>>, b: ReadonlyArray<Op<S>>): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
/** A plain, unquoted SQL identifier: a leading letter/underscore then word chars. */
const SQL_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Guard a table or column name that will be interpolated into SQL. Used at the
 * remote-apply boundary, where names come from an untrusted change — anything
 * that isn't a plain identifier is rejected before it can reach a query.
 */
function assertSqlIdentifier(name: string): void {
  if (!SQL_IDENTIFIER.test(name)) {
    throw new Error(`invalid SQL identifier in remote change: ${JSON.stringify(name)}`);
  }
}

function extractSchemaTables(schemaSql: string): Set<string> {
  const tables = new Set<string>();
  const pattern =
    /\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["`]?([A-Za-z_][A-Za-z0-9_]*)["`]?/gi;
  for (const match of schemaSql.matchAll(pattern)) {
    const table = match[1];
    if (table !== undefined) tables.add(table.toLowerCase());
  }
  return tables;
}

export interface ChangesLocal<S extends SchemaMap = SchemaMap> {
  /** The ops as they came out of the `tx()` builder, in order. */
  readonly ops: ReadonlyArray<Op<S>>;
  /** Lowercased table names touched by `ops`, deduped. */
  readonly touchedTables: ReadonlyArray<string>;
  /**
   * The single HLC stamped on this change. Every column written by `ops`
   * carries this HLC in `_sync_row_meta`; the sync transport propagates it so
   * remote peers can LWW-reconcile against it. One change = one HLC (`D2a`).
   */
  readonly hlc: Hlc;
  /** Stable id for this change — the sync transport's idempotency key. */
  readonly changeId: string;
}

/**
 * A durable side effect that must commit atomically with a local change.
 * Throwing aborts the engine transaction and rolls back its mutations.
 */
export type LocalChangeCheckpoint<S extends SchemaMap = SchemaMap> = (
  change: ChangesLocal<S>,
  adapter: StorageAdapter,
) => Promise<void>;

/**
 * A change received from a remote peer, applied via {@link PalladiumEngine.applyRemote}.
 * Carries the originating {@link Hlc} so the engine can column-LWW-reconcile
 * (`D3`); `id` is the idempotency key (a re-delivered change is a no-op).
 */
export interface RemoteChange<S extends SchemaMap = SchemaMap> {
  readonly hlc: Hlc;
  readonly ops: ReadonlyArray<Op<S>>;
  readonly id?: string;
  readonly scope?: string;
}

export interface EngineEvents<S extends SchemaMap = SchemaMap> {
  "sync:status": SyncStatus;
  error: Error;
  /**
   * Fired after a local `tx()` commits successfully. Suppressed while the
   * engine is applying remote ops via `applyRemote()`. Subscribers (sync
   * transport, audit logs, etc.) get the full batch with the original engine
   * `Op` shape — wire-format conversion is the subscriber's job.
   */
  "changes:local": ChangesLocal<S>;
}

export interface PalladiumEngineOptions {
  readonly blobAdapter?: BlobAdapter;
  /**
   * Stable node identifier for HLC stamping. Defaults to a fresh `crypto.randomUUID()`.
   *
   * Apps that need their HLCs to survive reloads should persist this string
   * (localStorage, SQLite, etc.) and pass it on every engine construction.
   */
  readonly nodeId?: string;
}

// ── Column-LWW shadow table (`_sync_row_meta`, D3/G8) ────────────────────────

/** Per-`(table, row, column)` write-HLC shadow table backing column-level LWW. */
const SYNC_ROW_META = "_sync_row_meta";

/**
 * Reserved `col` value marking a row-level delete tombstone (`D4`). The
 * `__palladium_` prefix keeps it clear of any real SQL column name while
 * staying plain ASCII (a NUL/control sentinel would make the source binary).
 */
const DELETED_COL = "__palladium_deleted__";

const SYNC_ROW_META_DDL = `CREATE TABLE IF NOT EXISTS ${SYNC_ROW_META} (
  tbl TEXT NOT NULL,
  row_id TEXT NOT NULL,
  col TEXT NOT NULL,
  hlc_wall_ms INTEGER NOT NULL,
  hlc_counter INTEGER NOT NULL,
  hlc_node_id TEXT NOT NULL,
  PRIMARY KEY (tbl, row_id, col)
)`;

/**
 * Remote updates whose target row has not arrived yet. Keeping their values,
 * rather than only shadow metadata, lets a later insert replay them under the
 * ordinary column-LWW rule without inventing metadata for a nonexistent row.
 */

const APPLIED_CHANGES = "_sync_applied_changes";
const APPLIED_CHANGES_DDL = `CREATE TABLE IF NOT EXISTS ${APPLIED_CHANGES} (
  scope TEXT NOT NULL,
  change_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  applied_at INTEGER NOT NULL,
  PRIMARY KEY (scope, change_id)
)`;
const PENDING_REMOTE_UPDATES = "_sync_pending_remote_updates";

const PENDING_REMOTE_UPDATES_DDL = `CREATE TABLE IF NOT EXISTS ${PENDING_REMOTE_UPDATES} (
  pending_id TEXT PRIMARY KEY,
  tbl TEXT NOT NULL,
  row_id TEXT NOT NULL,
  patch TEXT NOT NULL,
  hlc_wall_ms INTEGER NOT NULL,
  hlc_counter INTEGER NOT NULL,
  hlc_node_id TEXT NOT NULL
)`;

interface PendingRemoteUpdateRow extends MetaRow {
  pending_id: string;
  patch: string;
}

interface MetaRow {
  hlc_wall_ms: number;
  hlc_counter: number;
  hlc_node_id: string;
}

function metaRowToHlc(row: MetaRow): Hlc {
  return {
    wallMs: row.hlc_wall_ms,
    counter: row.hlc_counter,
    nodeId: row.hlc_node_id,
  };
}

// ── Durable sync state (`_sync_state`, D2b) ──────────────────────────────────

/** Key-value table holding durable engine and client-view sync state. */
const SYNC_STATE = "_sync_state";

const SYNC_STATE_DDL = `CREATE TABLE IF NOT EXISTS ${SYNC_STATE} (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
)`;

const STATE_NODE_ID = "node_id";
const STATE_HLC = "hlc";
const STATE_CURSOR = "cursor";
/** The fingerprint of the SchemaConfig that initialized this local view. */
const STATE_SCHEMA_IDENTITY = "schema_identity_v1";

function schemaIdentity(config: SchemaConfig): string {
  let hash = 2_166_136_261;
  for (const char of `${config.version}\u0000${config.schema}`) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return `v1-${config.version}-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export class SchemaIdentityMismatchError extends Error {
  readonly code = "schema_identity_mismatch" as const;
  readonly expected: string;
  readonly actual: string;

  constructor(expected: string, actual: string) {
    super(`Schema identity mismatch: local ${actual} cannot initialize as ${expected}`);
    this.name = "SchemaIdentityMismatchError";
    this.expected = expected;
    this.actual = actual;
  }
}

export class PalladiumEngine<S extends SchemaMap> {
  #knownTables = new Set<string>();
  readonly adapter: StorageAdapter;
  #nodeId: string;
  protected readonly emitter = new EventEmitter<EngineEvents<S>>();
  protected status: SyncStatus = "uninitialized";
  readonly #liveQueries = new Set<LiveQuery>();
  readonly #localChangeCheckpoints = new Set<LocalChangeCheckpoint<S>>();
  readonly #blobRegistry = new BlobRegistry();
  #schemaIdentity: string | null = null;
  #syncTransportOwner: object | null = null;
  readonly blobs: BlobHandle;

  /**
   * Stable per-device HLC node id. Defaults to the constructor value but is
   * adopted from durable `_sync_state` on `init()` if a prior session persisted
   * one (`D2b`) — so it survives leader-worker failover instead of churning.
   */
  get nodeId(): string {
    return this.#nodeId;
  }

  /**
   * Current HLC. Loaded from durable `_sync_state` on `init()` and persisted
   * within each `tx()` / `applyRemote()` transaction (`D2b` atomic checkpoint),
   * so a restart resumes from the persisted floor and never reissues an HLC.
   */
  #currentHlc: Hlc | null = null;

  constructor(adapter: StorageAdapter, options?: PalladiumEngineOptions | BlobAdapter) {
    this.adapter = adapter;
    // Back-compat shim: previous signature was (adapter, blobAdapter?). Detect
    // a bare BlobAdapter by the absence of nodeId/blobAdapter keys.
    const opts: PalladiumEngineOptions =
      options && "get" in options && typeof options.get === "function"
        ? { blobAdapter: options as BlobAdapter }
        : ((options as PalladiumEngineOptions | undefined) ?? {});
    this.#nodeId = opts.nodeId ?? crypto.randomUUID();
    this.blobs = new BlobHandle(opts.blobAdapter ?? new MemoryBlobAdapter(), this.#blobRegistry);
  }

  /**
   * Advance the engine's HLC for a *send* (local mutation about to be
   * propagated to the server). Counter increments on same-millisecond bursts;
   * `wallMs` advances when the OS clock ticks. The returned HLC is strictly
   * greater than any HLC this engine has issued or received.
   */
  nextSendHlc(): Hlc {
    this.#currentHlc =
      this.#currentHlc === null ? createHlc(this.nodeId) : sendHlc(this.#currentHlc);
    return this.#currentHlc;
  }

  /** Advance the engine clock after observing a remote HLC. */
  receiveHlc(remote: Hlc): void {
    this.#currentHlc =
      this.#currentHlc === null
        ? recvHlc(createHlc(this.nodeId), remote)
        : recvHlc(this.#currentHlc, remote);
  }

  /** Most-recently-issued HLC, or `null` if the engine has not yet stamped anything. */
  get currentHlc(): Hlc | null {
    return this.#currentHlc;
  }

  /** Stable identity of the schema used to initialize this engine, if any. */
  get initializedSchemaIdentity(): string | null {
    return this.#schemaIdentity;
  }

  /**
   * Open the adapter and optionally apply versioned migrations and seeds.
   */
  async init(schema?: SchemaConfig): Promise<void> {
    await this.adapter.open();
    await this.#ensureSyncTables(this.adapter);
    await this.#loadDurableState();
    if (schema) {
      const identity = schemaIdentity(schema);
      const persistedIdentity = await this.getSyncState(STATE_SCHEMA_IDENTITY);
      if (persistedIdentity !== null && persistedIdentity !== identity) {
        throw new SchemaIdentityMismatchError(identity, persistedIdentity);
      }
      this.#knownTables = extractSchemaTables(schema.schema);
      await applySchema(this.adapter, schema);
      await this.setSyncState(STATE_SCHEMA_IDENTITY, identity);
      this.#schemaIdentity = identity;
    }
  }

  /** Delete a local row without generating a sync/outbox change. */
  async purgeLocal<K extends keyof S & string>(table: K, id: string): Promise<void> {
    const tableName = String(table);
    await this.#serialize(async () => {
      await this.#purgeLocalTransaction(this.adapter, tableName, id);
    });
    await this.#notifyLiveQueries([tableName.toLowerCase()]);
  }

  /** Whether a table was declared by the initialized schema. */
  hasTable(table: string): boolean {
    return this.#knownTables.has(table.toLowerCase());
  }

  /**
   * Adopt the durable `nodeId` and engine HLC from `_sync_state`.
   */
  async #loadDurableState(): Promise<void> {
    const persistedNode = await this.getSyncState(STATE_NODE_ID);
    if (persistedNode === null) {
      await this.setSyncState(STATE_NODE_ID, this.#nodeId);
    } else {
      this.#nodeId = persistedNode;
    }
    const persistedHlc = await this.getSyncState(STATE_HLC);
    if (persistedHlc !== null) this.#currentHlc = hlcFromString(persistedHlc);
  }

  /** Suppresses `"changes:local"` while remote ops are being applied. */
  #suppressLocalEmit = false;

  /** Guards one-time DDL of the internal `_sync_*` shadow tables. */
  #syncTablesReady = false;
  /** Idempotently create the column-LWW + durable-state shadow tables (`D3`/`D2b`). */
  async #ensureSyncTables(adpt: StorageAdapter): Promise<void> {
    if (this.#syncTablesReady) return;
    await adpt.exec(SYNC_ROW_META_DDL, []);
    await adpt.exec(SYNC_STATE_DDL, []);
    await adpt.exec(APPLIED_CHANGES_DDL, []);
    await adpt.exec(PENDING_REMOTE_UPDATES_DDL, []);
    this.#syncTablesReady = true;
  }
  #writeChain: Promise<unknown> = Promise.resolve();
  #serialize<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.#writeChain.then(fn, fn);
    this.#writeChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /**
   * Read a durable sync-state value (`_sync_state`), or `null` if unset. Used
   * by the engine (nodeId/HLC) and the sync transport (poll cursor) — keeping
   * `_sync_state` access adapter-neutral inside core (`D2c`, no SQLite in the
   * transport).
   */
  async getSyncState(key: string): Promise<string | null> {
    await this.#ensureSyncTables(this.adapter);
    const rows = await this.adapter.exec<{ value: string }>(
      `SELECT value FROM ${SYNC_STATE} WHERE key = ?`,
      [key],
    );
    return rows[0]?.value ?? null;
  }

  /**
   * Upsert a durable sync-state value. `adpt` defaults to the engine adapter
   * but a transaction-scoped adapter may be passed so the write commits
   * atomically with the operation it records (`D2b` atomic checkpoint).
   */
  async setSyncState(
    key: string,
    value: string,
    adpt: StorageAdapter = this.adapter,
  ): Promise<void> {
    await this.#ensureSyncTables(adpt);
    await adpt.exec(
      `INSERT INTO ${SYNC_STATE} (key, value) VALUES (?, ?)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
      [key, value],
    );
  }

  /** Register a durable side effect for each committed local change. */
  registerLocalChangeCheckpoint(checkpoint: LocalChangeCheckpoint<S>): () => void {
    this.#localChangeCheckpoints.add(checkpoint);
    return () => this.#localChangeCheckpoints.delete(checkpoint);
  }

  acquireSyncTransport(owner: object): void {
    if (this.#syncTransportOwner !== null && this.#syncTransportOwner !== owner) {
      throw new Error("A SyncTransport is already attached to this engine");
    }
    this.#syncTransportOwner = owner;
  }

  releaseSyncTransport(owner: object): void {
    if (this.#syncTransportOwner === owner) this.#syncTransportOwner = null;
  }

  /**
   * Execute a batch of local mutations atomically. The whole batch is stamped
   * with a single HLC (`D2a`), and every written `(table, row, column)` records
   * that HLC in `_sync_row_meta` so a later remote change can column-LWW-
   * reconcile against it (`D3`). Local writes always win locally (their HLC is
   * freshly minted, hence latest), so no gating is applied on this path.
   */
  async tx(callback: (t: TxBuilder<S>) => void): Promise<void> {
    const builder = new TxBuilder<S>();
    const maybePromise: unknown = callback(builder);
    if (maybePromise instanceof Promise) {
      throw new TypeError(
        "tx() callback must be synchronous. Received a Promise — did you accidentally use an async function?",
      );
    }
    const builtOps = builder.build();
    const ops = normalizeOps(builtOps);
    const touchedTables = new Set<string>();
    const changeId = crypto.randomUUID();

    await this.#serialize(async () => {
      if (!isTransactable(this.adapter)) {
        throw new Error("PalladiumEngine writes require transaction support");
      }
      // One HLC per change (only minted when there is something to stamp).
      const hlc = ops.length > 0 ? this.nextSendHlc() : null;
      const localChange =
        hlc === null
          ? null
          : {
              ops,
              touchedTables: [...new Set(ops.map((op) => String(op.table).toLowerCase()))],
              hlc,
              changeId,
            };
      const checkpoints = localChange === null ? [] : [...this.#localChangeCheckpoints];

      const applyAll = async (adpt: StorageAdapter): Promise<void> => {
        await this.#ensureSyncTables(adpt);
        for (const op of ops) {
          touchedTables.add(String(op.table).toLowerCase());
          await this.#applyOp(adpt, op);
          if (hlc !== null) await this.#stampLocalMeta(adpt, op, hlc);
        }
        if (hlc !== null) await this.setSyncState(STATE_HLC, hlcToString(hlc), adpt);
        if (localChange !== null && !this.#suppressLocalEmit) {
          for (const checkpoint of checkpoints) await checkpoint(localChange, adpt);
        }
      };

      await this.adapter.transaction(applyAll);

      if (localChange !== null && !this.#suppressLocalEmit) {
        this.emitter.emit("changes:local", localChange);
      }
    });

    await this.#notifyLiveQueries([...touchedTables]);
  }

  async #isDuplicateRemoteChange(
    adpt: StorageAdapter,
    scope: string,
    changeId: string | undefined,
    payload: string,
  ): Promise<boolean> {
    if (changeId === undefined) return false;
    const prior = await adpt.exec<{ payload: string }>(
      `SELECT payload FROM ${APPLIED_CHANGES} WHERE scope = ? AND change_id = ?`,
      [scope, changeId],
    );
    if (prior[0] === undefined) return false;
    if (prior[0].payload !== payload) throw new Error("Remote change id conflict");
    return true;
  }

  async #applyNewRemoteChange(
    adpt: StorageAdapter,
    ops: ReadonlyArray<Op<S>>,
    hlc: Hlc,
    touchedTables: Set<string>,
  ): Promise<void> {
    this.receiveHlc(hlc);
    if (supportsConstraintDeferral(adpt)) await adpt.deferForeignKeys();
    for (const op of ops) {
      touchedTables.add(String(op.table).toLowerCase());
      await this.#applyRemoteOp(adpt, op, hlc);
    }
  }

  async #recordRemoteChange(
    adpt: StorageAdapter,
    scope: string,
    changeId: string | undefined,
    payload: string,
  ): Promise<void> {
    if (changeId === undefined) return;
    await adpt.exec(
      `INSERT INTO ${APPLIED_CHANGES} (scope, change_id, payload, applied_at) VALUES (?, ?, ?, ?)`,
      [scope, changeId, payload, Date.now()],
    );
  }

  async #checkpointRemoteCursor(adpt: StorageAdapter, cursor: string | undefined): Promise<void> {
    if (cursor === undefined) return;
    const rows = await adpt.exec<{ value: string }>(
      `SELECT value FROM ${SYNC_STATE} WHERE key = ?`,
      [STATE_CURSOR],
    );
    const savedCursor = rows[0]?.value ?? null;
    if (savedCursor === null || cursor > savedCursor) {
      await this.setSyncState(STATE_CURSOR, cursor, adpt);
    }
  }

  async #checkpointRemoteState(adpt: StorageAdapter, cursor: string | undefined): Promise<void> {
    if (this.#currentHlc !== null) {
      await this.setSyncState(STATE_HLC, hlcToString(this.#currentHlc), adpt);
    }
    await this.#checkpointRemoteCursor(adpt, cursor);
  }

  async #applyRemoteTransaction(
    adpt: StorageAdapter,
    change: RemoteChange<S>,
    canonicalOps: ReadonlyArray<Op<S>>,
    touchedTables: Set<string>,
    cursor: string | undefined,
  ): Promise<void> {
    await this.#ensureSyncTables(adpt);
    const scope = change.scope ?? "default";
    const payload = JSON.stringify({ hlc: change.hlc, ops: canonicalOps });
    const duplicate = await this.#isDuplicateRemoteChange(adpt, scope, change.id, payload);
    if (!duplicate) {
      await this.#applyNewRemoteChange(adpt, change.ops, change.hlc, touchedTables);
      await this.#recordRemoteChange(adpt, scope, change.id, payload);
    }
    await this.#checkpointRemoteState(adpt, cursor);
  }

  async #purgeLocalTransaction(adpt: StorageAdapter, tableName: string, id: string): Promise<void> {
    await adpt.remove(tableName, id);
    await adpt.exec(`DELETE FROM ${SYNC_ROW_META} WHERE tbl = ? AND row_id = ?`, [tableName, id]);
    await adpt.exec(`DELETE FROM ${PENDING_REMOTE_UPDATES} WHERE tbl = ? AND row_id = ?`, [
      tableName,
      id,
    ]);
  }

  /**
   * Apply a change received from a remote peer, column-LWW-reconciled by HLC.
   * An optional cursor is checkpointed atomically with the remote change.
   */
  async applyRemote(change: RemoteChange<S>, cursor?: string): Promise<void> {
    const { hlc, ops } = change;
    if (!isValidHlc(hlc)) throw new TypeError("Invalid remote HLC");
    const canonicalOps = normalizeOps(ops);
    if (!sameOps(ops, canonicalOps)) throw new TypeError("Remote change is not canonical");
    for (const op of ops) {
      if (!isUuidV7(op.id)) throw new TypeError("Remote row id must be a canonical UUIDv7");
    }
    if (ops.length === 0) return;
    const touchedTables = new Set<string>();
    await this.#serialize(async () => {
      if (!isTransactable(this.adapter)) {
        throw new Error("PalladiumEngine writes require transaction support");
      }
      const applyAll = async (adpt: StorageAdapter): Promise<void> => {
        await this.#applyRemoteTransaction(adpt, change, canonicalOps, touchedTables, cursor);
      };
      this.#suppressLocalEmit = true;
      try {
        await this.adapter.transaction(applyAll);
      } finally {
        this.#suppressLocalEmit = false;
      }
    });
    await this.#notifyLiveQueries([...touchedTables]);
  }

  /**
   * Apply a complete remote page. Each change commits independently, so a
   * rejected change cannot retain a prefix of its operations or roll back prior
   * successful changes. `afterApply` runs in a final transaction only when
   * every change applied, letting a transport atomically persist its page
   * checkpoint and associated durable side effects before acknowledgement.
   *
   * A rejected change is reported to `onRejected` in its own transaction after
   * the failed change has rolled back. Successful changes remain durable, but
   * `afterApply` is withheld so a caller can replay the page from its prior
   * checkpoint.
   *
   * @internal Transport coordination primitive; application code should use
   * {@link applyRemote} for individual changes.
   */
  async applyRemotePage(
    changes: ReadonlyArray<RemoteChange<S>>,
    purges: ReadonlyArray<{ readonly table: keyof S & string; readonly id: string }>,
    afterApply: (adapter: StorageAdapter) => Promise<void>,
    onRejected?: (
      change: RemoteChange<S>,
      error: unknown,
      adapter: StorageAdapter,
    ) => Promise<void>,
  ): Promise<boolean> {
    const prepared = changes.map((change) => {
      if (!isValidHlc(change.hlc)) throw new TypeError("Invalid remote HLC");
      const canonicalOps = normalizeOps(change.ops);
      if (!sameOps(change.ops, canonicalOps)) throw new TypeError("Remote change is not canonical");
      for (const op of change.ops) {
        if (!isUuidV7(op.id)) throw new TypeError("Remote row id must be a canonical UUIDv7");
      }
      return { change, canonicalOps };
    });
    const touchedTables = new Set<string>();
    let allApplied = true;
    await this.#serialize(async () => {
      if (!isTransactable(this.adapter)) {
        throw new Error("PalladiumEngine writes require transaction support");
      }
      this.#suppressLocalEmit = true;
      try {
        for (const { change, canonicalOps } of prepared) {
          const changeTouchedTables = new Set<string>();
          try {
            await this.adapter.transaction(async (adpt) => {
              await this.#applyRemoteTransaction(
                adpt,
                change,
                canonicalOps,
                changeTouchedTables,
                undefined,
              );
            });
            for (const table of changeTouchedTables) touchedTables.add(table);
          } catch (error) {
            if (onRejected === undefined) throw error;
            allApplied = false;
            await this.adapter.transaction(async (adpt) => {
              await onRejected(change, error, adpt);
            });
          }
        }
        if (!allApplied) return;
        await this.adapter.transaction(async (adpt) => {
          for (const purge of purges) {
            await this.#purgeLocalTransaction(adpt, String(purge.table), purge.id);
            touchedTables.add(String(purge.table).toLowerCase());
          }
          await afterApply(adpt);
        });
      } finally {
        this.#suppressLocalEmit = false;
      }
    });
    await this.#notifyLiveQueries([...touchedTables]);
    return allApplied;
  }

  /** Shorthand for single-row insert. */
  async insert<K extends keyof S & string>(table: K, data: S[K]): Promise<void> {
    return this.tx((t) => {
      t.insert(table, data);
    });
  }

  /** Shorthand for single-row update. */
  async update<K extends keyof S & string>(
    table: K,
    id: string,
    patch: Partial<S[K]>,
  ): Promise<void> {
    return this.tx((t) => {
      t.update(table, id, patch);
    });
  }

  /** Shorthand for single-row delete. */
  async delete<K extends keyof S & string>(table: K, id: string): Promise<void> {
    return this.tx((t) => {
      t.delete(table, id);
    });
  }

  /** Execute a raw SQL query. */
  async exec<T = Record<string, unknown>>(query: SqlQuery): Promise<T[]> {
    return this.adapter.exec<T>(query.text, query.params);
  }

  /**
   * Create a reactive live query. Automatically deregisters on cancel().
   * @deprecated LiveQuery runs on the same thread as the engine. In worker-based
   * architectures (OPFS / SharedArrayBuffer), use framework composables or a
   * message-bus subscription instead.
   */
  liveQuery<T = Record<string, unknown>>(query: SqlQuery): LiveQuery<T> {
    const lq = new LiveQuery<T>(query, this.adapter, () => {
      // Stryker disable next-line all -- removing delete is observably equivalent: cancelled lq returns early from notifyTables
      this.#liveQueries.delete(lq as LiveQuery);
    });
    this.#liveQueries.add(lq as LiveQuery);
    return lq;
  }

  /** Subscribe to engine events. */
  on<K extends keyof EngineEvents<S>>(
    event: K,
    listener: (payload: EngineEvents<S>[K]) => void,
  ): () => void {
    // Cast through unknown to bridge the Listener<T> conditional type.
    return this.emitter.on(event, listener as unknown as Parameters<typeof this.emitter.on<K>>[1]);
  }

  /** Poll the current sync status. */
  getSyncStatus(): SyncStatus {
    return this.status;
  }

  /** Update the sync status and emit a `sync:status` event. */
  setStatus(s: SyncStatus): void {
    this.status = s;
    this.emitter.emit("sync:status", s);
  }

  async #applyOp(adpt: StorageAdapter, op: Op<S>): Promise<void> {
    const table = String(op.table);
    if (op.type === "insert") {
      await this._putRow(
        adpt,
        table,
        (op.data as unknown as { id: string }).id,
        op.data as Record<string, unknown>,
      );
    } else if (op.type === "update") {
      await this._patchRow(adpt, table, op.id, op.patch as Record<string, unknown>);
    } else {
      await this._removeRow(adpt, table, op.id);
    }
  }

  /** Override to intercept or augment storage writes (e.g. server replication). */
  protected async _putRow(
    adpt: StorageAdapter,
    table: string,
    id: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    await adpt.put(table, id, data);
  }

  protected async _patchRow(
    adpt: StorageAdapter,
    table: string,
    id: string,
    patch: Record<string, unknown>,
  ): Promise<void> {
    await adpt.patch(table, id, patch);
  }

  protected async _removeRow(adpt: StorageAdapter, table: string, id: string): Promise<void> {
    await adpt.remove(table, id);
  }

  async #notifyLiveQueries(tables: string[]): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const lq of this.#liveQueries) {
      promises.push(lq.notifyTables(tables));
    }
    await Promise.all(promises);
  }

  // ── Column-LWW shadow-table helpers (`_sync_row_meta`, D3/D4) ──────────────

  /** Read the stored write HLC for one `(table, row, column)`, or `null`. */
  async #getColMeta(
    adpt: StorageAdapter,
    table: string,
    rowId: string,
    col: string,
  ): Promise<Hlc | null> {
    const rows = await adpt.exec<MetaRow>(
      `SELECT hlc_wall_ms, hlc_counter, hlc_node_id FROM ${SYNC_ROW_META}
         WHERE tbl = ? AND row_id = ? AND col = ?`,
      [table, rowId, col],
    );
    return rows[0] ? metaRowToHlc(rows[0]) : null;
  }

  /** Highest write HLC across all *data* columns of a row (excludes the tombstone). */
  async #maxColMeta(adpt: StorageAdapter, table: string, rowId: string): Promise<Hlc | null> {
    const rows = await adpt.exec<MetaRow>(
      `SELECT hlc_wall_ms, hlc_counter, hlc_node_id FROM ${SYNC_ROW_META}
         WHERE tbl = ? AND row_id = ? AND col != ?`,
      [table, rowId, DELETED_COL],
    );
    let max: Hlc | null = null;
    for (const r of rows) {
      const h = metaRowToHlc(r);
      if (max === null || compareHlc(h, max) > 0) max = h;
    }
    return max;
  }

  /** Upsert the write HLC for one `(table, row, column)`. */
  async #putColMeta(
    adpt: StorageAdapter,
    table: string,
    rowId: string,
    col: string,
    hlc: Hlc,
  ): Promise<void> {
    await adpt.exec(
      `INSERT INTO ${SYNC_ROW_META} (tbl, row_id, col, hlc_wall_ms, hlc_counter, hlc_node_id)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (tbl, row_id, col) DO UPDATE SET
           hlc_wall_ms = excluded.hlc_wall_ms,
           hlc_counter = excluded.hlc_counter,
           hlc_node_id = excluded.hlc_node_id`,
      [table, rowId, col, hlc.wallMs, hlc.counter, hlc.nodeId],
    );
  }

  async #bufferRemoteUpdate(
    adpt: StorageAdapter,
    table: string,
    rowId: string,
    patch: Record<string, unknown>,
    hlc: Hlc,
  ): Promise<void> {
    const pendingId = `${table}\u0000${rowId}\u0000${hlc.wallMs}\u0000${hlc.counter}\u0000${hlc.nodeId}\u0000${JSON.stringify(patch)}`;
    await adpt.exec(
      `INSERT OR REPLACE INTO ${PENDING_REMOTE_UPDATES}
       (pending_id, tbl, row_id, patch, hlc_wall_ms, hlc_counter, hlc_node_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [pendingId, table, rowId, JSON.stringify(patch), hlc.wallMs, hlc.counter, hlc.nodeId],
    );
  }

  async #pendingRemoteUpdates(
    adpt: StorageAdapter,
    table: string,
    rowId: string,
  ): Promise<PendingRemoteUpdateRow[]> {
    return adpt.exec<PendingRemoteUpdateRow>(
      `SELECT pending_id, patch, hlc_wall_ms, hlc_counter, hlc_node_id
       FROM ${PENDING_REMOTE_UPDATES} WHERE tbl = ? AND row_id = ?
       ORDER BY hlc_wall_ms ASC, hlc_counter ASC, hlc_node_id ASC, pending_id ASC`,
      [table, rowId],
    );
  }

  async #clearPendingRemoteUpdates(
    adpt: StorageAdapter,
    table: string,
    rowId: string,
  ): Promise<void> {
    await adpt.exec(`DELETE FROM ${PENDING_REMOTE_UPDATES} WHERE tbl = ? AND row_id = ?`, [
      table,
      rowId,
    ]);
  }

  /** Drop the delete tombstone for a row (on resurrection). */
  async #clearTombstone(adpt: StorageAdapter, table: string, rowId: string): Promise<void> {
    await adpt.exec(`DELETE FROM ${SYNC_ROW_META} WHERE tbl = ? AND row_id = ? AND col = ?`, [
      table,
      rowId,
      DELETED_COL,
    ]);
  }

  /** Stamp a set of columns of one row with the same write HLC. */
  async #stampCols(
    adpt: StorageAdapter,
    table: string,
    rowId: string,
    cols: Iterable<string>,
    hlc: Hlc,
  ): Promise<void> {
    for (const col of cols) {
      await this.#putColMeta(adpt, table, rowId, col, hlc);
    }
  }

  /** Stamp every column a *local* op writes with the change's HLC (no gating). */
  async #stampLocalMeta(adpt: StorageAdapter, op: Op<S>, hlc: Hlc): Promise<void> {
    const table = String(op.table);
    if (op.type === "insert") {
      const data = op.data as unknown as Record<string, unknown> & {
        id: string;
      };
      await this.#clearTombstone(adpt, table, data.id);
      await this.#stampCols(adpt, table, data.id, Object.keys(data), hlc);
    } else if (op.type === "update") {
      await this.#stampCols(
        adpt,
        table,
        op.id,
        Object.keys(op.patch as Record<string, unknown>),
        hlc,
      );
    } else {
      await this.#putColMeta(adpt, table, op.id, DELETED_COL, hlc);
    }
  }

  /**
   * Column-LWW filter: keep only the `fields` whose incoming `hlc` strictly
   * beats the stored per-column write HLC (`compareHlc` tie-breaks on `nodeId`).
   */
  async #winningCols(
    adpt: StorageAdapter,
    table: string,
    rowId: string,
    fields: Record<string, unknown>,
    hlc: Hlc,
  ): Promise<Record<string, unknown>> {
    const winning: Record<string, unknown> = {};
    for (const [col, value] of Object.entries(fields)) {
      const stored = await this.#getColMeta(adpt, table, rowId, col);
      if (stored === null || compareHlc(hlc, stored) > 0) winning[col] = value;
    }
    return winning;
  }

  /**
   * Apply one remote op with column-level LWW gating against `_sync_row_meta`.
   * A column is written only when the incoming `hlc` strictly beats the stored
   * write HLC; deletes reconcile against the row's newest column write and
   * leave a durable tombstone.
   */
  async #applyRemoteOp(adpt: StorageAdapter, op: Op<S>, hlc: Hlc): Promise<void> {
    const table = String(op.table);
    // Remote ops arrive from an untrusted peer/server, and the table + column
    // names are interpolated into SQL (`SELECT … FROM ${table}`, `INSERT …
    // (${cols})`). Reject anything that isn't a plain identifier so a malicious
    // change can't inject SQL — the throw quarantines the change (D2a) rather
    // than corrupting the local store.
    assertSqlIdentifier(table);
    if (op.type === "insert") {
      for (const col of Object.keys(op.data)) assertSqlIdentifier(col);
      await this.#applyRemoteInsert(adpt, table, op, hlc);
    } else if (op.type === "update") {
      for (const col of Object.keys(op.patch)) assertSqlIdentifier(col);
      await this.#applyRemoteUpdate(adpt, table, op, hlc);
    } else {
      await this.#applyRemoteDelete(adpt, table, op.id, hlc);
    }
  }

  async #applyRemoteInsert(
    adpt: StorageAdapter,
    table: string,
    op: Extract<Op<S>, { type: "insert" }>,
    hlc: Hlc,
  ): Promise<void> {
    const data = op.data as unknown as Record<string, unknown> & { id: string };
    const tombstone = await this.#getColMeta(adpt, table, data.id, DELETED_COL);
    if (tombstone !== null && compareHlc(hlc, tombstone) <= 0) return;
    const winning = await this.#winningCols(adpt, table, data.id, data, hlc);
    if (Object.keys(winning).length === 0) return;

    if (tombstone === null) {
      const existing = await adpt.exec(`SELECT 1 FROM ${table} WHERE id = ? LIMIT 1`, [data.id]);
      if (existing.length === 0) {
        await this._putRow(adpt, table, data.id, data);
        await this.#stampCols(adpt, table, data.id, Object.keys(data), hlc);
      } else {
        await this._patchRow(adpt, table, data.id, winning);
        await this.#stampCols(adpt, table, data.id, Object.keys(winning), hlc);
      }
    } else {
      await this.#clearTombstone(adpt, table, data.id);
      await this._putRow(adpt, table, data.id, data);
      await this.#stampCols(adpt, table, data.id, Object.keys(data), hlc);
    }

    const pending = await this.#pendingRemoteUpdates(adpt, table, data.id);
    await this.#clearPendingRemoteUpdates(adpt, table, data.id);
    for (const row of pending) {
      await this.#applyRemoteUpdate(
        adpt,
        table,
        {
          type: "update",
          table: op.table,
          id: data.id,
          patch: JSON.parse(row.patch) as Record<string, unknown>,
        } as Extract<Op<S>, { type: "update" }>,
        metaRowToHlc(row),
      );
    }
  }

  async #applyRemoteUpdate(
    adpt: StorageAdapter,
    table: string,
    op: Extract<Op<S>, { type: "update" }>,
    hlc: Hlc,
  ): Promise<void> {
    const tombstone = await this.#getColMeta(adpt, table, op.id, DELETED_COL);
    if (tombstone !== null && compareHlc(hlc, tombstone) <= 0) return;
    const existing = await adpt.exec(`SELECT 1 FROM ${table} WHERE id = ? LIMIT 1`, [op.id]);
    if (existing.length === 0) {
      await this.#bufferRemoteUpdate(adpt, table, op.id, op.patch as Record<string, unknown>, hlc);
      return;
    }
    const winning = await this.#winningCols(
      adpt,
      table,
      op.id,
      op.patch as Record<string, unknown>,
      hlc,
    );
    if (Object.keys(winning).length === 0) return;
    if (tombstone !== null) await this.#clearTombstone(adpt, table, op.id);
    await this._patchRow(adpt, table, op.id, winning);
    await this.#stampCols(adpt, table, op.id, Object.keys(winning), hlc);
  }

  async #applyRemoteDelete(
    adpt: StorageAdapter,
    table: string,
    rowId: string,
    hlc: Hlc,
  ): Promise<void> {
    const maxCol = await this.#maxColMeta(adpt, table, rowId);
    if (maxCol !== null && compareHlc(hlc, maxCol) < 0) return;
    await this._removeRow(adpt, table, rowId);
    await this.#putColMeta(adpt, table, rowId, DELETED_COL, hlc);
  }
}

/** Factory — create a `PalladiumEngine` with the given adapter and options. */
export function createEngine<S extends SchemaMap>(
  adapter: StorageAdapter,
  options?: PalladiumEngineOptions | BlobAdapter,
): PalladiumEngine<S> {
  return new PalladiumEngine<S>(adapter, options);
}

/** Coerces an unknown thrown value to an `Error` instance. */
export function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}
