<script setup lang="ts">
import { computed, markRaw, ref, shallowRef, watch } from "vue";
import { type Account, AtriumApi, createAccount, DEFAULT_SERVER, type Member } from "./atrium.js";
import StatusDot from "./StatusDot.vue";
import HabitsSection from "./sections/HabitsSection.vue";
import ListsSection from "./sections/ListsSection.vue";
import NotesSection from "./sections/NotesSection.vue";

const params = new URLSearchParams(location.search);
const serverUrl = params.get("server") ?? DEFAULT_SERVER;
// TODO(clerk): this preset-user picker is the dev stand-in for identity. Replace
// with Clerk sign-in gated on sync opt-in (local-first: no prompt until the user
// enables sync). `user` becomes the Clerk user id (`sub`); the bearer sent to
// Atrium becomes the Clerk session JWT (see atrium.ts authHeaders).
const PRESET_USERS = ["alice", "bob", "carol"];

const user = ref(params.get("user") ?? "");
const api = computed(() => (user.value ? new AtriumApi(user.value, serverUrl) : null));

const workspaces = ref<string[]>([]);
const activeWorkspace = ref<string | null>(null);
const account = shallowRef<Account | null>(null);
const members = ref<Member[]>([]);
const inviteToken = ref<string | null>(null);
const joinToken = ref("");
const busy = ref(false);
const errorMsg = ref<string | null>(null);

async function refreshWorkspaces(): Promise<void> {
  if (!api.value) return;
  try {
    workspaces.value = await api.value.listWorkspaces();
  } catch (err) {
    errorMsg.value = String(err);
  }
}

async function tearDown(): Promise<void> {
  if (account.value) {
    await account.value.transport.stop();
    account.value = null;
  }
  members.value = [];
  inviteToken.value = null;
}

async function mountWorkspace(workspaceId: string): Promise<void> {
  if (!user.value) return;
  busy.value = true;
  errorMsg.value = null;
  try {
    await tearDown();
    activeWorkspace.value = workspaceId;
    account.value = markRaw(await createAccount({ user: user.value, workspaceId, serverUrl }));
    if (api.value) members.value = await api.value.members(workspaceId);
  } catch (err) {
    errorMsg.value = String(err);
  } finally {
    busy.value = false;
  }
}

async function chooseUser(name: string): Promise<void> {
  await tearDown();
  activeWorkspace.value = null;
  user.value = name.trim();
  await refreshWorkspaces();
}

async function createFamily(): Promise<void> {
  if (!api.value) return;
  busy.value = true;
  try {
    const id = await api.value.createWorkspace();
    await refreshWorkspaces();
    await mountWorkspace(id);
  } catch (err) {
    errorMsg.value = String(err);
  } finally {
    busy.value = false;
  }
}

async function joinFamily(): Promise<void> {
  if (!api.value || !joinToken.value.trim()) return;
  busy.value = true;
  try {
    const id = await api.value.acceptInvite(joinToken.value.trim());
    joinToken.value = "";
    await refreshWorkspaces();
    await mountWorkspace(id);
  } catch (err) {
    errorMsg.value = String(err);
  } finally {
    busy.value = false;
  }
}

async function invite(): Promise<void> {
  if (!api.value || !activeWorkspace.value) return;
  try {
    inviteToken.value = await api.value.createInvite(activeWorkspace.value);
  } catch (err) {
    errorMsg.value = String(err);
  }
}

async function refreshMembers(): Promise<void> {
  if (api.value && activeWorkspace.value) {
    members.value = await api.value.members(activeWorkspace.value);
  }
}

const shortWs = (id: string): string => id.slice(0, 8);
const otherMembers = computed(() =>
  members.value.filter((m) => m.user_id !== user.value).map((m) => m.user_id),
);

watch(user, () => {
  void refreshWorkspaces();
});
</script>

<template>
  <div class="app">
    <header class="topbar">
      <h1>🕳️ Burrow</h1>
      <p class="tag">HabitatHQ POC · local-first + Atrium record ACL</p>
      <StatusDot v-if="account" :key="activeWorkspace ?? ''" :engine="account.engine" />
    </header>

    <!-- Identity (dev bearer stand-in for Clerk) -->
    <section class="panel">
      <h2>Who are you?</h2>
      <div class="row">
        <button
          v-for="u in PRESET_USERS"
          :key="u"
          type="button"
          class="pill"
          :class="{ active: user === u }"
          @click="chooseUser(u)"
        >
          {{ u }}
        </button>
        <span v-if="user" class="muted">signed in as <strong>{{ user }}</strong></span>
      </div>
    </section>

    <!-- Family / workspace -->
    <section v-if="user" class="panel">
      <h2>Family</h2>
      <div class="row">
        <button
          v-for="ws in workspaces"
          :key="ws"
          type="button"
          class="pill"
          :class="{ active: ws === activeWorkspace }"
          @click="mountWorkspace(ws)"
        >
          #{{ shortWs(ws) }}
        </button>
        <button type="button" class="ghost" :disabled="busy" @click="createFamily">+ create family</button>
      </div>
      <div class="row">
        <input v-model="joinToken" class="grow" placeholder="paste an invite token…" />
        <button type="button" class="ghost" :disabled="busy || !joinToken" @click="joinFamily">join</button>
      </div>
      <div v-if="activeWorkspace" class="row">
        <button type="button" class="ghost" @click="invite">invite a member…</button>
        <code v-if="inviteToken" class="token" :title="inviteToken">{{ inviteToken }}</code>
        <span class="muted">members: {{ members.map((m) => `${m.user_id} (${m.role})`).join(", ") }}</span>
      </div>
    </section>

    <p v-if="errorMsg" class="error">{{ errorMsg }}</p>

    <!-- The three aggregate-root surfaces -->
    <main v-if="account && api" class="surfaces">
      <HabitsSection :account="account" />
      <ListsSection :account="account" :api="api" />
      <NotesSection
        :account="account"
        :api="api"
        :members="otherMembers"
        @shared="refreshMembers"
      />
    </main>
    <p v-else-if="user" class="muted center">Pick or create a family to begin.</p>
  </div>
</template>

<style>
:root {
  color-scheme: dark;
}
body {
  margin: 0;
  font-family: system-ui, sans-serif;
  background: #0c0f16;
  color: #e7ecf5;
}
.app {
  max-width: 1080px;
  margin: 0 auto;
  padding: 1.5rem 1.25rem 4rem;
}
.topbar {
  display: flex;
  align-items: baseline;
  gap: 0.75rem;
  border-bottom: 1px solid #1e2430;
  padding-bottom: 0.75rem;
  margin-bottom: 1rem;
}
.topbar h1 {
  margin: 0;
  font-size: 1.4rem;
}
.tag {
  color: #7d8aa5;
  font-size: 0.85rem;
  margin: 0;
  flex: 1;
}
.dot {
  width: 11px;
  height: 11px;
  border-radius: 50%;
  background: #556;
}
.dot.idle {
  background: #35c46a;
}
.dot.syncing {
  background: #f0b429;
}
.dot.error {
  background: #e5484d;
}
.dot.offline {
  background: #5b6472;
}
.panel {
  background: #121722;
  border: 1px solid #1e2430;
  border-radius: 12px;
  padding: 0.9rem 1.1rem;
  margin-bottom: 1rem;
}
.panel h2 {
  margin: 0 0 0.6rem;
  font-size: 0.95rem;
  color: #aeb8cc;
}
.row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
  margin-bottom: 0.4rem;
}
.pill,
.ghost {
  font: inherit;
  cursor: pointer;
  border-radius: 999px;
  padding: 0.3rem 0.8rem;
  border: 1px solid #2b3242;
  background: #1a212e;
  color: #cdd6e6;
}
.pill.active {
  background: #2a68d8;
  border-color: #2a68d8;
  color: white;
}
.ghost {
  border-radius: 8px;
  border-style: dashed;
}
.ghost:disabled {
  opacity: 0.4;
  cursor: default;
}
input {
  font: inherit;
  background: #0f131b;
  color: #e7ecf5;
  border: 1px solid #2b3242;
  border-radius: 8px;
  padding: 0.35rem 0.55rem;
}
input.grow {
  flex: 1;
  min-width: 12rem;
}
.token {
  background: #0f131b;
  border: 1px solid #2b3242;
  border-radius: 6px;
  padding: 0.2rem 0.45rem;
  font-size: 0.78rem;
  max-width: 18rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.muted {
  color: #6b7488;
  font-size: 0.85rem;
}
.center {
  text-align: center;
  padding: 2rem;
}
.error {
  color: #f4a6b4;
  background: #2a1520;
  border: 1px solid #5a2b3b;
  border-radius: 8px;
  padding: 0.5rem 0.75rem;
  font-size: 0.85rem;
}
.surfaces {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 1rem;
}
</style>
