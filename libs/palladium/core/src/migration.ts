/**
 * Versioned migration and seeding framework.
 *
 * Uses `PRAGMA user_version` for schema version tracking and
 * a `_palladium_seeds` table for idempotent seed management.
 *
 * ## Usage
 *
 * ```ts
 * const schema: SchemaConfig = {
 *   schema: "CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, name TEXT);",
 *   version: 3,
 *   migrations: {
 *     2: ["ALTER TABLE tasks ADD COLUMN done INTEGER NOT NULL DEFAULT 0"],
 *     3: [async (exec) => {
 *       const rows = await exec<{ id: string }>("SELECT id FROM tasks WHERE done IS NULL");
 *       for (const r of rows) await exec("UPDATE tasks SET done = 0 WHERE id = ?", [r.id]);
 *     }],
 *   },
 *   seeds: [
 *     { key: "default-task", apply: (exec) => exec("INSERT INTO tasks ...") },
 *   ],
 * };
 *
 * await applySchema(adapter, schema);
 * ```
 */

import { isTransactable, type StorageAdapter } from "./storage.js";

/** Function signature for executing SQL during migrations and seeds. */
export type MigrationExec = <T = Record<string, unknown>>(
  sql: string,
  params?: readonly unknown[],
) => Promise<T[]>;

/** A single migration step: raw SQL string or async callback for complex logic. */
export type MigrationStep = string | ((exec: MigrationExec) => Promise<void>);

/** A named data initializer applied at most once after it completes successfully. */
export interface Seed {
  readonly key: string;
  /**
   * Apply the seed. This runs atomically with its tracking record when the
   * adapter supports transactions; otherwise it must be safe to retry.
   */
  readonly apply: (exec: MigrationExec) => Promise<void>;
}

/**
 * Schema configuration for versioned migrations and seeding.
 *
 * - `schema`: baseline DDL executed on every startup (use `CREATE TABLE IF NOT EXISTS`).
 * - `version`: current target schema version; fresh installs are stamped with this.
 * - `migrations`: versioned steps keyed by target version number.
 * - `seeds`: named initializers tracked in `_palladium_seeds`.
 */
export interface SchemaConfig {
  /** Baseline DDL — executed on every startup. Use `CREATE TABLE/INDEX IF NOT EXISTS`. */
  readonly schema: string;
  /** Current schema version. Fresh installs stamp this via `PRAGMA user_version`. */
  readonly version: number;
  /** Versioned migration steps keyed by target version number. */
  readonly migrations?: Readonly<Record<number, readonly MigrationStep[]>>;
  /** Named seeds applied at most once and tracked in `_palladium_seeds`. */
  readonly seeds?: readonly Seed[];
}

/** Execute migration steps for a single version. */
async function runSteps(
  adapter: StorageAdapter,
  exec: MigrationExec,
  steps: readonly MigrationStep[],
): Promise<void> {
  for (const step of steps) {
    if (typeof step === "string") {
      // String steps use runMigrations for multi-statement support.
      await adapter.runMigrations([step]);
    } else {
      await step(exec);
    }
  }
}

/** Run pending versioned migrations in ascending order without stamping a version. */
async function runPendingMigrations(
  adapter: StorageAdapter,
  exec: MigrationExec,
  migrations: Readonly<Record<number, readonly MigrationStep[]>>,
  currentVersion: number,
  targetVersion: number,
): Promise<void> {
  const versions = Object.keys(migrations)
    .map(Number)
    .filter((v) => v > currentVersion && v <= targetVersion)
    .sort((a, b) => a - b);

  for (const version of versions) {
    const steps = migrations[version];
    if (steps) {
      await runSteps(adapter, exec, steps);
    }
  }
}

/**
 * Apply versioned schema migrations and seeds to a database.
 *
 * On a fresh database (`user_version = 0`), the baseline DDL runs and the
 * version is stamped to `config.version` without applying migrations.
 * Existing databases are upgraded transactionally: pending migrations run
 * before the current baseline, and `user_version` advances only after both
 * succeed. Seeds are evaluated after the schema transaction commits.
 *
 * `beforeCommit`, when supplied, runs after the schema/version writes on the
 * same adapter inside the schema transaction where transactions are supported.
 * Existing upgrades still require transaction support; fresh nontransactional
 * installs retain their retry-safe baseline behavior.
 */
export async function applySchema(
  adapter: StorageAdapter,
  config: SchemaConfig,
  beforeCommit?: (transaction: StorageAdapter) => Promise<void>,
): Promise<void> {
  const rows = await adapter.exec<{ user_version: number }>("PRAGMA user_version");
  const currentVersion = rows[0]?.user_version ?? 0;
  if (currentVersion > config.version) {
    throw new Error(
      `applySchema: cannot downgrade from version ${currentVersion} to ${config.version}`,
    );
  }

  const apply = async (target: StorageAdapter, fresh: boolean): Promise<void> => {
    if (fresh) {
      await target.runMigrations([config.schema]);
      await target.exec(`PRAGMA user_version = ${config.version}`);
    } else if (currentVersion < config.version) {
      const exec: MigrationExec = <T = Record<string, unknown>>(
        sql: string,
        params?: readonly unknown[],
      ): Promise<T[]> => target.exec<T>(sql, params);
      if (config.migrations) {
        await runPendingMigrations(target, exec, config.migrations, currentVersion, config.version);
      }
      await target.runMigrations([config.schema]);
      await target.exec(`PRAGMA user_version = ${config.version}`);
    } else {
      await target.runMigrations([config.schema]);
    }
    await beforeCommit?.(target);
  };

  if (currentVersion === 0) {
    if (isTransactable(adapter)) {
      await adapter.transaction((tx) => apply(tx, true));
    } else {
      await apply(adapter, true);
    }
  } else if (currentVersion < config.version) {
    if (!isTransactable(adapter)) {
      throw new Error(
        `applySchema: upgrading from version ${currentVersion} to ${config.version} requires transaction support`,
      );
    }
    await adapter.transaction((tx) => apply(tx, false));
  } else if (isTransactable(adapter)) {
    await adapter.transaction((tx) => apply(tx, false));
  } else {
    await apply(adapter, false);
  }

  if (config.seeds && config.seeds.length > 0) {
    await applySeeds(adapter, config.seeds);
  }
}

async function applySeed(adapter: StorageAdapter, seed: Seed): Promise<void> {
  const existing = await adapter.exec<{ key: string }>(
    "SELECT key FROM _palladium_seeds WHERE key = ?",
    [seed.key],
  );
  if (existing.length > 0) return;

  const exec: MigrationExec = <T = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<T[]> => adapter.exec<T>(sql, params);
  await seed.apply(exec);
  await adapter.exec("INSERT INTO _palladium_seeds (key, applied_at) VALUES (?, ?)", [
    seed.key,
    new Date().toISOString(),
  ]);
}

/**
 * Apply named seeds, tracking each by key in `_palladium_seeds`.
 * On transaction-capable adapters, each seed and its tracking record commit
 * atomically. Seeds used with other adapters must be safe to retry.
 */
export async function applySeeds(adapter: StorageAdapter, seeds: readonly Seed[]): Promise<void> {
  await adapter.exec(
    "CREATE TABLE IF NOT EXISTS _palladium_seeds (key TEXT PRIMARY KEY, applied_at TEXT NOT NULL)",
  );

  for (const seed of seeds) {
    if (isTransactable(adapter)) {
      await adapter.transaction((tx) => applySeed(tx, seed));
    } else {
      await applySeed(adapter, seed);
    }
  }
}
