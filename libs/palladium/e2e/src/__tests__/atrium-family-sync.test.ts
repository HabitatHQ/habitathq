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

import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import {
  createEngine,
  generateUuidV7,
  type PalladiumEngine,
  type SchemaConfig,
  SyncTransport,
  sql,
  type WireChange,
} from "@palladium/core";
import { NodeSqliteAdapter } from "@palladium/sqlite-node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { buildRustPackage, type ManagedServer, rustBinary, startServer } from "../setup/process.js";

let server: ManagedServer | undefined;
let tmpDir: string | undefined;
let BASE_URL = "";
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

const newId = (): string => generateUuidV7();

// ── server lifecycle ─────────────────────────────────────────────────────────

beforeAll(async () => {
  buildRustPackage("atrium");
  tmpDir = await mkdtemp(join(tmpdir(), "atrium-e2e-"));
  try {
    server = await startServer({
      name: "atrium",
      binary: rustBinary("atrium"),
      args: (port) => [
        "--atrium-db",
        "sqlite:atrium.db",
        "--port",
        String(port),
        "--auth-mode",
        "dev",
      ],
      cwd: tmpDir,
      readinessPath: "/v1/health",
    });
    BASE_URL = server.baseUrl;
  } catch (error) {
    if (server !== undefined) await server.stop();
    if (tmpDir !== undefined) await rm(tmpDir, { recursive: true, force: true });
    server = undefined;
    tmpDir = undefined;
    throw error;
  }
}, 120_000);

afterAll(async () => {
  if (server !== undefined) {
    await server.stop();
    server = undefined;
  }
  if (tmpDir !== undefined) {
    await rm(tmpDir, { recursive: true, force: true });
    tmpDir = undefined;
  }
  BASE_URL = "";
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

async function errorCode(response: Response): Promise<string | undefined> {
  const body: unknown = await response.json();
  const code =
    typeof body === "object" &&
    body !== null &&
    !Array.isArray(body) &&
    "code" in body &&
    typeof body.code === "string"
      ? body.code
      : undefined;
  return code;
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

/** Poll the server through a registered device until it stores `rowId`. */
async function waitServerHas(
  user: string,
  ws: string,
  nodeId: string,
  rowId: string,
): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const res = await fetch(`${BASE_URL}/v1/changes?limit=100`, {
      headers: {
        Authorization: `Bearer ${user}`,
        "X-Workspace": ws,
        "X-Palladium-Node": nodeId,
      },
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
  nodeId: string;
  engine: PalladiumEngine<BurrowSchema>;
  transport: SyncTransport<BurrowSchema>;
  dispose(): Promise<void>;
}
interface ClientOptions {
  fetch?: typeof globalThis.fetch;
}

async function makeClient(user: string, ws: string, options: ClientOptions = {}): Promise<Client> {
  const nodeId = randomUUID();
  const engine = createEngine<BurrowSchema>(new NodeSqliteAdapter({ vfs: { type: "memory" } }), {
    nodeId,
  });
  await engine.init(SCHEMA);
  const transport = new SyncTransport<BurrowSchema>(engine, {
    serverUrl: BASE_URL,
    pollIntervalMs: POLL_MS,
    authHeaders: () => ({ Authorization: `Bearer ${user}`, "X-Workspace": ws }),
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });
  await transport.start();
  return { nodeId, engine, transport, dispose: () => transport.dispose() };
}

async function count(c: Client, table: keyof BurrowSchema, id: string): Promise<number> {
  // `table` is a compile-time literal from BurrowSchema, never user input.
  const rows = await c.engine.adapter.exec<{ n: number }>(
    `SELECT COUNT(*) AS n FROM ${table} WHERE id = ?`,
    [id],
  );
  return rows[0]?.n ?? 0;
}

async function acknowledgedEventCount(client: Client): Promise<number> {
  const rows = await client.engine.adapter.exec<{ n: number }>(
    "SELECT COUNT(*) AS n FROM _sync_events WHERE acknowledged_at IS NOT NULL",
    [],
  );
  return rows[0]?.n ?? 0;
}

interface AtriumEnvelope {
  changes: WireChange[];
  events: Array<{ id: number; kind: string; root_id: string }>;
  purges: Array<{ table: string; row_id: string }>;
  cursor: string;
}

async function changes(
  user: string,
  ws: string,
  nodeId: string,
  cursor?: string,
): Promise<AtriumEnvelope> {
  const query = new URLSearchParams({ limit: "100" });
  if (cursor !== undefined) query.set("cursor", cursor);
  const res = await rest("GET", `/v1/changes?${query}`, user, undefined, {
    "X-Workspace": ws,
    "X-Palladium-Node": nodeId,
  });
  expect(res.status).toBe(200);
  return (await res.json()) as AtriumEnvelope;
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
    await Promise.all(clients.splice(0).map((c) => c.dispose()));
  });

  it("delivers a later-appended lower-HLC change exactly once", async () => {
    const ws = await family();
    const high = newId();
    const low = newId();
    const nodeId = randomUUID();

    const highChange: WireChange = {
      id: randomUUID(),
      hlc: { wallMs: 100, counter: 0, nodeId: randomUUID() },
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
      await rest("GET", "/v1/changes", "alice", undefined, {
        "X-Workspace": ws,
        "X-Palladium-Node": nodeId,
      })
    ).json()) as { changes: WireChange[]; cursor: string };
    expect(first.changes.map((change) => change.id)).toContain(highChange.id);

    const lowChange: WireChange = {
      id: randomUUID(),
      hlc: { wallMs: 50, counter: 0, nodeId: randomUUID() },
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
      await rest("GET", `/v1/changes?cursor=${first.cursor}&limit=100`, "alice", undefined, {
        "X-Workspace": ws,
        "X-Palladium-Node": nodeId,
      })
    ).json()) as { changes: WireChange[]; cursor: string };
    expect(second.changes.map((change) => change.id)).toEqual([lowChange.id]);
    const third = (await (
      await rest("GET", `/v1/changes?cursor=${second.cursor}&limit=100`, "alice", undefined, {
        "X-Workspace": ws,
        "X-Palladium-Node": nodeId,
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
    await waitServerHas("alice", ws, alice.nodeId, item);

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
    await waitServerHas("alice", ws, alice.nodeId, item);

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
    await waitServerHas("alice", ws, alice.nodeId, note);

    expect((await share("alice", ws, note, "bob", "read")).status).toBe(200);
    await waitUntil(async () => (await count(bob, "notes", note)) === 1);

    await sleep(POLL_MS * 6);
    expect(await count(carol, "notes", note)).toBe(0); // never granted
  });

  it("A4b: independent device grants and revokes survive each sibling acknowledgement", async () => {
    const ws = await family();
    const alice = track(await makeClient("alice", ws));
    const bobOne = track(await makeClient("bob", ws));
    const bobTwo = track(await makeClient("bob", ws));

    const missingNode = await rest("GET", "/v1/changes?limit=100", "bob", undefined, {
      "X-Workspace": ws,
    });
    expect(missingNode.status).toBe(400);
    expect(await errorCode(missingNode)).toBe("bad_request");
    const malformedNode = await rest(
      "POST",
      "/v1/changes/events/ack",
      "bob",
      { event_ids: [] },
      {
        "X-Workspace": ws,
        "X-Palladium-Node": "not-a-uuid",
      },
    );
    expect(malformedNode.status).toBe(400);
    expect(await errorCode(malformedNode)).toBe("bad_request");
    expect(
      (
        await rest("GET", "/v1/changes?limit=100", "alice", undefined, {
          "X-Workspace": ws,
          "X-Palladium-Node": bobOne.nodeId,
        })
      ).status,
    ).toBe(403);

    await bobTwo.transport.stop();
    const note = newId();
    await alice.engine.insert("notes", {
      id: note,
      title: "Two device grant",
      body: "",
      created_at: Date.now(),
    });
    await waitServerHas("alice", ws, alice.nodeId, note);
    expect((await share("alice", ws, note, "bob", "read")).status).toBe(200);

    await waitUntil(async () => (await count(bobOne, "notes", note)) === 1);
    await waitUntil(async () => (await acknowledgedEventCount(bobOne)) === 1);
    expect(await acknowledgedEventCount(bobTwo)).toBe(0);
    expect(await count(bobTwo, "notes", note)).toBe(0);
    await bobTwo.transport.start();
    await waitUntil(async () => (await count(bobTwo, "notes", note)) === 1);
    await waitUntil(async () => (await acknowledgedEventCount(bobTwo)) === 1);

    await bobTwo.transport.stop();
    expect((await unshare("alice", ws, note, "bob")).status).toBe(200);
    await waitUntil(async () => (await count(bobOne, "notes", note)) === 0);
    await waitUntil(async () => (await acknowledgedEventCount(bobOne)) === 2);
    expect(await acknowledgedEventCount(bobTwo)).toBe(1);
    expect(await count(bobTwo, "notes", note)).toBe(1);
    await bobTwo.transport.start();
    await waitUntil(async () => (await count(bobTwo, "notes", note)) === 0);
    await waitUntil(async () => (await acknowledgedEventCount(bobTwo)) === 2);
  });

  it("never backfills a revoked root or child after a partial grant offer", async () => {
    const ws = await family();
    const alice = track(await makeClient("alice", ws));
    const bob = track(await makeClient("bob", ws));
    await bob.transport.stop();

    const note = newId();
    const image = newId();
    await alice.engine.insert("notes", {
      id: note,
      title: "Private history",
      body: "owner-only",
      created_at: Date.now(),
    });
    await alice.engine.insert("note_images", {
      id: image,
      root_id: note,
      blob_id: newId(),
      caption: "private child",
    });
    await waitServerHas("alice", ws, alice.nodeId, image);
    for (let index = 0; index < 100; index += 1) {
      const historical: WireChange = {
        id: randomUUID(),
        hlc: { wallMs: Date.now() + index, counter: 0, nodeId: randomUUID() },
        ops: [
          {
            op: "update",
            table: "notes",
            row_id: note,
            col: "title",
            value: `owner-history-${index}`,
          },
        ],
      };
      expect(
        (await rest("POST", "/v1/changes", "alice", historical, { "X-Workspace": ws })).status,
      ).toBe(201);
    }

    expect((await share("alice", ws, note, "bob", "read")).status).toBe(200);
    const offered = await changes("bob", ws, bob.nodeId);
    expect(offered.changes).toHaveLength(100);
    expect(offered.changes.some((change) => change.ops.some((op) => op.row_id === note))).toBe(
      true,
    );
    expect(offered.events.map((event) => event.kind)).toContain("grant");

    expect((await unshare("alice", ws, note, "bob")).status).toBe(200);
    const afterRevoke = await changes("bob", ws, bob.nodeId, offered.cursor);
    expect(afterRevoke.changes.some((change) => change.ops.some((op) => op.row_id === note))).toBe(
      false,
    );
    expect(afterRevoke.changes.some((change) => change.ops.some((op) => op.row_id === image))).toBe(
      false,
    );
    expect(afterRevoke.events.map((event) => event.kind)).toEqual(["revoke"]);
    expect(afterRevoke.purges).toEqual(
      expect.arrayContaining([
        { table: "notes", row_id: note },
        { table: "note_images", row_id: image },
      ]),
    );
  });

  it("does not purge a regranted offline device with its stale revoke", async () => {
    const ws = await family();
    const alice = track(await makeClient("alice", ws));
    const bob = track(await makeClient("bob", ws));

    const note = newId();
    const image = newId();
    await alice.engine.insert("notes", {
      id: note,
      title: "Regrantable",
      body: "authoritative",
      created_at: Date.now(),
    });
    await alice.engine.insert("note_images", {
      id: image,
      root_id: note,
      blob_id: newId(),
      caption: "authoritative child",
    });
    await waitServerHas("alice", ws, alice.nodeId, image);
    expect((await share("alice", ws, note, "bob", "read")).status).toBe(200);
    await waitUntil(async () => (await count(bob, "note_images", image)) === 1);

    await bob.transport.stop();
    expect((await unshare("alice", ws, note, "bob")).status).toBe(200);
    expect((await share("alice", ws, note, "bob", "read")).status).toBe(200);

    const recovery = await changes("bob", ws, bob.nodeId);
    expect(recovery.events.map((event) => event.kind)).not.toContain("revoke");
    expect(recovery.events.map((event) => event.kind)).toContain("grant");
    expect(recovery.purges).toEqual([]);
    await bob.transport.start();
    await waitUntil(
      async () =>
        (await count(bob, "notes", note)) === 1 && (await count(bob, "note_images", image)) === 1,
    );
  });

  it("replays a lost device acknowledgement without consuming its sibling event", async () => {
    const ws = await family();
    const alice = track(await makeClient("alice", ws));
    let rejectNextAck = false;
    const lossyFetch: typeof globalThis.fetch = async (input, init) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (rejectNextAck && url.endsWith("/v1/changes/events/ack")) {
        rejectNextAck = false;
        return new Response("lost acknowledgement", { status: 503 });
      }
      return globalThis.fetch(input, init);
    };
    const bobOne = track(await makeClient("bob", ws, { fetch: lossyFetch }));
    const bobTwo = track(await makeClient("bob", ws));
    await bobOne.transport.stop();
    await bobTwo.transport.stop();

    const note = newId();
    await alice.engine.insert("notes", {
      id: note,
      title: "Device acknowledgement",
      body: "",
      created_at: Date.now(),
    });
    await waitServerHas("alice", ws, alice.nodeId, note);
    rejectNextAck = true;
    expect((await share("alice", ws, note, "bob", "read")).status).toBe(200);

    await bobOne.transport.start();
    expect(await count(bobOne, "notes", note)).toBe(1);
    expect(await acknowledgedEventCount(bobOne)).toBe(0);
    await bobTwo.transport.start();
    expect(await count(bobTwo, "notes", note)).toBe(1);
    expect(await acknowledgedEventCount(bobTwo)).toBe(1);

    await bobOne.transport.poll();
    expect(await acknowledgedEventCount(bobOne)).toBe(1);
    expect(await acknowledgedEventCount(bobTwo)).toBe(1);
  });

  it("rejects stale offline writes through revoke and restores the owner state on regrant", async () => {
    const ws = await family();
    const alice = track(await makeClient("alice", ws));
    const bob = track(await makeClient("bob", ws));

    const note = newId();
    const image = newId();
    await alice.engine.insert("notes", {
      id: note,
      title: "Owner title",
      body: "owner body",
      created_at: Date.now(),
    });
    await alice.engine.insert("note_images", {
      id: image,
      root_id: note,
      blob_id: newId(),
      caption: "owner child",
    });
    await waitServerHas("alice", ws, alice.nodeId, image);
    expect((await share("alice", ws, note, "bob", "write")).status).toBe(200);
    await waitUntil(async () => (await count(bob, "note_images", image)) === 1);

    await bob.transport.stop();
    await bob.engine.update("notes", note, { body: "stale offline body" });
    await bob.engine.update("note_images", image, { caption: "stale offline child" });
    expect((await unshare("alice", ws, note, "bob")).status).toBe(200);
    await bob.transport.start();
    await waitUntil(
      async () =>
        (await count(bob, "notes", note)) === 0 && (await count(bob, "note_images", image)) === 0,
    );

    const ownerBeforeRegrant = await alice.engine.exec<{ body: string }>(
      sql`SELECT body FROM notes WHERE id = ${note}`,
    );
    expect(ownerBeforeRegrant[0]?.body).toBe("owner body");
    expect((await share("alice", ws, note, "bob", "write")).status).toBe(200);
    const serverBackfill = await changes("bob", ws, bob.nodeId);
    expect(
      serverBackfill.changes.some((change) => change.ops.some((op) => op.row_id === note)),
    ).toBe(true);
    expect(
      serverBackfill.changes.some((change) => change.ops.some((op) => op.row_id === image)),
    ).toBe(true);
    expect(serverBackfill.purges).toEqual([]);
    await bob.transport.poll();
    await waitUntil(
      async () =>
        (await count(bob, "notes", note)) === 1 && (await count(bob, "note_images", image)) === 1,
    );
    const regranted = await bob.engine.exec<{ body: string }>(
      sql`SELECT body FROM notes WHERE id = ${note}`,
    );
    expect(regranted[0]?.body).toBe("owner body");
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
    await waitServerHas("alice", ws, alice.nodeId, note);
    await share("alice", ws, note, "bob", "read");
    await waitUntil(async () => (await count(bob, "notes", note)) === 1);

    expect((await unshare("alice", ws, note, "bob")).status).toBe(200);
    await waitUntil(async () => (await count(bob, "notes", note)) === 0);
    const pending = await bob.engine.adapter.exec<{ n: number }>(
      "SELECT COUNT(*) AS n FROM _sync_outbox",
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
    await waitServerHas("alice", ws, alice.nodeId, note);
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
    await waitServerHas("alice", ws, alice.nodeId, note);

    const blob = newId();
    expect(await putBlob("alice", ws, note, blob, "PNGDATA")).toBe(201);
    expect((await getBlob("alice", blob)).text).toBe("PNGDATA"); // owner reads
    expect((await getBlob("bob", blob)).status).toBe(403); // member, no grant

    await share("alice", ws, note, "bob", "read");
    expect((await getBlob("bob", blob)).text).toBe("PNGDATA"); // read grant → blob
    expect((await getBlob("carol", blob)).status).toBe(403); // never granted
  });
});
