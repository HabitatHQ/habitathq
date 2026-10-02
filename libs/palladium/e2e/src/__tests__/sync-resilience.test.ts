import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import {
  createEngine,
  generateUuidV7,
  type PalladiumEngine,
  type SchemaConfig,
  SyncTransport,
  sql,
} from "@palladium/core";
import { NodeSqliteAdapter } from "@palladium/sqlite-node";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { type ManagedServer, rustBinary, startServer, WORKSPACE_ROOT } from "../setup/process.js";

type TaskRow = { id: string; text: string; done: number };
type TasksSchema = { tasks: TaskRow };

const SCHEMA: SchemaConfig = {
  version: 1,
  schema:
    "CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, text TEXT NOT NULL, done INTEGER NOT NULL)",
};
const RETRY_TIMEOUT_MS = 4_000;
const WAIT_POLL_MS = 25;
const CLIENT_FIXTURE = fileURLToPath(new URL("../fixtures/sync-crash-client.mjs", import.meta.url));

type ServerChange = {
  readonly id: string;
  readonly hlc: { readonly wallMs: number; readonly counter: number; readonly nodeId: string };
  readonly ops: readonly unknown[];
};

type FixtureMessage =
  | {
      readonly event: "durable-outbox";
      readonly changeId: string;
      readonly checkpoint: string | null;
    }
  | {
      readonly event: "drained";
      readonly outbox: readonly { readonly change_id: string }[];
      readonly rows: readonly TaskRow[];
      readonly checkpoint: string | null;
    }
  | { readonly event: "error"; readonly message: string };

interface FixtureProcess {
  readonly child: ChildProcess;
  readonly messages: FixtureMessage[];
  readonly exited: Promise<{
    readonly code: number | null;
    readonly signal: NodeJS.Signals | null;
  }>;
  readonly events: EventEmitter;
  readonly stderr: () => string;
}

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

async function startTestServer(port?: number, env?: NodeJS.ProcessEnv): Promise<ManagedServer> {
  if (tmpDir === undefined) throw new Error("test temporary directory is not initialized");
  return startServer({
    name: "palladium resilience server",
    binary: rustBinary("palladium"),
    args: (boundPort) => ["--db", "sqlite:server.db", "dev", "--port", String(boundPort)],
    cwd: tmpDir,
    readinessPath: "/api-doc/openapi.json",
    ...(port === undefined ? {} : { port }),
    ...(env === undefined ? {} : { env }),
  });
}

function crashEnvironment(
  boundary: "before-commit" | "after-commit",
  changeId: string,
  marker: string,
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PALLADIUM_SQLITE_CRASH_APPEND: boundary,
    PALLADIUM_SQLITE_CRASH_CHANGE_ID: changeId,
    PALLADIUM_SQLITE_CRASH_MARKER: marker,
  };
}

function startClientFixture(
  mode: "enqueue" | "drain",
  filename: string,
  serverUrl: string,
  rowId: string,
  text: string,
): FixtureProcess {
  const child = spawn(process.execPath, [CLIENT_FIXTURE, mode, filename, serverUrl, rowId, text], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  const messages: FixtureMessage[] = [];
  const events = new EventEmitter();
  let stderr = "";
  const stdout = child.stdout;
  if (stdout === null) throw new Error("client fixture did not expose stdout");
  const lines = createInterface({ input: stdout });
  lines.on("line", (line) => {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      messages.push({ event: "error", message: `non-JSON fixture output: ${line}` });
      events.emit("message");
      return;
    }
    if (typeof message === "object" && message !== null && "event" in message) {
      messages.push(message as FixtureMessage);
      events.emit("message");
    }
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const exited = new Promise<{
    readonly code: number | null;
    readonly signal: NodeJS.Signals | null;
  }>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  const fixture = { child, messages, events, exited, stderr: () => stderr };
  fixtureProcesses.push(fixture);
  return fixture;
}

function taskChange(rowId: string, text: string): ServerChange {
  return {
    id: randomUUID(),
    hlc: { wallMs: Date.now(), counter: 0, nodeId: randomUUID() },
    ops: [{ op: "insert", table: "tasks", row_id: rowId, data: { id: rowId, text, done: 0 } }],
  };
}

async function postServerChange(serverUrl: string, change: ServerChange): Promise<Response> {
  return fetch(`${serverUrl}/v1/changes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(change),
  });
}
let server: ManagedServer | undefined;
let tmpDir: string | undefined;
const clients: Client[] = [];
const fixtureProcesses: FixtureProcess[] = [];

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
  await waitUntil("outbox upload eligibility", async () => {
    const [row] = await outbox(client);
    return row !== undefined && (row.next_retry_at === null || row.next_retry_at <= Date.now());
  });
}
async function waitForFixtureMessage<T extends FixtureMessage["event"]>(
  fixture: FixtureProcess,
  event: T,
): Promise<Extract<FixtureMessage, { readonly event: T }>> {
  const matching = (): Extract<FixtureMessage, { readonly event: T }> | undefined => {
    const failure = fixture.messages.find(
      (message): message is Extract<FixtureMessage, { readonly event: "error" }> =>
        message.event === "error",
    );
    if (failure !== undefined) {
      throw new Error(`client fixture failed: ${failure.message}\n${fixture.stderr()}`);
    }
    return fixture.messages.find(
      (message): message is Extract<FixtureMessage, { readonly event: T }> =>
        message.event === event,
    );
  };
  const initial = matching();
  if (initial !== undefined) return initial;

  return new Promise<Extract<FixtureMessage, { readonly event: T }>>((resolve, reject) => {
    // Bound a hung external process; success resolves on its stdout handshake, not elapsed time.
    const timeout = setTimeout(() => failed(new Error(`Timed out waiting for ${event}`)), 10_000);
    function cleanup(): void {
      clearTimeout(timeout);
      fixture.events.off("message", settle);
      fixture.child.off("exit", exited);
      fixture.child.off("error", failed);
    }
    function settle(): void {
      try {
        const message = matching();
        if (message === undefined) return;
        cleanup();
        resolve(message);
      } catch (error) {
        cleanup();
        reject(error);
      }
    }
    function exited(): void {
      cleanup();
      reject(new Error(`client fixture exited before reporting ${event}\n${fixture.stderr()}`));
    }
    function failed(error: Error): void {
      cleanup();
      reject(error);
    }
    fixture.events.on("message", settle);
    fixture.child.once("exit", exited);
    fixture.child.once("error", failed);
  });
}

async function serverHistory(
  serverUrl: string,
): Promise<readonly { id: string; ops: readonly unknown[] }[]> {
  const response = await fetch(`${serverUrl}/v1/changes?limit=100`);
  expect(response.ok).toBe(true);
  const body: unknown = await response.json();
  const changes =
    typeof body === "object" && body !== null && !Array.isArray(body) && "changes" in body
      ? body.changes
      : undefined;
  if (!Array.isArray(changes)) throw new Error("real server returned an invalid history envelope");
  return changes.filter(
    (change: unknown): change is { id: string; ops: readonly unknown[] } =>
      typeof change === "object" &&
      change !== null &&
      !Array.isArray(change) &&
      "id" in change &&
      typeof change.id === "string" &&
      "ops" in change &&
      Array.isArray(change.ops),
  );
}

async function receiptCursor(response: Response): Promise<string> {
  expect(response.status).toBe(201);
  const receipt: unknown = await response.json();
  if (
    typeof receipt !== "object" ||
    receipt === null ||
    Array.isArray(receipt) ||
    !("cursor" in receipt) ||
    typeof receipt.cursor !== "string"
  ) {
    throw new Error("real server returned an invalid change receipt");
  }
  return receipt.cursor;
}

describe("SyncTransport resilience against the real Rust server", () => {
  beforeAll(() => {
    execFileSync("cargo", ["build", "-p", "palladium-cli", "--features", "crash-test-fixtures"], {
      cwd: WORKSPACE_ROOT,
      stdio: "inherit",
    });
  }, 120_000);

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "palladium-sync-resilience-"));
    server = await startTestServer();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    let clientFailure: unknown;
    await Promise.all(
      fixtureProcesses.splice(0).map(async (fixture) => {
        if (fixture.child.exitCode === null && fixture.child.signalCode === null) {
          fixture.child.kill("SIGKILL");
        }
        await fixture.exited;
      }),
    );
    try {
      await Promise.all(clients.splice(0).map((client) => client.close()));
    } catch (error) {
      clientFailure = error;
    }
    if (server !== undefined) {
      await server.stop();
      server = undefined;
    }
    if (tmpDir !== undefined) {
      await rm(tmpDir, { recursive: true, force: true });
      tmpDir = undefined;
    }
    if (clientFailure !== undefined) throw clientFailure;
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
  it("retains an acknowledged server append across SIGKILL with its exact receipt checkpoint", async () => {
    if (server === undefined || tmpDir === undefined) throw new Error("server fixture unavailable");
    const rowId = generateUuidV7();
    const change = taskChange(rowId, "acknowledged before SIGKILL");
    const cursor = await receiptCursor(await postServerChange(server.baseUrl, change));
    const port = server.port;

    await server.crash();
    server = await startTestServer(port);

    expect((await serverHistory(server.baseUrl)).filter((entry) => entry.id === change.id)).toEqual(
      [expect.objectContaining({ id: change.id, ops: change.ops })],
    );
    const consumer = track(
      await makeClient(join(tmpDir, "acknowledged-consumer.db"), server.baseUrl),
    );
    await consumer.transport.syncOnce();
    expect(await taskRows(consumer)).toEqual([
      { id: rowId, text: "acknowledged before SIGKILL", done: 0 },
    ]);
    expect(await checkpoint(consumer)).toBe(cursor);
  });

  it("loses no append when the real server aborts before the SQLite commit boundary", async () => {
    if (server === undefined || tmpDir === undefined) throw new Error("server fixture unavailable");
    const rowId = generateUuidV7();
    const change = taskChange(rowId, "before commit");
    const marker = join(tmpDir, "before-commit.marker");
    const port = server.port;
    await server.crash();
    server = await startTestServer(port, crashEnvironment("before-commit", change.id, marker));

    await expect(postServerChange(server.baseUrl, change)).rejects.toThrow();
    await server.crash();
    expect(await readFile(marker, "utf8")).toBe(`before-commit:${change.id}\n`);
    server = await startTestServer(port);

    expect((await serverHistory(server.baseUrl)).filter((entry) => entry.id === change.id)).toEqual(
      [],
    );
    const cursor = await receiptCursor(await postServerChange(server.baseUrl, change));
    expect((await serverHistory(server.baseUrl)).filter((entry) => entry.id === change.id)).toEqual(
      [expect.objectContaining({ id: change.id, ops: change.ops })],
    );
    const consumer = track(
      await makeClient(join(tmpDir, "before-commit-consumer.db"), server.baseUrl),
    );
    await consumer.transport.syncOnce();
    expect(await taskRows(consumer)).toEqual([{ id: rowId, text: "before commit", done: 0 }]);
    expect(await checkpoint(consumer)).toBe(cursor);
  });

  it("retries an after-commit server abort as one exact durable append", async () => {
    if (server === undefined || tmpDir === undefined) throw new Error("server fixture unavailable");
    const rowId = generateUuidV7();
    const change = taskChange(rowId, "after commit");
    const marker = join(tmpDir, "after-commit.marker");
    const port = server.port;
    await server.crash();
    server = await startTestServer(port, crashEnvironment("after-commit", change.id, marker));

    await expect(postServerChange(server.baseUrl, change)).rejects.toThrow();
    await server.crash();
    expect(await readFile(marker, "utf8")).toBe(`after-commit:${change.id}\n`);
    server = await startTestServer(port);

    const retry = await postServerChange(server.baseUrl, change);
    const cursor = await receiptCursor(retry);
    expect((await serverHistory(server.baseUrl)).filter((entry) => entry.id === change.id)).toEqual(
      [expect.objectContaining({ id: change.id, ops: change.ops })],
    );
    const consumer = track(
      await makeClient(join(tmpDir, "after-commit-consumer.db"), server.baseUrl),
    );
    await consumer.transport.syncOnce();
    expect(await taskRows(consumer)).toEqual([{ id: rowId, text: "after commit", done: 0 }]);
    expect(await checkpoint(consumer)).toBe(cursor);
  });

  it("drains an exact durable local outbox after the client process is SIGKILLed", async () => {
    if (server === undefined || tmpDir === undefined) throw new Error("server fixture unavailable");
    const rowId = generateUuidV7();
    const text = "client outbox survives SIGKILL";
    const filename = join(tmpDir, "killed-client.db");
    const enqueuer = startClientFixture("enqueue", filename, server.baseUrl, rowId, text);
    const durable = await waitForFixtureMessage(enqueuer, "durable-outbox");
    expect(durable.checkpoint).toBeNull();

    enqueuer.child.kill("SIGKILL");
    expect(await enqueuer.exited).toEqual({ code: null, signal: "SIGKILL" });

    const reopened = startClientFixture("drain", filename, server.baseUrl, rowId, text);
    const drained = await waitForFixtureMessage(reopened, "drained");
    expect(await reopened.exited).toEqual({ code: 0, signal: null });
    expect(drained.outbox).toEqual([]);
    expect(drained.rows).toEqual([{ id: rowId, text, done: 0 }]);
    expect(drained.checkpoint).not.toBeNull();
    expect(
      (await serverHistory(server.baseUrl)).filter((entry) => entry.id === durable.changeId),
    ).toEqual([
      expect.objectContaining({
        id: durable.changeId,
        ops: [{ op: "insert", table: "tasks", row_id: rowId, data: { id: rowId, text, done: 0 } }],
      }),
    ]);
  });
  it("recovers future-clock pending work and syncs to a ten-year-slow receiver through the real server", async () => {
    if (server === undefined || tmpDir === undefined) throw new Error("server fixture unavailable");
    const filename = join(tmpDir, "skewed-writer.db");
    const writer = track(await makeClient(filename, server.baseUrl, undefined, false));
    const rowId = generateUuidV7();
    const accurateNow = Date.now();
    const tenYears = 10 * 365 * 24 * 60 * 60 * 1_000;
    const wall = vi.spyOn(Date, "now").mockReturnValue(accurateNow + tenYears);
    await writer.engine.insert("tasks", { id: rowId, text: "preserved offline intent", done: 0 });
    wall.mockRestore();
    const original = (await outbox(writer))[0];
    if (original === undefined) throw new Error("missing skewed durable Change");
    await writer.transport.syncOnce();
    expect(writer.transport.lastError?.code).toBe("clock_skew");
    expect((await serverHistory(server.baseUrl)).map((entry) => entry.id)).not.toContain(
      original.change_id,
    );
    await writer.close();
    clients.splice(clients.indexOf(writer), 1);

    const reopened = track(await makeClient(filename, server.baseUrl, undefined, false));
    const recovered = await reopened.transport.recoverClock();
    expect(recovered).toEqual([
      {
        originalChangeId: original.change_id,
        replacementChangeId: expect.any(String),
      },
    ]);
    const replacement = recovered[0];
    if (replacement === undefined) throw new Error("missing replacement mapping");
    expect(replacement.replacementChangeId).not.toBe(original.change_id);
    expect(await reopened.transport.inspectQuarantine()).toContainEqual(
      expect.objectContaining({
        changeId: original.change_id,
        disposition: "superseded",
      }),
    );
    await reopened.transport.syncOnce();
    expect(await outbox(reopened)).toEqual([]);
    expect((await serverHistory(server.baseUrl)).map((entry) => entry.id)).toEqual([
      replacement.replacementChangeId,
    ]);

    const reader = track(
      await makeClient(join(tmpDir, "slow-reader.db"), server.baseUrl, undefined, false),
    );
    vi.spyOn(Date, "now").mockReturnValue(accurateNow - tenYears);
    await reader.transport.syncOnce();
    expect(await taskRows(reader)).toEqual([
      { id: rowId, text: "preserved offline intent", done: 0 },
    ]);
    await reader.engine.update("tasks", rowId, { done: 1 });
    await reader.transport.syncOnce();
    vi.restoreAllMocks();
    await reopened.transport.syncOnce();
    expect(await taskRows(reopened)).toEqual([
      { id: rowId, text: "preserved offline intent", done: 1 },
    ]);
    expect(await reader.transport.inspectQuarantine()).toEqual([]);
    expect(await outbox(reader)).toEqual([]);
  });
});
