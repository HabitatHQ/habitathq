import type { WorkerConnection } from "@palladium/worker";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NoteRow, NotesService, NotesSnapshot } from "./db.js";
import { NoteEditor } from "./NoteEditor.js";

interface AppProps {
  readonly connection: WorkerConnection<NotesService>;
}

const EMPTY_SNAPSHOT: NotesSnapshot = {
  nodeId: "",
  notes: [],
  pendingCount: 0,
  syncStatus: "uninitialized",
};

export function App({ connection }: AppProps): React.ReactElement {
  const [snapshot, setSnapshot] = useState<NotesSnapshot>(EMPTY_SNAPSHOT);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const writes = useRef({ pending: 0, revision: 0 });
  const refreshRevision = useRef(0);
  const refreshNeeded = useRef(false);

  const refresh = useCallback(async (): Promise<void> => {
    if (writes.current.pending > 0) {
      refreshNeeded.current = true;
      return;
    }
    refreshNeeded.current = false;
    const writeRevision = writes.current.revision;
    const requestRevision = ++refreshRevision.current;
    try {
      const next = await connection.service.snapshot();
      // A worker snapshot can describe an earlier keystroke. Never publish it
      // over newer edits, or let an older request replace a newer snapshot.
      if (writes.current.pending > 0 || writes.current.revision !== writeRevision) {
        refreshNeeded.current = true;
        return;
      }
      if (refreshRevision.current !== requestRevision) return;
      setSnapshot(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [connection]);

  useEffect(() => {
    const unsubscribeInvalidate = connection.onInvalidate(() => void refresh());
    const unsubscribeRole = connection.onRole(() => void refresh());
    const unsubscribeError = connection.onError(setError);
    void connection.service.ping().then(refresh, (err: unknown) => {
      setError(err instanceof Error ? err.message : String(err));
    });
    return () => {
      unsubscribeInvalidate();
      unsubscribeRole();
      unsubscribeError();
    };
  }, [connection, refresh]);

  const notes = useMemo(
    () => [...snapshot.notes].sort((a, b) => b.updated_at - a.updated_at),
    [snapshot.notes],
  );
  const selectedNote = notes.find((note) => note.id === selectedId) ?? null;

  async function createNote(): Promise<void> {
    try {
      const id = await connection.service.createNote();
      setSelectedId(id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function updateNote(
    id: string,
    patch: Partial<Pick<NoteRow, "title" | "content" | "updated_at">>,
  ): Promise<void> {
    writes.current.pending += 1;
    writes.current.revision += 1;
    refreshNeeded.current = true;
    try {
      await connection.service.updateNote(id, patch);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      writes.current.pending -= 1;
      if (writes.current.pending === 0 && refreshNeeded.current) await refresh();
    }
  }

  async function deleteNote(id: string): Promise<void> {
    try {
      await connection.service.deleteNote(id);
      if (selectedId === id) setSelectedId(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div style={layoutStyle}>
      <aside style={sidebarStyle}>
        <div style={sidebarHeaderStyle}>
          <span
            data-testid="sync-status"
            data-status={snapshot.syncStatus}
            style={statusDotStyle(snapshot.syncStatus)}
            title={snapshot.syncStatus}
          />
          <button
            data-testid="new-note-btn"
            onClick={() => void createNote()}
            style={newBtnStyle}
            type="button"
          >
            + New Note
          </button>
        </div>
        <ul data-testid="notes-list" style={notesListStyle}>
          {notes.map((note) => (
            <li
              key={note.id}
              data-testid="note-item"
              data-row-id={import.meta.env["VITE_E2E"] === "true" ? note.id : undefined}
              style={noteItemWrapperStyle}
            >
              <button
                aria-pressed={selectedId === note.id}
                onClick={() => setSelectedId(note.id)}
                style={noteSelectBtnStyle(selectedId === note.id)}
                type="button"
              >
                {note.title || "Untitled"}
              </button>
              <button
                data-testid="delete-note-btn"
                onClick={() => void deleteNote(note.id)}
                style={deleteBtnStyle}
                title="Delete"
                type="button"
              >
                ×
              </button>
            </li>
          ))}
          {notes.length === 0 && <li style={emptyStyle}>No notes yet — create one!</li>}
        </ul>
        {error !== null && <p data-testid="sync-error">{error}</p>}
        {import.meta.env["VITE_E2E"] === "true" && (
          <output data-testid="sync-diagnostics">
            <span data-testid="node-id">{snapshot.nodeId}</span>
            <span data-testid="pending-outbox-count">{snapshot.pendingCount}</span>
            <span data-testid="sync-status-value">{snapshot.syncStatus}</span>
          </output>
        )}
      </aside>

      <main style={mainStyle}>
        {selectedNote ? (
          <NoteEditor key={selectedNote.id} note={selectedNote} onUpdate={updateNote} />
        ) : (
          <div style={placeholderStyle}>
            <p>Select a note or click &ldquo;+ New Note&rdquo;</p>
          </div>
        )}
      </main>
    </div>
  );
}

const layoutStyle: React.CSSProperties = {
  display: "flex",
  height: "100vh",
  fontFamily: "system-ui, -apple-system, sans-serif",
};

const sidebarStyle: React.CSSProperties = {
  width: 260,
  borderRight: "1px solid #e0e0e0",
  background: "#fff",
  display: "flex",
  flexDirection: "column",
  flexShrink: 0,
};

const sidebarHeaderStyle: React.CSSProperties = {
  padding: "12px 16px",
  borderBottom: "1px solid #e0e0e0",
  display: "flex",
  alignItems: "center",
  gap: 8,
};

const statusColors: Record<string, string> = {
  caught_up: "#4caf50",
  syncing: "#ff9800",
  degraded: "#f44336",
  offline: "#9e9e9e",
  hydrating: "#ff9800",
  uninitialized: "#9e9e9e",
  blocked_auth: "#f44336",
};

function statusDotStyle(status: string): React.CSSProperties {
  return {
    width: 8,
    height: 8,
    borderRadius: "50%",
    background: statusColors[status] ?? "#9e9e9e",
    flexShrink: 0,
  };
}

const newBtnStyle: React.CSSProperties = {
  flex: 1,
  padding: "6px 12px",
  background: "#1a73e8",
  color: "#fff",
  border: "none",
  borderRadius: 4,
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 500,
};

const notesListStyle: React.CSSProperties = {
  listStyle: "none",
  margin: 0,
  padding: 0,
  flex: 1,
  overflowY: "auto",
};

const noteItemWrapperStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  borderBottom: "1px solid #f0f0f0",
};

function noteSelectBtnStyle(selected: boolean): React.CSSProperties {
  return {
    flex: 1,
    textAlign: "left",
    background: selected ? "#e8f0fe" : "transparent",
    border: "none",
    cursor: "pointer",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontSize: 14,
    padding: "10px 8px 10px 16px",
  };
}

const deleteBtnStyle: React.CSSProperties = {
  background: "transparent",
  border: "none",
  cursor: "pointer",
  color: "#999",
  fontSize: 18,
  lineHeight: 1,
  padding: "0 0 0 8px",
  flexShrink: 0,
};

const mainStyle: React.CSSProperties = {
  flex: 1,
  background: "#fafafa",
  overflow: "hidden",
};

const emptyStyle: React.CSSProperties = {
  padding: "16px",
  color: "#999",
  fontSize: 13,
};

const placeholderStyle: React.CSSProperties = {
  height: "100%",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: "#999",
};
