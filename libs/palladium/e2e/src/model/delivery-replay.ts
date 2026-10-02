import { deepStrictEqual, match, ok, strictEqual } from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createEngine,
  generateUuidV7,
  type PalladiumEngine,
  type SchemaConfig,
  SyncTransport,
  type WireChange,
} from "@palladium/core";
import { NodeSqliteAdapter } from "@palladium/sqlite-node";
import { type ManagedServer, rustBinary, startServer } from "../setup/process.js";
import type { DeliveryState, DeliveryTrace } from "./quint.js";

type NoteRow = {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly created_at: number;
};

type NotesSchema = { notes: NoteRow };

type OutboxRow = {
  readonly change_id: string;
  readonly hlc_wall_ms: number;
  readonly hlc_counter: number;
  readonly hlc_node_id: string;
  readonly ops: string;
  readonly schema_fingerprint: string;
  readonly retry_attempts: number;
  readonly next_retry_at: number | null;
  readonly terminal: number;
  readonly terminal_error: string | null;
  readonly created_at: number;
};

type StableOutboxRow = Omit<OutboxRow, "retry_attempts" | "next_retry_at">;

type QuarantineRow = {
  readonly change_id: string;
  readonly ops: string;
  readonly attempts: number;
  readonly permanent: number;
  readonly disposition: string | null;
};

type ServerPage = {
  readonly changes: readonly WireChange[];
  readonly cursor: string;
};

interface ReplayClient {
  readonly engine: PalladiumEngine<NotesSchema>;
  readonly transport: SyncTransport<NotesSchema>;
  close(): Promise<void>;
}

class DeliveryReplayCleanupError extends AggregateError {}

const USER = "quint-delivery-pilot";
const POLL_INTERVAL_MS = 60_000;
const SCHEMA: SchemaConfig = {
  version: 1,
  schema:
    "CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL)",
};
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

class DeterministicClock {
  #now = Date.now();

  tick(): void {
    this.#now += 1;
  }

  advanceTo(timestamp: number): void {
    this.#now = Math.max(this.#now, timestamp);
  }

  async run<T>(operation: () => Promise<T>): Promise<T> {
    const realNow = Date.now;
    Date.now = () => this.#now;
    try {
      return await operation();
    } finally {
      Date.now = realNow;
    }
  }
}

class TransparentFaultFetch {
  #dropNextReceipt = false;
  #truncateNextPage = false;
  readonly postedBodies: string[] = [];

  dropNextReceipt(): void {
    strictEqual(this.#dropNextReceipt, false, "receipt-loss fault was already armed");
    this.#dropNextReceipt = true;
  }

  truncateNextPage(): void {
    strictEqual(this.#truncateNextPage, false, "page-truncation fault was already armed");
    this.#truncateNextPage = true;
  }

  assertReceiptFaultConsumed(): void {
    strictEqual(this.#dropNextReceipt, false, "receipt-loss fault did not observe a real POST");
  }

  assertPageFaultConsumed(): void {
    strictEqual(this.#truncateNextPage, false, "page-truncation fault did not observe a real GET");
  }

  readonly fetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const isChangePost = request.method === "POST" && url.pathname === "/v1/changes";
    const isChangeGet = request.method === "GET" && url.pathname === "/v1/changes";

    if (isChangePost) this.postedBodies.push(await request.clone().text());

    const response = await globalThis.fetch(request);
    if (isChangePost && this.#dropNextReceipt) {
      this.#dropNextReceipt = false;
      await response.arrayBuffer();
      throw new TypeError("deterministic receipt loss after the real Atrium response");
    }
    if (isChangeGet && this.#truncateNextPage) {
      this.#truncateNextPage = false;
      const bytes = new Uint8Array(await response.arrayBuffer());
      strictEqual(bytes.byteLength > 1, true, "Atrium page was too short to truncate");
      const headers = new Headers(response.headers);
      headers.delete("content-length");
      return new Response(bytes.slice(0, Math.max(1, Math.floor(bytes.byteLength / 2))), {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    }
    return response;
  };
}

function normalizeSet(values: readonly number[]): number[] {
  return [...values].sort((left, right) => left - right);
}

function errorText(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

async function startAtrium(directory: string, port?: number): Promise<ManagedServer> {
  return startServer({
    name: "Atrium Quint delivery replay",
    binary: rustBinary("atrium"),
    args: (boundPort) => [
      "--atrium-db",
      "sqlite:atrium.db",
      "--port",
      String(boundPort),
      "--auth-mode",
      "dev",
    ],
    cwd: directory,
    readinessPath: "/v1/health",
    ...(port === undefined ? {} : { port }),
  });
}

class DeliveryReplayHarness {
  readonly #directory: string;
  readonly #clock = new DeterministicClock();
  readonly #writerFaults = new TransparentFaultFetch();
  readonly #readerFaults = new TransparentFaultFetch();
  readonly #rowIds = new Map<number, string>();
  readonly #changeIds = new Map<number, string>();
  readonly #slotsByChangeId = new Map<string, number>();
  readonly #stableOutbox = new Map<number, StableOutboxRow>();
  readonly #expectedRetries = new Map<number, number>();
  readonly #quarantineAttempts = new Map<number, number>();
  readonly #cursorPrefixes = new Map<string, number>();
  readonly #prefixCursors = new Map<number, string>();
  readonly #inspectorNode = randomUUID();
  #workspace = "";
  #server: ManagedServer | undefined;
  #writer: ReplayClient | undefined;
  #reader: ReplayClient | undefined;

  private constructor(directory: string) {
    this.#directory = directory;
  }

  static async create(directory: string): Promise<DeliveryReplayHarness> {
    const harness = new DeliveryReplayHarness(directory);
    try {
      harness.#server = await startAtrium(directory);
      harness.#workspace = await harness.#createWorkspace();
      harness.#writer = await harness.#openClient(
        join(directory, "writer.db"),
        harness.#writerFaults,
      );
      harness.#reader = await harness.#openClient(
        join(directory, "reader.db"),
        harness.#readerFaults,
      );
      return harness;
    } catch (error) {
      try {
        await harness.close();
      } catch (cleanupError) {
        throw new DeliveryReplayCleanupError(
          [error, cleanupError],
          "delivery replay setup and cleanup failed",
        );
      }
      throw error;
    }
  }

  get #baseUrl(): string {
    if (this.#server === undefined) throw new Error("Atrium is not running");
    return this.#server.baseUrl;
  }

  get #activeWriter(): ReplayClient {
    if (this.#writer === undefined) throw new Error("writer client is not open");
    return this.#writer;
  }

  get #activeReader(): ReplayClient {
    if (this.#reader === undefined) throw new Error("reader client is not open");
    return this.#reader;
  }

  async #createWorkspace(): Promise<string> {
    const response = await fetch(`${this.#baseUrl}/v1/workspaces`, {
      method: "POST",
      headers: { Authorization: `Bearer ${USER}` },
    });
    if (!response.ok) {
      throw new Error(`workspace creation failed (${response.status}): ${await response.text()}`);
    }
    const body: unknown = await response.json();
    if (
      typeof body !== "object" ||
      body === null ||
      Array.isArray(body) ||
      !("id" in body) ||
      typeof body.id !== "string"
    ) {
      throw new Error("workspace creation returned no string id");
    }
    return body.id;
  }

  async #openClient(filename: string, faults: TransparentFaultFetch): Promise<ReplayClient> {
    const engine = createEngine<NotesSchema>(
      new NodeSqliteAdapter({ vfs: { type: "file", filename } }),
      { nodeId: randomUUID() },
    );
    let transport: SyncTransport<NotesSchema> | undefined;
    try {
      await engine.init(SCHEMA);
      transport = new SyncTransport(engine, {
        serverUrl: this.#baseUrl,
        fetch: faults.fetch,
        pollIntervalMs: POLL_INTERVAL_MS,
        authHeaders: () => ({
          Authorization: `Bearer ${USER}`,
          "X-Workspace": this.#workspace,
        }),
      });
      await transport.inspectQuarantine();
    } catch (error) {
      const cleanupFailures: unknown[] = [];
      if (transport !== undefined) {
        try {
          await transport.dispose();
        } catch (cleanupError) {
          cleanupFailures.push(cleanupError);
        }
      }
      try {
        await engine.adapter.close();
      } catch (cleanupError) {
        cleanupFailures.push(cleanupError);
      }
      if (cleanupFailures.length > 0) {
        throw new DeliveryReplayCleanupError(
          [error, ...cleanupFailures],
          "client setup and cleanup failed",
        );
      }
      throw error;
    }
    if (transport === undefined) throw new Error("client transport was not initialized");
    const activeTransport = transport;
    return {
      engine,
      transport: activeTransport,
      close: async () => {
        let failure: unknown;
        try {
          await activeTransport.dispose();
        } catch (error) {
          failure = error;
        }
        try {
          await engine.adapter.close();
        } catch (error) {
          failure ??= error;
        }
        if (failure !== undefined) {
          throw new DeliveryReplayCleanupError([failure], "client cleanup failed");
        }
      },
    };
  }

  #rowId(slot: number): string {
    const existing = this.#rowIds.get(slot);
    if (existing !== undefined) return existing;
    const generated = generateUuidV7();
    match(generated, UUID_V7, `slot ${slot} did not receive a UUIDv7 row id`);
    this.#rowIds.set(slot, generated);
    return generated;
  }

  #note(slot: number): NoteRow {
    return {
      id: this.#rowId(slot),
      title: `Quint delivery ${slot}`,
      body: `model-slot-${slot}`,
      created_at: slot,
    };
  }

  async #outboxRows(): Promise<readonly OutboxRow[]> {
    return this.#activeWriter.engine.adapter.exec<OutboxRow>(
      `SELECT change_id, hlc_wall_ms, hlc_counter, hlc_node_id, ops, schema_fingerprint,
              retry_attempts, next_retry_at, terminal, terminal_error, created_at
         FROM _sync_outbox
        ORDER BY hlc_wall_ms ASC, hlc_counter ASC, change_id ASC`,
      [],
    );
  }

  async #makeFirstOutboxRowEligible(): Promise<void> {
    const first = (await this.#outboxRows())[0];
    if (first?.next_retry_at !== null && first?.next_retry_at !== undefined) {
      this.#clock.advanceTo(first.next_retry_at);
    }
  }

  #rememberOutbox(slot: number, row: OutboxRow): void {
    match(row.change_id, UUID_V4, `slot ${slot} did not receive a UUIDv4 change id`);
    strictEqual(this.#slotsByChangeId.has(row.change_id), false, "generated change id was reused");
    this.#changeIds.set(slot, row.change_id);
    this.#slotsByChangeId.set(row.change_id, slot);
    this.#stableOutbox.set(slot, {
      change_id: row.change_id,
      hlc_wall_ms: row.hlc_wall_ms,
      hlc_counter: row.hlc_counter,
      hlc_node_id: row.hlc_node_id,
      ops: row.ops,
      schema_fingerprint: row.schema_fingerprint,
      terminal: row.terminal,
      terminal_error: row.terminal_error,
      created_at: row.created_at,
    });
    this.#expectedRetries.set(slot, 0);
  }

  async #enqueue(slot: number): Promise<void> {
    strictEqual(this.#changeIds.has(slot), false, `slot ${slot} was already committed`);
    this.#clock.tick();
    await this.#clock.run(() => this.#activeWriter.engine.insert("notes", this.#note(slot)));
    const matching = (await this.#outboxRows()).filter(
      (row) => !this.#slotsByChangeId.has(row.change_id),
    );
    strictEqual(matching.length, 1, `enqueue for slot ${slot} did not add exactly one queue row`);
    const inserted = matching[0];
    if (inserted === undefined)
      throw new Error(`enqueue for slot ${slot} had no durable queue row`);
    this.#rememberOutbox(slot, inserted);
  }

  async #rejectEnqueue(slot: number): Promise<void> {
    const adapter = this.#activeWriter.engine.adapter;
    await adapter.exec(
      "CREATE TRIGGER quint_reject_outbox BEFORE INSERT ON _sync_outbox BEGIN SELECT RAISE(ABORT, 'quint reject enqueue'); END",
      [],
    );
    this.#clock.tick();
    let rejected = false;
    try {
      await this.#clock.run(() => this.#activeWriter.engine.insert("notes", this.#note(slot)));
    } catch (error) {
      if (!errorText(error).includes("quint reject enqueue")) throw error;
      rejected = true;
    } finally {
      await adapter.exec("DROP TRIGGER IF EXISTS quint_reject_outbox", []);
    }
    strictEqual(rejected, true, "outbox trigger did not reject the local transaction");
  }

  async #upload(): Promise<void> {
    await this.#makeFirstOutboxRowEligible();
    this.#clock.tick();
    await this.#clock.run(() => this.#activeWriter.transport.syncOnce());
  }

  async #loseReceipt(): Promise<void> {
    await this.#makeFirstOutboxRowEligible();
    const first = (await this.#outboxRows())[0];
    if (first === undefined) throw new Error("loseReceipt requires a durable queue row");
    const slot = this.#slotForChange(first.change_id);
    this.#writerFaults.dropNextReceipt();
    this.#clock.tick();
    await this.#clock.run(() => this.#activeWriter.transport.syncOnce());
    this.#writerFaults.assertReceiptFaultConsumed();
    this.#expectedRetries.set(slot, (this.#expectedRetries.get(slot) ?? 0) + 1);
  }

  async #losePage(): Promise<void> {
    this.#readerFaults.truncateNextPage();
    this.#clock.tick();
    await this.#clock.run(() => this.#activeReader.transport.poll());
    this.#readerFaults.assertPageFaultConsumed();
  }

  async #failCheckpoint(): Promise<void> {
    const adapter = this.#activeReader.engine.adapter;
    await adapter.exec(
      `CREATE TRIGGER quint_reject_checkpoint BEFORE INSERT ON _sync_state
         WHEN NEW.key = 'append_cursor_v1'
         BEGIN SELECT RAISE(ABORT, 'quint reject checkpoint'); END`,
      [],
    );
    this.#clock.tick();
    let rejected = false;
    try {
      await this.#clock.run(() => this.#activeReader.transport.poll());
    } catch (error) {
      if (!errorText(error).includes("quint reject checkpoint")) throw error;
      rejected = true;
    } finally {
      await adapter.exec("DROP TRIGGER IF EXISTS quint_reject_checkpoint", []);
    }
    strictEqual(rejected, true, "checkpoint trigger did not reject the final page transaction");
  }

  async #rejectChange(slot: number): Promise<void> {
    const rowId = this.#rowIds.get(slot);
    if (rowId === undefined) throw new Error(`rejectChange referenced unknown slot ${slot}`);
    match(rowId, UUID_V7);
    const adapter = this.#activeReader.engine.adapter;
    await adapter.exec(
      `CREATE TRIGGER quint_reject_note BEFORE INSERT ON notes
         WHEN NEW.id = '${rowId}'
         BEGIN SELECT RAISE(ABORT, 'quint reject remote change'); END`,
      [],
    );
    this.#clock.tick();
    try {
      await this.#clock.run(() => this.#activeReader.transport.poll());
    } finally {
      await adapter.exec("DROP TRIGGER IF EXISTS quint_reject_note", []);
    }
    this.#quarantineAttempts.set(slot, (this.#quarantineAttempts.get(slot) ?? 0) + 1);
  }

  async #poll(): Promise<void> {
    this.#clock.tick();
    await this.#clock.run(() => this.#activeReader.transport.poll());
  }

  async #restartWriter(): Promise<void> {
    const current = this.#activeWriter;
    await current.close();
    this.#writer = undefined;
    this.#writer = await this.#openClient(join(this.#directory, "writer.db"), this.#writerFaults);
  }

  async #restartReader(): Promise<void> {
    const current = this.#activeReader;
    await current.close();
    this.#reader = undefined;
    this.#reader = await this.#openClient(join(this.#directory, "reader.db"), this.#readerFaults);
  }

  async #restartServer(): Promise<void> {
    const current = this.#server;
    if (current === undefined) throw new Error("cannot restart a missing Atrium process");
    const port = current.port;
    await current.crash();
    this.#server = undefined;
    this.#server = await startAtrium(this.#directory, port);
  }

  async step(state: DeliveryState): Promise<void> {
    switch (state.lastAction) {
      case "enqueue":
        await this.#enqueue(state.lastId);
        return;
      case "rejectEnqueue":
        await this.#rejectEnqueue(state.lastId);
        return;
      case "upload":
        await this.#upload();
        return;
      case "loseReceipt":
        await this.#loseReceipt();
        return;
      case "losePage":
        await this.#losePage();
        return;
      case "failCheckpoint":
        await this.#failCheckpoint();
        return;
      case "rejectChange":
        await this.#rejectChange(state.lastId);
        return;
      case "poll":
        await this.#poll();
        return;
      case "restartWriter":
        await this.#restartWriter();
        return;
      case "restartReader":
        await this.#restartReader();
        return;
      case "restartServer":
        await this.#restartServer();
        return;
      default:
        throw new Error(`unsupported delivery action ${JSON.stringify(state.lastAction)}`);
    }
  }

  #slotForChange(changeId: string): number {
    const slot = this.#slotsByChangeId.get(changeId);
    if (slot === undefined) throw new Error(`unknown real change id ${changeId}`);
    return slot;
  }

  #slotsForRows(rows: readonly NoteRow[]): number[] {
    const slotsByRow = new Map([...this.#rowIds].map(([slot, id]) => [id, slot] as const));
    return rows.map((row) => {
      const slot = slotsByRow.get(row.id);
      if (slot === undefined) throw new Error(`unknown real row id ${row.id}`);
      const expected = this.#note(slot);
      strictEqual(row.id, expected.id, `slot ${slot} durable note id changed`);
      strictEqual(row.title, expected.title, `slot ${slot} durable note title changed`);
      strictEqual(row.body, expected.body, `slot ${slot} durable note body changed`);
      strictEqual(
        row.created_at,
        expected.created_at,
        `slot ${slot} durable note timestamp changed`,
      );
      return slot;
    });
  }

  #wirePayload(row: StableOutboxRow): string {
    return JSON.stringify({
      id: row.change_id,
      hlc: {
        wallMs: row.hlc_wall_ms,
        counter: row.hlc_counter,
        nodeId: row.hlc_node_id,
      },
      ops: JSON.parse(row.ops),
    });
  }

  #observeCursor(cursor: string, prefix: number): void {
    const existingPrefix = this.#cursorPrefixes.get(cursor);
    if (existingPrefix === undefined) {
      this.#cursorPrefixes.set(cursor, prefix);
    } else {
      strictEqual(existingPrefix, prefix, `opaque cursor ${cursor} changed history prefix`);
    }
    const existingCursor = this.#prefixCursors.get(prefix);
    if (existingCursor === undefined) {
      this.#prefixCursors.set(prefix, cursor);
    } else {
      strictEqual(existingCursor, cursor, `history prefix ${prefix} produced two opaque cursors`);
    }
  }

  async #serverPage(): Promise<ServerPage> {
    const response = await fetch(`${this.#baseUrl}/v1/changes?limit=100`, {
      headers: {
        Authorization: `Bearer ${USER}`,
        "X-Workspace": this.#workspace,
        "X-Palladium-Node": this.#inspectorNode,
      },
    });
    if (!response.ok) {
      throw new Error(`history inspection failed (${response.status}): ${await response.text()}`);
    }
    const body: unknown = await response.json();
    if (
      typeof body !== "object" ||
      body === null ||
      Array.isArray(body) ||
      !("changes" in body) ||
      !Array.isArray(body.changes) ||
      !("cursor" in body) ||
      typeof body.cursor !== "string"
    ) {
      throw new Error("Atrium returned an invalid history page during replay inspection");
    }
    return { changes: body.changes as WireChange[], cursor: body.cursor };
  }

  async assertState(state: DeliveryState): Promise<void> {
    const writerNotes = await this.#activeWriter.engine.adapter.exec<NoteRow>(
      "SELECT id, title, body, created_at FROM notes ORDER BY created_at ASC, id ASC",
      [],
    );
    deepStrictEqual(
      normalizeSet(this.#slotsForRows(writerNotes)),
      normalizeSet(state.committed),
      "writer durable rows do not match committed model slots",
    );

    const queue = await this.#outboxRows();
    deepStrictEqual(
      queue.map((row) => this.#slotForChange(row.change_id)),
      [...state.outbox],
      "durable queue order does not match the model",
    );
    for (const row of queue) {
      const slot = this.#slotForChange(row.change_id);
      const expectedStable = this.#stableOutbox.get(slot);
      ok(expectedStable, `slot ${slot} has no captured queue payload`);
      const { retry_attempts, next_retry_at, ...stable } = row;
      deepStrictEqual(stable, expectedStable, `slot ${slot} queue id/payload changed across retry`);
      strictEqual(
        retry_attempts,
        this.#expectedRetries.get(slot),
        `slot ${slot} retry count differs from executed receipt losses`,
      );
      strictEqual(row.terminal, 0, `slot ${slot} unexpectedly became terminal`);
      strictEqual(row.terminal_error, null, `slot ${slot} unexpectedly retained a terminal error`);
      if (retry_attempts === 0) strictEqual(next_retry_at, null);
      else strictEqual(typeof next_retry_at, "number");
    }

    const serverPage = await this.#serverPage();
    this.#observeCursor(serverPage.cursor, serverPage.changes.length);
    const actualHistory = serverPage.changes.map((change) => this.#slotForChange(change.id));
    deepStrictEqual(
      actualHistory,
      [...state.history],
      "Atrium append order does not match the model",
    );
    for (const change of serverPage.changes) {
      const slot = this.#slotForChange(change.id);
      const expected = this.#stableOutbox.get(slot);
      ok(expected, `history slot ${slot} has no captured payload`);
      deepStrictEqual(
        change.ops,
        JSON.parse(expected.ops),
        `history payload changed for slot ${slot}`,
      );
      deepStrictEqual(
        change.hlc,
        {
          wallMs: expected.hlc_wall_ms,
          counter: expected.hlc_counter,
          nodeId: expected.hlc_node_id,
        },
        `history HLC changed for slot ${slot}`,
      );
    }

    for (const body of this.#writerFaults.postedBodies) {
      const decoded: unknown = JSON.parse(body);
      if (
        typeof decoded !== "object" ||
        decoded === null ||
        Array.isArray(decoded) ||
        !("id" in decoded) ||
        typeof decoded.id !== "string"
      ) {
        throw new Error("writer fault seam observed a malformed POST body");
      }
      const slot = this.#slotForChange(decoded.id);
      const expected = this.#stableOutbox.get(slot);
      ok(expected, `posted slot ${slot} has no captured payload`);
      strictEqual(
        body,
        this.#wirePayload(expected),
        `retry changed the wire payload for slot ${slot}`,
      );
    }
    deepStrictEqual(this.#readerFaults.postedBodies, [], "reader unexpectedly uploaded a change");

    const readerNotes = await this.#activeReader.engine.adapter.exec<NoteRow>(
      "SELECT id, title, body, created_at FROM notes ORDER BY created_at ASC, id ASC",
      [],
    );
    deepStrictEqual(
      normalizeSet(this.#slotsForRows(readerNotes)),
      normalizeSet(state.applied),
      "reader durable rows do not match applied model slots",
    );
    const appliedRows = await this.#activeReader.engine.adapter.exec<{ change_id: string }>(
      "SELECT change_id FROM _sync_applied_changes ORDER BY change_id ASC",
      [],
    );
    deepStrictEqual(
      normalizeSet(
        appliedRows.map((row: { readonly change_id: string }) =>
          this.#slotForChange(row.change_id),
        ),
      ),
      normalizeSet(state.applied),
      "reader applied-change ledger does not match durable rows",
    );

    const checkpoint = await this.#activeReader.engine.getSyncState("append_cursor_v1");
    if (checkpoint === null) {
      strictEqual(state.checkpoint, -1, "reader has no checkpoint but model does");
    } else {
      const prefix = this.#cursorPrefixes.get(checkpoint);
      if (prefix === undefined) {
        throw new Error(`reader persisted an unobserved opaque cursor ${checkpoint}`);
      }
      strictEqual(prefix, state.checkpoint, "reader checkpoint prefix does not match the model");
    }

    const quarantine = await this.#activeReader.engine.adapter.exec<QuarantineRow>(
      `SELECT change_id, ops, attempts, permanent, disposition
         FROM _sync_quarantine ORDER BY change_id ASC`,
      [],
    );
    deepStrictEqual(
      normalizeSet(quarantine.map((row: QuarantineRow) => this.#slotForChange(row.change_id))),
      normalizeSet([...this.#quarantineAttempts.keys()]),
      "reader quarantine contains unexpected durable rows",
    );
    for (const row of quarantine) {
      const slot = this.#slotForChange(row.change_id);
      const expected = this.#stableOutbox.get(slot);
      ok(expected, `quarantined slot ${slot} has no captured payload`);
      deepStrictEqual(
        JSON.parse(row.ops),
        JSON.parse(expected.ops),
        `quarantine payload changed for slot ${slot}`,
      );
      strictEqual(row.attempts, this.#quarantineAttempts.get(slot));
      strictEqual(row.permanent, 0);
      strictEqual(row.disposition, "blocking");
    }
  }

  async close(): Promise<void> {
    const failures: unknown[] = [];
    const writer = this.#writer;
    this.#writer = undefined;
    if (writer !== undefined) {
      try {
        await writer.close();
      } catch (error) {
        failures.push(error);
      }
    }
    const reader = this.#reader;
    this.#reader = undefined;
    if (reader !== undefined) {
      try {
        await reader.close();
      } catch (error) {
        failures.push(error);
      }
    }
    const server = this.#server;
    this.#server = undefined;
    if (server !== undefined) {
      try {
        await server.stop();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0) {
      throw new DeliveryReplayCleanupError(failures, "delivery replay cleanup failed");
    }
  }
}

function transitionError(
  trace: DeliveryTrace,
  index: number,
  state: DeliveryState,
  error: unknown,
): Error {
  return new Error(
    `Delivery replay failed\nsource: ${trace.source}\nindex: ${index}\naction: ${state.lastAction}\nstate: ${JSON.stringify(state)}`,
    { cause: error },
  );
}

export async function replayDeliveryTrace(trace: DeliveryTrace): Promise<void> {
  const first = trace.states[0];
  if (first === undefined) throw new Error(`Delivery trace ${trace.source} has no states`);
  if (first.lastAction !== "init") {
    throw transitionError(
      trace,
      0,
      first,
      new Error(`trace starts with ${JSON.stringify(first.lastAction)} instead of init`),
    );
  }

  const directory = await mkdtemp(join(tmpdir(), "palladium-quint-delivery-"));
  let harness: DeliveryReplayHarness | undefined;
  let failure: unknown;
  let safeToRemoveFiles = true;
  try {
    try {
      harness = await DeliveryReplayHarness.create(directory);
    } catch (error) {
      if (error instanceof DeliveryReplayCleanupError) safeToRemoveFiles = false;
      throw transitionError(trace, 0, first, error);
    }
    try {
      await harness.assertState(first);
    } catch (error) {
      throw transitionError(trace, 0, first, error);
    }
    for (let index = 1; index < trace.states.length; index += 1) {
      const state = trace.states[index];
      if (state === undefined)
        throw new Error(`Delivery trace ${trace.source} lost state ${index}`);
      try {
        await harness.step(state);
        await harness.assertState(state);
      } catch (error) {
        throw transitionError(trace, index, state, error);
      }
    }
  } catch (error) {
    failure = error;
  }

  const lastIndex = trace.states.length - 1;
  const last = trace.states[lastIndex] ?? first;
  if (harness !== undefined) {
    try {
      await harness.close();
    } catch (error) {
      safeToRemoveFiles = false;
      failure ??= transitionError(trace, lastIndex, last, error);
    }
  }
  if (safeToRemoveFiles) {
    try {
      await rm(directory, { recursive: true, force: true });
    } catch (error) {
      failure ??= transitionError(trace, lastIndex, last, error);
    }
  }
  if (failure !== undefined) throw failure;
}
