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

/** A named, idempotent data initializer applied at most once. */
export interface Seed {
  readonly key: string;
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

/** Execute migration steps for a single version, atomically. */
async function runSteps(
  adapter: StorageAdapter,
  exec: MigrationExec,
  steps: readonly MigrationStep[],
): Promise<void> {
  if (isTransactable(adapter)) {
    // All steps in one transaction: a failure in step N rolls back
    // steps 0..N-1 and leaves the schema version at its previous value.
    await adapter.transaction(async (tx) => {
      for (const step of steps) {
        if (typeof step === "string") {
          await tx.runMigrations([step]);
        } else {
          await step(exec);
        }
      }
    });
  } else {
    for (const step of steps) {
      if (typeof step === "string") {
        await adapter.runMigrations([step]);
      } else {
        await step(exec);
      }
    }
  }
}

/** Apply pending versioned migrations from currentVersion to targetVersion. */
async function applyMigrations(
  adapter: StorageAdapter,
  exec: MigrationExec,
  migrations: Readonly<Record<number, readonly MigrationStep[]>>,
  currentVersion: number,
  targetVersion: number,
): Promise<void> {
  if (targetVersion < currentVersion) {
    throw new Error(
      `applySchema: target version ${targetVersion} is lower than current version ${currentVersion}. Downgrade is not supported.`,
    );
  }

  const versions = Object.keys(migrations)
    .map(Number)
    .filter((v) => v > currentVersion && v <= targetVersion)
    .sort((a, b) => a - b);

  let applied = currentVersion;
  for (const v of versions) {
    const steps = migrations[v];
    if (steps) {
      await runSteps(adapter, exec, steps);
    }
    await adapter.exec(`PRAGMA user_version = ${v}`);
    applied = v;
  }

  // Stamp target version if migrations didn't reach it (version gaps)
  if (applied < targetVersion) {
    await adapter.exec(`PRAGMA user_version = ${targetVersion}`);
  }
}

/**
 * Apply versioned schema migrations and seeds to a database.
 *
 * On a fresh database (`user_version = 0`), the baseline DDL runs and the
 * version is stamped to `config.version` without applying migrations.
 * On an existing database, only migrations with version > current are applied
 * in ascending order. Seeds are always evaluated regardless of version.
 */
export async function applySchema(adapter: StorageAdapter, config: SchemaConfig): Promise<void> {
  const exec: MigrationExec = <T = Record<string, unknown>>(
    s: string,
    params?: readonly unknown[],
  ): Promise<T[]> => adapter.exec<T>(s, params);

  // 1. Baseline DDL (idempotent). Uses runMigrations for multi-statement support.
  await adapter.runMigrations([config.schema]);

  // 2. Read current schema version
  const rows = await adapter.exec<{ user_version: number }>("PRAGMA user_version");
  const currentVersion = rows[0]?.user_version ?? 0;

  if (currentVersion === 0 && config.migrations) {
    // Fresh install — run the migration steps for the *current* target
    // version too. The baseline DDL may not be enough to express the
    // schema, and callbacks often seed data the app expects on first
    // boot. After the steps, stamp the version.
    await applyMigrations(adapter, exec, config.migrations, 0, config.version);
  } else if (config.migrations) {
    await applyMigrations(adapter, exec, config.migrations, currentVersion, config.version);
  } else if (currentVersion < config.version) {
    await adapter.exec(`PRAGMA user_version = ${config.version}`);
  }

  // 3. Apply seeds
  if (config.seeds && config.seeds.length > 0) {
    await applySeeds(adapter, config.seeds);
  }
}

/**
 * Apply named seeds, tracking each by key in `_palladium_seeds`.
 * Seeds are applied at most once regardless of how many times this is called.
 */
export async function applySeeds(adapter: StorageAdapter, seeds: readonly Seed[]): Promise<void> {
  await adapter.exec(
    "CREATE TABLE IF NOT EXISTS _palladium_seeds (key TEXT PRIMARY KEY, applied_at TEXT NOT NULL)",
  );

  const exec: MigrationExec = <T = Record<string, unknown>>(
    s: string,
    params?: readonly unknown[],
  ): Promise<T[]> => adapter.exec<T>(s, params);

  for (const seed of seeds) {
    const existing = await adapter.exec<{ key: string }>(
      "SELECT key FROM _palladium_seeds WHERE key = ?",
      [seed.key],
    );
    if (existing.length === 0) {
      await seed.apply(exec);
      await adapter.exec("INSERT INTO _palladium_seeds (key, applied_at) VALUES (?, ?)", [
        seed.key,
        new Date().toISOString(),
      ]);
    }
  }
}
