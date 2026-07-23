import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

/**
 * OPFS SAHPool + SharedArrayBuffer require cross-origin isolation, i.e. the
 * COOP/COEP response headers below. `@palladium/vite-plugin` sets the same
 * pair; inlined here to keep the example's dep graph minimal.
 */
export default defineConfig({
  optimizeDeps: {
    // sqlite-wasm manages its own WASM loading; never pre-bundle it.
    exclude: ["@sqlite.org/sqlite-wasm"],
  },
  resolve: {
    // Order matters: the more specific `/owner` subpath must precede the bare
    // package alias, or Vite's prefix match rewrites it to `…/index.ts/owner`.
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
  },
  preview: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
});
