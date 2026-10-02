/**
 * PalladiumDialect — plugs the Palladium StorageAdapter into Kysely.
 *
 * ```ts
 * import { Kysely } from 'kysely';
 * import { PalladiumDialect } from '@palladium/kysely';
 *
 * const db = new Kysely<DB>({ dialect: new PalladiumDialect(engine) });
 * const tasks = await db.selectFrom('tasks').selectAll().execute();
 * ```
 *
 * The dialect translates Kysely's `CompiledQuery` (which uses `?` placeholders
 * and an ordered params list) into the StorageAdapter's `exec()` call.
 */

import { isTransactable, type PalladiumEngine, type StorageAdapter } from "@palladium/core";
import type {
  CompiledQuery,
  DatabaseConnection,
  DatabaseIntrospector,
  Dialect,
  DialectAdapter,
  Driver,
  Kysely,
  QueryCompiler,
  QueryResult,
} from "kysely";
import { SqliteAdapter, SqliteIntrospector, SqliteQueryCompiler } from "kysely";

export class PalladiumDialect implements Dialect {
  // biome-ignore lint/suspicious/noExplicitAny: engine is schema-generic
  readonly #engine: PalladiumEngine<any>;

  // biome-ignore lint/suspicious/noExplicitAny: engine is schema-generic
  constructor(engine: PalladiumEngine<any>) {
    this.#engine = engine;
  }

  createAdapter(): DialectAdapter {
    return new SqliteAdapter();
  }

  createDriver(): Driver {
    return new PalladiumDriver(this.#engine);
  }

  // biome-ignore lint/suspicious/noExplicitAny: Kysely generic usage
  createIntrospector(db: Kysely<any>): DatabaseIntrospector {
    return new SqliteIntrospector(db);
  }

  createQueryCompiler(): QueryCompiler {
    return new SqliteQueryCompiler();
  }
}

class PalladiumDriver implements Driver {
  // biome-ignore lint/suspicious/noExplicitAny: engine is schema-generic
  readonly #engine: PalladiumEngine<any>;

  // biome-ignore lint/suspicious/noExplicitAny: engine is schema-generic
  constructor(engine: PalladiumEngine<any>) {
    this.#engine = engine;
  }

  async init(): Promise<void> {}

  async acquireConnection(): Promise<DatabaseConnection> {
    return new PalladiumConnection(this.#engine);
  }

  async beginTransaction(conn: DatabaseConnection): Promise<void> {
    await getPalladiumConnection(conn).beginTransaction();
  }
  async commitTransaction(conn: DatabaseConnection): Promise<void> {
    await getPalladiumConnection(conn).commitTransaction();
  }
  async rollbackTransaction(conn: DatabaseConnection): Promise<void> {
    await getPalladiumConnection(conn).rollbackTransaction();
  }

  async releaseConnection(_conn: DatabaseConnection): Promise<void> {}
  async destroy(): Promise<void> {}
}

type ActiveTransaction = {
  adapter: StorageAdapter | null;
  finish: Deferred<boolean>;
  operation: Promise<void>;
};

class PalladiumConnection implements DatabaseConnection {
  // biome-ignore lint/suspicious/noExplicitAny: engine is schema-generic
  readonly #engine: PalladiumEngine<any>;
  #transaction: ActiveTransaction | null = null;

  // biome-ignore lint/suspicious/noExplicitAny: engine is schema-generic
  constructor(engine: PalladiumEngine<any>) {
    this.#engine = engine;
  }

  async beginTransaction(): Promise<void> {
    if (this.#transaction !== null) throw new Error("Kysely transaction already active");
    const ready = deferred<void>();
    const finish = deferred<boolean>();
    const transaction: ActiveTransaction = {
      adapter: null,
      finish,
      operation: Promise.resolve(),
    };
    this.#transaction = transaction;
    transaction.operation = this.#engine.withStorage(async (adapter) => {
      if (!isTransactable(adapter))
        throw new Error("PalladiumDialect requires transaction support");
      try {
        await adapter.transaction(async (tx) => {
          transaction.adapter = tx;
          ready.resolve(undefined);
          if (!(await finish.promise)) throw rollbackTransaction;
        });
      } catch (error) {
        if (error !== rollbackTransaction) throw error;
      }
    });
    transaction.operation.catch((error: unknown) => ready.reject(error));
    try {
      await ready.promise;
    } catch (error) {
      this.#transaction = null;
      throw error;
    }
  }

  async commitTransaction(): Promise<void> {
    const transaction = this.#transaction;
    if (transaction === null) throw new Error("No Kysely transaction is active");
    transaction.finish.resolve(true);
    try {
      await transaction.operation;
    } finally {
      this.#transaction = null;
    }
  }

  async rollbackTransaction(): Promise<void> {
    const transaction = this.#transaction;
    if (transaction === null) return;
    transaction.finish.resolve(false);
    try {
      await transaction.operation;
    } finally {
      this.#transaction = null;
    }
  }

  async executeQuery<R>(compiled: CompiledQuery): Promise<QueryResult<R>> {
    const run = async (adapter: StorageAdapter): Promise<QueryResult<R>> => ({
      rows: await adapter.exec<R>(compiled.sql, compiled.parameters as readonly unknown[]),
    });
    const transactionAdapter = this.#transaction?.adapter;
    return transactionAdapter === null || transactionAdapter === undefined
      ? this.#engine.withStorage(run)
      : run(transactionAdapter);
  }

  // biome-ignore lint/correctness/useYield: streaming not supported
  async *streamQuery<R>(
    _compiled: CompiledQuery,
    _chunkSize: number,
  ): AsyncIterableIterator<QueryResult<R>> {
    throw new Error("PalladiumDialect does not support streaming queries.");
  }
}

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>["resolve"];
  let reject!: Deferred<T>["reject"];
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const rollbackTransaction = Symbol("rollback Kysely transaction");

function getPalladiumConnection(conn: DatabaseConnection): PalladiumConnection {
  if (!(conn instanceof PalladiumConnection)) throw new TypeError("Invalid Palladium connection");
  return conn;
}
