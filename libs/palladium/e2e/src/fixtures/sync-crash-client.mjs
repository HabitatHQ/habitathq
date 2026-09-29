import { randomUUID } from "node:crypto";
import { createEngine, SyncTransport, sql } from "@palladium/core";
import { NodeSqliteAdapter } from "@palladium/sqlite-node";

const [mode, filename, serverUrl, rowId, text] = process.argv.slice(2);

if (
  (mode !== "enqueue" && mode !== "drain") ||
  filename === undefined ||
  serverUrl === undefined ||
  rowId === undefined ||
  text === undefined
) {
  throw new Error("usage: sync-crash-client.mjs <enqueue|drain> <db> <server-url> <row-id> <text>");
}

const schema = {
  version: 1,
  schema:
    "CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, text TEXT NOT NULL, done INTEGER NOT NULL)",
};
const engine = createEngine(new NodeSqliteAdapter({ vfs: { type: "file", filename } }), {
  nodeId: randomUUID(),
});
let transport;

function emit(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

try {
  await engine.init(schema);
  transport = new SyncTransport(engine, { serverUrl, pollIntervalMs: 60_000 });
  if (mode === "enqueue") {
    // Keep a live pipe open until the parent kills this process at the handshake.
    process.stdin.resume();
    await engine.insert("tasks", { id: rowId, text, done: 0 });
    const [outbox] = await engine.adapter.exec(
      "SELECT change_id FROM _sync_outbox ORDER BY change_id",
      [],
    );
    if (outbox?.change_id === undefined) throw new Error("local change was not durably enqueued");
    emit({
      event: "durable-outbox",
      changeId: outbox.change_id,
      checkpoint: await engine.getSyncState("append_cursor_v1"),
    });
    const { promise } = Promise.withResolvers();
    await promise;
  }

  await transport.start();
  emit({
    event: "drained",
    outbox: await engine.adapter.exec("SELECT change_id FROM _sync_outbox ORDER BY change_id", []),
    rows: await engine.exec(sql`SELECT id, text, done FROM tasks ORDER BY id`),
    checkpoint: await engine.getSyncState("append_cursor_v1"),
  });
} catch (error) {
  emit({ event: "error", message: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
} finally {
  if (transport !== undefined) await transport.dispose();
  await engine.adapter.close();
}
