/**
 * The dedicated worker every tab spawns. One line of glue: hand the OPFS
 * backend to the bus and let it handle leadership, RPC, and invalidation.
 */

import { startDbOwner } from "@palladium/worker/owner";
import { createBackend, DB_NAME } from "./backend.js";

startDbOwner({ dbName: DB_NAME, backend: createBackend() });
