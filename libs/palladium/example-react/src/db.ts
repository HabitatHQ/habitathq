import {
  createEngine,
  generateUuidV7,
  type JsonValue,
  type PalladiumEngine,
  type SyncStatus,
  SyncTransport,
  sql,
} from "@palladium/core";
import { BrowserSqliteAdapter } from "@palladium/sqlite-browser";
import type { OwnerContext } from "@palladium/worker";

export interface NoteRow {
  [key: string]: JsonValue;
  id: string;
  title: string;
  /** Stringified TipTap JSON. */
  content: string;
  updated_at: number;
}

export type NotesSchema = { notes: NoteRow };

export interface NotesSnapshot {
  readonly nodeId: string;
  readonly notes: readonly NoteRow[];
  readonly pendingCount: number;
  readonly syncStatus: SyncStatus;
}

export interface NotesService {
  ping(): Promise<true>;
  snapshot(): Promise<NotesSnapshot>;
  createNote(): Promise<string>;
  updateNote(
    id: string,
    patch: Partial<Pick<NoteRow, "title" | "content" | "updated_at">>,
  ): Promise<void>;
  deleteNote(id: string): Promise<void>;
}

export interface NotesWorkerConfig {
  readonly databaseName: string;
  readonly nodeId: string;
  readonly serverUrl: string;
}

const SCHEMA = {
  version: 1,
  schema:
    "CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, title TEXT NOT NULL, content TEXT NOT NULL, updated_at INTEGER NOT NULL)",
};

const EMPTY_DOC = JSON.stringify({ type: "doc", content: [{ type: "paragraph" }] });

export function createNotesService(
  ctx: OwnerContext,
  config: NotesWorkerConfig,
): NotesService & { open(): Promise<void> } {
  const storage = new BrowserSqliteAdapter({
    vfs: {
      type: "opfs-sah-pool",
      directory: `/react-notes-${config.databaseName}`,
      filename: "/notes.db",
    },
  });
  const engine: PalladiumEngine<NotesSchema> = createEngine<NotesSchema>(storage, {
    nodeId: config.nodeId,
  });
  let transport: SyncTransport<NotesSchema> | null = null;

  async function snapshot(): Promise<NotesSnapshot> {
    const notes = await engine.exec<NoteRow>(
      sql`SELECT * FROM notes ORDER BY updated_at DESC, id DESC`,
    );
    const [pending] = await engine.exec<{ count: number }>(
      sql`SELECT COUNT(*) AS count FROM _sync_outbox`,
    );
    return {
      nodeId: engine.nodeId,
      notes,
      pendingCount: pending?.count ?? 0,
      syncStatus: engine.getSyncStatus(),
    };
  }

  return {
    async open(): Promise<void> {
      await engine.init(SCHEMA);
      const notesQuery = engine.liveQuery<NoteRow>(sql`SELECT * FROM notes`);
      notesQuery.on("change", () => ctx.invalidate(["notes"]));
      await notesQuery.exec();

      transport = new SyncTransport(engine, {
        serverUrl: config.serverUrl,
        pollIntervalMs: 1_000,
      });
      await transport.start();
    },

    async ping(): Promise<true> {
      return true;
    },

    snapshot,

    async createNote(): Promise<string> {
      const id = generateUuidV7();
      await engine.insert("notes", {
        id,
        title: "",
        content: EMPTY_DOC,
        updated_at: Date.now(),
      });
      return id;
    },

    async updateNote(id, patch): Promise<void> {
      await engine.update("notes", id, patch);
    },

    async deleteNote(id): Promise<void> {
      await engine.delete("notes", id);
    },
  };
}
