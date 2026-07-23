/**
 * The dedicated worker every tab spawns. One line of glue: describe the service
 * and let the bus handle leadership, RPC, and invalidation.
 */

import type { DbApi } from "@palladium/worker";
import { startDbOwner } from "@palladium/worker/owner";
import { createNotesService, DB_NAME } from "./backend.js";

startDbOwner<DbApi>({
  dbName: DB_NAME,
  methods: ["query", "mutate"],
  create: createNotesService,
});
