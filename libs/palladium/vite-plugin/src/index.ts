/**
 * @palladium/vite-plugin
 *
 * Sets the COOP/COEP headers required for SharedArrayBuffer (used by SQLite WASM)
 * on every dev-server response.
 *
 * ```ts
 * // vite.config.ts
 * import { palladium } from '@palladium/vite-plugin';
 * export default { plugins: [palladium()] };
 * ```
 */

import type { Plugin } from "vite";

export function palladium(): Plugin {
  return {
    name: "palladium",
    configureServer(server) {
      server.middlewares.use((_req, res, next) => {
        res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
        res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
        next();
      });
    },
  };
}
