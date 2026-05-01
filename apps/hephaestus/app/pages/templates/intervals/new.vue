<script setup lang="ts">
import { buildEmom, buildTabata } from '~/lib/interval-templates'

const db = useDatabase()

type Mode = 'tabata' | 'emom' | 'amrap' | 'custom'

const mode = ref<Mode>('custom')
const name = ref('')
const rounds = ref(8)
const workSec = ref(20)
const restSec = ref(10)
const timeCapSec = ref(300)
const saving = ref(false)

watch(mode, (m) => {
  if (m === 'tabata') {
    const t = buildTabata()
    name.value = name.value || t.name
    rounds.value = t.rounds
    workSec.value = t.work_sec
    restSec.value = t.rest_sec
  } else if (m === 'emom') {
    const e = buildEmom(10)
    name.value = name.value || e.name
    rounds.value = e.rounds
    workSec.value = 60
    restSec.value = 0
  } else if (m === 'amrap') {
    name.value = name.value || 'AMRAP 5min'
  }
})

const totalTimeSec = computed(() => {
  if (mode.value === 'amrap') return timeCapSec.value
  return rounds.value * (workSec.value + restSec.value)
})

function formatTime(s: number): string {
  const m = Math.floor(s / 60)
  const sec = s % 60
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`
}

const canSave = computed(() => name.value.trim().length > 0)

async function handleSave() {
  if (!canSave.value) return
  saving.value = true
  try {
    const id = crypto.randomUUID()
    const now = new Date().toISOString()
    await db.exec(
      'INSERT INTO interval_templates (id, name, intervals, created_at, type, work_sec, rest_sec, rounds) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [
        id,
        name.value.trim(),
        '[]',
        now,
        mode.value,
        mode.value !== 'amrap' ? workSec.value : null,
        mode.value !== 'amrap' ? restSec.value : null,
        mode.value !== 'amrap' ? rounds.value : null,
      ],
    )
    await navigateTo('/templates/intervals')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <article class="p-4 pb-24 space-y-5">
    <header class="flex items-center gap-3 pt-2">
      <NuxtLink to="/templates/intervals" class="text-(--ui-text-muted)" aria-label="Back">
        <UIcon name="i-heroicons-arrow-left" class="w-6 h-6" aria-hidden="true" />
      </NuxtLink>
      <h1 class="text-xl font-bold flex-1">New Interval</h1>
      <UButton size="sm" color="primary" :disabled="!canSave || saving" :loading="saving" @click="handleSave">
        Save
      </UButton>
    </header>

    <!-- Mode selector -->
    <div class="grid grid-cols-4 gap-1.5 p-1 bg-(--color-surface) rounded-xl">
      <button
        v-for="m in (['custom', 'tabata', 'emom', 'amrap'] as const)"
        :key="m"
        class="py-1.5 text-xs font-semibold rounded-lg transition-colors capitalize"
        :class="mode === m ? 'bg-(--color-accent) text-white' : 'text-(--ui-text-muted)'"
        @click="mode = m"
      >
        {{ m }}
      </button>
    </div>

    <!-- Name -->
    <div class="space-y-1">
      <label class="text-xs font-medium text-(--ui-text-muted) uppercase tracking-wider" for="int-name">Name</label>
      <input
        id="int-name"
        v-model="name"
        type="text"
        :placeholder="mode === 'tabata' ? 'Tabata' : mode === 'emom' ? 'EMOM 10' : mode === 'amrap' ? 'AMRAP 5min' : 'My Interval'"
        class="w-full bg-(--color-surface) rounded-xl px-3 py-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-(--color-accent)"
      />
    </div>

    <!-- AMRAP: time cap -->
    <template v-if="mode === 'amrap'">
      <div class="space-y-1">
        <label class="text-xs font-medium text-(--ui-text-muted) uppercase tracking-wider" for="int-cap">
          Time Cap (seconds)
        </label>
        <input
          id="int-cap"
          v-model.number="timeCapSec"
          type="number"
          min="60"
          step="60"
          class="w-full bg-(--color-surface) rounded-xl px-3 py-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-(--color-accent)"
        />
      </div>
    </template>

    <!-- Non-AMRAP config -->
    <template v-else>
      <div class="grid grid-cols-3 gap-3">
        <div class="space-y-1">
          <label class="text-xs text-(--ui-text-muted)" for="int-rounds">Rounds</label>
          <input
            id="int-rounds"
            v-model.number="rounds"
            type="number"
            min="1"
            :disabled="mode === 'tabata'"
            class="w-full text-center text-sm font-bold bg-(--color-surface) rounded-xl py-2.5 outline-none focus-visible:ring-2 focus-visible:ring-(--color-accent) disabled:opacity-50"
          />
        </div>
        <div class="space-y-1">
          <label class="text-xs text-(--ui-text-muted)" for="int-work">Work (s)</label>
          <input
            id="int-work"
            v-model.number="workSec"
            type="number"
            min="1"
            :disabled="mode === 'tabata' || mode === 'emom'"
            class="w-full text-center text-sm font-bold bg-(--color-surface) rounded-xl py-2.5 outline-none focus-visible:ring-2 focus-visible:ring-(--color-accent) disabled:opacity-50"
          />
        </div>
        <div class="space-y-1">
          <label class="text-xs text-(--ui-text-muted)" for="int-rest">Rest (s)</label>
          <input
            id="int-rest"
            v-model.number="restSec"
            type="number"
            min="0"
            :disabled="mode === 'tabata' || mode === 'emom'"
            class="w-full text-center text-sm font-bold bg-(--color-surface) rounded-xl py-2.5 outline-none focus-visible:ring-2 focus-visible:ring-(--color-accent) disabled:opacity-50"
          />
        </div>
      </div>
    </template>

    <!-- Total duration preview -->
    <div class="rounded-xl bg-(--color-surface) p-4 text-center">
      <p class="text-xs text-(--ui-text-muted)">Total Duration</p>
      <p class="text-2xl font-bold text-(--color-accent) mt-1">{{ formatTime(totalTimeSec) }}</p>
    </div>
  </article>
</template>
