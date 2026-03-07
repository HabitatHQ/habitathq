import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature requires bracket notation
const PALLADIUM_API = process.env["PALLADIUM_API"] ?? "http://localhost:13743";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Prevent Vite from trying to bundle node:module (used by SqliteAdapter).
      // We use MemoryAdapter in the browser, so this import is never called.
      "node:module": fileURLToPath(new URL("./src/stubs/node-module.ts", import.meta.url)),
    },
  },
  server: {
    proxy: {
      // Forward /v1/* to the Palladium backend, avoiding CORS in the browser.
      "/v1": {
        target: PALLADIUM_API,
        changeOrigin: true,
      },
    },
  },
});
