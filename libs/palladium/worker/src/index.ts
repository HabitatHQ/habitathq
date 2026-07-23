/**
 * @palladium/worker — multi-tab OPFS ownership bus.
 *
 * - Main-thread entry: {@link connect} (generic) / {@link createClient}
 *   (query/mutate convenience) — import from the package root.
 * - Worker entry: `startDbOwner` (import from `@palladium/worker/owner`), kept
 *   on a separate subpath so the worker bundle stays lean.
 */

export type { PalladiumClient, WorkerConnection } from "./client.js";
export { connect, createClient } from "./client.js";
export type {
  BusFacade,
  DbOwnerConfig,
  OwnerContext,
  Role,
  ServiceMethods,
  WorkerFacade,
} from "./db-owner.js";
export type { DbApi } from "./protocol.js";
