<script setup lang="ts">
import { sql } from "@palladium/core";
import { useLiveQuery } from "@palladium/vue";
import { computed, onUnmounted, ref, watch } from "vue";
import type { Account, AtriumApi } from "../atrium.js";
import { newId } from "../atrium.js";
import type { NoteImageRow, NoteRow } from "../schema.js";

const props = defineProps<{ account: Account; api: AtriumApi; members: string[] }>();
const emit = defineEmits<{ shared: [] }>();
const engine = props.account.engine;

const { rows: notes } = useLiveQuery<NoteRow>(
  engine,
  sql`SELECT id, title, body, created_at FROM notes ORDER BY created_at DESC`,
);
const { rows: images } = useLiveQuery<NoteImageRow>(
  engine,
  sql`SELECT id, root_id, blob_id, caption FROM note_images ORDER BY rowid`,
);

const imagesByNote = computed(() => {
  const map = new Map<string, NoteImageRow[]>();
  for (const img of images.value) {
    const arr = map.get(img.root_id) ?? [];
    arr.push(img);
    map.set(img.root_id, arr);
  }
  return map;
});

const newTitle = ref("");
const grantee = ref(new Map<string, string>());
const perm = ref(new Map<string, "read" | "write">());
const thumbs = ref(new Map<string, string>()); // blob_id → object URL
const wantedBlobIds = new Set<string>();
let acceptingThumbs = true;
const inFlight = new Set<string>(); // blob_ids currently being fetched
const err = ref<string | null>(null);

async function addNote(): Promise<void> {
  const title = newTitle.value.trim();
  if (!title) return;
  await engine.insert("notes", { id: newId(), title, body: "", created_at: Date.now() });
  newTitle.value = "";
}

async function shareNote(note: NoteRow): Promise<void> {
  const to = grantee.value.get(note.id);
  if (!to) return;
  err.value = null;
  try {
    await props.api.share(
      props.account.workspaceId,
      note.id,
      to,
      perm.value.get(note.id) ?? "read",
    );
    emit("shared");
  } catch (e) {
    err.value = String(e);
  }
}

async function unshareNote(note: NoteRow): Promise<void> {
  const to = grantee.value.get(note.id);
  if (!to) return;
  err.value = null;
  try {
    await props.api.unshare(props.account.workspaceId, note.id, to);
    emit("shared");
  } catch (e) {
    err.value = String(e);
  }
}

async function attachImage(note: NoteRow, event: Event): Promise<void> {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  err.value = null;
  try {
    const blobId = newId();
    await props.api.putBlob(props.account.workspaceId, note.id, blobId, file);
    await engine.insert("note_images", {
      id: newId(),
      root_id: note.id,
      blob_id: blobId,
      caption: file.name,
    });
  } catch (e) {
    err.value = String(e);
  }
  (event.target as HTMLInputElement).value = "";
}

async function loadThumb(blobId: string): Promise<void> {
  // Guard against a re-entrant fetch for the same blob: without the in-flight
  // set, a watcher that fires twice before the first `getBlob` resolves would
  // create two object URLs and leak the first.
  if (thumbs.value.has(blobId) || inFlight.has(blobId)) return;
  inFlight.add(blobId);
  try {
    const blob = await props.api.getBlob(blobId);
    if (blob && acceptingThumbs && wantedBlobIds.has(blobId) && !thumbs.value.has(blobId)) {
      const next = new Map(thumbs.value);
      next.set(blobId, URL.createObjectURL(blob));
      // reassign to trigger reactive re-render of the thumbnail grid
      thumbs.value = next;
    }
  } finally {
    inFlight.delete(blobId);
  }
}

// Release every object URL when the section unmounts (workspace/user switch) so
// the blobs don't stay pinned in memory for the document's lifetime. Prevent an
// in-flight fetch from creating a new URL after this cleanup.
onUnmounted(() => {
  acceptingThumbs = false;
  wantedBlobIds.clear();
  for (const url of thumbs.value.values()) URL.revokeObjectURL(url);
  thumbs.value = new Map();
});

// Fetch any blob bytes we don't have yet whenever the image rows change (new
// local attach, or a sync/backfill from another member), and immediately
// release URLs once their last referencing row disappears.
watch(
  images,
  (rows) => {
    wantedBlobIds.clear();
    for (const img of rows) wantedBlobIds.add(img.blob_id);

    const next = new Map(thumbs.value);
    for (const [blobId, url] of next) {
      if (!wantedBlobIds.has(blobId)) {
        URL.revokeObjectURL(url);
        next.delete(blobId);
      }
    }
    if (next.size !== thumbs.value.size) thumbs.value = next;

    for (const blobId of wantedBlobIds) void loadThumb(blobId);
  },
  { immediate: true },
);
</script>

<template>
  <section class="card">
    <header><h3>Notes</h3><span class="badge per-member">per-member</span></header>
    <p class="hint">Private by default; share a single note with one person (with an image).</p>
    <form @submit.prevent="addNote">
      <input v-model="newTitle" placeholder="New note…" />
      <button type="submit">Add</button>
    </form>
    <p v-if="err" class="hint" style="color: #f4a6b4">{{ err }}</p>
    <ul>
      <li v-for="n in notes" :key="n.id" style="flex-direction: column; align-items: stretch">
        <strong>{{ n.title }}</strong>
        <div class="share-row">
          <select
            :value="grantee.get(n.id) ?? ''"
            @change="grantee.set(n.id, ($event.target as HTMLSelectElement).value)"
          >
            <option value="" disabled>share with…</option>
            <option v-for="m in members" :key="m" :value="m">{{ m }}</option>
          </select>
          <select
            :value="perm.get(n.id) ?? 'read'"
            @change="perm.set(n.id, ($event.target as HTMLSelectElement).value as 'read' | 'write')"
          >
            <option value="read">read</option>
            <option value="write">read+write</option>
          </select>
          <button type="button" class="btn subtle" @click="shareNote(n)">grant</button>
          <button type="button" class="btn subtle" @click="unshareNote(n)">revoke</button>
          <label class="btn subtle" style="cursor: pointer">
            <span aria-hidden="true">📎</span> image
            <input
              type="file"
              accept="image/*"
              class="visually-hidden"
              :aria-label="`Attach an image to ${n.title}`"
              @change="attachImage(n, $event)"
            />
          </label>
        </div>
        <div v-if="(imagesByNote.get(n.id) ?? []).length" class="thumbs">
          <img
            v-for="img in imagesByNote.get(n.id) ?? []"
            :key="img.id"
            :src="thumbs.get(img.blob_id)"
            :alt="img.caption"
            :title="img.caption"
          />
        </div>
      </li>
      <li v-if="notes.length === 0" class="muted">No notes yet.</li>
    </ul>
  </section>
</template>
