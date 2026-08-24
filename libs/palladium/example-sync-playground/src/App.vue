<script setup lang="ts">
import { markRaw, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { createDevice, type Device, newId } from "./client.js";
import DeviceCard from "./DeviceCard.vue";

/** Preset tenant tokens. Same token = same workspace; different = isolated. */
const TOKENS = ["team-alpha", "team-beta"];
const DEFAULT_SERVER = "http://localhost:3000";

interface Seat {
  id: number;
  label: string;
  token: string;
  /** Bumped on every (re)creation so the card remounts and rebinds. */
  gen: number;
  device: Device | null;
}

// Single-device mode: `?single` (or `?device`) renders exactly ONE device, so
// you can run one device per browser window / per port. Label defaults to the
// port (e.g. ":5174"); workspace + server are overridable via query params.
//   http://localhost:5174/?single&label=Phone&workspace=team-beta
const params = new URLSearchParams(location.search);
const single = params.has("single") || params.has("device");
const initialServer = params.get("server") ?? DEFAULT_SERVER;
const initialWorkspace = params.get("workspace") ?? TOKENS[0];
const portLabel = location.port ? `:${location.port}` : "device";

const serverUrl = ref(initialServer);
const serverUp = ref<boolean | null>(null);
const seats = reactive<Seat[]>(
  single
    ? [
        {
          id: 1,
          label: params.get("label") ?? portLabel,
          token: initialWorkspace,
          gen: 0,
          device: null,
        },
      ]
    : [
        { id: 1, label: "Laptop", token: TOKENS[0], gen: 0, device: null },
        { id: 2, label: "Phone", token: TOKENS[0], gen: 0, device: null },
      ],
);
let nextId = seats.length + 1;

/** (Re)create the device backing a seat, tearing down any previous one. */
async function mountSeat(seat: Seat): Promise<void> {
  const prev = seat.device;
  seat.device = null;
  if (prev) await prev.transport.stop().catch(() => {});
  seat.gen += 1;
  // markRaw: the engine/transport are class instances with private fields and
  // internal timers. Letting Vue deep-proxy them corrupts rendering (their
  // `#private` access throws through the proxy). We still want reactivity on the
  // `null → device` reference swap, which assigning into the reactive seat gives us.
  const device = await createDevice({
    nodeId: newId(),
    serverUrl: serverUrl.value,
    token: seat.token,
  });
  seat.device = markRaw(device);
}

async function changeToken(seat: Seat, token: string): Promise<void> {
  seat.token = token;
  await mountSeat(seat);
}

async function addSeat(): Promise<void> {
  const seat: Seat = {
    id: nextId++,
    label: `Device ${seats.length + 1}`,
    token: TOKENS[0],
    gen: 0,
    device: null,
  };
  seats.push(seat);
  await mountSeat(seat);
}

async function removeSeat(seat: Seat): Promise<void> {
  if (seat.device) await seat.device.transport.stop().catch(() => {});
  const i = seats.indexOf(seat);
  if (i >= 0) seats.splice(i, 1);
}

async function reconnectAll(): Promise<void> {
  await checkServer();
  await Promise.all(seats.map(mountSeat));
}

async function checkServer(): Promise<void> {
  try {
    await fetch(`${serverUrl.value.replace(/\/+$/, "")}/v1/health`, { method: "GET" });
    serverUp.value = true; // any HTTP reply (even 401) means it's reachable
  } catch {
    serverUp.value = false;
  }
}

let healthTimer: ReturnType<typeof setInterval> | undefined;

onMounted(async () => {
  await checkServer();
  await Promise.all(seats.map(mountSeat));
  healthTimer = setInterval(checkServer, 3_000);
});

onBeforeUnmount(async () => {
  if (healthTimer) clearInterval(healthTimer);
  await Promise.all(seats.map((s) => s.device?.transport.stop().catch(() => {})));
});
</script>

<template>
  <div class="page">
    <header class="top">
      <div>
        <h1>Palladium Sync {{ single ? "Device" : "Playground" }}</h1>
        <p v-if="single" class="sub">
          This window is <strong>one device</strong> ({{ seats[0]?.label }}), with its own local
          database, syncing through the <code>palladium dev</code> server. Open this app on another
          port/window to add more devices — they all sync through the same server.
        </p>
        <p v-else class="sub">
          Each card is an independent device with its own local database, all syncing through the
          <code>palladium dev</code> server. Type in one — watch it land in the others.
        </p>
      </div>
      <div class="server">
        <span class="dot" :class="serverUp === null ? 'unknown' : serverUp ? 'up' : 'down'"></span>
        <label>
          server
          <input v-model="serverUrl" spellcheck="false" @change="reconnectAll" />
        </label>
        <button type="button" @click="reconnectAll">reconnect</button>
      </div>
    </header>

    <p v-if="serverUp === false" class="warn">
      Can't reach <code>{{ serverUrl }}</code>. Start it with
      <code>pnpm --filter @palladium/example-sync-playground server</code>
      (or <code>palladium dev --port 3000 --auth bearer</code>), then hit <b>reconnect</b>.
    </p>

    <section class="grid">
      <div v-for="seat in seats" :key="seat.id" class="seat">
        <DeviceCard
          v-if="seat.device"
          :key="seat.id + ':' + seat.gen"
          :device="seat.device"
          :label="seat.label"
          :token="seat.token"
          :tokens="TOKENS"
          @change-token="(t) => changeToken(seat, t)"
        />
        <div v-else class="card connecting">Connecting <strong>{{ seat.label }}</strong>…</div>
        <button
          v-if="seats.length > 1"
          type="button"
          class="remove"
          :aria-label="`Remove ${seat.label}`"
          @click="removeSeat(seat)"
        >
          remove
        </button>
      </div>
      <button v-if="!single" type="button" class="add" @click="addSeat">+ add device</button>
    </section>

    <footer class="legend">
      <h2>Things to try</h2>
      <ul>
        <li><b>Basic sync:</b> add a task on <em>Laptop</em> — it appears on <em>Phone</em>.</li>
        <li>
          <b>Column-level merge:</b> on one device edit a task's <em>text</em> (click it, type); on
          another toggle its <em>checkbox</em> at the same time. Both edits survive.
        </li>
        <li>
          <b>Conflict / LWW:</b> click <em>go offline</em> on both, edit the <b>same</b> task's text
          differently, then <em>go online</em>. Both converge to one winner (last write by clock).
        </li>
        <li>
          <b>Tenant isolation:</b> switch one device's <em>workspace</em> to
          <code>team-beta</code>. It stops seeing <code>team-alpha</code>'s data entirely.
        </li>
      </ul>
    </footer>
  </div>
</template>

<style>
:root {
  color-scheme: dark;
}
body {
  margin: 0;
  background: #0b0e14;
  color: #e7ecf5;
  font-family: system-ui, -apple-system, sans-serif;
}
</style>

<style scoped>
.page {
  max-width: 1100px;
  margin: 0 auto;
  padding: 1.5rem 1.25rem 3rem;
}
.top {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
  flex-wrap: wrap;
  margin-bottom: 1.25rem;
}
h1 {
  margin: 0 0 0.25rem;
  font-size: 1.5rem;
}
.sub {
  margin: 0;
  color: #8b95aa;
  max-width: 60ch;
  font-size: 0.9rem;
}
code {
  background: #181d27;
  padding: 0.05rem 0.3rem;
  border-radius: 4px;
  font-size: 0.85em;
}
.server {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.82rem;
  color: #8b95aa;
}
.server input {
  width: 15rem;
  background: #0f131b;
  color: #e7ecf5;
  border: 1px solid #2b3242;
  border-radius: 6px;
  padding: 0.25rem 0.45rem;
  font: inherit;
}
.server button,
.add,
.remove {
  background: #1d2431;
  color: #cdd6e6;
  border: 1px solid #2b3242;
  border-radius: 6px;
  padding: 0.25rem 0.6rem;
  cursor: pointer;
  font: inherit;
}
.dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex: none;
}
.dot.up {
  background: #35c46a;
}
.dot.down {
  background: #e5484d;
}
.dot.unknown {
  background: #5b6472;
}
.warn {
  background: #2a1c22;
  border: 1px solid #5a2b3b;
  color: #f4a6b4;
  padding: 0.6rem 0.8rem;
  border-radius: 8px;
  font-size: 0.88rem;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 1rem;
  align-items: start;
}
.seat {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}
.remove {
  align-self: flex-end;
  font-size: 0.72rem;
  color: #7d8aa5;
}
.connecting {
  border: 1px dashed #2b3242;
  border-radius: 12px;
  padding: 2rem 1rem;
  text-align: center;
  color: #6b7488;
  background: #10141c;
}
.add {
  border-style: dashed;
  min-height: 90px;
  align-self: stretch;
}
.legend {
  margin-top: 2rem;
  border-top: 1px solid #1e2430;
  padding-top: 1rem;
}
.legend h2 {
  font-size: 1rem;
  margin: 0 0 0.5rem;
}
.legend ul {
  margin: 0;
  padding-left: 1.1rem;
  color: #aeb7c9;
  font-size: 0.9rem;
  line-height: 1.6;
}
.legend em {
  color: #e7ecf5;
  font-style: normal;
  font-weight: 600;
}
</style>
