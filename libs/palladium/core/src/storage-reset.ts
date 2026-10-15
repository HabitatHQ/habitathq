import type { StorageAdapter } from "./storage.js";

/** Transaction-scoped SQLite SQL surface required for a logical reset. */
export interface LogicalResetExecutor {
  /** Execute SQL and return result rows; reset requires SQLite catalog introspection. */
  exec(sql: string, bind?: unknown[]): Promise<unknown>;
  deferForeignKeys?: () => Promise<void>;
}

/** App SQLite adapters must provide atomic execution and return query result rows. */
export interface LogicalResetAdapter {
  transaction<T>(fn: (tx: LogicalResetExecutor) => Promise<T>): Promise<T>;
}

const SQL_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const RESERVED_TABLE_PREFIXES = ["sqlite_", "_palladium_", "_sync_"] as const;

interface SqliteTableRow {
  readonly name: string;
  readonly schema: "main" | "temp";
}

interface SqliteTriggerRow {
  readonly tbl_name: string;
  readonly sql: string | null;
}

interface SqliteForeignKeyRow {
  readonly table: string;
}

function rowsOf<T>(value: unknown, fields: readonly (keyof T)[]): T[] {
  if (!Array.isArray(value)) {
    throw new TypeError("Logical reset executor must return rows for schema inspection");
  }
  for (const row of value) {
    if (typeof row !== "object" || row === null || fields.some((field) => !(field in row))) {
      throw new TypeError("Logical reset executor returned invalid schema metadata");
    }
  }
  return value as T[];
}

async function assertResetEffectsAreOwned(
  tx: LogicalResetExecutor,
  deletedTables: readonly string[],
): Promise<void> {
  if (deletedTables.length === 0) return;

  const tableRows = rowsOf<SqliteTableRow>(
    await tx.exec(
      "SELECT name, 'main' AS schema FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' UNION ALL SELECT name, 'temp' AS schema FROM sqlite_temp_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
    ),
    ["name", "schema"],
  );
  const triggerRows = rowsOf<SqliteTriggerRow>(
    await tx.exec(
      "SELECT tbl_name, sql FROM sqlite_schema WHERE type = 'trigger' UNION ALL SELECT tbl_name, sql FROM sqlite_temp_schema WHERE type = 'trigger'",
    ),
    ["tbl_name", "sql"],
  );

  const deleted = new Set(deletedTables.map(sqliteTableIdentity));
  for (const table of tableRows) {
    if (typeof table.name !== "string") {
      throw new TypeError("Logical reset executor returned invalid table metadata");
    }
    const foreignKeys = rowsOf<SqliteForeignKeyRow>(
      await tx.exec(
        `PRAGMA ${table.schema}.foreign_key_list("${table.name.replaceAll('"', '""')}")`,
      ),
      ["table"],
    );
    for (const foreignKey of foreignKeys) {
      if (typeof foreignKey.table !== "string") {
        throw new TypeError("Logical reset executor returned invalid foreign-key metadata");
      }
      if (
        deleted.has(sqliteTableIdentity(foreignKey.table)) &&
        !deleted.has(sqliteTableIdentity(table.name))
      ) {
        throw new Error(
          `Logical reset of ${JSON.stringify(foreignKey.table)} may mutate non-deleted table ${JSON.stringify(table.name)} through a foreign key`,
        );
      }
    }
  }

  for (const trigger of triggerRows) {
    if (typeof trigger.tbl_name !== "string" || typeof trigger.sql !== "string") {
      throw new TypeError("Logical reset executor returned invalid trigger metadata");
    }
    if (
      deleted.has(sqliteTableIdentity(trigger.tbl_name)) &&
      triggerHasDeleteEvent(trigger.sql) &&
      !isAbortOnlyTrigger(trigger.sql)
    ) {
      throw new Error(
        `Logical reset may mutate other tables through a trigger on ${JSON.stringify(trigger.tbl_name)}`,
      );
    }
  }
}

function triggerHasDeleteEvent(sql: string): boolean {
  const tokens = sqliteSqlTokens(sql);
  let index = tokens.indexOf("TRIGGER");
  if (index < 0) return true;
  index += 1;
  while (tokens[index] === "IF" || tokens[index] === "NOT" || tokens[index] === "EXISTS")
    index += 1;
  index += 1; // trigger name
  if (tokens[index] === ".") index += 2; // optional schema-qualified name
  if (tokens[index] === "BEFORE" || tokens[index] === "AFTER") index += 1;
  else if (tokens[index] === "INSTEAD") index += tokens[index + 1] === "OF" ? 2 : 1;
  const event = tokens[index];
  if (event === "DELETE") return true;
  if (event !== "INSERT" && event !== "UPDATE") return true;
  return false;
}

function sqliteSqlTokens(sql: string): string[] {
  const tokens: string[] = [];
  for (let index = 0; index < sql.length; ) {
    const char = sql[index] ?? "";
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (char === "-" && sql[index + 1] === "-") {
      index += 2;
      while (index < sql.length && sql[index] !== "\n") index += 1;
      continue;
    }
    if (char === "/" && sql[index + 1] === "*") {
      index += 2;
      while (index < sql.length && !(sql[index] === "*" && sql[index + 1] === "/")) index += 1;
      index = Math.min(index + 2, sql.length);
      continue;
    }
    if (char === "'" || char === '"' || char === "`" || char === "[") {
      const closer = char === "[" ? "]" : char;
      index += 1;
      while (index < sql.length) {
        if (sql[index] === closer) {
          if (sql[index + 1] === closer && char !== "[") {
            index += 2;
            continue;
          }
          if (char === "[" && sql[index + 1] === "]") {
            index += 2;
            continue;
          }
          index += 1;
          break;
        }
        index += 1;
      }
      tokens.push("QUOTED");
      continue;
    }
    const word = /^[A-Za-z_\u0080-\uFFFF][A-Za-z0-9_$\u0080-\uFFFF]*/.exec(sql.slice(index))?.[0];
    if (word !== undefined) {
      tokens.push(word.toUpperCase());
      index += word.length;
      continue;
    }
    tokens.push(char);
    index += 1;
  }
  return tokens;
}

function isAbortOnlyTrigger(sql: string): boolean {
  return /\bBEGIN\s+SELECT\s+RAISE\s*\(\s*ABORT\s*,\s*(?:'(?:(?:'')|[^'])*'|"(?:(?:"")|[^"])*")\s*\)\s*;\s*END\s*;?\s*$/i.test(
    sql,
  );
}

function sqliteTableIdentity(name: string): string {
  // SQLite folds only ASCII letters: e.g. `keys` and `Keys` are distinct tables.
  return name.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

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
 * reset back. SQLite catalog metadata is inspected first so foreign-key effects
 * and triggers cannot mutate non-deleted tables. Foreign keys are deferred to
 * commit when the transaction-scoped adapter advertises that capability.
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
  const ownedIdentities = new Set(ownedTables.map(sqliteTableIdentity));
  for (const table of preserveTables) {
    if (!ownedIdentities.has(sqliteTableIdentity(table))) {
      throw new TypeError(`Preserved table ${JSON.stringify(table)} is not an owned table`);
    }
  }

  const preservedIdentities = new Set(preserveTables.map(sqliteTableIdentity));
  const canonicalPreservedTables = ownedTables.filter((table) =>
    preservedIdentities.has(sqliteTableIdentity(table)),
  );
  const deletedTables = ownedTables.filter(
    (table) => !preservedIdentities.has(sqliteTableIdentity(table)),
  );

  await adapter.transaction(async (tx) => {
    await assertResetEffectsAreOwned(tx, deletedTables);
    if (typeof tx.deferForeignKeys === "function") {
      await tx.deferForeignKeys();
    }
    for (const table of deletedTables) {
      await tx.exec(`DELETE FROM "${table}"`);
    }
  });

  return { deletedTables, preservedTables: canonicalPreservedTables };
}

function validateUniqueTableNames(names: readonly string[], field: string): string[] {
  const validated: string[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    assertOwnedTableName(name);
    const identity = sqliteTableIdentity(name);
    if (seen.has(identity)) {
      throw new TypeError(`${field} contains duplicate table ${JSON.stringify(name)}`);
    }
    seen.add(identity);
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
  const normalized = sqliteTableIdentity(name);
  if (RESERVED_TABLE_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    throw new TypeError(`Reserved metadata table cannot be reset: ${JSON.stringify(name)}`);
  }
}
