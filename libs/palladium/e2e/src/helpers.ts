/** Test-data builders for E2E specs. */

import { randomUUID } from "node:crypto";
import type { Hlc } from "@palladium/core";
import type { ServerChange, ServerOp } from "./client.js";

/** Create a minimal valid [`Hlc`]. */
export function makeHlc(overrides: Partial<Hlc> = {}): Hlc {
  return {
    wallMs: Date.now(),
    counter: 0,
    nodeId: randomUUID(),
    ...overrides,
  };
}

/** Create a minimal insert `Op`. */
export function insertOp(
  table: string,
  rowId: string,
  data: Record<string, unknown> = {},
): ServerOp {
  return { op: "insert", table, row_id: rowId, data };
}

/** Create a minimal valid `ServerChange`. */
export function makeChange(overrides: Partial<ServerChange> = {}): ServerChange {
  return {
    id: randomUUID(),
    hlc: makeHlc(),
    ops: [insertOp("items", randomUUID())],
    ...overrides,
  };
}
