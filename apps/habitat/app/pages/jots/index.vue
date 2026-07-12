<script setup lang="ts">
import type { ImageNote, JotItem, VoiceNote } from '~/composables/useJotsStore'
import type { Scribble } from '~/types/database'
import { toLocalDateKey } from '~/utils/format'
import type { JotSection } from '~/utils/jots-helpers'
import { groupJotsByDate, groupJotsByTags } from '~/utils/jots-helpers'

const router = useRouter()
const { settings: appSettings } = useAppSettings()
const { selectionChanged } = useHaptics()
const store = useJotsStore()
const { timeline, todoByJotId, todos } = store
const db = useDatabase()

// ─── Recently bookmarked ──────────────────────────────────────────────────────

const recentShared = ref<Scribble[]>([])
const dismissedIds = ref<Set<string>>(new Set())

const visibleBookmarks = computed(() =>
  recentShared.value.filter((s) => !dismissedIds.value.has(s.id)),
)

async function loadRecentShared() {
  recentShared.value = await db.getRecentSharedScribbles(7)
}

function dismissBookmark(id: string) {
  dismissedIds.value = new Set([...dismissedIds.value, id])
}

function getBookmarkIcon(scribble: Scribble): string {
  if (scribble.tags.some((t) => t === 'shared/url')) return 'link'
  if (scribble.tags.some((t) => t === 'shared/image')) return 'photo'
  return 'document-text'
}

// ─── View mode ────────────────────────────────────────────────────────────────

const gridView = ref(false)

// ─── Search, filter & categorization ─────────────────────────────────────────

interface JotsFilterDefaults {
  types: Array<'text' | 'voice' | 'image'>
  categorizeBy: 'created' | 'tags'
}

const JOTS_FILTER_KEY = 'jots-filter-defaults'
const JOTS_HARDCODED: JotsFilterDefaults = {
  types: ['text', 'voice', 'image'],
  categorizeBy: 'created',
}

function readJotsDefaults(): JotsFilterDefaults {
  try {
    const raw = localStorage.getItem(JOTS_FILTER_KEY)
    if (!raw) return { ...JOTS_HARDCODED }
    return { ...JOTS_HARDCODED, ...JSON.parse(raw) } as JotsFilterDefaults
  } catch {
    return { ...JOTS_HARDCODED }
  }
}

const savedDefaults = ref(readJotsDefaults())

const searchQuery = ref('')
const searchExpanded = ref(false)
const typeFilter = ref(new Set<'text' | 'voice' | 'image'>(savedDefaults.value.types))
const categorizeBy = ref<'created' | 'tags'>(savedDefaults.value.categorizeBy)
const showFilterPopover = ref(false)

function toggleType(kind: 'text' | 'voice' | 'image') {
  const next = new Set(typeFilter.value)
  if (next.has(kind) && next.size > 1) next.delete(kind)
  else next.add(kind)
  typeFilter.value = next
  void selectionChanged()
}

const activeFilterCount = computed(() => {
  let count = 0
  const dTypes = new Set(savedDefaults.value.types)
  for (const k of ['text', 'voice', 'image'] as const) {
    if (typeFilter.value.has(k) !== dTypes.has(k)) count++
  }
  if (categorizeBy.value !== savedDefaults.value.categorizeBy) count++
  return count
})

const canMakeDefault = computed(() => activeFilterCount.value > 0)

function makeDefaultView() {
  const defaults: JotsFilterDefaults = {
    types: [...typeFilter.value],
    categorizeBy: categorizeBy.value,
  }
  localStorage.setItem(JOTS_FILTER_KEY, JSON.stringify(defaults))
  savedDefaults.value = defaults
  void selectionChanged()
}

const isFiltered = computed(() => searchQuery.value.trim() !== '' || activeFilterCount.value > 0)

const filteredJots = computed((): JotItem[] => {
  let list = timeline.value

  list = list.filter((item) => typeFilter.value.has(item.kind))

  const q = searchQuery.value.trim().toLowerCase()
  if (q) {
    list = list.filter((item) => {
      if (item.kind === 'text') {
        return (
          item.data.title.toLowerCase().includes(q) ||
          item.data.content.toLowerCase().includes(q) ||
          item.data.tags.some((t) => t.toLowerCase().includes(q))
        )
      }
      if (item.kind === 'image') {
        return (item.data as ImageNote).filename.toLowerCase().includes(q)
      }
      if (item.kind === 'voice') {
        const title = (item.data as VoiceNote).title
        return title ? title.toLowerCase().includes(q) : false
      }
      return false
    })
  }

  return list
})

const groupedJots = computed((): JotSection[] => {
  if (categorizeBy.value === 'tags') return groupJotsByTags(filteredJots.value)
  return groupJotsByDate(filteredJots.value)
})

function resetFilters() {
  typeFilter.value = new Set(savedDefaults.value.types)
  categorizeBy.value = savedDefaults.value.categorizeBy
  void selectionChanged()
}

// ─── Linked TODOs ─────────────────────────────────────────────────────────────

function hasLinkedTodo(jotId: string): boolean {
  return todoByJotId.value.has(jotId)
}

function onJotLinkClick(item: JotItem) {
  const todo = todoByJotId.value.get(item.data.id)
  if (todo) {
    router.push({ path: '/todos', query: { highlight: todo.id } })
  } else {
    openCreateTodo(item)
  }
}

// ─── Create TODO from jot ─────────────────────────────────────────────────────

const today = toLocalDateKey()

const showCreateTodoModal = ref(false)
const createTodoForJot = ref<JotItem | null>(null)
const createTodoTitle = ref('')
const createTodoDate = ref('')
const creatingTodo = ref(false)

function jotDisplayTitle(item: JotItem): string {
  if (item.kind === 'text') {
    return item.data.title || item.data.content.slice(0, 50) || 'Untitled jot'
  }
  if (item.kind === 'voice') {
    return (item.data as VoiceNote).title || `Voice note — ${item.data.created_at.slice(0, 10)}`
  }
  return (item.data as ImageNote).filename
}

function openCreateTodo(item: JotItem) {
  createTodoForJot.value = item
  createTodoTitle.value = `Revisit: ${jotDisplayTitle(item)}`
  createTodoDate.value = today
  showCreateTodoModal.value = true
}

async function saveCreateTodo() {
  if (!createTodoForJot.value || !createTodoTitle.value.trim() || creatingTodo.value) return
  creatingTodo.value = true
  try {
    const jot = createTodoForJot.value
    const created = await store.db.createTodo({
      title: createTodoTitle.value.trim(),
      description: '',
      due_date: createTodoDate.value || null,
      priority: 'medium',
      estimated_minutes: null,
      is_recurring: false,
      recurrence_rule: null,
      show_in_bored: false,
      bored_category_id: null,
      tags: [],
      annotations: {
        linked_jot_id: jot.data.id,
        linked_jot_kind: jot.kind,
        linked_jot_title: jotDisplayTitle(jot),
      },
    })
    todos.value.push(created)
    showCreateTodoModal.value = false
  } finally {
    creatingTodo.value = false
  }
}

// ─── Voice playback ───────────────────────────────────────────────────────────

const currentlyPlaying = ref<string | null>(null)
const audioMap = new Map<string, HTMLAudioElement>()

function togglePlay(note: VoiceNote) {
  if (!note.url) return
  if (currentlyPlaying.value && currentlyPlaying.value !== note.id) {
    audioMap.get(currentlyPlaying.value)?.pause()
    currentlyPlaying.value = null
  }
  let audio = audioMap.get(note.id)
  if (!audio) {
    audio = new Audio(note.url)
    audio.onended = () => {
      currentlyPlaying.value = null
    }
    audioMap.set(note.id, audio)
  }
  if (currentlyPlaying.value === note.id) {
    audio.pause()
    currentlyPlaying.value = null
  } else {
    audio.play()
    currentlyPlaying.value = note.id
  }
}

async function handleDeleteVoice(note: VoiceNote) {
  const audio = audioMap.get(note.id)
  if (audio) {
    audio.pause()
    audioMap.delete(note.id)
  }
  if (currentlyPlaying.value === note.id) currentlyPlaying.value = null
  await store.deleteVoiceNote(note)
}

// ─── Bottom sheet modals ──────────────────────────────────────────────────────

const showPickSheet = ref(false)
const showRecordSheet = ref(false)
const showCaptureSheet = ref(false)

function onRingSelect(type: 'text' | 'voice' | 'image') {
  showPickSheet.value = false
  if (type === 'text') navigateTo('/jots/new')
  else if (type === 'voice') showRecordSheet.value = true
  else showCaptureSheet.value = true
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

onMounted(async () => {
  gridView.value = localStorage.getItem('jots-view') === 'grid'
  await store.loadAll()
  await loadRecentShared()
})

watch(gridView, (v) => localStorage.setItem('jots-view', v ? 'grid' : 'list'))

onUnmounted(() => {
  for (const a of audioMap.values()) a.pause()
})
</script>

<template>
  <div class="space-y-5">

    <header class="flex items-center justify-between">
      <h2 class="text-2xl font-bold">Jots</h2>
      <div class="flex items-center gap-1.5">
        <UButton
          v-if="timeline.length > 0"
          :icon="resolveIcon(gridView ? 'list-bullet' : 'squares-2x2')"
          size="sm"
          color="neutral"
          variant="ghost"
          :aria-label="gridView ? 'Switch to list view' : 'Switch to grid view'"
          @click="gridView = !gridView"
        />
        <UButton :icon="resolveIcon('plus')" size="sm" @click="showPickSheet = true">New</UButton>
      </div>
    </header>

    <!-- Toolbar: search + filter -->
    <div v-if="timeline.length > 0" class="flex items-center gap-2">
      <!-- Search -->
      <button
        v-if="!searchExpanded"
        class="w-10 h-10 rounded-full flex items-center justify-center text-(--ui-text-muted) hover:text-(--ui-text) hover:bg-(--ui-bg-elevated) transition-colors"
        aria-label="Search jots"
        @click="searchExpanded = true"
      >
        <AppIcon name="magnifying-glass" class="w-5 h-5" />
      </button>
      <div
        v-else
        class="flex items-center gap-2 flex-1 min-w-0 px-3 h-10 rounded-full
               bg-(--ui-bg-elevated) border border-(--ui-border-accented)
               focus-within:ring-2 focus-within:ring-primary-500/40 transition-shadow"
      >
        <AppIcon name="magnifying-glass" class="w-4 h-4 text-(--ui-text-dimmed) shrink-0" />
        <input
          v-model="searchQuery"
          autofocus
          placeholder="Search jots…"
          class="flex-1 min-w-0 bg-transparent text-(--ui-text) placeholder:text-(--ui-text-dimmed) outline-none border-0 type-input"
          @blur="searchQuery || (searchExpanded = false)"
          @keydown.escape="searchQuery = ''; searchExpanded = false"
        />
        <button
          class="w-5 h-5 rounded-full flex items-center justify-center text-(--ui-text-dimmed) hover:text-(--ui-text)"
          aria-label="Clear search"
          @click="searchQuery = ''; searchExpanded = false"
        >
          <AppIcon name="x-mark" class="w-4 h-4" />
        </button>
      </div>

      <div class="flex-1" />

      <button
        v-if="canMakeDefault"
        class="text-[11px] text-primary-400 hover:text-primary-300 whitespace-nowrap min-h-[44px] px-1"
        @click="makeDefaultView"
      >Make default</button>

      <!-- Filter -->
      <div class="relative">
        <button
          class="w-10 h-10 rounded-full flex items-center justify-center transition-colors relative"
          :class="showFilterPopover || activeFilterCount > 0
            ? 'bg-(--ui-bg-elevated) text-(--ui-text)'
            : 'text-(--ui-text-muted) hover:text-(--ui-text) hover:bg-(--ui-bg-elevated)'"
          aria-label="Filter and categorize"
          @click="showFilterPopover = !showFilterPopover"
        >
          <AppIcon name="adjustments-horizontal" class="w-5 h-5" />
          <span
            v-if="activeFilterCount > 0"
            class="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-primary-600 text-[10px] text-white flex items-center justify-center font-bold"
          >{{ activeFilterCount }}</span>
        </button>

        <!-- Filter popover -->
        <div v-if="showFilterPopover" class="fixed inset-0 z-40" @click="showFilterPopover = false" />
        <div
          v-if="showFilterPopover"
          class="absolute right-0 top-full mt-1 z-50 w-72 bg-(--ui-bg) border border-(--ui-border) rounded-xl shadow-xl p-3 space-y-3.5"
        >
          <!-- Type -->
          <div>
            <p class="text-[10px] font-semibold uppercase tracking-wider text-(--ui-text-dimmed) mb-1.5">Type</p>
            <div class="flex gap-1.5">
              <button
                class="flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors text-center"
                :class="typeFilter.has('text') ? 'bg-amber-500/20 text-amber-400 ring-1 ring-amber-500/40' : 'bg-(--ui-bg-elevated) text-(--ui-text-muted) hover:text-(--ui-text-toned)'"
                @click="toggleType('text')"
              >Scribble</button>
              <button
                class="flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors text-center"
                :class="typeFilter.has('image') ? 'bg-sky-500/20 text-sky-400 ring-1 ring-sky-500/40' : 'bg-(--ui-bg-elevated) text-(--ui-text-muted) hover:text-(--ui-text-toned)'"
                @click="toggleType('image')"
              >Photograph</button>
              <button
                class="flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors text-center"
                :class="typeFilter.has('voice') ? 'bg-rose-500/20 text-rose-400 ring-1 ring-rose-500/40' : 'bg-(--ui-bg-elevated) text-(--ui-text-muted) hover:text-(--ui-text-toned)'"
                @click="toggleType('voice')"
              >Voice</button>
            </div>
          </div>

          <!-- Categorize by -->
          <div>
            <p class="text-[10px] font-semibold uppercase tracking-wider text-(--ui-text-dimmed) mb-1.5">Categorize by</p>
            <div class="flex gap-1.5">
              <button
                class="flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors text-center"
                :class="categorizeBy === 'created' ? 'bg-primary-600 text-white' : 'bg-(--ui-bg-elevated) text-(--ui-text-muted) hover:text-(--ui-text-toned)'"
                @click="categorizeBy = 'created'; selectionChanged()"
              >Created on</button>
              <button
                class="flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors text-center"
                :class="categorizeBy === 'tags' ? 'bg-primary-600 text-white' : 'bg-(--ui-bg-elevated) text-(--ui-text-muted) hover:text-(--ui-text-toned)'"
                @click="categorizeBy = 'tags'; selectionChanged()"
              >Tags</button>
            </div>
          </div>

          <!-- Reset -->
          <button
            v-if="activeFilterCount > 0"
            class="w-full text-[11px] text-(--ui-text-dimmed) hover:text-(--ui-text-muted) pt-1 border-t border-(--ui-border)/50"
            @click="resetFilters"
          >Reset all filters</button>
        </div>
      </div>
    </div>

    <!-- Recently bookmarked -->
    <section v-if="visibleBookmarks.length > 0" class="space-y-2">
      <h3 class="text-xs font-semibold uppercase tracking-wider text-(--ui-text-dimmed)">Recently bookmarked</h3>
      <div class="flex gap-2.5 overflow-x-auto pb-2 -mx-1 px-1 scrollbar-none">
        <div
          v-for="item in visibleBookmarks"
          :key="item.id"
          class="flex-shrink-0 w-56 p-3 rounded-xl bg-(--ui-bg-muted) border border-(--ui-border) cursor-pointer active:opacity-70 transition-opacity"
          @click="navigateTo(`/jots/edit-${item.id}`)"
        >
          <div class="flex items-start gap-2">
            <div class="w-6 h-6 rounded-full bg-primary-500/10 flex items-center justify-center mt-0.5 shrink-0">
              <AppIcon :name="getBookmarkIcon(item)" class="w-3.5 h-3.5 text-primary-400" />
            </div>
            <div class="flex-1 min-w-0">
              <p class="text-xs font-medium text-(--ui-text) line-clamp-2 leading-snug">{{ item.title || item.content.slice(0, 50) || 'Untitled' }}</p>
              <p class="text-[10px] text-(--ui-text-dimmed) mt-1">{{ timeAgo(item.created_at) }}</p>
            </div>
            <button
              class="shrink-0 p-1 rounded-lg text-(--ui-text-dimmed) hover:text-(--ui-text) min-h-[44px] min-w-[44px] flex items-center justify-center -mr-1 -mt-1"
              aria-label="Dismiss from recently bookmarked"
              @click.stop="dismissBookmark(item.id)"
            >
              <AppIcon name="x-mark" class="w-3.5 h-3.5" />
            </button>
          </div>
          <p
            v-if="item.annotations['source_url']"
            class="text-[10px] text-primary-400/70 mt-1.5 truncate"
          >{{ item.annotations['source_url'] }}</p>
        </div>
      </div>
    </section>

    <!-- Empty state — full ring inline (no jots at all) -->
    <section
      v-if="timeline.length === 0"
      class="flex flex-col items-center justify-center py-8 gap-4"
    >
      <p class="text-sm text-(--ui-text-dimmed)">No jots yet. Add your first note, voice memo, or photo.</p>
      <JotsRing @select="onRingSelect" />
    </section>

    <!-- Filtered empty state -->
    <section
      v-else-if="filteredJots.length === 0 && isFiltered"
      class="flex flex-col items-center justify-center py-12 gap-2"
    >
      <AppIcon name="magnifying-glass" class="w-8 h-8 text-(--ui-text-dimmed)" />
      <p class="text-sm text-(--ui-text-dimmed)">No matching jots</p>
      <button
        class="text-xs text-primary-400 hover:text-primary-300"
        @click="searchQuery = ''; searchExpanded = false; resetFilters()"
      >Clear filters</button>
    </section>

    <!-- ── Sectioned content ──────────────────────────────────────────── -->
    <template v-else>
      <div v-for="section in groupedJots" :key="section.label" class="space-y-2">
        <h3 class="text-xs font-semibold uppercase tracking-wider text-(--ui-text-dimmed) mt-4 first:mt-0">{{ section.label }}</h3>

        <!-- ── List view ─────────────────────────────────────────────── -->
        <ul v-if="!gridView" class="space-y-2">
          <template v-for="item in section.items" :key="item.kind + '-' + item.data.id">

            <!-- Text jot -->
            <li
              v-if="item.kind === 'text'"
              class="p-3 rounded-xl bg-(--ui-bg-muted) border border-(--ui-border) active:opacity-70 transition-opacity cursor-pointer"
              @click="navigateTo(`/jots/edit-${item.data.id}`)"
            >
              <div class="flex items-start gap-2.5">
                <div class="w-6 h-6 rounded-full bg-amber-500/10 flex items-center justify-center mt-0.5 shrink-0">
                  <AppIcon name="pencil" class="w-4 h-4 text-amber-400" />
                </div>
                <div class="flex-1 min-w-0">
                  <div class="flex items-start justify-between gap-2">
                    <p
                      class="text-sm text-(--ui-text) leading-snug"
                      :class="{ 'font-medium': item.data.title }"
                    >{{ previewTitle(item.data) }}</p>
                    <span class="text-[11px] text-slate-600 shrink-0 mt-0.5">{{ timeAgo(item.data.updated_at) }}</span>
                  </div>
                  <p v-if="previewBody(item.data)" class="text-xs text-(--ui-text-dimmed) mt-0.5 line-clamp-2">{{ previewBody(item.data) }}</p>
                  <div v-if="item.data.tags?.length > 0" class="flex flex-wrap gap-1 mt-2">
                    <span
                      v-for="tag in (item.data.tags || []).slice(0, 5)"
                      :key="tag"
                      class="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px]
                             text-(--ui-text-muted) bg-(--ui-bg-elevated) border border-(--ui-border-accented)"
                    >
                      <span v-if="splitTag(tag).parent" class="text-slate-600">{{ splitTag(tag).parent }}/</span>
                      <span>{{ splitTag(tag).leaf }}</span>
                    </span>
                    <span v-if="item.data.tags?.length > 5" class="text-[10px] text-slate-600 self-center pl-0.5">+{{ (item.data.tags?.length || 0) - 5 }}</span>
                  </div>
                </div>
                <button
                  class="shrink-0 self-start mt-0.5 p-1 rounded-lg transition-colors"
                  :class="hasLinkedTodo(item.data.id) ? 'text-primary-400' : 'text-slate-600 hover:text-primary-400'"
                  :aria-label="hasLinkedTodo(item.data.id) ? 'View linked TODO' : 'Create TODO for this jot'"
                  @click.stop="onJotLinkClick(item)"
                >
                  <AppIcon :name="hasLinkedTodo(item.data.id) ? 'paper-clip' : 'link'" class="w-4 h-4" />
                </button>
              </div>
            </li>

            <!-- Voice jot -->
            <li
              v-else-if="item.kind === 'voice'"
              class="p-3 rounded-xl bg-(--ui-bg-muted) border border-(--ui-border)"
            >
              <div class="flex items-center gap-3">
                <div class="w-6 h-6 rounded-full bg-rose-500/10 flex items-center justify-center shrink-0">
                  <AppIcon name="microphone" class="w-4 h-4 text-rose-400" />
                </div>
                <UButton
                  :icon="resolveIcon(currentlyPlaying === item.data.id ? 'pause' : 'play')"
                  :color="currentlyPlaying === item.data.id ? 'primary' : 'neutral'"
                  :variant="currentlyPlaying === item.data.id ? 'soft' : 'outline'"
                  size="sm"
                  :aria-label="currentlyPlaying === item.data.id ? 'Pause voice note' : 'Play voice note'"
                  class="min-h-[44px] min-w-[44px]"
                  :ui="{ base: 'rounded-full' }"
                  @click="togglePlay(item.data as VoiceNote)"
                />
                <div class="flex-1 min-w-0">
                  <p v-if="(item.data as VoiceNote).title" class="text-sm font-medium text-(--ui-text) truncate">{{ (item.data as VoiceNote).title }}</p>
                  <p class="text-sm text-(--ui-text-toned) truncate">{{ fmtDate(item.data.created_at, appSettings.use24HourTime) }}</p>
                  <p class="text-xs type-duration text-(--ui-text-dimmed)">{{ fmtDuration((item.data as VoiceNote).duration) }}</p>
                </div>
                <UButton
                  :icon="resolveIcon(hasLinkedTodo(item.data.id) ? 'paper-clip' : 'link')"
                  color="neutral"
                  variant="ghost"
                  size="sm"
                  :aria-label="hasLinkedTodo(item.data.id) ? 'Linked to todo' : 'Link to todo'"
                  class="min-h-[44px] min-w-[44px]"
                  :class="hasLinkedTodo(item.data.id) ? 'text-primary-400' : 'text-slate-600 hover:text-primary-400'"
                  @click="onJotLinkClick(item)"
                />
                <UButton
                  :icon="resolveIcon('trash')"
                  color="neutral"
                  variant="ghost"
                  size="sm"
                  aria-label="Delete voice note"
                  class="min-h-[44px] min-w-[44px] text-slate-600 hover:text-red-400"
                  @click="handleDeleteVoice(item.data as VoiceNote)"
                />
              </div>
            </li>

            <!-- Image jot -->
            <li
              v-else-if="item.kind === 'image'"
              class="p-3 rounded-xl bg-(--ui-bg-muted) border border-(--ui-border)"
            >
              <div class="flex items-center gap-3">
                <div class="w-6 h-6 rounded-full bg-sky-500/10 flex items-center justify-center shrink-0">
                  <AppIcon name="photo" class="w-4 h-4 text-sky-400" />
                </div>
                <img
                  v-if="(item.data as ImageNote).url"
                  :src="(item.data as ImageNote).url"
                  :alt="(item.data as ImageNote).filename"
                  class="w-16 h-16 object-cover rounded-lg shrink-0"
                />
                <div class="flex-1 min-w-0">
                  <p class="text-sm text-(--ui-text-toned) truncate">{{ (item.data as ImageNote).filename }}</p>
                  <p class="text-xs text-(--ui-text-dimmed)">{{ fmtDate(item.data.created_at, appSettings.use24HourTime) }}</p>
                </div>
                <UButton
                  :icon="resolveIcon(hasLinkedTodo(item.data.id) ? 'paper-clip' : 'link')"
                  color="neutral"
                  variant="ghost"
                  size="sm"
                  :aria-label="hasLinkedTodo(item.data.id) ? 'Linked to todo' : 'Link to todo'"
                  class="min-h-[44px] min-w-[44px]"
                  :class="hasLinkedTodo(item.data.id) ? 'text-primary-400' : 'text-slate-600 hover:text-primary-400'"
                  @click="onJotLinkClick(item)"
                />
                <UButton
                  :icon="resolveIcon('trash')"
                  color="neutral"
                  variant="ghost"
                  size="sm"
                  aria-label="Delete image note"
                  class="min-h-[44px] min-w-[44px] text-slate-600 hover:text-red-400"
                  @click="store.deleteImageNote(item.data as ImageNote)"
                />
              </div>
            </li>

          </template>
        </ul>

        <!-- ── Grid view ─────────────────────────────────────────────── -->
        <ul v-else class="jots-masonry stagger-list">
          <template v-for="item in section.items" :key="item.kind + '-' + item.data.id">

            <!-- Text tile -->
            <li
              v-if="item.kind === 'text'"
              class="rounded-2xl bg-(--ui-bg-muted) border border-(--ui-border) overflow-hidden cursor-pointer active:scale-[0.97] transition-transform"
              @click="navigateTo(`/jots/edit-${item.data.id}`)"
            >
              <div class="flex">
                <div class="w-[3px] shrink-0 rounded-l-2xl bg-gradient-to-b from-amber-500/80 to-amber-600/30" />
                <div class="p-3 flex flex-col gap-2 min-w-0 flex-1">
                  <p
                    class="text-sm text-(--ui-text) leading-snug line-clamp-2"
                    :class="{ 'font-semibold': item.data.title }"
                  >{{ previewTitle(item.data) }}</p>
                  <p v-if="gridBody(item.data)" class="text-xs text-(--ui-text-dimmed) line-clamp-6 leading-relaxed">{{ gridBody(item.data) }}</p>
                  <div class="flex items-end justify-between gap-1 mt-auto pt-1">
                    <div class="flex flex-wrap gap-1 min-w-0">
                      <span
                        v-for="tag in (item.data.tags || []).slice(0, 2)"
                        :key="tag"
                        class="px-1.5 py-0.5 rounded-full text-[9px] bg-(--ui-bg-elevated) text-(--ui-text-dimmed) border border-(--ui-border-accented)/60 truncate max-w-[72px]"
                      >{{ splitTag(tag).leaf }}</span>
                      <span v-if="item.data.tags?.length > 2" class="text-[9px] text-slate-600 self-center">+{{ (item.data.tags?.length || 0) - 2 }}</span>
                    </div>
                    <div class="flex items-center gap-0.5 shrink-0">
                      <button
                        class="p-0.5 rounded transition-colors"
                        :class="hasLinkedTodo(item.data.id) ? 'text-primary-400' : 'text-slate-600 hover:text-primary-400'"
                        @click.stop="onJotLinkClick(item)"
                      >
                        <AppIcon :name="hasLinkedTodo(item.data.id) ? 'paper-clip' : 'link'" class="w-3 h-3" />
                      </button>
                      <span class="text-[10px] text-slate-600">{{ timeAgo(item.data.updated_at) }}</span>
                    </div>
                  </div>
                </div>
              </div>
            </li>

            <!-- Voice tile -->
            <li
              v-else-if="item.kind === 'voice'"
              class="rounded-2xl bg-(--ui-bg-muted) border border-(--ui-border) overflow-hidden"
            >
              <div class="h-0.5 bg-gradient-to-r from-rose-500/70 to-rose-600/30" />
              <div class="p-3 flex flex-col items-center gap-2.5 text-center">
                <div class="w-12 h-12 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center mt-1">
                  <AppIcon name="microphone" class="w-6 h-6 text-rose-400" />
                </div>
                <div>
                  <p v-if="(item.data as VoiceNote).title" class="text-sm font-medium text-(--ui-text) line-clamp-2 mb-0.5">{{ (item.data as VoiceNote).title }}</p>
                  <p class="text-sm type-duration font-medium text-(--ui-text-toned)">{{ fmtDuration((item.data as VoiceNote).duration) }}</p>
                  <p class="text-[10px] text-slate-600 mt-0.5">{{ timeAgo(item.data.created_at) }}</p>
                </div>
                <UButton
                  :icon="resolveIcon(currentlyPlaying === item.data.id ? 'pause' : 'play')"
                  :color="currentlyPlaying === item.data.id ? 'primary' : 'neutral'"
                  :variant="currentlyPlaying === item.data.id ? 'soft' : 'outline'"
                  size="xs"
                  :aria-label="currentlyPlaying === item.data.id ? 'Pause voice note' : 'Play voice note'"
                  class="min-h-[44px] min-w-[44px]"
                  :ui="{ base: 'rounded-full' }"
                  @click.stop="togglePlay(item.data as VoiceNote)"
                />
                <div class="flex items-center gap-0.5 pb-1">
                  <UButton
                    :icon="resolveIcon(hasLinkedTodo(item.data.id) ? 'paper-clip' : 'link')"
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    :aria-label="hasLinkedTodo(item.data.id) ? 'Linked to todo' : 'Link to todo'"
                    class="min-h-[44px] min-w-[44px]"
                    :class="hasLinkedTodo(item.data.id) ? 'text-primary-400' : 'text-slate-600 hover:text-primary-400'"
                    @click.stop="onJotLinkClick(item)"
                  />
                  <UButton
                    :icon="resolveIcon('trash')"
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    aria-label="Delete voice note"
                    class="min-h-[44px] min-w-[44px] text-slate-600 hover:text-red-400"
                    @click.stop="handleDeleteVoice(item.data as VoiceNote)"
                  />
                </div>
              </div>
            </li>

            <!-- Image tile -->
            <li
              v-else-if="item.kind === 'image'"
              class="rounded-2xl bg-(--ui-bg-muted) border border-(--ui-border) overflow-hidden"
            >
              <img
                v-if="(item.data as ImageNote).url"
                :src="(item.data as ImageNote).url"
                :alt="(item.data as ImageNote).filename"
                class="w-full object-cover rounded-t-2xl"
              />
              <div v-else class="w-full aspect-[4/3] bg-(--ui-bg-elevated) flex items-center justify-center rounded-t-2xl">
                <AppIcon name="photo" class="w-8 h-8 text-slate-600" />
              </div>
              <div class="px-2.5 py-2 flex items-center justify-between gap-1">
                <div class="min-w-0">
                  <p class="text-[11px] text-(--ui-text-muted) truncate leading-tight">{{ (item.data as ImageNote).filename }}</p>
                  <p class="text-[10px] text-slate-600 mt-0.5">{{ timeAgo(item.data.created_at) }}</p>
                </div>
                <div class="flex items-center gap-0.5 shrink-0">
                  <button
                    type="button"
                    class="icon-btn text-(--ui-text-muted)"
                    :class="hasLinkedTodo(item.data.id) ? 'text-primary-400' : 'text-slate-600 hover:text-primary-400'"
                    :aria-label="hasLinkedTodo(item.data.id) ? 'Linked to todo' : 'Link to todo'"
                    @click="onJotLinkClick(item)"
                  >
                    <AppIcon :name="hasLinkedTodo(item.data.id) ? 'paper-clip' : 'link'" class="w-4 h-4" />
                  </button>
                  <UButton
                    :icon="resolveIcon('trash')"
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    aria-label="Delete image note"
                    class="min-h-[44px] min-w-[44px] text-slate-600 hover:text-red-400 shrink-0"
                    @click="store.deleteImageNote(item.data as ImageNote)"
                  />
                </div>
              </div>
            </li>

          </template>
        </ul>
      </div>
    </template>

    <!-- ── Create TODO from jot modal ────────────────────────────────────── -->
    <AppModal v-model="showCreateTodoModal" title="Create TODO">
      <p class="text-xs text-(--ui-text-dimmed) -mt-2">A TODO will be created and linked to this jot.</p>
      <div class="space-y-3">
        <UFormField label="Title" required>
          <AppTextField v-model="createTodoTitle" placeholder="Revisit: …" class="w-full" />
        </UFormField>
        <UFormField label="Due date">
          <AppTextField v-model="createTodoDate" type="date" class="w-full" />
        </UFormField>
      </div>
      <template #footer>
        <div class="flex gap-2">
          <UButton variant="soft" color="neutral" class="flex-1" @click="showCreateTodoModal = false">Cancel</UButton>
          <UButton
            color="primary"
            class="flex-1"
            :loading="creatingTodo"
            :disabled="!createTodoTitle.trim()"
            @click="saveCreateTodo"
          >Create</UButton>
        </div>
      </template>
    </AppModal>

    <!-- ── Bottom Sheets ─────────────────────────────────────────────────── -->

    <!-- Picker Sheet -->
    <USlideover
      v-model:open="showPickSheet"
      side="bottom"
      class="z-50"
      :ui="{
        content: 'w-full h-[400px] rounded-t-3xl bg-(--ui-bg) border-t border-(--ui-border) overflow-hidden flex flex-col'
      }"
    >
      <template #content>
        <div class="h-full overflow-y-auto p-5 space-y-5">
          <div class="flex items-center justify-between">
            <h3 class="text-base font-semibold">New Jot</h3>
            <AppIconButton icon="x-mark" label="Close" @click="showPickSheet = false" />
          </div>
          <div class="flex flex-col items-center justify-center pt-8">
            <JotsRing class="hidden sm:flex" @select="onRingSelect" />
            <JotsRing compact class="flex sm:hidden w-full" @select="onRingSelect" />
          </div>
        </div>
      </template>
    </USlideover>

    <!-- Record Sheet -->
    <USlideover
      v-model:open="showRecordSheet"
      side="bottom"
      class="z-50"
      :ui="{
        content: 'w-full min-h-[50vh] rounded-t-3xl bg-(--ui-bg) border-t border-(--ui-border) overflow-hidden flex flex-col'
      }"
    >
      <template #content>
        <JotsRecordSheet class="p-5 overflow-y-auto" @close="showRecordSheet = false" />
      </template>
    </USlideover>

    <!-- Capture Sheet -->
    <USlideover
      v-model:open="showCaptureSheet"
      side="bottom"
      class="z-50"
      :ui="{
        content: 'w-full min-h-[60vh] rounded-t-3xl bg-(--ui-bg) border-t border-(--ui-border) overflow-hidden flex flex-col'
      }"
    >
      <template #content>
        <JotsCaptureSheet class="p-5 overflow-y-auto" @close="showCaptureSheet = false" />
      </template>
    </USlideover>

  </div>
</template>

<style scoped>
/* Masonry layout only — item entrance uses the shared `stagger-list` preset
   (see @habitathq/shared animations.css), applied via the class on the <ul>. */
.jots-masonry {
  columns: 2;
  column-gap: 10px;
  list-style: none;
  padding: 0;
  margin: 0;
}
.jots-masonry > li {
  break-inside: avoid;
  margin-bottom: 10px;
  display: inline-block;
  width: 100%;
}
</style>
