import { connect } from "@palladium/worker";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import type { NotesService, NotesWorkerConfig } from "./db.js";

const params = new URLSearchParams(window.location.search);
const databaseName = params.get("database") ?? "default";
const persistedNodeKey = `palladium-react-notes-node:${databaseName}`;
const nodeId = params.get("node") ?? localStorage.getItem(persistedNodeKey) ?? crypto.randomUUID();

if (params.get("node") === null) localStorage.setItem(persistedNodeKey, nodeId);

const serverUrl = (import.meta.env["VITE_API_URL"] as string | undefined) ?? "";
const worker = new Worker(new URL("./db.worker.ts", import.meta.url), { type: "module" });
const workerConfig: NotesWorkerConfig = { databaseName, nodeId, serverUrl };
worker.postMessage(workerConfig);
const connection = connect<NotesService>(worker);

const root = document.getElementById("root");
if (!root) throw new Error("Root element #root not found");

createRoot(root).render(
  <StrictMode>
    <App connection={connection} />
  </StrictMode>,
);

window.addEventListener("pagehide", () => worker.terminate(), { once: true });
