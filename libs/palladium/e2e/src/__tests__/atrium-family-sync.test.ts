/**
 * Phase 5 — the HabitatHQ acceptance matrix (ERD §7.1), end-to-end through the
 * REAL client stack: `@palladium/core` engine + an Atrium-aware `SyncTransport`
 * driving a live `atrium` server (dev bearer identity). This is the "2 members ×
 * 2 devices" verification the plan calls for — it exercises the client transport
 * (envelope decode, X-Workspace, grant-backfill, revoke-purge) that the Rust
 * `http_tests` cannot, because those stop at the HTTP boundary.
 *
 * Coverage: A1 private floor + child cascade + multi-device convergence,
 * A2 household grant incl. children, A3 downgrade rejects member writes,
 * A4 per-member grant + backfill, A5 revoke purges, A6 offline-write-after-
 * revoke rejected, A7 blob ACL inherited from the note.
 */

import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import {
  createEngine,
  type PalladiumEngine,
  type SchemaConfig,
  SyncTransport,
  sql,
  type WireChange,
} from "@palladium/core";
import { NodeSqliteAdapter } from "@palladium/sqlite-node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "../../../../../");
const BINARY = join(process.env["CARGO_TARGET_DIR"] ?? join(ROOT, "target"), "debug", "atrium");
const PORT = 13_760;
const BASE_URL = `http://localhost:${PORT}`;
const POLL_MS = 150;

// ── the burrow §7.1 surface (children carry `root_id`) ───────────────────────

// A `type` (not `interface`) so it carries the implicit index signature the
// engine's `SchemaMap` constraint requires.
type BurrowSchema = {
  habits: { id: string; name: string; created_at: number };
  completions: { id: string; root_id: string; day: string; done: number };
  lists: { id: string; name: string; created_at: number };
  list_items: { id: string; root_id: string; text: string; done: number };
  notes: { id: string; title: string; body: string; created_at: number };
  note_images: {
    id: string;
    root_id: string;
    blob_id: string;
    caption: string;
  };
};

const ROOT_TABLES = ["habits", "lists", "notes"] as const;
const CHILD_TABLES = ["completions", "list_items", "note_images"] as const;

const SCHEMA: SchemaConfig = {
  version: 1,
  schema: `
    CREATE TABLE IF NOT EXISTS habits (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS completions (id TEXT PRIMARY KEY, root_id TEXT NOT NULL, day TEXT NOT NULL, done INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS lists (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS list_items (id TEXT PRIMARY KEY, root_id TEXT NOT NULL, text TEXT NOT NULL, done INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS note_images (id TEXT PRIMARY KEY, root_id TEXT NOT NULL, blob_id TEXT NOT NULL, caption TEXT NOT NULL);
  `,
};

const newId = (): string => crypto.randomUUID();

// ── server lifecycle ─────────────────────────────────────────────────────────

let server: ChildProcess | undefined;
let tmpDir: string | undefined;

async function waitForReady(url: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // not ready
    }
    await sleep(100);
  }
  throw new Error(`server at ${url} not ready within ${timeoutMs}ms`);
}

beforeAll(async () => {
  execFileSync("cargo", ["build", "-p", "atrium"], {
    cwd: ROOT,
    stdio: "inherit",
  });
  tmpDir = await mkdtemp(join(tmpdir(), "atrium-e2e-"));
  server = spawn(BINARY, ["--atrium-db", "sqlite:atrium.db", "--port", String(PORT)], {
    cwd: tmpDir,
    stdio: "pipe",
  });
  server.stderr?.on("data", (c: Buffer) => process.stderr.write(`[atrium] ${c}`));
  await waitForReady(`${BASE_URL}/v1/health`);
}, 120_000);

afterAll(async () => {
  server?.kill("SIGTERM");
  if (tmpDir !== undefined) await rm(tmpDir, { recursive: true, force: true });
});

// ── REST control plane ───────────────────────────────────────────────────────

async function rest(
  method: string,
  path: string,
  user: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${user}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function createWorkspace(user: string): Promise<string> {
  const res = await rest("POST", "/v1/workspaces", user);
  return ((await res.json()) as { id: string }).id;
}

/** Create the family: alice owns; bob and carol join via invites. */
async function family(): Promise<string> {
  const ws = await createWorkspace("alice");
  for (const member of ["bob", "carol"]) {
    const invite = await rest("POST", `/v1/workspaces/${ws}/invites`, "alice");
    const { token } = (await invite.json()) as { token: string };
    await rest("POST", `/v1/invites/${token}/accept`, member);
  }
  return ws;
}

const share = (
  owner: string,
  workspace: string,
  root: string,
  grantee: string,
  perm: "read" | "write",
) =>
  rest(
    "POST",
    "/v1/shares",
    owner,
    { root_id: root, grantee_user_id: grantee, perm },
    { "X-Workspace": workspace },
  );
const unshare = (owner: string, workspace: string, root: string, grantee: string) =>
  rest(
    "DELETE",
    "/v1/shares",
    owner,
    { root_id: root, grantee_user_id: grantee },
    { "X-Workspace": workspace },
  );
const setSharing = (owner: string, workspace: string, root: string, cls: string) =>
  rest("PATCH", `/v1/records/${root}/sharing`, owner, { class: cls }, { "X-Workspace": workspace });

async function putBlob(
  user: string,
  ws: string,
  note: string,
  blobId: string,
  bytes: string,
): Promise<number> {
  const res = await fetch(`${BASE_URL}/v1/blobs/${blobId}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${user}`,
      "X-Workspace": ws,
      "X-Note": note,
      "Content-Type": "application/octet-stream",
    },
    body: bytes,
  });
  return res.status;
}

async function getBlob(user: string, blobId: string): Promise<{ status: number; text: string }> {
  const res = await fetch(`${BASE_URL}/v1/blobs/${blobId}`, {
    headers: { Authorization: `Bearer ${user}` },
  });
  return { status: res.status, text: res.ok ? await res.text() : "" };
}

/** Poll the server (as `user`) until a change touching `rowId` is stored. */
async function waitServerHas(user: string, ws: string, rowId: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const res = await fetch(`${BASE_URL}/v1/changes`, {
      headers: { Authorization: `Bearer ${user}`, "X-Workspace": ws },
    });
    if (res.ok) {
      const env = (await res.json()) as { changes: WireChange[] };
      if (env.changes.some((c) => c.ops.some((o) => o.row_id === rowId))) return;
    }
    await sleep(POLL_MS);
  }
  throw new Error(`server never stored ${rowId}`);
}

// ── Atrium-aware client (mirrors example-burrow/src/atrium.ts) ────────────────

interface Client {
  engine: PalladiumEngine<BurrowSchema>;
  transport: SyncTransport<BurrowSchema>;
  stop(): Promise<void>;
}

async function applyPurges(engine: PalladiumEngine<BurrowSchema>, roots: string[]): Promise<void> {
  for (const rootId of roots) {
    const rows: Array<{ table: keyof BurrowSchema & string; id: string }> = [];
    for (const child of CHILD_TABLES) {
      const childRows = await engine.adapter.exec<{ id: string }>(
        `SELECT id FROM ${child} WHERE root_id = ?`,
        [rootId],
      );
      for (const { id } of childRows) rows.push({ table: child, id });
    }
    for (const root of ROOT_TABLES) {
      const rootRows = await engine.adapter.exec<{ id: string }>(
        `SELECT id FROM ${root} WHERE id = ?`,
        [rootId],
      );
      for (const { id } of rootRows) rows.push({ table: root, id });
    }
    for (const row of rows) await engine.purgeLocal(row.table, row.id);
  }
}
async function makeClient(user: string, ws: string): Promise<Client> {
  const engine = createEngine<BurrowSchema>(new NodeSqliteAdapter({ vfs: { type: "memory" } }), {
    nodeId: newId(),
  });
  await engine.init(SCHEMA);
  const transport = new SyncTransport<BurrowSchema>(engine, {
    serverUrl: BASE_URL,
    pollIntervalMs: POLL_MS,
    authHeaders: () => ({ Authorization: `Bearer ${user}`, "X-Workspace": ws }),
    decodeChanges: async (body) => {
      if (Array.isArray(body)) return body as WireChange[];
      const env = body as { changes: WireChange[]; cursor?: string | null; purges: string[] };
      if (env.purges?.length) await applyPurges(engine, env.purges);
      const changes = env.changes ?? [];
      return env.cursor === undefined ? { changes } : { changes, cursor: env.cursor };
    },
    acknowledgeChanges: async (body) => {
      const env = body as {
        events?: Array<{ id: number; kind: "grant" | "revoke"; root_id: string }>;
      };
      const eventIds = (env.events ?? []).map((event) => event.id);
      if (eventIds.length === 0) return;
      const res = await rest(
        "POST",
        "/v1/changes/events/ack",
        user,
        { event_ids: eventIds },
        {
          "X-Workspace": ws,
        },
      );
      if (!res.ok) throw new Error(`event ack failed: ${res.status}`);
    },
  });
  await transport.start();
  return { engine, transport, stop: () => transport.stop() };
}

async function count(c: Client, table: keyof BurrowSchema, id: string): Promise<number> {
  // `table` is a compile-time literal from BurrowSchema, never user input.
  const rows = await c.engine.adapter.exec<{ n: number }>(
    `SELECT COUNT(*) AS n FROM ${table} WHERE id = ?`,
    [id],
  );
  return rows[0]?.n ?? 0;
}

/** Wait until `predicate` holds for the client, else throw. */
async function waitUntil(fn: () => Promise<boolean>, timeoutMs = 8_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) return;
    await sleep(POLL_MS / 2);
  }
  throw new Error("waitUntil timed out");
}

// ── the matrix ───────────────────────────────────────────────────────────────

describe("Atrium family sync — acceptance matrix (client stack)", () => {
  const clients: Client[] = [];
  const track = (c: Client): Client => {
    clients.push(c);
    return c;
  };
  afterEach(async () => {
    await Promise.all(clients.splice(0).map((c) => c.stop()));
  });

  it("delivers a later-appended lower-HLC change exactly once", async () => {
    const ws = await family();
    const high = newId();
    const low = newId();

    const highChange: WireChange = {
      id: newId(),
      hlc: { wallMs: 100, counter: 0, nodeId: newId() },
      ops: [
        {
          op: "insert",
          table: "habits",
          row_id: high,
          data: { id: high, name: "High HLC", created_at: 100 },
        },
      ],
    };
    expect(
      (await rest("POST", "/v1/changes", "alice", highChange, { "X-Workspace": ws })).status,
    ).toBe(201);

    const first = (await (
      await rest("GET", "/v1/changes", "alice", undefined, { "X-Workspace": ws })
    ).json()) as { changes: WireChange[]; cursor: string };
    expect(first.changes.map((change) => change.id)).toContain(highChange.id);

    const lowChange: WireChange = {
      id: newId(),
      hlc: { wallMs: 50, counter: 0, nodeId: newId() },
      ops: [
        {
          op: "insert",
          table: "habits",
          row_id: low,
          data: { id: low, name: "Low HLC", created_at: 50 },
        },
      ],
    };
    expect(
      (await rest("POST", "/v1/changes", "alice", lowChange, { "X-Workspace": ws })).status,
    ).toBe(201);

    const second = (await (
      await rest("GET", `/v1/changes?after=${first.cursor}`, "alice", undefined, {
        "X-Workspace": ws,
      })
    ).json()) as { changes: WireChange[]; cursor: string };
    expect(second.changes.map((change) => change.id)).toEqual([lowChange.id]);

    const third = (await (
      await rest("GET", `/v1/changes?after=${second.cursor}`, "alice", undefined, {
        "X-Workspace": ws,
      })
    ).json()) as { changes: WireChange[] };
    expect(third.changes).toEqual([]);
  });

  it("A1: private floor + child cascade, and multi-device convergence", async () => {
    const ws = await family();
    const alice1 = track(await makeClient("alice", ws));
    const alice2 = track(await makeClient("alice", ws));
    const bob = track(await makeClient("bob", ws));

    const habit = newId();
    await alice1.engine.insert("habits", {
      id: habit,
      name: "Meditate",
      created_at: Date.now(),
    });
    const comp = newId();
    await alice1.engine.insert("completions", {
      id: comp,
      root_id: habit,
      day: "2026-08-06",
      done: 1,
    });

    // alice's second device converges on both the root and its child.
    await waitUntil(async () => (await count(alice2, "habits", habit)) === 1);
    await waitUntil(async () => (await count(alice2, "completions", comp)) === 1);

    // bob (a member) never sees the private habit or its completion.
    await sleep(POLL_MS * 6);
    expect(await count(bob, "habits", habit)).toBe(0);
    expect(await count(bob, "completions", comp)).toBe(0);
  });

  it("A2: household grant surfaces the list and its items", async () => {
    const ws = await family();
    const alice = track(await makeClient("alice", ws));
    const bob = track(await makeClient("bob", ws));

    const list = newId();
    await alice.engine.insert("lists", {
      id: list,
      name: "Groceries",
      created_at: Date.now(),
    });
    const item = newId();
    await alice.engine.insert("list_items", {
      id: item,
      root_id: list,
      text: "Milk",
      done: 0,
    });
    await waitServerHas("alice", ws, item);

    await sleep(POLL_MS * 6);
    expect(await count(bob, "lists", list)).toBe(0); // private before sharing

    expect((await setSharing("alice", ws, list, "household_read")).status).toBe(200);
    await waitUntil(async () => (await count(bob, "lists", list)) === 1);
    await waitUntil(async () => (await count(bob, "list_items", item)) === 1);
  });

  it("A3: after RW→read downgrade, a member's write no longer converges", async () => {
    const ws = await family();
    const alice = track(await makeClient("alice", ws));
    const bob = track(await makeClient("bob", ws));

    const list = newId();
    await alice.engine.insert("lists", {
      id: list,
      name: "Chores",
      created_at: Date.now(),
    });
    const item = newId();
    await alice.engine.insert("list_items", {
      id: item,
      root_id: list,
      text: "v0",
      done: 0,
    });
    await waitServerHas("alice", ws, item);

    expect((await setSharing("alice", ws, list, "household_rw")).status).toBe(200);
    await waitUntil(async () => (await count(bob, "list_items", item)) === 1);

    // While RW, bob's write converges back to alice.
    await bob.engine.update("list_items", item, { text: "v1-by-bob" });
    await waitUntil(async () => {
      const rows = await alice.engine.exec<{ text: string }>(
        sql`SELECT text FROM list_items WHERE id = ${item}`,
      );
      return rows[0]?.text === "v1-by-bob";
    });

    // Downgrade to read-only; bob's next write is rejected server-side.
    expect((await setSharing("alice", ws, list, "household_read")).status).toBe(200);
    await sleep(POLL_MS * 3);
    await bob.engine.update("list_items", item, {
      text: "v2-should-be-rejected",
    });

    await sleep(POLL_MS * 8);
    const rows = await alice.engine.exec<{ text: string }>(
      sql`SELECT text FROM list_items WHERE id = ${item}`,
    );
    expect(rows[0]?.text).toBe("v1-by-bob"); // never advanced to v2
  });

  it("A4: per-member grant backfills to the grantee only", async () => {
    const ws = await family();
    const alice = track(await makeClient("alice", ws));
    const bob = track(await makeClient("bob", ws));
    const carol = track(await makeClient("carol", ws));

    const note = newId();
    await alice.engine.insert("notes", {
      id: note,
      title: "Secret",
      body: "",
      created_at: Date.now(),
    });
    await waitServerHas("alice", ws, note);

    expect((await share("alice", ws, note, "bob", "read")).status).toBe(200);
    await waitUntil(async () => (await count(bob, "notes", note)) === 1);

    await sleep(POLL_MS * 6);
    expect(await count(carol, "notes", note)).toBe(0); // never granted
  });

  it("A5: revoke purges the note from the ex-grantee", async () => {
    const ws = await family();
    const alice = track(await makeClient("alice", ws));
    const bob = track(await makeClient("bob", ws));

    const note = newId();
    await alice.engine.insert("notes", {
      id: note,
      title: "Shared then not",
      body: "",
      created_at: Date.now(),
    });
    await waitServerHas("alice", ws, note);
    await share("alice", ws, note, "bob", "read");
    await waitUntil(async () => (await count(bob, "notes", note)) === 1);

    expect((await unshare("alice", ws, note, "bob")).status).toBe(200);
    await waitUntil(async () => (await count(bob, "notes", note)) === 0);
    const pending = await bob.engine.adapter.exec<{ n: number }>(
      "SELECT COUNT(*) AS n FROM _sync_pending_changes",
      [],
    );
    expect(pending[0]?.n ?? 0).toBe(0); // a server purge is never an outbound delete
  });

  it("A6: an offline write after revoke is rejected and purged", async () => {
    const ws = await family();
    const alice = track(await makeClient("alice", ws));
    const bob = track(await makeClient("bob", ws));

    const note = newId();
    await alice.engine.insert("notes", {
      id: note,
      title: "Draft",
      body: "orig",
      created_at: Date.now(),
    });
    await waitServerHas("alice", ws, note);
    await share("alice", ws, note, "bob", "write");
    await waitUntil(async () => (await count(bob, "notes", note)) === 1);

    // bob goes offline and edits, then alice revokes before he reconnects.
    await bob.transport.stop();
    await bob.engine.update("notes", note, { body: "bob-offline-edit" });
    await unshare("alice", ws, note, "bob");

    await bob.transport.start(); // drains outbox (rejected) + receives the purge
    await waitUntil(async () => (await count(bob, "notes", note)) === 0);

    // alice never received bob's offline edit.
    await sleep(POLL_MS * 6);
    const rows = await alice.engine.exec<{ body: string }>(
      sql`SELECT body FROM notes WHERE id = ${note}`,
    );
    expect(rows[0]?.body).toBe("orig");
  });

  it("A7: a note's blob is readable only through the note's ACL", async () => {
    const ws = await family();
    const alice = track(await makeClient("alice", ws));

    const note = newId();
    await alice.engine.insert("notes", {
      id: note,
      title: "With image",
      body: "",
      created_at: Date.now(),
    });
    await waitServerHas("alice", ws, note);

    const blob = newId();
    expect(await putBlob("alice", ws, note, blob, "PNGDATA")).toBe(201);
    expect((await getBlob("alice", blob)).text).toBe("PNGDATA"); // owner reads
    expect((await getBlob("bob", blob)).status).toBe(403); // member, no grant

    await share("alice", ws, note, "bob", "read");
    expect((await getBlob("bob", blob)).text).toBe("PNGDATA"); // read grant → blob
    expect((await getBlob("carol", blob)).status).toBe(403); // never granted
  });
});
