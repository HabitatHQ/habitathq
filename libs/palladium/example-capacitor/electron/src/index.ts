/**
 * Electron main process entry point.
 *
 * Creates a BrowserWindow, registers IPC handlers that run sql.js (a pure-JS
 * SQLite library) for database operations, and loads the Vite-built renderer
 * from dist/index.html.
 *
 * Running sql.js here (in the true Node.js main process) avoids the browser-
 * context restrictions that exist in the renderer/preload hybrid.
 */

import path from "node:path";
import { BrowserWindow, app, ipcMain } from "electron";
import initSqlJs from "sql.js";
import type { Database, SqlJsStatic } from "sql.js";

const sqlJsDir = path.dirname(require.resolve("sql.js"));

let sqlInstance: SqlJsStatic | null = null;
const dbs = new Map<string, Database>();

const sqlInitPromise: Promise<void> = initSqlJs({
  locateFile: (filename: string) => path.join(sqlJsDir, filename),
}).then((SQL) => {
  sqlInstance = SQL;
});

/** Coerce JS values to types accepted by sql.js bind(). */
function coerce(v: unknown): null | number | string | Uint8Array {
  if (v === null || v === undefined) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "number" || typeof v === "string" || v instanceof Uint8Array) return v;
  return String(v);
}

function getDb(dbName: string): Database {
  const db = dbs.get(dbName);
  if (db === undefined) throw new Error(`Database "${dbName}" is not open.`);
  return db;
}

// ── IPC handlers ──────────────────────────────────────────────────────────────

ipcMain.handle("sqlite:open", async (_event, dbName: string) => {
  await sqlInitPromise;
  if (!dbs.has(dbName)) {
    // biome-ignore lint/style/noNonNullAssertion: set by sqlInitPromise
    dbs.set(dbName, new sqlInstance!.Database());
  }
});

ipcMain.handle("sqlite:query", async (_event, dbName: string, sql: string, params: unknown[]) => {
  await sqlInitPromise;
  const db = getDb(dbName);
  const stmt = db.prepare(sql);
  stmt.bind(params.map(coerce));
  const rows: Record<string, unknown>[] = [];
  while (stmt.step()) {
    rows.push({ ...stmt.getAsObject() } as Record<string, unknown>);
  }
  stmt.free();
  return rows;
});

ipcMain.handle("sqlite:run", async (_event, dbName: string, sql: string, params: unknown[]) => {
  await sqlInitPromise;
  getDb(dbName).run(sql, params.map(coerce));
});

ipcMain.handle("sqlite:execute", async (_event, dbName: string, sql: string) => {
  await sqlInitPromise;
  getDb(dbName).run(sql);
});

ipcMain.handle("sqlite:beginTx", async (_event, dbName: string) => {
  await sqlInitPromise;
  getDb(dbName).run("BEGIN");
});

ipcMain.handle("sqlite:commitTx", async (_event, dbName: string) => {
  await sqlInitPromise;
  getDb(dbName).run("COMMIT");
});

ipcMain.handle("sqlite:rollbackTx", async (_event, dbName: string) => {
  await sqlInitPromise;
  getDb(dbName).run("ROLLBACK");
});

ipcMain.handle("sqlite:close", async (_event, dbName: string) => {
  await sqlInitPromise;
  const db = dbs.get(dbName);
  if (db !== undefined) {
    db.close();
    dbs.delete(dbName);
  }
});

// ── Window ────────────────────────────────────────────────────────────────────

function createWindow(): void {
  const win = new BrowserWindow({
    width: 900,
    height: 700,
    show: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  void win.loadFile(path.join(__dirname, "../../dist/index.html"));
}

app
  .whenReady()
  .then(createWindow)
  .catch((err: unknown) => {
    process.stderr.write(`Electron app error: ${String(err)}\n`);
    app.exit(1);
  });

app.on("window-all-closed", () => {
  app.quit();
});
