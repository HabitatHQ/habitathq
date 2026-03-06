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

import type { PalladiumEngine } from "@palladium/core";
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
import { MysqlAdapter, MysqlIntrospector, MysqlQueryCompiler } from "kysely";

export class PalladiumDialect implements Dialect {
  // biome-ignore lint/suspicious/noExplicitAny: engine is schema-generic
  readonly #engine: PalladiumEngine<any>;

  // biome-ignore lint/suspicious/noExplicitAny: engine is schema-generic
  constructor(engine: PalladiumEngine<any>) {
    this.#engine = engine;
  }

  createAdapter(): DialectAdapter {
    return new MysqlAdapter();
  }

  createDriver(): Driver {
    return new PalladiumDriver(this.#engine);
  }

  // biome-ignore lint/suspicious/noExplicitAny: Kysely generic usage
  createIntrospector(db: Kysely<any>): DatabaseIntrospector {
    return new MysqlIntrospector(db);
  }

  createQueryCompiler(): QueryCompiler {
    return new MysqlQueryCompiler();
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

  async beginTransaction(_conn: DatabaseConnection): Promise<void> {}
  async commitTransaction(_conn: DatabaseConnection): Promise<void> {}
  async rollbackTransaction(_conn: DatabaseConnection): Promise<void> {}

  async releaseConnection(_conn: DatabaseConnection): Promise<void> {}
  async destroy(): Promise<void> {}
}

class PalladiumConnection implements DatabaseConnection {
  // biome-ignore lint/suspicious/noExplicitAny: engine is schema-generic
  readonly #engine: PalladiumEngine<any>;

  // biome-ignore lint/suspicious/noExplicitAny: engine is schema-generic
  constructor(engine: PalladiumEngine<any>) {
    this.#engine = engine;
  }

  async executeQuery<R>(compiled: CompiledQuery): Promise<QueryResult<R>> {
    const rows = await this.#engine.adapter.exec<R>(compiled.sql, compiled.parameters as unknown[]);
    return { rows };
  }

  // biome-ignore lint/correctness/useYield: streaming not supported
  async *streamQuery<R>(
    _compiled: CompiledQuery,
    _chunkSize: number,
  ): AsyncIterableIterator<QueryResult<R>> {
    throw new Error("PalladiumDialect does not support streaming queries.");
  }
}
