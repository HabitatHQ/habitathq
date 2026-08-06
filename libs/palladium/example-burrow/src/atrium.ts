import type { PalladiumEngine, WireChange } from "@palladium/core";
import { createEngine, SyncTransport } from "@palladium/core";
import { BrowserSqliteAdapter } from "@palladium/sqlite-browser";
import { BURROW_SCHEMA, type BurrowSchema, CHILD_TABLES, ROOT_TABLES } from "./schema.js";

/** Fresh id. The Atrium wire types row_id/node_id as UUID (non-UUID → 422). */
export const newId = (): string => crypto.randomUUID();

/** Default Atrium dev server. Override with `?server=` in the URL. */
export const DEFAULT_SERVER = "http://localhost:4000";

/** Atrium's `GET /v1/changes` envelope (extends the bare palladium-axum array). */
interface ChangesEnvelope {
  changes: WireChange[];
  purges: string[];
}

/** A workspace member as returned by `GET /v1/workspaces/:id/members`. */
export interface Member {
  user_id: string;
  role: "owner" | "member";
}

/** One live account: a local engine + its Atrium uplink for one workspace. */
export interface Account {
  engine: PalladiumEngine<BurrowSchema>;
  transport: SyncTransport<BurrowSchema>;
  user: string;
  workspaceId: string;
}

/**
 * REST client for Atrium's control-plane endpoints (everything that isn't the
 * change/blob sync itself). Carries the dev bearer identity; the workspace is
 * passed per-call where the endpoint needs it.
 */
export class AtriumApi {
  readonly #serverUrl: string;
  readonly #user: string;

  constructor(user: string, serverUrl: string = DEFAULT_SERVER) {
    this.#user = user;
    this.#serverUrl = serverUrl.replace(/\/+$/, "");
  }

  get user(): string {
    return this.#user;
  }

  async #json<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.#serverUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.#user}`,
        ...(init?.body === undefined ? {} : { "Content-Type": "application/json" }),
        ...init?.headers,
      },
    });
    if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${path} → ${res.status}`);
    return (await res.json()) as T;
  }

  /** Workspace ids the caller belongs to. */
  async listWorkspaces(): Promise<string[]> {
    const { workspaces } = await this.#json<{ workspaces: string[] }>("/v1/workspaces");
    return workspaces;
  }

  /** Create a workspace; the caller becomes its owner. Returns the new id. */
  async createWorkspace(): Promise<string> {
    const { id } = await this.#json<{ id: string }>("/v1/workspaces", { method: "POST" });
    return id;
  }

  /** Owner mints a single-use invite token for a workspace. */
  async createInvite(workspaceId: string): Promise<string> {
    const { token } = await this.#json<{ token: string }>(`/v1/workspaces/${workspaceId}/invites`, {
      method: "POST",
    });
    return token;
  }

  /** Accept an invite; the caller joins as a member. Returns the workspace id. */
  async acceptInvite(token: string): Promise<string> {
    const { workspace_id } = await this.#json<{ workspace_id: string }>(
      `/v1/invites/${token}/accept`,
      { method: "POST" },
    );
    return workspace_id;
  }

  /** Members of a workspace. */
  async members(workspaceId: string): Promise<Member[]> {
    const { members } = await this.#json<{ members: Member[] }>(
      `/v1/workspaces/${workspaceId}/members`,
    );
    return members;
  }

  /** Grant a specific member read/write on a per-member root (e.g. a note). */
  async share(rootId: string, grantee: string, perm: "read" | "write"): Promise<void> {
    await this.#json("/v1/shares", {
      method: "POST",
      body: JSON.stringify({ root_id: rootId, grantee_user_id: grantee, perm }),
    });
  }

  /** Revoke a member's per-member grant (enqueues a purge for them). */
  async unshare(rootId: string, grantee: string): Promise<void> {
    await this.#json("/v1/shares", {
      method: "DELETE",
      body: JSON.stringify({ root_id: rootId, grantee_user_id: grantee }),
    });
  }

  /** Set a household root's sharing class (`private` | `household_read` | `household_rw`). */
  async setSharing(rootId: string, sharingClass: string): Promise<void> {
    await this.#json(`/v1/records/${rootId}/sharing`, {
      method: "PATCH",
      body: JSON.stringify({ class: sharingClass }),
    });
  }

  /** Upload a blob under a note the caller may write (ACL inherited, `D18`). */
  async putBlob(workspaceId: string, noteId: string, blobId: string, bytes: Blob): Promise<void> {
    const res = await fetch(`${this.#serverUrl}/v1/blobs/${blobId}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${this.#user}`,
        "X-Workspace": workspaceId,
        "X-Note": noteId,
        "Content-Type": bytes.type || "application/octet-stream",
      },
      body: bytes,
    });
    if (!res.ok) throw new Error(`PUT /v1/blobs → ${res.status}`);
  }

  /** Fetch a blob's bytes if the caller may read its note; `null` if denied. */
  async getBlob(blobId: string): Promise<Blob | null> {
    const res = await fetch(`${this.#serverUrl}/v1/blobs/${blobId}`, {
      headers: { Authorization: `Bearer ${this.#user}` },
    });
    return res.ok ? await res.blob() : null;
  }
}

/**
 * Apply server-driven purges (revoked roots) to the local store.
 *
 * A purge is a *local* deletion: we must not re-POST it (the caller just lost
 * write access). Routing it through `applyRemote` deletes the rows, refreshes
 * live queries, and — crucially — suppresses the `changes:local` event so the
 * transport never tries to sync it back. A fresh HLC guarantees the delete wins
 * LWW against any local row it removes.
 */
async function applyPurges(
  engine: PalladiumEngine<BurrowSchema>,
  rootIds: string[],
): Promise<void> {
  for (const rootId of rootIds) {
    const ops: { type: "delete"; table: string; id: string }[] = [];
    for (const child of CHILD_TABLES) {
      const rows = await engine.adapter.exec<{ id: string }>(
        `SELECT id FROM ${child} WHERE root_id = ?`,
        [rootId],
      );
      for (const { id } of rows) ops.push({ type: "delete", table: child, id });
    }
    for (const root of ROOT_TABLES) {
      const rows = await engine.adapter.exec<{ id: string }>(
        `SELECT id FROM ${root} WHERE id = ?`,
        [rootId],
      );
      for (const { id } of rows) ops.push({ type: "delete", table: root, id });
    }
    if (ops.length === 0) continue;
    const change = { id: newId(), hlc: engine.nextSendHlc(), ops } as unknown as Parameters<
      PalladiumEngine<BurrowSchema>["applyRemote"]
    >[0];
    await engine.applyRemote(change);
  }
}

/**
 * A device's stable node id, persisted per (user, workspace) so a reload keeps
 * the same identity — the durable sync cursor and own-write skipping both key
 * off it, so a fresh id every load would re-hydrate and mis-attribute writes.
 */
function deviceNodeId(user: string, workspaceId: string): string {
  const key = `burrow:node:${user}:${workspaceId}`;
  let id = localStorage.getItem(key);
  if (!id) {
    id = newId();
    localStorage.setItem(key, id);
  }
  return id;
}

/**
 * Build the local engine, persisting to OPFS (SAH-pool VFS — no COOP/COEP
 * headers needed) so data survives reloads. Falls back to an in-memory store if
 * OPFS is unavailable (e.g. private browsing, or two tabs of the *same* user
 * contending for one SAH pool).
 */
async function buildEngine(
  user: string,
  workspaceId: string,
): Promise<PalladiumEngine<BurrowSchema>> {
  const nodeId = deviceNodeId(user, workspaceId);
  try {
    const engine = createEngine<BurrowSchema>(
      new BrowserSqliteAdapter({
        // Per-user pool directory so alice's and bob's tabs don't contend.
        vfs: { type: "opfs-sah-pool", directory: `burrow-${user}`, filename: `${workspaceId}.db` },
      }),
      { nodeId },
    );
    await engine.init(BURROW_SCHEMA);
    return engine;
  } catch (err) {
    console.warn("burrow: OPFS unavailable, using in-memory store", err);
    const engine = createEngine<BurrowSchema>(
      new BrowserSqliteAdapter({ vfs: { type: "memory" } }),
      { nodeId },
    );
    await engine.init(BURROW_SCHEMA);
    return engine;
  }
}

/**
 * Build and start one account: a local persistent SQLite engine plus an
 * Atrium-aware `SyncTransport`.
 *
 * The transport reuses Palladium's hardened change loop unchanged; Atrium's
 * protocol differences are supplied as config: the bearer + `X-Workspace`
 * selector via `authHeaders`, and the `{ changes, purges }` envelope via
 * `decodeChanges` (which also drives local purges).
 */
export async function createAccount(opts: {
  user: string;
  workspaceId: string;
  serverUrl?: string;
  pollIntervalMs?: number;
}): Promise<Account> {
  const serverUrl = opts.serverUrl ?? DEFAULT_SERVER;
  const engine = await buildEngine(opts.user, opts.workspaceId);

  const transport = new SyncTransport<BurrowSchema>(engine, {
    serverUrl,
    pollIntervalMs: opts.pollIntervalMs ?? 600,
    // TODO(clerk): swap the dev bearer (`opts.user` is the raw user id) for a
    // real Clerk session JWT — `Authorization: Bearer ${await clerk.session.getToken()}`.
    // Atrium's ClerkProvider (JWKS verify) reads `sub` as the user id; no other
    // change here. The `X-Workspace` selector stays as-is.
    authHeaders: () => ({
      Authorization: `Bearer ${opts.user}`,
      "X-Workspace": opts.workspaceId,
    }),
    decodeChanges: async (body) => {
      const env = body as ChangesEnvelope;
      if (env.purges?.length) await applyPurges(engine, env.purges);
      return env.changes ?? [];
    },
  });
  await transport.start();

  return { engine, transport, user: opts.user, workspaceId: opts.workspaceId };
}
