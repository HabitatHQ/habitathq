/**
 * NoteEditor — TipTap rich-text editor for a single note.
 *
 * Handles the two-way sync problem:
 * • When the user types, changes are saved to the engine (which posts to server).
 * • When a remote change arrives via polling, the engine updates `note.content`
 *   (via live query re-run), and a useEffect applies it to the editor only when
 *   the content actually differs from what we last saved.
 */

import type { PalladiumEngine } from "@palladium/core";
import Placeholder from "@tiptap/extension-placeholder";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useRef } from "react";
import type { NoteRow, NotesSchema } from "./db.js";

const EMPTY_DOC = JSON.stringify({ type: "doc", content: [{ type: "paragraph" }] });

function safeParse(s: string): object {
  try {
    return JSON.parse(s) as object;
  } catch {
    return JSON.parse(EMPTY_DOC) as object;
  }
}

interface Props {
  note: NoteRow;
  db: PalladiumEngine<NotesSchema>;
}

export function NoteEditor({ note, db }: Props): React.ReactElement {
  // Track the last content we wrote to the DB so we can distinguish local
  // writes (already in editor) from remote updates (need to push to editor).
  const lastSavedContentRef = useRef(note.content);
  const lastSavedTitleRef = useRef(note.title);

  const editor = useEditor({
    extensions: [StarterKit, Placeholder.configure({ placeholder: "Start writing…" })],
    content: safeParse(note.content),
    onUpdate: ({ editor: e }) => {
      const content = JSON.stringify(e.getJSON());
      lastSavedContentRef.current = content;
      void db.update("notes", note.id, {
        content,
        updated_at: Date.now(),
      });
    },
  });

  // Push remote content changes into the editor without disrupting cursor
  // position for local edits (we skip if content matches what we just saved).
  useEffect(() => {
    if (!editor) return;
    if (note.content !== lastSavedContentRef.current) {
      lastSavedContentRef.current = note.content;
      editor.commands.setContent(safeParse(note.content), false);
    }
  }, [note.content, editor]);

  function handleTitleChange(e: React.ChangeEvent<HTMLInputElement>): void {
    const title = e.target.value;
    lastSavedTitleRef.current = title;
    void db.update("notes", note.id, { title, updated_at: Date.now() });
  }

  // Sync remote title changes into the uncontrolled input.
  const titleRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (titleRef.current && note.title !== lastSavedTitleRef.current) {
      lastSavedTitleRef.current = note.title;
      titleRef.current.value = note.title;
    }
  }, [note.title]);

  return (
    <div style={editorContainerStyle}>
      <input
        ref={titleRef}
        data-testid="note-title"
        defaultValue={note.title}
        onChange={handleTitleChange}
        placeholder="Untitled"
        style={titleInputStyle}
      />
      <div data-testid="editor-content" style={editorWrapperStyle}>
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

// ── Inline styles ───────────────────────────────────────────────────────────

const editorContainerStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  height: "100%",
  padding: "24px 32px",
};

const titleInputStyle: React.CSSProperties = {
  border: "none",
  borderBottom: "1px solid #e0e0e0",
  fontSize: "24px",
  fontWeight: 600,
  marginBottom: "16px",
  outline: "none",
  padding: "4px 0",
  background: "transparent",
};

const editorWrapperStyle: React.CSSProperties = {
  flex: 1,
  overflowY: "auto",
};
