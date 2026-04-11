<script setup lang="ts">
import type { ImageNote, JotItem, VoiceNote } from '~/composables/useJotsStore'
import { toLocalDateKey } from '~/utils/format'

const router = useRouter()
const { settings: appSettings } = useAppSettings()
const store = useJotsStore()
const { timeline, todoByJotId, todos } = store

// ─── View mode ────────────────────────────────────────────────────────────────

const gridView = ref(false)

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
    return `Voice note — ${item.data.created_at.slice(0, 10)}`
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

// ─── Error ────────────────────────────────────────────────────────────────────

const errorMsg = ref<string | null>(null)

// ─── Lifecycle ────────────────────────────────────────────────────────────────

onMounted(async () => {
  gridView.value = localStorage.getItem('jots-view') === 'grid'
  await store.loadAll()
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
          :icon="gridView ? 'i-heroicons-list-bullet' : 'i-heroicons-squares-2x2'"
          size="sm"
          color="neutral"
          variant="ghost"
          :aria-label="gridView ? 'Switch to list view' : 'Switch to grid view'"
          @click="gridView = !gridView"
        />
        <UButton icon="i-heroicons-plus" size="sm" @click="showPickSheet = true">New</UButton>
      </div>
    </header>

    <!-- Error -->
    <UAlert
      v-if="errorMsg"
      :title="errorMsg"
      color="error"
      variant="soft"
      icon="i-heroicons-exclamation-circle"
      :close-button="{ icon: 'i-heroicons-x-mark', color: 'error', variant: 'ghost', size: 'sm' }"
      @close="errorMsg = null"
    />

    <!-- Empty state — full ring inline -->
    <section
      v-if="timeline.length === 0"
      class="flex flex-col items-center justify-center py-8 gap-4"
    >
      <p class="text-sm text-(--ui-text-dimmed)">No jots yet. Add your first note, voice memo, or photo.</p>
      <JotsRing @select="onRingSelect" />
    </section>

    <!-- ── List view ─────────────────────────────────────────────────────── -->
    <ul v-else-if="!gridView" class="space-y-2">
      <template v-for="item in timeline" :key="item.kind + '-' + item.data.id">

        <!-- Text jot -->
        <li
          v-if="item.kind === 'text'"
          class="p-3 rounded-xl bg-(--ui-bg-muted) border border-(--ui-border) active:opacity-70 transition-opacity cursor-pointer"
          @click="navigateTo(`/jots/edit-${item.data.id}`)"
        >
          <div class="flex items-start gap-2.5">
            <div class="w-6 h-6 rounded-full bg-amber-500/10 flex items-center justify-center mt-0.5 shrink-0">
              <UIcon name="i-heroicons-pencil" class="w-3.5 h-3.5 text-amber-400" />
            </div>
            <div class="flex-1 min-w-0">
              <div class="flex items-start justify-between gap-2">
                <p class="font-medium text-sm text-(--ui-text) leading-snug">{{ previewTitle(item.data) }}</p>
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
              :title="hasLinkedTodo(item.data.id) ? 'View linked TODO' : 'Create TODO for this jot'"
              @click.stop="onJotLinkClick(item)"
            >
              <UIcon :name="hasLinkedTodo(item.data.id) ? 'i-heroicons-paper-clip' : 'i-heroicons-link'" class="w-3.5 h-3.5" />
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
              <UIcon name="i-heroicons-microphone" class="w-3.5 h-3.5 text-rose-400" />
            </div>
            <UButton
              :icon="currentlyPlaying === item.data.id ? 'i-heroicons-pause' : 'i-heroicons-play'"
              :color="currentlyPlaying === item.data.id ? 'primary' : 'neutral'"
              :variant="currentlyPlaying === item.data.id ? 'soft' : 'outline'"
              size="sm"
              :ui="{ base: 'rounded-full' }"
              @click="togglePlay(item.data as VoiceNote)"
            />
            <div class="flex-1 min-w-0">
              <p class="text-sm text-(--ui-text-toned) truncate">{{ fmtDate(item.data.created_at, appSettings.use24HourTime) }}</p>
              <p class="text-xs type-duration text-(--ui-text-dimmed)">{{ fmtDuration((item.data as VoiceNote).duration) }}</p>
            </div>
            <UButton
              :icon="hasLinkedTodo(item.data.id) ? 'i-heroicons-paper-clip' : 'i-heroicons-link'"
              color="neutral"
              variant="ghost"
              size="sm"
              :class="hasLinkedTodo(item.data.id) ? 'text-primary-400' : 'text-slate-600 hover:text-primary-400'"
              @click="onJotLinkClick(item)"
            />
            <UButton
              icon="i-heroicons-trash"
              color="neutral"
              variant="ghost"
              size="sm"
              class="text-slate-600 hover:text-red-400"
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
              <UIcon name="i-heroicons-photo" class="w-3.5 h-3.5 text-sky-400" />
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
              :icon="hasLinkedTodo(item.data.id) ? 'i-heroicons-paper-clip' : 'i-heroicons-link'"
              color="neutral"
              variant="ghost"
              size="sm"
              :class="hasLinkedTodo(item.data.id) ? 'text-primary-400' : 'text-slate-600 hover:text-primary-400'"
              @click="onJotLinkClick(item)"
            />
            <UButton
              icon="i-heroicons-trash"
              color="neutral"
              variant="ghost"
              size="sm"
              class="text-slate-600 hover:text-red-400"
              @click="store.deleteImageNote(item.data as ImageNote)"
            />
          </div>
        </li>

      </template>
    </ul>

    <!-- ── Grid view ──────────────────────────────────────────────────────── -->
    <ul v-else class="jots-masonry">
      <template v-for="item in timeline" :key="item.kind + '-' + item.data.id">

        <!-- Text tile -->
        <li
          v-if="item.kind === 'text'"
          class="rounded-2xl bg-(--ui-bg-muted) border border-(--ui-border) overflow-hidden cursor-pointer active:scale-[0.97] transition-transform"
          @click="navigateTo(`/jots/edit-${item.data.id}`)"
        >
          <div class="flex">
            <div class="w-[3px] shrink-0 rounded-l-2xl bg-gradient-to-b from-amber-500/80 to-amber-600/30" />
            <div class="p-3 flex flex-col gap-2 min-w-0 flex-1">
              <p class="font-semibold text-sm text-(--ui-text) leading-snug line-clamp-2">{{ previewTitle(item.data) }}</p>
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
                    <UIcon :name="hasLinkedTodo(item.data.id) ? 'i-heroicons-paper-clip' : 'i-heroicons-link'" class="w-3 h-3" />
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
              <UIcon name="i-heroicons-microphone" class="w-6 h-6 text-rose-400" />
            </div>
            <div>
              <p class="text-sm type-duration font-medium text-(--ui-text-toned)">{{ fmtDuration((item.data as VoiceNote).duration) }}</p>
              <p class="text-[10px] text-slate-600 mt-0.5">{{ timeAgo(item.data.created_at) }}</p>
            </div>
            <UButton
              :icon="currentlyPlaying === item.data.id ? 'i-heroicons-pause' : 'i-heroicons-play'"
              :color="currentlyPlaying === item.data.id ? 'primary' : 'neutral'"
              :variant="currentlyPlaying === item.data.id ? 'soft' : 'outline'"
              size="xs"
              :ui="{ base: 'rounded-full' }"
              @click.stop="togglePlay(item.data as VoiceNote)"
            />
            <div class="flex items-center gap-0.5 pb-1">
              <UButton
                :icon="hasLinkedTodo(item.data.id) ? 'i-heroicons-paper-clip' : 'i-heroicons-link'"
                color="neutral"
                variant="ghost"
                size="xs"
                :class="hasLinkedTodo(item.data.id) ? 'text-primary-400' : 'text-slate-600 hover:text-primary-400'"
                @click.stop="onJotLinkClick(item)"
              />
              <UButton
                icon="i-heroicons-trash"
                color="neutral"
                variant="ghost"
                size="xs"
                class="text-slate-600 hover:text-red-400"
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
            <UIcon name="i-heroicons-photo" class="w-8 h-8 text-slate-600" />
          </div>
          <div class="px-2.5 py-2 flex items-center justify-between gap-1">
            <div class="min-w-0">
              <p class="text-[11px] text-(--ui-text-muted) truncate leading-tight">{{ (item.data as ImageNote).filename }}</p>
              <p class="text-[10px] text-slate-600 mt-0.5">{{ timeAgo(item.data.created_at) }}</p>
            </div>
            <div class="flex items-center gap-0.5 shrink-0">
              <button
                class="p-0.5 rounded transition-colors"
                :class="hasLinkedTodo(item.data.id) ? 'text-primary-400' : 'text-slate-600 hover:text-primary-400'"
                @click="onJotLinkClick(item)"
              >
                <UIcon :name="hasLinkedTodo(item.data.id) ? 'i-heroicons-paper-clip' : 'i-heroicons-link'" class="w-3 h-3" />
              </button>
              <UButton
                icon="i-heroicons-trash"
                color="neutral"
                variant="ghost"
                size="xs"
                class="text-slate-600 hover:text-red-400 shrink-0"
                @click="store.deleteImageNote(item.data as ImageNote)"
              />
            </div>
          </div>
        </li>

      </template>
    </ul>

    <!-- ── Create TODO from jot modal ────────────────────────────────────── -->
    <AppModal v-model="showCreateTodoModal" title="Create TODO">
      <p class="text-xs text-(--ui-text-dimmed) -mt-2">A TODO will be created and linked to this jot.</p>
      <div class="space-y-3">
        <UFormField label="Title" required>
          <UInput v-model="createTodoTitle" placeholder="Revisit: …" class="w-full" />
        </UFormField>
        <UFormField label="Due date">
          <UInput v-model="createTodoDate" type="date" class="w-full" />
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
            <UButton icon="i-heroicons-x-mark" variant="ghost" color="neutral" size="sm" aria-label="Close" @click="showPickSheet = false" />
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
/* Custom keyframes for the bottom sheets to slide up while keeping Nuxt's out-in page transitions separate */
.slide-up-sheet {
  animation: slide-up-sheet-anime 0.3s cubic-bezier(0.22, 1, 0.36, 1) both;
}
@keyframes slide-up-sheet-anime {
  from { transform: translateY(100%); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}
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
  animation: tile-in 0.3s ease-out both;
}
@keyframes tile-in {
  from {
    opacity: 0;
    transform: scale(0.96) translateY(6px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}
</style>
