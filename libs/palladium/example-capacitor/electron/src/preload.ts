/**
 * Electron preload — bridges window.__sqlite__ (renderer) to IPC calls handled
 * by the main process (electron/src/index.ts).
 *
 * All database operations execute in the main process where sql.js runs in a
 * true Node.js environment without browser-context restrictions.
 */

import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("__sqlite__", {
  open: (dbName: string) => ipcRenderer.invoke("sqlite:open", dbName),

  query: (dbName: string, sql: string, params: unknown[]) =>
    ipcRenderer.invoke("sqlite:query", dbName, sql, params),

  run: (dbName: string, sql: string, params: unknown[]) =>
    ipcRenderer.invoke("sqlite:run", dbName, sql, params),

  execute: (dbName: string, sql: string) => ipcRenderer.invoke("sqlite:execute", dbName, sql),

  beginTx: (dbName: string) => ipcRenderer.invoke("sqlite:beginTx", dbName),

  commitTx: (dbName: string) => ipcRenderer.invoke("sqlite:commitTx", dbName),

  rollbackTx: (dbName: string) => ipcRenderer.invoke("sqlite:rollbackTx", dbName),

  close: (dbName: string) => ipcRenderer.invoke("sqlite:close", dbName),
});
