/**
 * @palladium/worker — multi-tab OPFS ownership bus (spike).
 *
 * - Main-thread entry: {@link createClient} (import from the package root).
 * - Worker entry: `startDbOwner` (import from `@palladium/worker/owner`), kept
 *   on a separate subpath so the worker bundle stays lean.
 */

export type { PalladiumClient } from "./client.js";
export { createClient } from "./client.js";
export type { OpfsBackend } from "./db-owner.js";
export type { DbApi } from "./protocol.js";
