import { startDbOwner } from "@palladium/worker/owner";
import type { NotesService, NotesWorkerConfig } from "./db.js";
import { createNotesService } from "./db.js";

function isNotesWorkerConfig(value: unknown): value is NotesWorkerConfig {
  if (typeof value !== "object" || value === null) return false;
  const config = value as Partial<NotesWorkerConfig>;
  return (
    typeof config.databaseName === "string" &&
    typeof config.nodeId === "string" &&
    typeof config.serverUrl === "string"
  );
}

let started = false;
self.addEventListener("message", (event: MessageEvent<unknown>) => {
  if (started || !isNotesWorkerConfig(event.data)) return;
  started = true;
  const config = event.data;
  startDbOwner<NotesService>({
    dbName: `react-notes-${config.databaseName}`,
    methods: ["ping", "snapshot", "createNote", "updateNote", "deleteNote"],
    create: (ctx) => createNotesService(ctx, config),
  });
});
