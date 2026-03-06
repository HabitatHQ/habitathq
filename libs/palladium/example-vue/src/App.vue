<script setup lang="ts">
import { sql } from "@palladium/core";
import { useLiveQuery } from "@palladium/vue";
import { ref } from "vue";
import { db, generateUlid } from "./db.js";

type Task = { id: string; text: string; done: number };

const { rows: tasks, loading } = useLiveQuery<Task>(db, sql`SELECT * FROM tasks`);
const newText = ref("");

async function addTask(): Promise<void> {
  const text = newText.value.trim();
  if (!text) return;
  await db.insert("tasks", { id: generateUlid(), text, done: 0 });
  newText.value = "";
}

async function toggleTask(task: Task): Promise<void> {
  await db.update("tasks", task.id, { done: task.done === 0 ? 1 : 0 });
}

async function deleteTask(id: string): Promise<void> {
  await db.delete("tasks", id);
}
</script>

<template>
  <main>
    <h1>Todo</h1>

    <form @submit.prevent="addTask">
      <label for="new-task">New task</label>
      <input
        id="new-task"
        v-model="newText"
        placeholder="What needs doing?"
        data-testid="new-task-input"
        autocomplete="off"
      />
      <button type="submit" data-testid="add-task-btn">Add</button>
    </form>

    <section aria-label="Tasks">
      <p v-if="loading">Loading…</p>
      <p v-else-if="tasks.length === 0" data-testid="empty-message">No todos yet.</p>
      <ul v-else>
        <li v-for="task in tasks" :key="task.id" data-testid="task-item">
          <label>
            <input
              type="checkbox"
              :checked="task.done === 1"
              @change="toggleTask(task)"
              :aria-label="task.text"
            />
            <span :class="{ done: task.done === 1 }">{{ task.text }}</span>
          </label>
          <button
            type="button"
            :aria-label="`Delete ${task.text}`"
            :data-testid="`task-delete-${task.id}`"
            @click="deleteTask(task.id)"
          >
            ×
          </button>
        </li>
      </ul>
    </section>
  </main>
</template>

<style scoped>
main {
  max-width: 480px;
  margin: 2rem auto;
  font-family: system-ui, sans-serif;
  padding: 0 1rem;
}

form {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  margin-block-end: 1.5rem;
}

form label {
  display: none;
}

input[type="text"],
input:not([type]) {
  flex: 1;
  padding: 0.4rem 0.6rem;
  border: 1px solid #ccc;
  border-radius: 4px;
  font-size: 1rem;
}

ul {
  list-style: none;
  padding: 0;
  margin: 0;
}

li {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.4rem 0;
  border-block-end: 1px solid #eee;
}

li label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex: 1;
  cursor: pointer;
}

.done {
  text-decoration: line-through;
  opacity: 0.5;
}
</style>
