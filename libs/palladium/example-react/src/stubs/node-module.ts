/**
 * Stub for node:module — not available in browsers.
 *
 * SqliteAdapter uses `createRequire` to load node:sqlite at runtime, which is
 * also unavailable in browser contexts.  Aliasing node:module to this stub in
 * vite.config.ts prevents bundler errors while keeping SqliteAdapter in the
 * import graph.  We use MemoryAdapter in this app, so createRequire is never
 * actually invoked.
 */
export const createRequire =
  (_url: string | URL): ((_id: string) => never) =>
  (_id: string) => {
    throw new Error("node:sqlite is not available in the browser");
  };
