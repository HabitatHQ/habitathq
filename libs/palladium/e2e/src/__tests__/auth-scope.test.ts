/**
 * Auth-seam scoping E2E (Phase 2).
 *
 * Boots a *dedicated* Rust server in `--auth bearer` mode, so the store scope
 * is derived from the `Authorization: Bearer <token>` header (a stand-in for a
 * real host seam). Proves end-to-end that:
 *   - two clients with the SAME token share a workspace and converge;
 *   - a client with a DIFFERENT token never sees the other workspace's data;
 *   - a client with NO token is rejected (401) and syncs nothing.
 */

import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { createEngine, type PalladiumEngine, SyncTransport, sql } from "@palladium/core";
import { NodeSqliteAdapter } from "@palladium/sqlite-node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "../../../../../");
const BINARY = join(ROOT, "target", "debug", "palladium");
const PORT = 13_755;
const BASE_URL = `http://localhost:${PORT}`;
const POLL_MS = 200;

type TaskRow = { id: string; text: string; done: number };
type TasksSchema = { tasks: TaskRow };
const SCHEMA = {
  version: 1,
  schema:
    "CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, text TEXT NOT NULL, done INTEGER NOT NULL)",
};

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
  execFileSync("cargo", ["build", "-p", "palladium-cli"], { cwd: ROOT, stdio: "inherit" });
  tmpDir = await mkdtemp(join(tmpdir(), "palladium-e2e-auth-"));
  server = spawn(
    BINARY,
    ["--db", "sqlite:auth.db", "dev", "--port", String(PORT), "--auth", "bearer"],
    { cwd: tmpDir, stdio: "pipe" },
  );
  server.stderr?.on("data", (c: Buffer) => process.stderr.write(`[palladium-auth] ${c}`));
  await waitForReady(`${BASE_URL}/api-doc/openapi.json`);
}, 60_000);

afterAll(async () => {
  server?.kill("SIGTERM");
  if (tmpDir !== undefined) await rm(tmpDir, { recursive: true, force: true });
});

interface Client {
  engine: PalladiumEngine<TasksSchema>;
  transport: SyncTransport<TasksSchema>;
  stop(): Promise<void>;
}

/** A client whose transport authenticates with `token` (or none → 401). */
async function makeClient(token: string | null): Promise<Client> {
  const engine = createEngine<TasksSchema>(new NodeSqliteAdapter({ vfs: { type: "memory" } }), {
    nodeId: crypto.randomUUID(),
  });
  await engine.init(SCHEMA);
  // Omit `authHeaders` entirely when there's no token (exactOptionalPropertyTypes
  // forbids passing `undefined` for an optional property).
  const transport = new SyncTransport(engine, {
    serverUrl: BASE_URL,
    pollIntervalMs: POLL_MS,
    ...(token === null ? {} : { authHeaders: () => ({ Authorization: `Bearer ${token}` }) }),
  });
  await transport.start();
  return { engine, transport, stop: () => transport.stop() };
}

async function tasksOf(c: Client): Promise<TaskRow[]> {
  return c.engine.exec<TaskRow>(sql`SELECT id, text, done FROM tasks ORDER BY id`);
}

async function waitFor(
  c: Client,
  predicate: (r: TaskRow[]) => boolean,
  timeoutMs = 5_000,
): Promise<TaskRow[]> {
  const deadline = Date.now() + timeoutMs;
  let last: TaskRow[] = [];
  while (Date.now() < deadline) {
    last = await tasksOf(c);
    if (predicate(last)) return last;
    await sleep(POLL_MS / 2);
  }
  throw new Error(`waitFor timed out. Last: ${JSON.stringify(last)}`);
}

describe("auth-seam scoping", () => {
  const clients: Client[] = [];
  const track = (c: Client): Client => {
    clients.push(c);
    return c;
  };
  afterEach(async () => {
    await Promise.all(clients.splice(0).map((c) => c.stop()));
  });

  it("same token → same workspace: writes converge", async () => {
    const a1 = track(await makeClient("alice"));
    const a2 = track(await makeClient("alice"));
    const id = crypto.randomUUID();
    await a1.engine.insert("tasks", { id, text: "hi from a1", done: 0 });

    const rows = await waitFor(a2, (r) => r.some((t) => t.id === id));
    expect(rows.find((t) => t.id === id)?.text).toBe("hi from a1");
  });

  it("different token → isolated workspace: no cross-tenant leak", async () => {
    const alice = track(await makeClient("alice"));
    const bob = track(await makeClient("bob"));
    const id = crypto.randomUUID();
    await alice.engine.insert("tasks", { id, text: "alice secret", done: 0 });

    // Alice sees her own write (round-trips through her scope)…
    await waitFor(alice, (r) => r.some((t) => t.id === id));
    // …but bob (different scope) never does, even after ample polling.
    await sleep(POLL_MS * 6);
    const bobRows = await tasksOf(bob);
    expect(bobRows.some((t) => t.id === id)).toBe(false);
  });

  it("no token → 401: the client syncs nothing", async () => {
    // A direct unauthenticated GET is rejected.
    const res = await fetch(`${BASE_URL}/v1/changes`);
    expect(res.status).toBe(401);

    // And a no-token client's write never lands server-side (its own local row
    // stays, but a fresh authed client in another scope never sees it).
    const anon = track(await makeClient(null));
    const id = crypto.randomUUID();
    await anon.engine.insert("tasks", { id, text: "no auth", done: 0 });
    await sleep(POLL_MS * 4);

    const carol = track(await makeClient("carol"));
    await sleep(POLL_MS * 4);
    expect((await tasksOf(carol)).some((t) => t.id === id)).toBe(false);
  });
});
