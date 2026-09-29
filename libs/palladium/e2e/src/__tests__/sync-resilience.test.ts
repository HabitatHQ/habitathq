import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  createEngine,
  generateUuidV7,
  type PalladiumEngine,
  type SchemaConfig,
  SyncTransport,
  sql,
} from "@palladium/core";
import { NodeSqliteAdapter } from "@palladium/sqlite-node";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildRustPackage, type ManagedServer, rustBinary, startServer } from "../setup/process.js";

type TaskRow = { id: string; text: string; done: number };
type TasksSchema = { tasks: TaskRow };

const SCHEMA: SchemaConfig = {
  version: 1,
  schema:
    "CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, text TEXT NOT NULL, done INTEGER NOT NULL)",
};
const RETRY_TIMEOUT_MS = 4_000;
const WAIT_POLL_MS = 25;

interface Client {
  readonly engine: PalladiumEngine<TasksSchema>;
  readonly transport: SyncTransport<TasksSchema>;
  close(): Promise<void>;
}

class TransparentFaultFetch {
  #partitioned = false;
  #dropNextPostReceipt = false;
  #truncateNextGet = false;
  readonly postedChangeIds: string[] = [];

  partition(): void {
    this.#partitioned = true;
  }

  reconnect(): void {
    this.#partitioned = false;
  }

  dropNextPostReceipt(): void {
    this.#dropNextPostReceipt = true;
  }

  truncateNextGet(): void {
    this.#truncateNextGet = true;
  }

  readonly fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (this.#partitioned) throw new TypeError("deterministic network partition");
    const request = new Request(input, init);
    const path = new URL(request.url).pathname;
    const isChangePost = request.method === "POST" && path === "/v1/changes";
    const isChangeGet = request.method === "GET" && path === "/v1/changes";

    if (isChangePost) {
      const payload: unknown = await request.clone().json();
      const changeId =
        typeof payload === "object" &&
        payload !== null &&
        !Array.isArray(payload) &&
        "id" in payload
          ? payload.id
          : undefined;
      if (typeof changeId !== "string") {
        throw new Error("fault seam observed a change POST without a string id");
      }
      this.postedChangeIds.push(changeId);
    }

    const response = await fetch(request);
    if (isChangePost && this.#dropNextPostReceipt) {
      this.#dropNextPostReceipt = false;
      await response.arrayBuffer();
      throw new TypeError("deterministic lost acknowledgement after upstream commit");
    }
    if (isChangeGet && this.#truncateNextGet) {
      this.#truncateNextGet = false;
      const bytes = new Uint8Array(await response.arrayBuffer());
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

let server: ManagedServer | undefined;
let tmpDir: string | undefined;
const clients: Client[] = [];

async function startTestServer(port?: number): Promise<ManagedServer> {
  if (tmpDir === undefined) throw new Error("test temporary directory is not initialized");
  return startServer({
    name: "palladium resilience server",
    binary: rustBinary("palladium"),
    args: (boundPort) => ["--db", "sqlite:server.db", "dev", "--port", String(boundPort)],
    cwd: tmpDir,
    readinessPath: "/api-doc/openapi.json",
    ...(port === undefined ? {} : { port }),
  });
}

async function makeClient(
  filename: string,
  serverUrl: string,
  faultFetch: TransparentFaultFetch = new TransparentFaultFetch(),
  start = true,
): Promise<Client> {
  const engine = createEngine<TasksSchema>(
    new NodeSqliteAdapter({ vfs: { type: "file", filename } }),
    { nodeId: randomUUID() },
  );
  await engine.init(SCHEMA);
  const transport = new SyncTransport(engine, {
    serverUrl,
    fetch: faultFetch.fetch,
    pollIntervalMs: 60_000,
  });
  if (start) await transport.start();
  return {
    engine,
    transport,
    close: async () => {
      await transport.dispose();
      await engine.adapter.close();
    },
  };
}

function track(client: Client): Client {
  clients.push(client);
  return client;
}

async function taskRows(client: Client): Promise<TaskRow[]> {
  return client.engine.exec<TaskRow>(sql`SELECT id, text, done FROM tasks ORDER BY id`);
}

async function outbox(
  client: Client,
): Promise<readonly { change_id: string; retry_attempts: number; next_retry_at: number | null }[]> {
  return client.engine.adapter.exec(
    "SELECT change_id, retry_attempts, next_retry_at FROM _sync_outbox ORDER BY change_id",
    [],
  );
}

async function checkpoint(client: Client): Promise<string | null> {
  return client.engine.getSyncState("append_cursor_v1");
}

async function waitUntil(description: string, predicate: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + RETRY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await delay(WAIT_POLL_MS);
  }
  throw new Error(`timed out waiting for ${description}`);
}

async function retryWhenDue(client: Client): Promise<void> {
  await waitUntil("outbox retry backoff", async () => {
    const [row] = await outbox(client);
    return row !== undefined && row.next_retry_at !== null && row.next_retry_at <= Date.now();
  });
}

async function serverHistory(serverUrl: string): Promise<readonly { id: string }[]> {
  const response = await fetch(`${serverUrl}/v1/changes?limit=100`);
  expect(response.ok).toBe(true);
  const body: unknown = await response.json();
  const changes =
    typeof body === "object" && body !== null && !Array.isArray(body) && "changes" in body
      ? body.changes
      : undefined;
  if (!Array.isArray(changes)) throw new Error("real server returned an invalid history envelope");
  return changes.filter(
    (change: unknown): change is { id: string } =>
      typeof change === "object" &&
      change !== null &&
      !Array.isArray(change) &&
      "id" in change &&
      typeof change.id === "string",
  );
}

describe("SyncTransport resilience against the real Rust server", () => {
  beforeAll(() => {
    buildRustPackage("palladium-cli");
  }, 120_000);

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "palladium-sync-resilience-"));
    server = await startTestServer();
  });

  afterEach(async () => {
    let clientFailure: unknown;
    try {
      await Promise.all(clients.splice(0).map((client) => client.close()));
    } catch (error) {
      clientFailure = error;
    }
    if (server !== undefined) {
      await server.stop();
      server = undefined;
    }
    if (clientFailure !== undefined) throw clientFailure;
    if (tmpDir !== undefined) {
      await rm(tmpDir, { recursive: true, force: true });
      tmpDir = undefined;
    }
  });

  it("retries a committed POST with its durable change id and one server append", async () => {
    if (server === undefined || tmpDir === undefined) throw new Error("server fixture unavailable");
    const faults = new TransparentFaultFetch();
    const writer = track(
      await makeClient(join(tmpDir, "writer.db"), server.baseUrl, faults, false),
    );
    const reader = track(await makeClient(join(tmpDir, "reader.db"), server.baseUrl));
    const rowId = generateUuidV7();

    await writer.engine.insert("tasks", { id: rowId, text: "receipt lost", done: 0 });
    faults.dropNextPostReceipt();
    const [durable] = await outbox(writer);
    expect(durable).toBeDefined();
    const changeId = durable?.change_id;
    if (changeId === undefined) throw new Error("local change was not durably enqueued");

    await writer.transport.start();
    expect(await outbox(writer)).toEqual([
      expect.objectContaining({ change_id: changeId, retry_attempts: 1 }),
    ]);
    expect(faults.postedChangeIds).toEqual([changeId]);

    await retryWhenDue(writer);
    await writer.transport.syncOnce();
    expect(await outbox(writer)).toEqual([]);
    expect(faults.postedChangeIds).toEqual([changeId, changeId]);
    expect(
      (await serverHistory(server.baseUrl)).filter((change) => change.id === changeId),
    ).toHaveLength(1);

    await reader.transport.syncOnce();
    expect(await taskRows(reader)).toEqual([{ id: rowId, text: "receipt lost", done: 0 }]);
    expect(await checkpoint(reader)).not.toBeNull();
  });

  it("does not checkpoint a truncated real GET body and recovers from the same page", async () => {
    if (server === undefined || tmpDir === undefined) throw new Error("server fixture unavailable");
    const source = track(await makeClient(join(tmpDir, "source.db"), server.baseUrl));
    const rowId = generateUuidV7();
    await source.engine.insert("tasks", { id: rowId, text: "truncated page", done: 0 });
    await source.transport.syncOnce();
    expect(await outbox(source)).toEqual([]);

    const faults = new TransparentFaultFetch();
    faults.truncateNextGet();
    const receiver = track(
      await makeClient(join(tmpDir, "receiver.db"), server.baseUrl, faults, false),
    );
    await receiver.transport.start();
    expect(await checkpoint(receiver)).toBeNull();
    expect(await taskRows(receiver)).toEqual([]);

    await receiver.transport.syncOnce();
    expect(await taskRows(receiver)).toEqual([{ id: rowId, text: "truncated page", done: 0 }]);
    expect(await checkpoint(receiver)).not.toBeNull();
  });

  it("retains a file-backed outbox during a partition and converges after reconnect", async () => {
    if (server === undefined || tmpDir === undefined) throw new Error("server fixture unavailable");
    const faults = new TransparentFaultFetch();
    const writer = track(
      await makeClient(join(tmpDir, "partitioned-writer.db"), server.baseUrl, faults, false),
    );
    const reader = track(await makeClient(join(tmpDir, "partitioned-reader.db"), server.baseUrl));
    const rowId = generateUuidV7();

    faults.partition();
    await writer.engine.insert("tasks", { id: rowId, text: "offline first", done: 0 });
    const [durable] = await outbox(writer);
    expect(durable).toBeDefined();
    const changeId = durable?.change_id;
    if (changeId === undefined) throw new Error("local change was not durably enqueued");
    await writer.transport.start();
    expect((await outbox(writer)).map((row) => row.change_id)).toEqual([changeId]);
    expect(await taskRows(writer)).toEqual([{ id: rowId, text: "offline first", done: 0 }]);

    faults.reconnect();
    await retryWhenDue(writer);
    await writer.transport.syncOnce();
    await reader.transport.syncOnce();
    expect(await outbox(writer)).toEqual([]);
    expect(await taskRows(reader)).toEqual([{ id: rowId, text: "offline first", done: 0 }]);
  });

  it("survives client reopen and server crash restart without losing the queued change or history", async () => {
    if (server === undefined || tmpDir === undefined) throw new Error("server fixture unavailable");
    const clientFile = join(tmpDir, "reopened-client.db");
    const initial = track(
      await makeClient(clientFile, server.baseUrl, new TransparentFaultFetch(), false),
    );
    const rowId = generateUuidV7();
    await initial.engine.insert("tasks", { id: rowId, text: "survives restart", done: 0 });
    const [durable] = await outbox(initial);
    const changeId = durable?.change_id;
    if (changeId === undefined) throw new Error("local change was not durably enqueued");
    await initial.close();

    const port = server.port;
    await server.crash();
    server = await startTestServer(port);

    const reopened = track(await makeClient(clientFile, server.baseUrl));
    const reader = track(await makeClient(join(tmpDir, "after-restart-reader.db"), server.baseUrl));
    await reopened.transport.syncOnce();
    await reader.transport.syncOnce();

    expect(await outbox(reopened)).toEqual([]);
    expect(await taskRows(reopened)).toEqual([{ id: rowId, text: "survives restart", done: 0 }]);
    expect(await taskRows(reader)).toEqual([{ id: rowId, text: "survives restart", done: 0 }]);
    expect(await checkpoint(reopened)).not.toBeNull();
    expect(
      (await serverHistory(server.baseUrl)).filter((change) => change.id === changeId),
    ).toHaveLength(1);
  });
});
