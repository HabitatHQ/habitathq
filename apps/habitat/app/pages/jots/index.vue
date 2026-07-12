<script setup lang="ts">
import type { ImageNote, JotItem, VoiceNote } from '~/composables/useJotsStore'
import type { Scribble } from '~/types/database'
import { toLocalDateKey } from '~/utils/format'
import type { JotSection } from '~/utils/jots-helpers'
import { groupJotsByDate, groupJotsByTags } from '~/utils/jots-helpers'

const router = useRouter()
const { selectionChanged } = useHaptics()
const store = useJotsStore()
const { timeline, todoByJotId, todos } = store
const staggerListOnce = useFirstVisit('jots-list')
const staggerGridOnce = useFirstVisit('jots-grid')
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

const currentlyPlaying = ref<string | null>(null) // id while actively playing
const activeNoteId = ref<string | null>(null) // id loaded (playing OR paused/scrubbed)
const playbackFraction = ref(0) // 0..1 progress of the active note
const audioMap = new Map<string, HTMLAudioElement>()

// Decorative waveform for voice tiles — deterministic bar heights (20–100%)
// derived from the note id so a given note always renders the same shape.
// Memoized so repeated renders don't recompute the array.
const WAVEFORM_BARS = 32
const waveformCache = new Map<string, number[]>()
function waveformBars(id: string): number[] {
  let bars = waveformCache.get(id)
  if (bars) return bars
  let seed = 2166136261
  for (let i = 0; i < id.length; i++) seed = ((seed ^ id.charCodeAt(i)) * 16777619) >>> 0
  bars = []
  for (let i = 0; i < WAVEFORM_BARS; i++) {
    seed = (seed * 1103515245 + 12345) >>> 0
    bars.push(20 + (seed % 81))
  }
  waveformCache.set(id, bars)
  return bars
}

/**
 * Authoritative clip length in seconds. Prefer the stored `note.duration` —
 * webm from MediaRecorder reports `audio.duration === Infinity` until a seek
 * forces it to resolve, which would make `currentTime / duration` collapse to 0
 * and freeze the progress fill until you manually scrub. Fall back to the media
 * element's duration only when the note has no stored value.
 */
function clipLength(note: VoiceNote, audio: HTMLAudioElement): number {
  if (note.duration > 0) return note.duration
  return Number.isFinite(audio.duration) ? audio.duration : 0
}

function getAudio(note: VoiceNote): HTMLAudioElement | null {
  if (!note.url) return null
  const existing = audioMap.get(note.id)
  if (existing) return existing
  const audio = new Audio(note.url)
  audio.addEventListener('timeupdate', () => {
    const len = clipLength(note, audio)
    if (activeNoteId.value === note.id && len > 0) {
      playbackFraction.value = Math.min(1, audio.currentTime / len)
    }
  })
  audio.addEventListener('ended', () => {
    if (currentlyPlaying.value === note.id) currentlyPlaying.value = null
    if (activeNoteId.value === note.id) playbackFraction.value = 0
  })
  audioMap.set(note.id, audio)
  return audio
}

/** Progress (0..1) to render on a note's waveform. Only the active note tracks. */
function fractionFor(note: VoiceNote): number {
  return activeNoteId.value === note.id ? playbackFraction.value : 0
}

function togglePlay(note: VoiceNote) {
  const audio = getAudio(note)
  if (!audio) return
  if (currentlyPlaying.value && currentlyPlaying.value !== note.id) {
    audioMap.get(currentlyPlaying.value)?.pause()
    currentlyPlaying.value = null
  }
  if (currentlyPlaying.value === note.id) {
    audio.pause()
    currentlyPlaying.value = null // stays active; fraction retained
  } else {
    if (activeNoteId.value !== note.id) {
      activeNoteId.value = note.id
      const len = clipLength(note, audio)
      playbackFraction.value = len > 0 ? Math.min(1, audio.currentTime / len) : 0
    }
    audio.play()
    currentlyPlaying.value = note.id
  }
}

/** Move playback position without changing play/pause state. */
function seekTo(note: VoiceNote, fraction: number) {
  const audio = getAudio(note)
  if (!audio) return
  const clamped = Math.min(1, Math.max(0, fraction))
  if (activeNoteId.value !== note.id) {
    // scrubbing a different note takes over the active slot (pause the old one)
    if (currentlyPlaying.value && currentlyPlaying.value !== note.id) {
      audioMap.get(currentlyPlaying.value)?.pause()
      currentlyPlaying.value = null
    }
    activeNoteId.value = note.id
  }
  playbackFraction.value = clamped
  const len = clipLength(note, audio)
  if (len > 0) {
    audio.currentTime = clamped * len
  } else {
    // Unknown length (no stored duration, metadata not in yet) — wait for it.
    audio.addEventListener(
      'loadedmetadata',
      () => {
        if (Number.isFinite(audio.duration)) audio.currentTime = clamped * audio.duration
      },
      { once: true },
    )
  }
}

function seekFromEvent(note: VoiceNote, el: HTMLElement, clientX: number) {
  const rect = el.getBoundingClientRect()
  seekTo(note, (clientX - rect.left) / rect.width)
}

function onWaveformPointerDown(note: VoiceNote, e: PointerEvent) {
  const el = e.currentTarget as HTMLElement
  el.setPointerCapture(e.pointerId)
  seekFromEvent(note, el, e.clientX)
}

function onWaveformPointerMove(note: VoiceNote, e: PointerEvent) {
  const el = e.currentTarget as HTMLElement
  if (el.hasPointerCapture(e.pointerId)) seekFromEvent(note, el, e.clientX)
}

/** Keyboard nudge: ±5% of the clip. */
function seekBy(note: VoiceNote, delta: number) {
  seekTo(note, fractionFor(note) + delta)
}

async function handleDeleteVoice(note: VoiceNote) {
  const audio = audioMap.get(note.id)
  if (audio) {
    audio.pause()
    audioMap.delete(note.id)
  }
  if (currentlyPlaying.value === note.id) currentlyPlaying.value = null
  if (activeNoteId.value === note.id) {
    activeNoteId.value = null
    playbackFraction.value = 0
  }
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
      <div class="space-y-6">
      <AppListSection v-for="section in groupedJots" :key="section.label" :title="section.label">

        <!-- ── List view ─────────────────────────────────────────────── -->
        <ul v-if="!gridView" :class="['space-y-2', { 'stagger-list': staggerListOnce }]">
          <template v-for="item in section.items" :key="item.kind + '-' + item.data.id">

            <!-- Text jot -->
            <AppCard
              v-if="item.kind === 'text'"
              tag="li"
              align="start"
              class="active:opacity-70 transition-opacity cursor-pointer"
              @click="navigateTo(`/jots/edit-${item.data.id}`)"
            >
              <div class="flex-1 min-w-0">
                <p
                  class="text-sm text-(--ui-text) leading-snug"
                  :class="{ 'font-medium': item.data.title }"
                >{{ previewTitle(item.data) }}</p>
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
                <!-- Footer -->
                <div class="flex items-center justify-between gap-2 mt-2.5">
                  <div class="flex items-center gap-1.5 text-(--ui-text-dimmed)">
                    <AppIcon name="pencil" class="w-3.5 h-3.5" />
                    <span class="text-[11px]">{{ timeAgo(item.data.updated_at) }}</span>
                  </div>
                  <button
                    class="shrink-0 p-1 rounded-lg transition-colors"
                    :class="hasLinkedTodo(item.data.id) ? 'text-primary-400' : 'text-slate-600 hover:text-primary-400'"
                    :aria-label="hasLinkedTodo(item.data.id) ? 'View linked TODO' : 'Create TODO for this jot'"
                    @click.stop="onJotLinkClick(item)"
                  >
                    <AppIcon :name="hasLinkedTodo(item.data.id) ? 'paper-clip' : 'link'" class="w-4 h-4" />
                  </button>
                </div>
              </div>
            </AppCard>

            <!-- Voice jot -->
            <AppCard
              v-else-if="item.kind === 'voice'"
              tag="li"
              align="start"
            >
              <div class="flex-1 min-w-0">
                <p v-if="(item.data as VoiceNote).title" class="text-sm font-medium text-(--ui-text) truncate mb-1.5">{{ (item.data as VoiceNote).title }}</p>
                <div class="flex items-center gap-3">
                  <UButton
                    :icon="resolveIcon(currentlyPlaying === item.data.id ? 'pause' : 'play')"
                    :color="currentlyPlaying === item.data.id ? 'primary' : 'neutral'"
                    :variant="currentlyPlaying === item.data.id ? 'soft' : 'outline'"
                    size="sm"
                    :aria-label="currentlyPlaying === item.data.id ? 'Pause voice note' : 'Play voice note'"
                    class="min-h-[44px] min-w-[44px] shrink-0"
                    :ui="{ base: 'rounded-full' }"
                    @click="togglePlay(item.data as VoiceNote)"
                  />
                  <!-- Waveform — click / drag to seek -->
                  <div
                    class="flex-1 min-w-0 h-8 flex items-center gap-[2px] cursor-pointer touch-none select-none"
                    role="slider"
                    tabindex="0"
                    aria-label="Seek voice note"
                    :aria-valuenow="Math.round(fractionFor(item.data as VoiceNote) * 100)"
                    aria-valuemin="0"
                    aria-valuemax="100"
                    @pointerdown="onWaveformPointerDown(item.data as VoiceNote, $event)"
                    @pointermove="onWaveformPointerMove(item.data as VoiceNote, $event)"
                    @keydown.left.prevent="seekBy(item.data as VoiceNote, -0.05)"
                    @keydown.right.prevent="seekBy(item.data as VoiceNote, 0.05)"
                  >
                    <span
                      v-for="(h, i) in waveformBars(item.data.id)"
                      :key="i"
                      class="flex-1 rounded-full"
                      :class="(i + 0.5) / WAVEFORM_BARS <= fractionFor(item.data as VoiceNote) ? 'bg-primary-400' : 'bg-(--ui-text-dimmed)'"
                      :style="{ height: h + '%' }"
                    />
                  </div>
                  <span class="text-xs type-duration text-(--ui-text-toned) shrink-0">{{ fmtDuration((item.data as VoiceNote).duration) }}</span>
                </div>
                <!-- Footer -->
                <div class="flex items-center justify-between gap-2 mt-2.5">
                  <div class="flex items-center gap-1.5 text-(--ui-text-dimmed)">
                    <AppIcon name="microphone" class="w-3.5 h-3.5" />
                    <span class="text-[11px]">{{ timeAgo(item.data.created_at) }}</span>
                  </div>
                  <div class="flex items-center">
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
                </div>
              </div>
            </AppCard>

            <!-- Image jot -->
            <AppCard
              v-else-if="item.kind === 'image'"
              tag="li"
              align="start"
            >
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-3">
                  <img
                    v-if="(item.data as ImageNote).url"
                    :src="(item.data as ImageNote).url"
                    :alt="(item.data as ImageNote).filename"
                    class="w-16 h-16 object-cover rounded-lg shrink-0"
                  />
                  <div class="flex-1 min-w-0">
                    <p class="text-sm text-(--ui-text-toned) truncate">{{ (item.data as ImageNote).filename }}</p>
                  </div>
                </div>
                <!-- Footer -->
                <div class="flex items-center justify-between gap-2 mt-2.5">
                  <div class="flex items-center gap-1.5 text-(--ui-text-dimmed)">
                    <AppIcon name="photo" class="w-3.5 h-3.5" />
                    <span class="text-[11px]">{{ timeAgo(item.data.created_at) }}</span>
                  </div>
                  <div class="flex items-center">
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
                </div>
              </div>
            </AppCard>

          </template>
        </ul>

        <!-- ── Grid view ─────────────────────────────────────────────── -->
        <ul v-else :class="['jots-masonry', { 'stagger-list': staggerGridOnce }]">
          <template v-for="item in section.items" :key="item.kind + '-' + item.data.id">

            <!-- Text tile -->
            <li
              v-if="item.kind === 'text'"
              class="rounded-2xl bg-(--ui-bg-muted) border border-(--ui-border) overflow-hidden cursor-pointer active:scale-[0.97] transition-transform"
              @click="navigateTo(`/jots/edit-${item.data.id}`)"
            >
              <div class="p-3 flex flex-col gap-2 min-w-0">
                <p
                  class="text-sm text-(--ui-text) leading-snug line-clamp-2"
                  :class="{ 'font-semibold': item.data.title }"
                >{{ previewTitle(item.data) }}</p>
                <p v-if="gridBody(item.data)" class="text-xs text-(--ui-text-dimmed) line-clamp-6 leading-relaxed">{{ gridBody(item.data) }}</p>
                <div v-if="item.data.tags?.length > 0" class="flex flex-wrap gap-1">
                  <span
                    v-for="tag in (item.data.tags || []).slice(0, 2)"
                    :key="tag"
                    class="px-1.5 py-0.5 rounded-full text-[9px] bg-(--ui-bg-elevated) text-(--ui-text-dimmed) border border-(--ui-border-accented)/60 truncate max-w-[72px]"
                  >{{ splitTag(tag).leaf }}</span>
                  <span v-if="item.data.tags?.length > 2" class="text-[9px] text-slate-600 self-center">+{{ (item.data.tags?.length || 0) - 2 }}</span>
                </div>
                <!-- Footer -->
                <div class="flex items-center justify-between gap-1 mt-auto pt-1">
                  <div class="flex items-center gap-1 text-(--ui-text-dimmed) min-w-0">
                    <AppIcon name="pencil" class="w-3 h-3 shrink-0" />
                    <span class="text-[10px] truncate">{{ timeAgo(item.data.updated_at) }}</span>
                  </div>
                  <button
                    class="p-0.5 rounded transition-colors shrink-0"
                    :class="hasLinkedTodo(item.data.id) ? 'text-primary-400' : 'text-slate-600 hover:text-primary-400'"
                    @click.stop="onJotLinkClick(item)"
                  >
                    <AppIcon :name="hasLinkedTodo(item.data.id) ? 'paper-clip' : 'link'" class="w-3 h-3" />
                  </button>
                </div>
              </div>
            </li>

            <!-- Voice tile -->
            <li
              v-else-if="item.kind === 'voice'"
              class="rounded-2xl bg-(--ui-bg-muted) border border-(--ui-border) overflow-hidden"
            >
              <!-- Waveform thumbnail — click / drag to seek -->
              <div
                class="relative h-24 bg-(--ui-bg-elevated) flex items-center justify-between px-3 overflow-hidden cursor-pointer touch-none select-none"
                role="slider"
                tabindex="0"
                aria-label="Seek voice note"
                :aria-valuenow="Math.round(fractionFor(item.data as VoiceNote) * 100)"
                aria-valuemin="0"
                aria-valuemax="100"
                @pointerdown="onWaveformPointerDown(item.data as VoiceNote, $event)"
                @pointermove="onWaveformPointerMove(item.data as VoiceNote, $event)"
                @keydown.left.prevent="seekBy(item.data as VoiceNote, -0.05)"
                @keydown.right.prevent="seekBy(item.data as VoiceNote, 0.05)"
                @keydown.enter.prevent="togglePlay(item.data as VoiceNote)"
              >
                <span
                  v-for="(h, i) in waveformBars(item.data.id)"
                  :key="i"
                  class="w-[3px] rounded-full"
                  :class="(i + 0.5) / WAVEFORM_BARS <= fractionFor(item.data as VoiceNote) ? 'bg-primary-400' : 'bg-(--ui-text-dimmed)'"
                  :style="{ height: h + '%' }"
                />
                <UButton
                  :icon="resolveIcon(currentlyPlaying === item.data.id ? 'pause' : 'play')"
                  :color="currentlyPlaying === item.data.id ? 'primary' : 'neutral'"
                  :variant="currentlyPlaying === item.data.id ? 'solid' : 'soft'"
                  size="sm"
                  :aria-label="currentlyPlaying === item.data.id ? 'Pause voice note' : 'Play voice note'"
                  class="absolute min-h-[44px] min-w-[44px] shadow-md"
                  :ui="{ base: 'rounded-full' }"
                  @pointerdown.stop
                  @click.stop="togglePlay(item.data as VoiceNote)"
                />
              </div>
              <div class="px-2.5 py-2">
                <p v-if="(item.data as VoiceNote).title" class="text-[13px] font-medium text-(--ui-text) line-clamp-1">{{ (item.data as VoiceNote).title }}</p>
                <p class="text-xs type-duration text-(--ui-text-toned)">{{ fmtDuration((item.data as VoiceNote).duration) }}</p>
                <!-- Footer -->
                <div class="flex items-center justify-between gap-1 mt-1.5">
                  <div class="flex items-center gap-1 text-(--ui-text-dimmed) min-w-0">
                    <AppIcon name="microphone" class="w-3 h-3 shrink-0" />
                    <span class="text-[10px] truncate">{{ timeAgo(item.data.created_at) }}</span>
                  </div>
                  <div class="flex items-center shrink-0">
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
                  <div class="flex items-center gap-1 text-(--ui-text-dimmed) mt-0.5">
                    <AppIcon name="photo" class="w-3 h-3 shrink-0" />
                    <span class="text-[10px] truncate">{{ timeAgo(item.data.created_at) }}</span>
                  </div>
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
      </AppListSection>
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
