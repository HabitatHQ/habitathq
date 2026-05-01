<script setup lang="ts">
import type { TemplateExerciseWithName } from '~/composables/useTemplates'
import { estimateTemplateDuration } from '~/lib/template-stats'
import type { TemplateRow } from '~/types/database'

const route = useRoute()
const workout = useWorkout()
const {
  getById,
  getExercises,
  deleteTemplate,
  cloneTemplate,
  pinTemplate,
  unpinTemplate,
  archiveTemplate,
  markUsed,
} = useTemplates()
const db = useDatabase()

const templateId = computed(() => route.params.id as string)

const template = ref<TemplateRow | null>(null)
const exercises = ref<TemplateExerciseWithName[]>([])
const loading = ref(true)
const showDeleteConfirm = ref(false)
const starting = ref(false)
const deleting = ref(false)
const showPreview = ref(false)
const expandedExercises = ref<Set<string>>(new Set())

// Inline edit
const editingName = ref(false)
const inlineName = ref('')

watch(
  db.status,
  async (s) => {
    if (s !== 'ready') return
    loading.value = true
    try {
      template.value = await getById(templateId.value)
      exercises.value = await getExercises(templateId.value)
    } finally {
      loading.value = false
    }
  },
  { immediate: true },
)

async function handleStart() {
  showPreview.value = true
}

async function handleStartConfirm(_opts: { scaleFactor: number; excludedIds: string[] }) {
  showPreview.value = false
  starting.value = true
  try {
    await markUsed(templateId.value)
    await workout.startWorkout(templateId.value)
    await navigateTo('/workout')
  } finally {
    starting.value = false
  }
}

async function handleDelete() {
  deleting.value = true
  try {
    await deleteTemplate(templateId.value)
    await navigateTo('/templates')
  } finally {
    deleting.value = false
  }
}

async function handleClone() {
  const newId = await cloneTemplate(templateId.value)
  await navigateTo(`/templates/${newId}`)
}

async function handlePin() {
  if (!template.value) return
  if (template.value.pinned_at) {
    await unpinTemplate(templateId.value)
  } else {
    await pinTemplate(templateId.value)
  }
  template.value = await getById(templateId.value)
}

async function handleArchive() {
  await archiveTemplate(templateId.value)
  await navigateTo('/templates')
}

function startInlineEdit() {
  if (!template.value) return
  inlineName.value = template.value.name
  editingName.value = true
}

async function commitInlineEdit() {
  if (!template.value || !inlineName.value.trim()) {
    editingName.value = false
    return
  }
  const { update } = useTemplates()
  await update(templateId.value, { name: inlineName.value.trim() })
  template.value = await getById(templateId.value)
  editingName.value = false
}

function toggleExerciseExpand(id: string) {
  if (expandedExercises.value.has(id)) {
    expandedExercises.value.delete(id)
  } else {
    expandedExercises.value.add(id)
  }
}

function restLabel(te: TemplateExerciseWithName): string {
  if (te.set_rest_seconds) return 'Variable rest'
  const s = te.rest_seconds
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${s % 60 > 0 ? `${s % 60}s` : ''}`.trim()
}

const estimatedDuration = computed(() => {
  const totalSets = exercises.value.reduce((a, e) => a + (e.sets_planned ?? 3), 0)
  return estimateTemplateDuration(exercises.value.length, totalSets, 120)
})

function formatDur(secs: number): string {
  const m = Math.round(secs / 60)
  return `~${m} min`
}

function relativeDate(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const days = Math.floor(diff / 86_400_000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days}d ago`
  if (days < 30) return `${Math.floor(days / 7)}w ago`
  return `${Math.floor(days / 30)}mo ago`
}
</script>

<template>
  <div>
    <article class="p-4 pb-32 space-y-5">
      <header class="flex items-center gap-3 pt-2">
        <NuxtLink to="/templates" class="text-(--ui-text-muted)" aria-label="Back to templates">
          <UIcon name="i-heroicons-arrow-left" class="w-6 h-6" aria-hidden="true" />
        </NuxtLink>

        <!-- Inline name editing -->
        <div class="flex-1 min-w-0">
          <template v-if="editingName">
            <input
              v-model="inlineName"
              class="text-xl font-bold w-full bg-transparent border-b-2 border-(--color-accent) outline-none"
              autofocus
              @blur="commitInlineEdit"
              @keydown.enter="commitInlineEdit"
              @keydown.escape="editingName = false"
            />
          </template>
          <template v-else>
            <div class="flex items-center gap-2">
              <button
                class="text-xl font-bold truncate text-left hover:opacity-80"
                :aria-label="`Edit name: ${template?.name ?? 'Template'}`"
                @click="startInlineEdit"
              >
                <span v-if="template?.cover_emoji" class="mr-1">{{ template.cover_emoji }}</span>
                {{ template?.name ?? 'Template' }}
              </button>
              <span v-if="template?.pinned_at" class="text-amber-400 shrink-0">
                <UIcon name="i-heroicons-star-solid" class="w-4 h-4" aria-label="Pinned" />
              </span>
            </div>
          </template>
        </div>

        <!-- Action buttons -->
        <div class="flex items-center gap-1 shrink-0">
          <button
            class="w-8 h-8 flex items-center justify-center rounded-lg text-(--ui-text-muted) hover:text-amber-400"
            :aria-label="template?.pinned_at ? 'Unpin' : 'Pin'"
            @click="handlePin"
          >
            <UIcon :name="template?.pinned_at ? 'i-heroicons-star-solid' : 'i-heroicons-star'" class="w-4 h-4" aria-hidden="true" />
          </button>
          <NuxtLink
            :to="`/templates/${templateId}/edit`"
            class="w-8 h-8 flex items-center justify-center rounded-lg text-(--ui-text-muted) hover:text-(--ui-text)"
            aria-label="Edit template"
          >
            <UIcon name="i-heroicons-pencil" class="w-4 h-4" aria-hidden="true" />
          </NuxtLink>
          <button
            class="w-8 h-8 flex items-center justify-center rounded-lg text-(--ui-text-muted) hover:text-(--ui-text)"
            aria-label="Clone template"
            @click="handleClone"
          >
            <UIcon name="i-heroicons-document-duplicate" class="w-4 h-4" aria-hidden="true" />
          </button>
          <NuxtLink
            :to="`/templates/${templateId}/export`"
            class="w-8 h-8 flex items-center justify-center rounded-lg text-(--ui-text-muted) hover:text-(--ui-text)"
            aria-label="Export template"
          >
            <UIcon name="i-heroicons-arrow-up-tray" class="w-4 h-4" aria-hidden="true" />
          </NuxtLink>
        </div>
      </header>

      <div v-if="loading" class="text-center py-12 text-(--ui-text-muted)">
        <p>Loading…</p>
      </div>

      <template v-else-if="template">
        <!-- Stats strip -->
        <div class="flex items-center gap-4 text-xs text-(--ui-text-muted) flex-wrap">
          <span v-if="template.use_count > 0">{{ template.use_count }}× used</span>
          <span v-if="template.last_used_at">Last: {{ relativeDate(template.last_used_at) }}</span>
          <span>{{ formatDur(estimatedDuration) }}</span>
        </div>

        <p v-if="template.description" class="text-sm text-(--ui-text-muted)">
          {{ template.description }}
        </p>

        <section aria-labelledby="tpl-exercises-heading">
          <h2
            id="tpl-exercises-heading"
            class="text-xs font-semibold uppercase tracking-wider text-(--ui-text-muted) mb-3"
          >
            {{ exercises.length }} Exercise{{ exercises.length !== 1 ? 's' : '' }}
          </h2>

          <ul v-if="exercises.length > 0" role="list" class="space-y-2">
            <li
              v-for="te in exercises"
              :key="te.id"
              class="rounded-xl bg-(--color-surface) overflow-hidden"
            >
              <!-- Main row -->
              <button
                class="w-full text-left px-4 py-3 flex items-center gap-3"
                :aria-expanded="expandedExercises.has(te.id)"
                @click="toggleExerciseExpand(te.id)"
              >
                <ExerciseAvatar :icon="te.exercise_icon" :movement="(te.exercise_movement as any)" />
                <div class="flex-1 min-w-0">
                  <p class="text-sm font-medium">{{ te.exercise_name }}</p>
                  <div class="flex items-center gap-2 mt-0.5">
                    <span class="text-xs text-(--ui-text-muted)">
                      {{ te.sets_planned }} × {{ te.reps_planned }}
                    </span>
                    <span v-if="te.superset_group" class="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-(--color-accent)/15 text-(--color-accent)">
                      {{ te.superset_group }}
                    </span>
                    <span v-if="te.failure_target" class="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-orange-500/15 text-orange-400">
                      Failure
                    </span>
                    <span v-if="te.tempo" class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-500/15 text-zinc-400">
                      {{ te.tempo }}
                    </span>
                    <span v-if="te.unilateral" class="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-400">
                      ×2
                    </span>
                  </div>
                </div>
                <UIcon
                  :name="expandedExercises.has(te.id) ? 'i-heroicons-chevron-up' : 'i-heroicons-chevron-down'"
                  class="w-4 h-4 text-(--ui-text-muted) shrink-0"
                  aria-hidden="true"
                />
              </button>

              <!-- Expanded details -->
              <div
                v-if="expandedExercises.has(te.id)"
                class="px-4 pb-3 space-y-2 border-t border-(--ui-border)/50"
              >
                <dl class="grid grid-cols-2 gap-x-4 gap-y-1 text-xs mt-2">
                  <div>
                    <dt class="text-(--ui-text-muted)">Rest</dt>
                    <dd>{{ restLabel(te) }}</dd>
                  </div>
                  <div v-if="te.rpe_target">
                    <dt class="text-(--ui-text-muted)">RPE target</dt>
                    <dd>@{{ te.rpe_target }}</dd>
                  </div>
                  <div v-if="te.resistance_note">
                    <dt class="text-(--ui-text-muted)">Resistance</dt>
                    <dd>{{ te.resistance_note }}</dd>
                  </div>
                </dl>
                <p v-if="te.notes" class="text-xs italic text-(--ui-text-muted)">{{ te.notes }}</p>
              </div>
            </li>
          </ul>

          <div v-else class="rounded-xl bg-(--color-surface) p-6 text-center text-(--ui-text-muted) text-sm">
            No exercises in this template.
          </div>
        </section>

        <!-- Delete / Archive -->
        <div class="space-y-2">
          <div
            v-if="showDeleteConfirm"
            class="rounded-xl bg-(--color-surface) border border-red-500/30 p-4 space-y-3"
          >
            <p class="text-sm text-red-400 font-medium">Delete "{{ template.name }}"?</p>
            <p class="text-xs text-(--ui-text-muted)">This cannot be undone.</p>
            <div class="flex gap-3">
              <UButton variant="ghost" color="neutral" size="sm" class="flex-1" @click="showDeleteConfirm = false">
                Cancel
              </UButton>
              <UButton color="error" size="sm" class="flex-1" :loading="deleting" @click="handleDelete">
                Delete
              </UButton>
            </div>
          </div>

          <div v-if="!showDeleteConfirm" class="flex items-center gap-3">
            <button
              class="text-xs text-(--ui-text-muted) hover:text-amber-400 transition-colors"
              @click="handleArchive"
            >
              Archive
            </button>
            <span class="text-(--ui-text-muted)" aria-hidden="true">·</span>
            <button
              class="text-xs text-red-400/70 hover:text-red-400 transition-colors"
              @click="showDeleteConfirm = true"
            >
              Delete template
            </button>
          </div>
        </div>
      </template>

      <div v-else class="text-center py-12 text-(--ui-text-muted)">
        <p>Template not found.</p>
      </div>
    </article>

    <!-- Sticky start button -->
    <div
      v-if="template && !loading"
      class="fixed bottom-0 left-0 right-0 safe-area-bottom bg-(--ui-bg)/95 backdrop-blur border-t border-(--ui-border) p-4 z-40"
    >
      <UButton
        color="primary"
        size="lg"
        class="w-full"
        :loading="starting"
        @click="handleStart"
      >
        <UIcon name="i-heroicons-bolt" class="w-5 h-5" aria-hidden="true" />
        Start Workout
      </UButton>
    </div>

    <!-- Preview sheet -->
    <WorkoutTemplatePreviewSheet
      v-if="template && exercises.length > 0"
      :open="showPreview"
      :template="template"
      :exercises="exercises"
      @close="showPreview = false"
      @start="handleStartConfirm"
    />
  </div>
</template>
