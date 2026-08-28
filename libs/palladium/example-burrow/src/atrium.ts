import type { PalladiumEngine } from "@palladium/core";
import { createEngine, generateUuidV7, SyncTransport } from "@palladium/core";
import { BrowserSqliteAdapter } from "@palladium/sqlite-browser";
import { BURROW_SCHEMA, type BurrowSchema } from "./schema.js";

/** Fresh replicated row identifier. */
export const newId = (): string => generateUuidV7();

/** Default Atrium dev server. Override with `?server=` in the URL. */
export const DEFAULT_SERVER = "http://localhost:4000";

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
    const { id } = await this.#json<{ id: string }>("/v1/workspaces", {
      method: "POST",
    });
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
  async share(
    workspaceId: string,
    rootId: string,
    grantee: string,
    perm: "read" | "write",
  ): Promise<void> {
    await this.#json("/v1/shares", {
      method: "POST",
      headers: { "X-Workspace": workspaceId },
      body: JSON.stringify({ root_id: rootId, grantee_user_id: grantee, perm }),
    });
  }

  /** Revoke a member's per-member grant (enqueues a purge for them). */
  async unshare(workspaceId: string, rootId: string, grantee: string): Promise<void> {
    await this.#json("/v1/shares", {
      method: "DELETE",
      headers: { "X-Workspace": workspaceId },
      body: JSON.stringify({ root_id: rootId, grantee_user_id: grantee }),
    });
  }

  /** Set a household root's sharing class (`private` | `household_read` | `household_rw`). */
  async setSharing(workspaceId: string, rootId: string, sharingClass: string): Promise<void> {
    await this.#json(`/v1/records/${rootId}/sharing`, {
      method: "PATCH",
      headers: { "X-Workspace": workspaceId },
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
 * A device's stable node id, persisted per (user, workspace) so a reload keeps
 * the same identity — the durable sync cursor and own-write skipping both key
 * off it, so a fresh id every load would re-hydrate and mis-attribute writes.
 */
function deviceNodeId(user: string, workspaceId: string): string {
  const key = `burrow:node:${user}:${workspaceId}`;
  try {
    const existing = localStorage.getItem(key);
    if (existing) return existing;
    const id = newId();
    localStorage.setItem(key, id);
    return id;
  } catch {
    // Storage blocked (private browsing / disabled site data). A per-session id
    // is fine for the POC — the durable cursor simply re-hydrates on reload —
    // and letting the SecurityError escape would defeat the in-memory fallback.
    return newId();
  }
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
        vfs: {
          type: "opfs-sah-pool",
          directory: `burrow-${user}`,
          filename: `${workspaceId}.db`,
        },
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
 * Build and start one account with an Atrium-aware `SyncTransport`.
 *
 * The transport validates and applies the versioned page envelope itself,
 * including replay-safe local purges. Authentication remains request scoped.
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
    authHeaders: () => ({
      Authorization: `Bearer ${opts.user}`,
      "X-Workspace": opts.workspaceId,
    }),
  });
  await transport.start();

  return { engine, transport, user: opts.user, workspaceId: opts.workspaceId };
}
