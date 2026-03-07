import { generateUlid, sql } from "@palladium/core";
import { useLiveQuery, usePalladium, useSyncStatus } from "@palladium/react";
import { useMemo, useState } from "react";
import { NoteEditor } from "./NoteEditor.js";
import type { NoteRow, NotesSchema } from "./db.js";

export function App(): React.ReactElement {
  const db = usePalladium<NotesSchema>();
  const status = useSyncStatus();
  const { rows: rawNotes } = useLiveQuery<NoteRow>(sql`SELECT * FROM notes`);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Sort client-side — MemoryAdapter does not support ORDER BY.
  const notes = useMemo(
    () => [...rawNotes].sort((a, b) => b.updated_at - a.updated_at),
    [rawNotes],
  );

  const selectedNote = notes.find((n) => n.id === selectedId) ?? null;

  async function handleNewNote(): Promise<void> {
    const id = generateUlid();
    await db.insert("notes", {
      id,
      title: "",
      content: JSON.stringify({ type: "doc", content: [{ type: "paragraph" }] }),
      updated_at: Date.now(),
    });
    setSelectedId(id);
  }

  async function handleDelete(id: string, e: React.MouseEvent): Promise<void> {
    e.stopPropagation();
    await db.delete("notes", id);
    if (selectedId === id) setSelectedId(null);
  }

  return (
    <div style={layoutStyle}>
      {/* ── Sidebar ──────────────────────────────────────────────────── */}
      <aside style={sidebarStyle}>
        <div style={sidebarHeaderStyle}>
          <span style={statusDotStyle(status)} data-testid="sync-status" title={status} />
          <button
            data-testid="new-note-btn"
            onClick={() => void handleNewNote()}
            style={newBtnStyle}
            type="button"
          >
            + New Note
          </button>
        </div>
        <ul data-testid="notes-list" style={notesListStyle}>
          {notes.map((note) => (
            <li key={note.id} data-testid="note-item" style={noteItemWrapperStyle}>
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
                onClick={(e) => void handleDelete(note.id, e)}
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
      </aside>

      {/* ── Editor pane ──────────────────────────────────────────────── */}
      <main style={mainStyle}>
        {selectedNote ? (
          <NoteEditor note={selectedNote} db={db} />
        ) : (
          <div style={placeholderStyle}>
            <p>Select a note or click &ldquo;+ New Note&rdquo;</p>
          </div>
        )}
      </main>
    </div>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────

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
  idle: "#4caf50",
  syncing: "#ff9800",
  error: "#f44336",
  offline: "#9e9e9e",
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
