/**
 * Browser stub for node:module.
 *
 * SqliteAdapter imports createRequire at module load time. This stub makes
 * the class definition load safely in a browser — DatabaseSync will be
 * undefined, but SqliteAdapter is never instantiated here (MemoryAdapter is
 * used instead).
 */
export function createRequire(_url: string | URL): (_id: string) => Record<string, unknown> {
  return (_id) => ({});
}
