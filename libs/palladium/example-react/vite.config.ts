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
    alias: {
      "@palladium/sqlite-browser": fileURLToPath(
        new URL("../sqlite-browser/src/index.ts", import.meta.url),
      ),
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
