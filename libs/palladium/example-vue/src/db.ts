import { createEngine, generateUlid } from "@palladium/core";
import { BrowserSqliteAdapter } from "@palladium/sqlite-browser";

export type TodoRow = { id: string; text: string; done: number };
export type TodoSchema = { tasks: TodoRow };

const MIGRATIONS = [
  "CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, text TEXT NOT NULL, done INTEGER NOT NULL)",
];

export const db = createEngine<TodoSchema>(
  new BrowserSqliteAdapter({ vfs: { type: "memory" } }),
  MIGRATIONS,
);

export { generateUlid };
