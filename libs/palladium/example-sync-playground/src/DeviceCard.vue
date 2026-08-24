<script setup lang="ts">
import { sql } from "@palladium/core";
import { useLiveQuery, useSyncStatus } from "@palladium/vue";
import { computed, ref } from "vue";
import { type Device, newId, type TaskRow } from "./client.js";

const props = defineProps<{
  device: Device;
  label: string;
  token: string;
  tokens: string[];
}>();

const emit = defineEmits<{
  "change-token": [token: string];
}>();

const { rows: tasks, loading } = useLiveQuery<TaskRow>(
  props.device.engine,
  sql`SELECT id, text, done FROM tasks ORDER BY text`,
);
const status = useSyncStatus(props.device.engine);

const newText = ref("");
const online = ref(true);

const shortNode = computed(() => props.device.nodeId.slice(0, 8));
const statusLabel = computed(() => (online.value ? status.value : "paused"));

async function addTask(): Promise<void> {
  const text = newText.value.trim();
  if (!text) return;
  await props.device.engine.insert("tasks", { id: newId(), text, done: 0 });
  newText.value = "";
}

async function toggleTask(task: TaskRow): Promise<void> {
  await props.device.engine.update("tasks", task.id, { done: task.done === 0 ? 1 : 0 });
}

async function editTask(task: TaskRow, event: Event): Promise<void> {
  const el = event.target;
  const text = el instanceof HTMLElement ? (el.textContent?.trim() ?? "") : "";
  if (text && text !== task.text) await props.device.engine.update("tasks", task.id, { text });
}

function onTokenChange(event: Event): void {
  const el = event.target;
  if (el instanceof HTMLSelectElement) emit("change-token", el.value);
}

async function deleteTask(id: string): Promise<void> {
  await props.device.engine.delete("tasks", id);
}

/** Pause/resume the uplink — the classic offline→converge demo. */
async function toggleOnline(): Promise<void> {
  if (online.value) {
    await props.device.transport.stop();
    online.value = false;
  } else {
    await props.device.transport.start();
    online.value = true;
  }
}
</script>

<template>
  <article class="card" :data-status="statusLabel">
    <header>
      <div class="who">
        <span class="dot" :class="statusLabel" :title="statusLabel"></span>
        <strong>{{ label }}</strong>
        <code class="node" :title="`nodeId: ${device.nodeId}`">#{{ shortNode }}</code>
      </div>
      <div class="controls">
        <label class="ws">
          workspace
          <select :value="token" @change="onTokenChange">
            <option v-for="t in tokens" :key="t" :value="t">{{ t }}</option>
          </select>
        </label>
        <button
          type="button"
          class="wire"
          :class="{ off: !online }"
          :data-testid="`toggle-online-${label}`"
          @click="toggleOnline"
        >
          {{ online ? "⏸ go offline" : "▶ go online" }}
        </button>
      </div>
    </header>

    <form @submit.prevent="addTask">
      <input
        v-model="newText"
        placeholder="Add a task…"
        :data-testid="`new-task-${label}`"
        autocomplete="off"
      />
      <button type="submit" :data-testid="`add-task-${label}`">Add</button>
    </form>

    <p v-if="loading" class="muted">Loading…</p>
    <p v-else-if="tasks.length === 0" class="muted" :data-testid="`empty-${label}`">
      No tasks yet.
    </p>
    <ul v-else>
      <li v-for="task in tasks" :key="task.id" data-testid="task-item">
        <input
          type="checkbox"
          :checked="task.done === 1"
          :aria-label="task.text"
          @change="toggleTask(task)"
        />
        <span
          class="text"
          :class="{ done: task.done === 1 }"
          contenteditable="plaintext-only"
          @blur="editTask(task, $event)"
        >{{ task.text }}</span>
        <button
          type="button"
          class="del"
          :aria-label="`Delete ${task.text}`"
          @click="deleteTask(task.id)"
        >
          ×
        </button>
      </li>
    </ul>
  </article>
</template>

<style scoped>
.card {
  border: 1px solid #2b3242;
  border-radius: 12px;
  background: #151a24;
  padding: 1rem 1.1rem 1.2rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  min-width: 0;
}

header {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.who {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.who strong {
  font-size: 1.05rem;
}

.node {
  color: #7d8aa5;
  font-size: 0.78rem;
}

.dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #556;
  flex: none;
}
.dot.idle {
  background: #35c46a;
}
.dot.syncing {
  background: #f0b429;
  animation: pulse 0.9s infinite;
}
.dot.error {
  background: #e5484d;
}
.dot.offline,
.dot.paused {
  background: #5b6472;
}
@keyframes pulse {
  50% {
    opacity: 0.35;
  }
}
@media (prefers-reduced-motion: reduce) {
  .dot.syncing {
    animation: none;
  }
}
:global(html.reduce-motion) .dot.syncing {
  animation: none;
}

.controls {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.ws {
  font-size: 0.78rem;
  color: #7d8aa5;
  display: flex;
  align-items: center;
  gap: 0.35rem;
}

select,
input,
button {
  font: inherit;
}

select {
  background: #0f131b;
  color: #e7ecf5;
  border: 1px solid #2b3242;
  border-radius: 6px;
  padding: 0.15rem 0.35rem;
}

.wire {
  background: #1d2431;
  color: #cdd6e6;
  border: 1px solid #2b3242;
  border-radius: 6px;
  padding: 0.2rem 0.55rem;
  cursor: pointer;
  font-size: 0.78rem;
}
.wire.off {
  background: #3a2130;
  color: #f4a6b4;
  border-color: #5a2b3b;
}

form {
  display: flex;
  gap: 0.4rem;
}
form input {
  flex: 1;
  min-width: 0;
  padding: 0.4rem 0.55rem;
  border: 1px solid #2b3242;
  border-radius: 6px;
  background: #0f131b;
  color: #e7ecf5;
}
form button {
  padding: 0.4rem 0.7rem;
  border-radius: 6px;
  border: 1px solid #2b3242;
  background: #2a68d8;
  color: white;
  cursor: pointer;
}

.muted {
  color: #6b7488;
  font-size: 0.9rem;
  margin: 0;
}

ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}
li {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.3rem 0;
  border-bottom: 1px solid #1e2430;
}
.text {
  flex: 1;
  min-width: 0;
  outline: none;
  border-radius: 4px;
  padding: 0.1rem 0.2rem;
}
.text:focus {
  background: #0f131b;
  box-shadow: 0 0 0 1px #2a68d8;
}
.text.done {
  text-decoration: line-through;
  opacity: 0.45;
}
.del {
  background: none;
  border: none;
  color: #7d8aa5;
  cursor: pointer;
  font-size: 1.1rem;
  line-height: 1;
}
.del:hover {
  color: #e5484d;
}
</style>
