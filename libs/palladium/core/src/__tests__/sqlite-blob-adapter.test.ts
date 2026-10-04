import { createRequire } from "node:module";
import type { DatabaseSync as DatabaseSyncConstructor, SQLInputValue } from "node:sqlite";
import { NodeSqliteAdapter } from "@palladium/sqlite-node";
import { describe, expect, it } from "vitest";
import { SqliteBlobAdapter } from "../sqlite-blob-adapter.js";
import type { StorageAdapter } from "../storage.js";

const _require = createRequire(import.meta.url);
const { DatabaseSync } = _require("node:sqlite") as {
  DatabaseSync: typeof DatabaseSyncConstructor;
};

class TestSqliteStorage implements StorageAdapter {
  readonly #db = new DatabaseSync(":memory:");

  constructor(
    private readonly nativeByteArrays = false,
    private readonly blobResultOverride?: unknown,
  ) {}

  async open(): Promise<void> {}

  async exec<T = Record<string, unknown>>(
    sql: string,
    params: readonly unknown[] = [],
  ): Promise<T[]> {
    if (sql.startsWith("SELECT") && this.blobResultOverride !== undefined) {
      return [{ data: this.blobResultOverride }] as T[];
    }
    const rows = this.#db.prepare(sql).all(...(params as SQLInputValue[]));
    if (!this.nativeByteArrays) return rows as T[];
    return rows.map((row) => {
      if ("data" in row && row.data instanceof Uint8Array) {
        return { ...row, data: Array.from(row.data) };
      }
      return row;
    }) as T[];
  }
  async put(): Promise<void> {
    throw new Error("Not used by this test adapter");
  }

  async patch(): Promise<void> {
    throw new Error("Not used by this test adapter");
  }

  async remove(): Promise<void> {
    throw new Error("Not used by this test adapter");
  }

  async runMigrations(migrations: readonly string[]): Promise<void> {
    for (const migration of migrations) this.#db.exec(migration);
  }

  async close(): Promise<void> {
    this.#db.close();
  }

  async transaction<T>(fn: (tx: StorageAdapter) => Promise<T>): Promise<T> {
    this.#db.exec("BEGIN");
    try {
      const result = await fn(this);
      this.#db.exec("COMMIT");
      return result;
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }
}

describe("SqliteBlobAdapter", () => {
  it("recreates a namespaced table after first-use creation rolls back", async () => {
    const storage = new TestSqliteStorage();
    const media = new SqliteBlobAdapter(storage, { table: "media", namespace: "app" });
    try {
      await expect(
        storage.transaction(async (tx) => {
          await media.put("rolled-back", new Uint8Array([255]), { transaction: tx });
          throw new Error("rollback");
        }),
      ).rejects.toThrow("rollback");
      expect(await media.get("rolled-back")).toBeNull();
      await media.put("retry", new Uint8Array([0, 128, 255]));
      expect(await media.get("retry")).toEqual(new Uint8Array([0, 128, 255]));
    } finally {
      await storage.close();
    }
  });

  it("round-trips BLOB bytes and isolates storage namespaces", async () => {
    const storage = new TestSqliteStorage();
    await storage.runMigrations([
      "CREATE TABLE media (namespace TEXT NOT NULL, id TEXT NOT NULL, data BLOB NOT NULL, PRIMARY KEY(namespace, id))",
    ]);
    const appA = new SqliteBlobAdapter(storage, { table: "media", namespace: "app-a" });
    const appB = new SqliteBlobAdapter(storage, { table: "media", namespace: "app-b" });
    const bytes = new Uint8Array([0, 255, 1]);
    await appA.put("image", bytes);

    expect(await appA.get("image")).toEqual(bytes);
    expect(await appA.has("image")).toBe(true);
    expect(await appB.has("image")).toBe(false);
    await appB.put("image", new Uint8Array([2]));
    await appA.clear();
    expect(await appA.get("image")).toBeNull();
    expect(await appB.get("image")).toEqual(new Uint8Array([2]));
    await appB.delete("image");
    expect(await appB.has("image")).toBe(false);
    await appB.dispose();
    await expect(appB.get("image")).rejects.toThrow("disposed");
    await storage.close();
  });
  it("normalizes native SQLite byte-array results without corrupting high-bit bytes", async () => {
    const storage = new TestSqliteStorage(true);
    await storage.runMigrations([
      "CREATE TABLE media (namespace TEXT NOT NULL, id TEXT NOT NULL, data BLOB NOT NULL, PRIMARY KEY(namespace, id))",
    ]);
    const blobs = new SqliteBlobAdapter(storage, { table: "media", namespace: "native" });
    const expected = new Uint8Array([0, 127, 128, 255, 1]);
    await blobs.put("photo", expected);
    expect(await blobs.get("photo")).toEqual(expected);
    await storage.close();
  });

  it.each([{ data: [0, 256] }, { data: [-1] }, { data: [1.5] }])(
    "rejects malformed native BLOB byte arrays $data",
    async ({ data }) => {
      const storage = new TestSqliteStorage(false, data);
      const blobs = new SqliteBlobAdapter(storage, {
        table: "media",
        columns: { id: "id", data: "bytes" },
      });
      await expect(blobs.get("photo")).rejects.toBeInstanceOf(TypeError);
      await storage.close();
    },
  );

  it("returns an existing Uint8Array result without copying", async () => {
    const bytes = new Uint8Array([0, 128, 255]);
    const storage = new TestSqliteStorage(false, bytes);
    const blobs = new SqliteBlobAdapter(storage, {
      table: "media",
      columns: { id: "id", data: "bytes" },
    });
    expect(await blobs.get("photo")).toBe(bytes);
    await storage.close();
  });

  it("couples blob writes to domain transaction rollback and FK cascade", async () => {
    const storage = new TestSqliteStorage();
    await storage.runMigrations([
      "PRAGMA foreign_keys = ON",
      "CREATE TABLE documents (id TEXT PRIMARY KEY, title TEXT NOT NULL)",
      "CREATE TABLE media (namespace TEXT NOT NULL, id TEXT NOT NULL UNIQUE REFERENCES documents(id) ON DELETE CASCADE, data BLOB NOT NULL, PRIMARY KEY(namespace, id))",
      "INSERT INTO documents VALUES ('doc', 'before')",
    ]);
    const blobs = new SqliteBlobAdapter(storage, { table: "media", namespace: "app" });
    await blobs.put("doc", new Uint8Array([1, 2]));

    await expect(
      storage.transaction(async (tx) => {
        await tx.exec("UPDATE documents SET title = 'after' WHERE id = 'doc'");
        await blobs.put("doc", new Uint8Array([9]), { transaction: tx });
        throw new Error("abort domain mutation");
      }),
    ).rejects.toThrow("abort domain mutation");
    expect(await blobs.get("doc")).toEqual(new Uint8Array([1, 2]));
    expect(await blobs.get("changed")).toBeNull();

    await storage.exec("DELETE FROM documents WHERE id = 'doc'");
    expect(await blobs.has("doc")).toBe(false);
    await storage.close();
  });
  it("preserves an existing metadata table, byte binding, rollback, and cascades", async () => {
    const storage = new NodeSqliteAdapter();
    await storage.open();
    try {
      await storage.runMigrations([
        "PRAGMA foreign_keys = ON",
        "CREATE TABLE documents (id TEXT PRIMARY KEY)",
        "CREATE TABLE receipts (id TEXT PRIMARY KEY, document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE, image_data BLOB NOT NULL)",
        "INSERT INTO documents VALUES ('doc')",
        "INSERT INTO receipts VALUES ('receipt', 'doc', X'00FF01')",
      ]);
      const media = new SqliteBlobAdapter(storage, {
        table: "receipts",
        columns: { id: "id", data: "image_data" },
      });
      expect(await media.get("receipt")).toEqual(new Uint8Array([0, 255, 1]));
      await expect(media.put("missing", new Uint8Array([7]))).rejects.toThrow("metadata");
      await expect(
        storage.transaction(async (tx) => {
          await media.put("receipt", new Uint8Array([8, 9]), { transaction: tx });
          throw new Error("abort");
        }),
      ).rejects.toThrow("abort");
      expect(await media.get("receipt")).toEqual(new Uint8Array([0, 255, 1]));
      await media.put("receipt", new Uint8Array([4, 5]));
      expect(await media.get("receipt")).toEqual(new Uint8Array([4, 5]));
      await storage.exec("DELETE FROM documents WHERE id = 'doc'");
      expect(await media.get("receipt")).toBeNull();
      await media.dispose();
    } finally {
      await storage.close();
    }
  });
});
