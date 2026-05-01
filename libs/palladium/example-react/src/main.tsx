import { PalladiumProvider } from "@palladium/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { NotesEngine } from "./db.js";

/**
 * Each browser tab / test instance gets a unique node ID from the URL.
 * The ID must be a UUID — the Rust backend parses node_id as a Uuid.
 *
 * Example:  /?node=550e8400-e29b-41d4-a716-446655440001
 */
const nodeId = new URLSearchParams(window.location.search).get("node") ?? crypto.randomUUID();

/**
 * API base URL.  In development the Vite proxy forwards `/v1/*` to the
 * Palladium backend, so we use an empty string (relative paths).
 * Set VITE_API_URL to an absolute URL to bypass the proxy.
 */
// biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature requires bracket notation
const serverUrl = (import.meta.env["VITE_API_URL"] as string | undefined) ?? "";

const engine = new NotesEngine(serverUrl, nodeId);
await engine.init();

const root = document.getElementById("root");
if (!root) throw new Error("Root element #root not found");

createRoot(root).render(
  <StrictMode>
    <PalladiumProvider engine={engine}>
      <App />
    </PalladiumProvider>
  </StrictMode>,
);
