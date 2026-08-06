<script setup lang="ts">
import { sql } from "@palladium/core";
import { useLiveQuery } from "@palladium/vue";
import { computed, ref } from "vue";
import type { Account } from "../atrium.js";
import { newId } from "../atrium.js";
import type { CompletionRow, HabitRow } from "../schema.js";

const props = defineProps<{ account: Account }>();

const today = new Date().toISOString().slice(0, 10);
const engine = props.account.engine;

const { rows: habits } = useLiveQuery<HabitRow>(
  engine,
  sql`SELECT id, name, created_at FROM habits ORDER BY created_at`,
);
const { rows: todays } = useLiveQuery<CompletionRow>(
  engine,
  sql`SELECT id, root_id, day, done FROM completions WHERE day = ${today}`,
);

const doneByHabit = computed(() => {
  const map = new Map<string, CompletionRow>();
  for (const c of todays.value) map.set(c.root_id, c);
  return map;
});

const newHabit = ref("");
const toggling = new Set<string>(); // habit ids with an in-flight toggle

async function addHabit(): Promise<void> {
  const name = newHabit.value.trim();
  if (!name) return;
  await engine.insert("habits", { id: newId(), name, created_at: Date.now() });
  newHabit.value = "";
}

async function toggleToday(habit: HabitRow): Promise<void> {
  // The `doneByHabit` map lags behind the live query, so two rapid toggles
  // could both observe "no completion" and both insert a duplicate. Guard with
  // an in-flight set and read the current row straight from the store rather
  // than the async projection.
  if (toggling.has(habit.id)) return;
  toggling.add(habit.id);
  try {
    const rows = await engine.adapter.exec<{ id: string; done: number }>(
      "SELECT id, done FROM completions WHERE root_id = ? AND day = ? LIMIT 1",
      [habit.id, today],
    );
    const existing = rows[0];
    if (existing) {
      await engine.update("completions", existing.id, { done: existing.done === 1 ? 0 : 1 });
    } else {
      await engine.insert("completions", { id: newId(), root_id: habit.id, day: today, done: 1 });
    }
  } finally {
    toggling.delete(habit.id);
  }
}
</script>

<template>
  <section class="card">
    <header><h3>Habits</h3><span class="badge private">private</span></header>
    <p class="hint">Yours alone — never shared, even within the family.</p>
    <form @submit.prevent="addHabit">
      <input v-model="newHabit" placeholder="New habit…" />
      <button type="submit">Add</button>
    </form>
    <ul>
      <li v-for="h in habits" :key="h.id">
        <input
          type="checkbox"
          :checked="doneByHabit.get(h.id)?.done === 1"
          :aria-label="`${h.name} done today`"
          @change="toggleToday(h)"
        />
        <span :class="{ done: doneByHabit.get(h.id)?.done === 1 }">{{ h.name }}</span>
      </li>
      <li v-if="habits.length === 0" class="muted">No habits yet.</li>
    </ul>
  </section>
</template>

