<script setup lang="ts">
import type { ExercisePreview } from '~/composables/useTemplates'
import { filterTemplates, sortTemplates } from '~/lib/template-sort'
import type { TemplateSortOrder } from '~/types/database'

const db = useDatabase()
const {
  templates,
  loading,
  load,
  getExerciseCounts,
  getExercisePreviews,
  archiveTemplate,
  pinTemplate,
  unpinTemplate,
  cloneTemplate,
} = useTemplates()

const exerciseCounts = ref<Record<string, number>>({})
const exercisePreviews = ref<Record<string, ExercisePreview[]>>({})

const searchQuery = ref('')
const sortOrder = ref<TemplateSortOrder>('pinned_first')
const showArchived = ref(false)
const showSearch = ref(false)
const undoTemplate = ref<{ id: string; name: string } | null>(null)
let undoTimer: ReturnType<typeof setTimeout> | null = null

// Import sheet
const showImport = ref(false)

async function loadData() {
  await load({ includeArchived: showArchived.value })
  if (templates.value.length > 0) {
    ;[exerciseCounts.value, exercisePreviews.value] = await Promise.all([
      getExerciseCounts(),
      getExercisePreviews(),
    ])
  }
}

watch(
  db.status,
  async (s) => {
    if (s === 'ready') await loadData()
  },
  { immediate: true },
)
watch(showArchived, () => loadData())
watch(templates, async () => {
  if (db.status.value === 'ready') {
    ;[exerciseCounts.value, exercisePreviews.value] = await Promise.all([
      getExerciseCounts(),
      getExercisePreviews(),
    ])
  }
})

const filteredTemplates = computed(() => {
  let result = filterTemplates([...templates.value], searchQuery.value)
  return sortTemplates(result, sortOrder.value)
})

function relativeDate(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const days = Math.floor(diff / 86_400_000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days}d ago`
  if (days < 30) return `${Math.floor(days / 7)}w ago`
  if (days < 365) return `${Math.floor(days / 30)}mo ago`
  return `${Math.floor(days / 365)}y ago`
}

async function handleArchive(id: string, name: string) {
  await archiveTemplate(id)
  undoTemplate.value = { id, name }
  if (undoTimer) clearTimeout(undoTimer)
  undoTimer = setTimeout(() => {
    undoTemplate.value = null
  }, 5000)
}

async function handleUndo() {
  if (!undoTemplate.value) return
  if (undoTimer) clearTimeout(undoTimer)
  const { unarchiveTemplate } = useTemplates()
  await unarchiveTemplate(undoTemplate.value.id)
  await loadData()
  undoTemplate.value = null
}

async function handleClone(id: string) {
  await cloneTemplate(id)
}

async function handlePin(id: string, pinned: boolean) {
  if (pinned) await unpinTemplate(id)
  else await pinTemplate(id)
}

const sortOptions: Array<{ value: TemplateSortOrder; label: string }> = [
  { value: 'pinned_first', label: 'Pinned first' },
  { value: 'recent', label: 'Date created' },
  { value: 'last_used', label: 'Last used' },
  { value: 'most_used', label: 'Most used' },
  { value: 'name', label: 'Name A–Z' },
]
</script>

<template>
  <article class="p-4 space-y-4">
    <header class="flex items-center justify-between pt-2">
      <h1 class="text-2xl font-bold">Templates</h1>
      <div class="flex items-center gap-2">
        <button
          class="w-8 h-8 flex items-center justify-center rounded-lg text-(--ui-text-muted) hover:text-(--ui-text)"
          :aria-label="showSearch ? 'Close search' : 'Search templates'"
          @click="showSearch = !showSearch; if (!showSearch) searchQuery = ''"
        >
          <UIcon :name="showSearch ? 'i-heroicons-x-mark' : 'i-heroicons-magnifying-glass'" class="w-5 h-5" aria-hidden="true" />
        </button>
        <button
          class="w-8 h-8 flex items-center justify-center rounded-lg text-(--ui-text-muted) hover:text-(--ui-text)"
          aria-label="Import template"
          @click="showImport = true"
        >
          <UIcon name="i-heroicons-arrow-down-tray" class="w-5 h-5" aria-hidden="true" />
        </button>
        <UButton size="sm" color="primary" to="/templates/new">
          <UIcon name="i-heroicons-plus" class="w-4 h-4" aria-hidden="true" />
          New
        </UButton>
      </div>
    </header>

    <!-- Search bar -->
    <div v-if="showSearch">
      <input
        v-model="searchQuery"
        type="search"
        placeholder="Search templates…"
        class="w-full bg-(--color-surface) rounded-xl px-3 py-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-(--color-accent)"
        autofocus
        aria-label="Search templates"
      />
    </div>

    <!-- Toolbar: sort + options -->
    <div class="flex items-center gap-2 overflow-x-auto pb-1">
      <select
        v-model="sortOrder"
        class="text-xs bg-(--color-surface) rounded-lg px-2.5 py-1.5 outline-none focus-visible:ring-1 focus-visible:ring-(--color-accent) shrink-0"
        aria-label="Sort templates"
      >
        <option v-for="opt in sortOptions" :key="opt.value" :value="opt.value">
          {{ opt.label }}
        </option>
      </select>

      <button
        class="text-xs px-2.5 py-1.5 rounded-lg shrink-0 transition-colors"
        :class="showArchived ? 'bg-(--color-accent)/20 text-(--color-accent)' : 'bg-(--color-surface) text-(--ui-text-muted)'"
        :aria-pressed="showArchived"
        @click="showArchived = !showArchived"
      >
        {{ showArchived ? 'Hide archived' : 'Archived' }}
      </button>

      <!-- Quick nav links -->
      <NuxtLink
        to="/templates/folders"
        class="text-xs bg-(--color-surface) text-(--ui-text-muted) px-2.5 py-1.5 rounded-lg shrink-0 hover:text-(--ui-text)"
      >
        Folders
      </NuxtLink>
      <NuxtLink
        to="/templates/programs"
        class="text-xs bg-(--color-surface) text-(--ui-text-muted) px-2.5 py-1.5 rounded-lg shrink-0 hover:text-(--ui-text)"
      >
        Programs
      </NuxtLink>
      <NuxtLink
        to="/templates/intervals"
        class="text-xs bg-(--color-surface) text-(--ui-text-muted) px-2.5 py-1.5 rounded-lg shrink-0 hover:text-(--ui-text)"
      >
        Intervals
      </NuxtLink>
    </div>

    <!-- Undo toast -->
    <Transition name="slide-down">
      <div
        v-if="undoTemplate"
        class="rounded-xl bg-zinc-800 border border-zinc-700 px-4 py-3 flex items-center justify-between gap-3"
        role="status"
        aria-live="polite"
      >
        <p class="text-sm text-white">"{{ undoTemplate.name }}" archived</p>
        <button class="text-xs font-semibold text-(--color-accent)" @click="handleUndo">Undo</button>
      </div>
    </Transition>

    <!-- Loading skeletons -->
    <div v-if="loading" class="space-y-2">
      <div v-for="i in 3" :key="i" class="rounded-xl bg-(--color-surface) h-16 animate-pulse" />
    </div>

    <div
      v-else-if="filteredTemplates.length === 0"
      class="rounded-xl bg-(--color-surface) p-10 text-center space-y-3"
    >
      <UIcon name="i-heroicons-clipboard-document-list" class="w-10 h-10 text-(--ui-text-muted) mx-auto" aria-hidden="true" />
      <div>
        <p class="font-medium text-sm">{{ searchQuery ? `No results for "${searchQuery}"` : 'No templates yet' }}</p>
        <p class="text-xs text-(--ui-text-muted) mt-1">
          {{ searchQuery ? 'Try a different search.' : 'Save a workout structure to reuse it later' }}
        </p>
      </div>
      <UButton v-if="!searchQuery" class="mt-2" to="/templates/new" color="primary" size="sm">
        Create Template
      </UButton>
    </div>

    <ul v-else role="list" class="space-y-2">
      <li v-for="t in filteredTemplates" :key="t.id">
        <div class="block rounded-xl bg-(--color-surface) hover:bg-(--color-surface-2) transition-colors">
          <NuxtLink :to="`/templates/${t.id}`" class="flex items-start gap-3 px-4 py-3.5">
            <!-- Emoji or avatar preview -->
            <div class="shrink-0 pt-0.5">
              <div
                v-if="t.cover_emoji"
                class="w-9 h-9 rounded-xl bg-(--color-surface-2) flex items-center justify-center text-xl"
              >
                {{ t.cover_emoji }}
              </div>
              <div v-else-if="exercisePreviews[t.id]?.length" class="flex -space-x-1.5">
                <ExerciseAvatar
                  v-for="(p, pi) in (exercisePreviews[t.id] ?? [])"
                  :key="pi"
                  :icon="p.icon"
                  :movement="p.movement"
                  size="w-7 h-7"
                  class="ring-2 ring-(--color-surface)"
                />
              </div>
              <div v-else class="w-7 h-7 rounded-full bg-(--color-surface-2) flex items-center justify-center" aria-hidden="true">
                <UIcon name="i-heroicons-clipboard-document-list" class="w-3.5 h-3.5 text-(--ui-text-muted)" />
              </div>
            </div>

            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-1.5">
                <p class="font-semibold text-sm leading-snug truncate">{{ t.name }}</p>
                <span v-if="t.pinned_at" class="text-amber-400 shrink-0" aria-label="Pinned">
                  <UIcon name="i-heroicons-star-solid" class="w-3 h-3" />
                </span>
                <span
                  v-if="t.archived_at"
                  class="text-[10px] px-1.5 py-0.5 rounded bg-zinc-500/15 text-zinc-400 shrink-0"
                >
                  Archived
                </span>
              </div>
              <p class="text-xs text-(--ui-text-muted) mt-0.5">
                {{ exerciseCounts[t.id] ?? 0 }}
                exercise{{ (exerciseCounts[t.id] ?? 0) !== 1 ? 's' : '' }}
                <span v-if="t.use_count > 0"> · {{ t.use_count }}× used</span>
                <span v-if="t.description"> · {{ t.description }}</span>
              </p>
            </div>

            <div class="flex items-center gap-1.5 shrink-0">
              <span class="text-[10px] text-(--ui-text-muted)">{{ relativeDate(t.created_at) }}</span>
              <UIcon name="i-heroicons-chevron-right" class="w-4 h-4 text-(--ui-text-muted)" aria-hidden="true" />
            </div>
          </NuxtLink>

          <!-- Quick actions -->
          <div class="flex items-center gap-1 px-4 pb-2 -mt-1">
            <button
              class="text-[10px] text-(--ui-text-muted) hover:text-amber-400 transition-colors flex items-center gap-0.5"
              :aria-label="t.pinned_at ? `Unpin ${t.name}` : `Pin ${t.name}`"
              @click.prevent="handlePin(t.id, !!t.pinned_at)"
            >
              <UIcon :name="t.pinned_at ? 'i-heroicons-star-solid' : 'i-heroicons-star'" class="w-3 h-3" aria-hidden="true" />
              {{ t.pinned_at ? 'Pinned' : 'Pin' }}
            </button>
            <span class="text-(--ui-text-muted)" aria-hidden="true">·</span>
            <button
              class="text-[10px] text-(--ui-text-muted) hover:text-(--ui-text) transition-colors"
              :aria-label="`Clone ${t.name}`"
              @click.prevent="handleClone(t.id)"
            >
              Clone
            </button>
            <span class="text-(--ui-text-muted)" aria-hidden="true">·</span>
            <button
              class="text-[10px] text-(--ui-text-muted) hover:text-red-400 transition-colors"
              :aria-label="`Archive ${t.name}`"
              @click.prevent="handleArchive(t.id, t.name)"
            >
              Archive
            </button>
          </div>
        </div>
      </li>
    </ul>
  </article>

  <!-- Import sheet -->
  <WorkoutTemplateImportSheet
    :open="showImport"
    @close="showImport = false"
    @import="showImport = false"
  />
</template>

<style scoped>
.slide-down-enter-active,
.slide-down-leave-active {
  transition: all 0.2s ease;
}
.slide-down-enter-from,
.slide-down-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
</style>
