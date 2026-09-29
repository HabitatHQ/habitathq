import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const PALLADIUM_API = process.env["PALLADIUM_API"] ?? "http://localhost:13743";

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    // sqlite-wasm must not be pre-bundled — it manages its own WASM loading.
    exclude: ["@sqlite.org/sqlite-wasm"],
  },
  resolve: {
    alias: [
      {
        find: "@palladium/worker/owner",
        replacement: fileURLToPath(new URL("../worker/src/db-owner.ts", import.meta.url)),
      },
      {
        find: "@palladium/worker",
        replacement: fileURLToPath(new URL("../worker/src/index.ts", import.meta.url)),
      },
      {
        find: "@palladium/sqlite-browser",
        replacement: fileURLToPath(new URL("../sqlite-browser/src/index.ts", import.meta.url)),
      },
    ],
  },
  server: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
    proxy: {
      "/v1": {
        target: PALLADIUM_API,
        changeOrigin: true,
      },
    },
  },
  preview: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
});
