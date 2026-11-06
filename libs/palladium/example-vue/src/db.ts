import type { SchemaConfig } from "@palladium/core";
import { createEngine } from "@palladium/core";
import { BrowserSqliteAdapter } from "@palladium/sqlite-browser";

export type TodoRow = { id: string; text: string; done: number };
export type TodoSchema = { tasks: TodoRow };

export const SCHEMA: SchemaConfig = {
  schema:
    "CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, text TEXT NOT NULL, done INTEGER NOT NULL)",
  version: 1,
};

export const db = createEngine<TodoSchema>(new BrowserSqliteAdapter({ vfs: { type: "memory" } }));

export { generateUuidV7 } from "@palladium/core";
