import type { SchemaConfig } from "@palladium/core";

/**
 * The burrow POC surface (ERD §7.1): three aggregate roots, each with a child,
 * exercising Atrium's three sharing classes.
 *
 * - `habits`  → root, **private only**   (child `completions`)
 * - `lists`   → root, **household**       (child `list_items`)
 * - `notes`   → root, **per-member**      (child `note_images`, a blob child)
 *
 * Every child carries a `root_id` column. The engine serialises a row's columns
 * into the insert op's `data`, so Atrium reads `data.root_id` to resolve the
 * child's audience through its root (`D21`) — the column name must be exactly
 * `root_id` to match Atrium's registry.
 */
export interface HabitRow {
  id: string;
  name: string;
  created_at: number;
}
export interface CompletionRow {
  id: string;
  root_id: string;
  day: string;
  done: number;
}
export interface ListRow {
  id: string;
  name: string;
  created_at: number;
}
export interface ListItemRow {
  id: string;
  root_id: string;
  text: string;
  done: number;
}
export interface NoteRow {
  id: string;
  title: string;
  body: string;
  created_at: number;
}
export interface NoteImageRow {
  id: string;
  root_id: string;
  blob_id: string;
  caption: string;
}

export interface BurrowSchema {
  habits: HabitRow;
  completions: CompletionRow;
  lists: ListRow;
  list_items: ListItemRow;
  notes: NoteRow;
  note_images: NoteImageRow;
}

/** Root tables (own an ACL) and child tables (inherit via `root_id`). */
export const ROOT_TABLES = ["habits", "lists", "notes"] as const;
export const CHILD_TABLES = ["completions", "list_items", "note_images"] as const;

export const BURROW_SCHEMA: SchemaConfig = {
  version: 1,
  schema: `
    CREATE TABLE IF NOT EXISTS habits (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS completions (
      id TEXT PRIMARY KEY, root_id TEXT NOT NULL, day TEXT NOT NULL, done INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS lists (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS list_items (
      id TEXT PRIMARY KEY, root_id TEXT NOT NULL, text TEXT NOT NULL, done INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS note_images (
      id TEXT PRIMARY KEY, root_id TEXT NOT NULL, blob_id TEXT NOT NULL, caption TEXT NOT NULL
    );
  `,
};
