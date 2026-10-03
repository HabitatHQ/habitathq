<script setup lang="ts">
import { toRaw } from 'vue'
import type { ProgramRow } from '~/types/database'
import type { ProgramDesign, ProgramRevision } from '~/types/prescription'

const route = useRoute()
const programId = computed(() => String(route.params['id'] ?? ''))
const db = useDatabase()
const programs = usePrograms()
const templates = useTemplates()
const templateRows = templates.templates
const program = ref<ProgramRow | null>(null)
const revision = ref<ProgramRevision | null>(null)
const draft = ref<ProgramDesign | null>(null)
const name = ref('')
const description = ref('')
const selectedWeek = ref(1)
const selectedDay = ref(1)
const selectedTemplate = ref('')
const slotLabel = ref('')
const error = ref('')
const busy = ref(false)
const week = computed(() =>
  draft.value?.weekProgression.find((item) => item.week === selectedWeek.value),
)
const slots = computed(
  () => draft.value?.slots.filter((item) => item.week === selectedWeek.value) ?? [],
)
const templateName = (id: string | null) =>
  templateRows.value.find((item) => item.id === id)?.name ?? 'Unassigned template'

async function load() {
  busy.value = true
  try {
    await templates.load()
    program.value = (await programs.load()).find((item) => item.id === programId.value) ?? null
    if (!program.value) throw new Error('Program not found')
    revision.value = await db.domain('PROGRAM_GET_REVISION', { programId: programId.value })
    draft.value = structuredClone(toRaw(revision.value.design))
    name.value = program.value.name
    description.value = program.value.description ?? ''
    error.value = ''
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    busy.value = false
  }
}
watch(
  db.status,
  (status) => {
    if (status === 'ready') void load()
  },
  { immediate: true },
)

async function addSlot() {
  if (!draft.value || !week.value) return
  busy.value = true
  try {
    const source = selectedTemplate.value
      ? await templates.getRevision(selectedTemplate.value)
      : null
    draft.value.slots.push({
      id: crypto.randomUUID(),
      templateId: source?.templateId ?? null,
      templateRevisionId: source?.id ?? null,
      assignmentResolved: source !== null,
      week: selectedWeek.value,
      day: selectedDay.value,
      label: slotLabel.value.trim() || null,
      progression: { ...week.value.progression },
    })
    slotLabel.value = ''
    error.value = ''
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    busy.value = false
  }
}
async function save() {
  if (!draft.value || !revision.value) return
  busy.value = true
  try {
    const design = structuredClone(toRaw(draft.value))
    for (const slot of design.slots) {
      const progression = design.weekProgression.find((item) => item.week === slot.week)
      const previous = revision.value.design.weekProgression.find((item) => item.week === slot.week)
      if (
        progression &&
        JSON.stringify(progression.progression) !== JSON.stringify(previous?.progression)
      )
        slot.progression = { ...progression.progression }
    }
    await db.domain('PROGRAM_EDIT', {
      programId: programId.value,
      expectedRevisionId: revision.value.id,
      name: name.value,
      description: description.value.trim() || null,
      design,
    })
    await load()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <article class="space-y-5 p-4 pb-24">
    <header class="flex items-center justify-between gap-3">
      <NuxtLink to="/templates/programs">Back</NuxtLink>
      <h1 class="text-xl font-semibold">Reusable Program</h1>
      <UButton :loading="busy" :disabled="!draft" @click="save">Save revision</UButton>
    </header>
    <p v-if="error" role="alert" class="text-sm text-red-400">{{ error }} <button type="button" class="underline min-h-11" @click="load">Reload saved revision</button></p>
    <template v-if="draft && revision">
      <p class="text-sm text-(--ui-text-muted)">Design revision {{ revision.revisionNumber }}. Personal plans keep their adopted revision until reviewed. This design never contains personal working loads.</p>
      <label class="block">Name<input v-model="name" required class="mt-1 min-h-11 w-full rounded bg-(--color-surface) p-2" /></label>
      <label class="block">Description<textarea v-model="description" class="mt-1 w-full rounded bg-(--color-surface) p-2" /></label>
      <UButton to="/plans" variant="outline">Follow in a personal Training Plan</UButton>
      <label class="block">Design week<select v-model.number="selectedWeek" class="mt-1 min-h-11 w-full rounded bg-(--color-surface) p-2"><option v-for="number in draft.weeks" :key="number" :value="number">Week {{ number }}</option></select></label>
      <section v-if="week" class="space-y-3 rounded-xl bg-(--color-surface) p-4">
        <h2 class="font-semibold">Week {{ selectedWeek }} progression intent</h2>
        <p class="text-xs text-(--ui-text-muted)">Suggestions only. Adopting this design does not silently recalculate saved routines. Accept changes through their configuration or workout review.</p>
        <label class="block">Suggested load multiplier<input v-model.number="week.progression.intensityModifier" type="number" min="0" step="any" class="mt-1 min-h-11 w-full rounded bg-(--color-bg) p-2" /></label>
        <label class="block">Suggested set-count multiplier<input v-model.number="week.progression.volumeModifier" type="number" min="0" step="any" class="mt-1 min-h-11 w-full rounded bg-(--color-bg) p-2" /></label>
        <label class="flex min-h-11 items-center gap-2"><input v-model="week.progression.isDeload" type="checkbox" /> Deload</label>
        <label class="block">Phase<select v-model="week.progression.phase" class="mt-1 min-h-11 w-full rounded bg-(--color-bg) p-2"><option :value="null">No phase</option><option value="accumulation">Accumulation</option><option value="intensification">Intensification</option><option value="deload">Deload</option><option value="peak">Peak</option></select></label>
      </section>
      <section class="space-y-3">
        <h2 class="font-semibold">Template-based slots</h2>
        <p class="text-xs text-(--ui-text-muted)">Day 1 is the first local date of each seven-date program week. A Wednesday-start plan enters week two the next Wednesday. Several slots can share a day.</p>
        <ul class="space-y-2"><li v-for="slot in slots" :key="slot.id" class="flex items-center justify-between gap-3 rounded-xl bg-(--color-surface) p-3"><div><p>Day {{ slot.day }} · {{ slot.label || templateName(slot.templateId) }}</p><p class="text-xs text-(--ui-text-muted)">{{ templateName(slot.templateId) }} · {{ slot.assignmentResolved ? 'Template revision captured' : 'Needs template assignment' }}</p></div><UButton variant="ghost" :aria-label="`Remove slot ${slot.label || templateName(slot.templateId)} on day ${slot.day}`" @click="draft.slots = draft.slots.filter(item => item.id !== slot.id)">Remove</UButton></li></ul>
        <label class="block">Day in program week<select v-model.number="selectedDay" class="mt-1 min-h-11 w-full rounded bg-(--color-surface) p-2"><option v-for="day in 7" :key="day" :value="day">Day {{ day }}</option></select></label>
        <label class="block">Template<select v-model="selectedTemplate" class="mt-1 min-h-11 w-full rounded bg-(--color-surface) p-2"><option value="">Leave unresolved</option><option v-for="template in templateRows" :key="template.id" :value="template.id">{{ template.name }}</option></select></label>
        <label class="block">Slot label<input v-model="slotLabel" class="mt-1 min-h-11 w-full rounded bg-(--color-surface) p-2" /></label>
        <UButton :loading="busy" variant="outline" @click="addSlot">Add template slot</UButton>
      </section>
    </template>
  </article>
</template>
