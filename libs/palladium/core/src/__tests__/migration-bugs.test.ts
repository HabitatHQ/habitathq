/**
 * Migration framework tests — fresh-install callbacks, multi-step
 * atomicity, downgrades.
 *
 * Architecture review §6 'Fix the migration bugs (fresh-install
 * skips callbacks, multi-step is non-atomic, downgrade silently
 * no-ops)'.
 *
 * After the fix:
 *   - Fresh installs run the migrations keyed at the *current*
 *     target version (callbacks are executed for every version
 *     that has steps, even when currentVersion === 0).
 *   - Multi-step migrations run inside a single storage transaction
 *     (when the adapter supports it); a failure in step N rolls
 *     back steps 0..N-1.
 *   - A target version lower than currentVersion is a downgrade:
 *     surface an error rather than silently no-op.
 */

import { NodeSqliteAdapter } from "@palladium/sqlite-node";
import { describe, expect, it } from "vitest";
import { applySchema } from "../migration.js";

const BASE = "CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, body TEXT NOT NULL)";

describe("applySchema — fresh-install runs all migration callbacks", () => {
  it("callbacks keyed at the current target version are executed", async () => {
    const adapter = new NodeSqliteAdapter({ vfs: { type: "memory" } });
    await adapter.open();

    const seen: number[] = [];
    await applySchema(adapter, {
      version: 3,
      schema: BASE,
      migrations: {
        2: [
          async (exec) => {
            await exec("INSERT INTO notes (id, body) VALUES ('m2', 'two')");
            seen.push(2);
          },
        ],
        3: [
          async (exec) => {
            await exec("INSERT INTO notes (id, body) VALUES ('m3', 'three')");
            seen.push(3);
          },
        ],
      },
    });

    expect(seen.sort()).toEqual([2, 3]);

    const rows = await adapter.exec<{ id: string }>("SELECT id FROM notes ORDER BY id");
    expect(rows.map((r) => r.id)).toEqual(["m2", "m3"]);
  });
});

describe("applySchema — multi-step atomicity", () => {
  it("two steps in the same version run in a single transaction (one fails → both roll back)", async () => {
    // Subclass to inject a failing put (first step's exec inside the
    // transaction). The migration's first step inserts via exec; the
    // second step throws. The whole version must roll back.
    class FailingAdapter extends NodeSqliteAdapter {
      // Force the second step's exec to throw.
      override async exec<T = Record<string, unknown>>(
        sql: string,
        params: readonly unknown[] = [],
      ): Promise<T[]> {
        if (sql === "ROLLBACK_ME") throw new Error("step 2 boom");
        return super.exec<T>(sql, params);
      }
    }
    const adapter = new FailingAdapter({ vfs: { type: "memory" } });
    await adapter.open();

    await expect(
      applySchema(adapter, {
        version: 2,
        schema: BASE,
        migrations: {
          2: [
            async (exec) => {
              await exec("INSERT INTO notes (id, body) VALUES ('ok', 'yes')");
            },
            async () => {
              // The migration's exec re-routes to the subclass's exec,
              // which throws on the sentinel string.
              const a = (await import("../migration.js")).applySchema;
              void a;
              // Use a sentinel that goes through the overridden exec.
              const exec: (s: string) => Promise<unknown> = (s) =>
                adapter.exec(s).then(() => undefined);
              await exec("ROLLBACK_ME");
            },
          ],
        },
      }),
    ).rejects.toThrow("step 2 boom");

    // The first step's insert must NOT be in the table.
    const rows = await adapter.exec<{ id: string }>("SELECT id FROM notes");
    expect(rows).toHaveLength(0);
  });
});

describe("applySchema — downgrade is an explicit error", () => {
  it("a target version below currentVersion throws (with migrations configured)", async () => {
    const adapter = new NodeSqliteAdapter({ vfs: { type: "memory" } });
    await adapter.open();
    await applySchema(adapter, {
      version: 5,
      schema: BASE,
      migrations: {
        3: [],
        4: [],
        5: [],
      },
    });

    await expect(
      applySchema(adapter, {
        version: 3,
        schema: BASE,
        migrations: {
          3: [],
          4: [],
          5: [],
        },
      }),
    ).rejects.toThrow(/downgrade/i);
  });
});
