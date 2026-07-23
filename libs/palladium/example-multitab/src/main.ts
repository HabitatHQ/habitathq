/**
 * Hello-world UI. Open this page in several tabs:
 * - the badge shows which tab is LEADER (owns OPFS) vs follower;
 * - adding/clearing notes in any tab updates every tab live;
 * - close the leader tab and a follower takes over — no reload, data intact.
 */

import { createClient } from "@palladium/worker";

interface NoteRow {
  id: string;
  body: string;
  created_at: number;
}

const worker = new Worker(new URL("./db.worker.ts", import.meta.url), { type: "module" });
const db = createClient(worker);

const $ = (id: string): HTMLElement => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el;
};

const roleBadge = $("role");
const list = $("list");
const input = $("body") as HTMLInputElement;

db.onRole((role) => {
  roleBadge.textContent = role === "leader" ? "LEADER (owns OPFS)" : "follower";
  roleBadge.dataset["role"] = role;
});

db.live<NoteRow>("SELECT * FROM notes ORDER BY created_at DESC, id DESC", [], (rows) => {
  list.innerHTML = "";
  for (const r of rows) {
    const li = document.createElement("li");
    li.textContent = r.body;
    li.dataset["id"] = r.id;
    list.appendChild(li);
  }
  $("count").textContent = String(rows.length);
});

async function addNote(body: string): Promise<void> {
  const trimmed = body.trim();
  if (!trimmed) return;
  await db.mutate("INSERT INTO notes (id, body, created_at) VALUES (?, ?, ?)", [
    crypto.randomUUID(),
    trimmed,
    Date.now(),
  ]);
  input.value = "";
}

$("add").addEventListener("click", () => void addNote(input.value));
input.addEventListener("keydown", (e) => {
  if ((e as KeyboardEvent).key === "Enter") void addNote(input.value);
});
$("clear").addEventListener("click", () => void db.mutate("DELETE FROM notes"));
