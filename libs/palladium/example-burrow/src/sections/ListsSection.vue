<script setup lang="ts">
import { sql } from "@palladium/core";
import { useLiveQuery } from "@palladium/vue";
import { computed, ref } from "vue";
import type { Account, AtriumApi } from "../atrium.js";
import { newId } from "../atrium.js";
import type { ListItemRow, ListRow } from "../schema.js";

const props = defineProps<{ account: Account; api: AtriumApi }>();
const engine = props.account.engine;

const { rows: lists } = useLiveQuery<ListRow>(
  engine,
  sql`SELECT id, name, created_at FROM lists ORDER BY created_at`,
);
const { rows: items } = useLiveQuery<ListItemRow>(
  engine,
  sql`SELECT id, root_id, text, done FROM list_items ORDER BY rowid`,
);

const itemsByList = computed(() => {
  const map = new Map<string, ListItemRow[]>();
  for (const it of items.value) {
    const arr = map.get(it.root_id) ?? [];
    arr.push(it);
    map.set(it.root_id, arr);
  }
  return map;
});

// Sharing class is Atrium's truth; we track the last class we *set* locally so
// the buttons can show an active state (there is no read-sharing endpoint yet).
const sharing = ref(new Map<string, string>());
const newList = ref("");
const draftItem = ref(new Map<string, string>());
const err = ref<string | null>(null);

async function addList(): Promise<void> {
  const name = newList.value.trim();
  if (!name) return;
  await engine.insert("lists", { id: newId(), name, created_at: Date.now() });
  newList.value = "";
}

async function addItem(list: ListRow): Promise<void> {
  const text = (draftItem.value.get(list.id) ?? "").trim();
  if (!text) return;
  await engine.insert("list_items", { id: newId(), root_id: list.id, text, done: 0 });
  draftItem.value.set(list.id, "");
}

async function toggleItem(it: ListItemRow): Promise<void> {
  await engine.update("list_items", it.id, { done: it.done === 1 ? 0 : 1 });
}

async function setSharing(list: ListRow, cls: string): Promise<void> {
  err.value = null;
  try {
    await props.api.setSharing(list.id, cls);
    sharing.value.set(list.id, cls);
  } catch (e) {
    err.value = String(e);
  }
}
</script>

<template>
  <section class="card">
    <header><h3>Lists</h3><span class="badge household">household</span></header>
    <p class="hint">Share the whole list (and its items) with everyone in the family.</p>
    <form @submit.prevent="addList">
      <input v-model="newList" placeholder="New list…" />
      <button type="submit">Add</button>
    </form>
    <p v-if="err" class="hint" style="color: #f4a6b4">{{ err }}</p>
    <ul>
      <li v-for="l in lists" :key="l.id" style="flex-direction: column; align-items: stretch">
        <div class="share-row">
          <strong style="flex: 1">{{ l.name }}</strong>
          <div role="group" :aria-label="`Sharing for ${l.name}`" class="share-row">
            <button
              v-for="cls in ['private', 'household_read', 'household_rw']"
              :key="cls"
              type="button"
              class="btn subtle"
              :aria-pressed="sharing.get(l.id) === cls"
              :style="sharing.get(l.id) === cls ? 'outline: 1px solid #2a68d8' : ''"
              @click="setSharing(l, cls)"
            >
              {{ cls === 'private' ? 'private' : cls === 'household_read' ? 'read' : 'read+write' }}
            </button>
          </div>
        </div>
        <ul class="sub">
          <li v-for="it in itemsByList.get(l.id) ?? []" :key="it.id">
            <input
              type="checkbox"
              :checked="it.done === 1"
              :aria-label="it.text"
              @change="toggleItem(it)"
            />
            <span :class="{ done: it.done === 1 }">{{ it.text }}</span>
          </li>
        </ul>
        <div class="share-row">
          <input
            :value="draftItem.get(l.id) ?? ''"
            placeholder="add item…"
            style="flex: 1"
            @input="draftItem.set(l.id, ($event.target as HTMLInputElement).value)"
            @keyup.enter="addItem(l)"
          />
          <button type="button" class="btn subtle" @click="addItem(l)">+</button>
        </div>
      </li>
      <li v-if="lists.length === 0" class="muted">No lists yet.</li>
    </ul>
  </section>
</template>
