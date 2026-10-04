import type { StorageAdapter } from "./storage.js";

/** Minimal transaction-scoped SQL surface required for a logical reset. */
export interface LogicalResetExecutor {
  exec(sql: string, bind?: unknown[]): Promise<unknown>;
  deferForeignKeys?: () => Promise<void>;
}

/** App database adapters need only provide atomic execution and SQL commands. */
export interface LogicalResetAdapter {
  transaction<T>(fn: (tx: LogicalResetExecutor) => Promise<T>): Promise<T>;
}

const SQL_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const RESERVED_TABLE_PREFIXES = ["sqlite_", "_palladium_", "_sync_"] as const;

/** Tables an application owns and the owned tables it intentionally preserves. */
export interface LogicalResetPolicy {
  /**
   * Application-owned tables to consider, in deletion order. Palladium and
   * SQLite metadata tables are never valid owned tables.
   */
  readonly ownedTables: readonly string[];
  /** Application-owned tables to leave unchanged. Every entry must also occur in ownedTables. */
  readonly preserveTables?: readonly string[];
}

/** Result of a successful logical reset. */
export interface LogicalResetResult {
  readonly deletedTables: readonly string[];
  readonly preservedTables: readonly string[];
}

/**
 * Optional storage capability for a safe, app-scoped physical reset.
 *
 * Implementations must close their current resources, delete only their own
 * configured storage, and reopen before resolving. Backends that cannot
 * guarantee all three steps must not implement this interface.
 */
export interface PhysicalStorageResetAdapter extends StorageAdapter {
  resetStorage(): Promise<void>;
}

/** True when an adapter explicitly supports safe physical reset. */
export function supportsPhysicalStorageReset(
  adapter: StorageAdapter,
): adapter is PhysicalStorageResetAdapter {
  return (
    "resetStorage" in adapter &&
    typeof (adapter as PhysicalStorageResetAdapter).resetStorage === "function"
  );
}

/**
 * Delete only explicitly owned application tables in one transaction.
 *
 * Any failure escapes the transaction callback so the adapter rolls the whole
 * reset back. Foreign keys are deferred to commit when the transaction-scoped
 * adapter advertises that capability; otherwise tables are deleted in the
 * caller-provided order under the backend's normal FK enforcement.
 */
export async function resetOwnedTables(
  adapter: LogicalResetAdapter,
  policy: LogicalResetPolicy,
): Promise<LogicalResetResult> {
  const ownedTables = validateUniqueTableNames(policy.ownedTables, "ownedTables");
  if (ownedTables.length === 0) {
    throw new TypeError("Logical reset requires at least one explicitly owned table");
  }

  const preserveTables = validateUniqueTableNames(policy.preserveTables ?? [], "preserveTables");
  const owned = new Set(ownedTables);
  for (const table of preserveTables) {
    if (!owned.has(table)) {
      throw new TypeError(`Preserved table ${JSON.stringify(table)} is not an owned table`);
    }
  }

  const preserved = new Set(preserveTables);
  const deletedTables = ownedTables.filter((table) => !preserved.has(table));

  await adapter.transaction(async (tx) => {
    if (typeof tx.deferForeignKeys === "function") {
      await tx.deferForeignKeys();
    }
    for (const table of deletedTables) {
      await tx.exec(`DELETE FROM "${table}"`);
    }
  });

  return { deletedTables, preservedTables: preserveTables };
}

function validateUniqueTableNames(names: readonly string[], field: string): string[] {
  const validated: string[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    assertOwnedTableName(name);
    if (seen.has(name)) {
      throw new TypeError(`${field} contains duplicate table ${JSON.stringify(name)}`);
    }
    seen.add(name);
    validated.push(name);
  }
  return validated;
}

function assertOwnedTableName(name: string): void {
  if (!SQL_IDENTIFIER.test(name)) {
    throw new TypeError(
      `Invalid owned table identifier ${JSON.stringify(name)}; expected [A-Za-z_][A-Za-z0-9_]*`,
    );
  }
  const normalized = name.toLowerCase();
  if (RESERVED_TABLE_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    throw new TypeError(`Reserved metadata table cannot be reset: ${JSON.stringify(name)}`);
  }
}
