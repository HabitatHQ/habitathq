<script setup lang="ts">
import type { Scribble } from '~/types/database'

const db = useDatabase()
const scribbles = ref<Scribble[]>([])

// ─── Modal state ──────────────────────────────────────────────────────────────

const isOpen = ref(false)
const saving = ref(false)
const editing = ref<Scribble | null>(null)

const form = reactive({
  title: '',
  content: '',
  tags: [] as string[],
  annotations: {} as Record<string, string>,
})

// ─── Tag input ────────────────────────────────────────────────────────────────

const tagInput = ref('')

function commitTag() {
  const t = tagInput.value.replace(/,+$/, '').trim()
  if (t && !t.startsWith('habitat-') && !form.tags.includes(t)) form.tags.push(t)
  tagInput.value = ''
}

function onTagKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commitTag() }
}

function removeTag(tag: string) {
  form.tags = form.tags.filter(t => t !== tag)
}

// ─── Annotation editor ────────────────────────────────────────────────────────

const annotExpanded = ref(false)
const newAnnotKey = ref('')
const newAnnotVal = ref('')

function commitAnnot() {
  if (!newAnnotKey.value.trim() || !newAnnotVal.value.trim()) return
  form.annotations[newAnnotKey.value.trim()] = newAnnotVal.value.trim()
  newAnnotKey.value = ''
  newAnnotVal.value = ''
}

function removeAnnot(key: string) {
  delete form.annotations[key]
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

async function load() {
  if (!db.isAvailable) return
  scribbles.value = await db.getScribbles()
}

function openNew() {
  editing.value = null
  form.title = ''
  form.content = ''
  form.tags = []
  form.annotations = {}
  tagInput.value = ''
  annotExpanded.value = false
  newAnnotKey.value = ''
  newAnnotVal.value = ''
  isOpen.value = true
}

function openEdit(s: Scribble) {
  editing.value = s
  form.title = s.title
  form.content = s.content
  form.tags = [...s.tags]
  form.annotations = { ...s.annotations }
  tagInput.value = ''
  annotExpanded.value = false
  newAnnotKey.value = ''
  newAnnotVal.value = ''
  isOpen.value = true
}

function close() {
  isOpen.value = false
}

async function save() {
  if (!db.isAvailable || saving.value) return
  saving.value = true
  try {
    if (editing.value) {
      await db.updateScribble({
        id: editing.value.id,
        title: form.title,
        content: form.content,
        tags: [...form.tags],
        annotations: { ...form.annotations },
      })
    } else {
      await db.createScribble({
        title: form.title,
        content: form.content,
        tags: [...form.tags],
        annotations: { ...form.annotations },
      })
    }
    await load()
    close()
  } finally {
    saving.value = false
  }
}

async function remove() {
  if (!db.isAvailable || !editing.value) return
  await db.deleteScribble(editing.value.id)
  await load()
  close()
}

// ─── Display helpers ──────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function previewTitle(s: Scribble): string {
  if (s.title) return s.title
  const first = s.content.split('\n')[0]?.trim() ?? ''
  return first.slice(0, 72) || 'Untitled'
}

function previewBody(s: Scribble): string {
  if (!s.title) return ''
  return s.content.split('\n').slice(0, 2).join(' ').trim().slice(0, 120)
}

function splitTag(tag: string): { parent: string | null; leaf: string } {
  const idx = tag.lastIndexOf('/')
  return idx === -1 ? { parent: null, leaf: tag } : { parent: tag.slice(0, idx), leaf: tag.slice(idx + 1) }
}

const annotationCount = computed(() => Object.keys(form.annotations).length)
const canSave = computed(() => form.title.trim().length > 0 || form.content.trim().length > 0)

onMounted(load)
</script>

<template>
  <div class="space-y-5">

    <header class="flex items-center justify-between">
      <h2 class="text-2xl font-bold">Scribbles</h2>
      <UButton icon="i-heroicons-plus" size="sm" @click="openNew">New</UButton>
    </header>

    <!-- ── Empty state ───────────────────────────────────────────────────── -->
    <section
      v-if="scribbles.length === 0"
      class="flex flex-col items-center justify-center gap-4 py-12 text-center"
    >
      <div class="w-16 h-16 rounded-full bg-slate-800 flex items-center justify-center">
        <UIcon name="i-heroicons-pencil" class="w-8 h-8 text-slate-400" />
      </div>
      <div class="space-y-1">
        <p class="font-semibold text-slate-200">No scribbles yet</p>
        <p class="text-sm text-slate-500">Tap New to jot something down.</p>
      </div>
    </section>

    <!-- ── List ──────────────────────────────────────────────────────────── -->
    <ul v-else class="space-y-2">
      <li
        v-for="s in scribbles"
        :key="s.id"
        class="p-3 rounded-xl bg-slate-900 border border-slate-800 active:opacity-70 transition-opacity cursor-pointer"
        @click="openEdit(s)"
      >
        <div class="flex items-start justify-between gap-2">
          <p class="font-medium text-sm text-slate-100 leading-snug">{{ previewTitle(s) }}</p>
          <span class="text-[11px] text-slate-600 shrink-0 mt-0.5">{{ timeAgo(s.updated_at) }}</span>
        </div>
        <p v-if="previewBody(s)" class="text-xs text-slate-500 mt-0.5 line-clamp-2">{{ previewBody(s) }}</p>
        <div v-if="s.tags.length > 0" class="flex flex-wrap gap-1 mt-2">
          <span
            v-for="tag in s.tags.slice(0, 5)"
            :key="tag"
            class="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px]
                   text-slate-400 bg-slate-800 border border-slate-700"
          >
            <span v-if="splitTag(tag).parent" class="text-slate-600">{{ splitTag(tag).parent }}/</span>
            <span>{{ splitTag(tag).leaf }}</span>
          </span>
          <span v-if="s.tags.length > 5" class="text-[10px] text-slate-600 self-center pl-0.5">+{{ s.tags.length - 5 }}</span>
        </div>
      </li>
    </ul>

    <!-- ── Create / Edit modal ───────────────────────────────────────────── -->
    <UModal v-model:open="isOpen">
      <template #content>
        <div class="flex flex-col max-h-[90dvh]">

          <!-- Header -->
          <div class="flex items-center justify-between px-4 pt-4 pb-3 border-b border-slate-800 shrink-0">
            <h3 class="text-base font-semibold">{{ editing ? 'Edit Scribble' : 'New Scribble' }}</h3>
            <div class="flex items-center gap-2">
              <span v-if="editing" class="text-[11px] text-slate-600">
                Created {{ timeAgo(editing.created_at) }}
              </span>
              <UButton
                v-if="editing"
                icon="i-heroicons-trash"
                color="error"
                variant="ghost"
                size="sm"
                @click="remove"
              />
            </div>
          </div>

          <!-- Scrollable body -->
          <div class="flex-1 overflow-y-auto px-4 pt-3 pb-2 space-y-3 min-h-0">

            <!-- Title -->
            <input
              v-model="form.title"
              placeholder="Title (optional)"
              class="w-full bg-transparent text-base font-medium text-slate-100
                     placeholder-slate-600 outline-none border-0"
            />

            <!-- Divider -->
            <div class="border-t border-slate-800/60" />

            <!-- Content -->
            <UTextarea
              v-model="form.content"
              placeholder="Start writing…"
              autoresize
              :rows="6"
              variant="none"
              class="w-full"
              :ui="{ base: 'resize-none bg-transparent text-slate-200 placeholder-slate-600 text-sm leading-relaxed' }"
            />

            <!-- Tags -->
            <div class="border-t border-slate-800 pt-3 space-y-2">
              <p class="text-[10px] font-semibold text-slate-600 uppercase tracking-wider">Tags</p>
              <div class="flex flex-wrap items-center gap-1.5 min-h-[20px]">
                <span
                  v-for="tag in form.tags"
                  :key="tag"
                  class="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full text-[11px]
                         bg-slate-800 text-slate-300 border border-slate-700"
                >
                  <span v-if="splitTag(tag).parent" class="text-slate-500">{{ splitTag(tag).parent }}/</span>
                  {{ splitTag(tag).leaf }}
                  <button
                    class="ml-0.5 w-5 h-5 flex items-center justify-center rounded-full
                           text-slate-500 hover:text-slate-200 hover:bg-slate-700 transition-colors"
                    @click.stop="removeTag(tag)"
                  >×</button>
                </span>
                <input
                  v-model="tagInput"
                  placeholder="+ add tag"
                  class="text-[11px] bg-transparent text-slate-400 placeholder-slate-600
                         outline-none border-0 min-w-0 w-20"
                  @keydown="onTagKeydown"
                  @blur="commitTag"
                />
              </div>
            </div>

            <!-- Annotations -->
            <div class="border-t border-slate-800 pt-3 pb-1">
              <button
                class="text-xs text-slate-500 hover:text-slate-400 flex items-center gap-1.5 transition-colors"
                @click="annotExpanded = !annotExpanded"
              >
                <UIcon
                  :name="annotExpanded ? 'i-heroicons-chevron-down' : 'i-heroicons-tag'"
                  class="w-3.5 h-3.5"
                />
                <span v-if="annotationCount > 0">
                  {{ annotationCount }} annotation{{ annotationCount !== 1 ? 's' : '' }}
                </span>
                <span v-else>{{ annotExpanded ? 'Hide annotations' : 'Add annotations' }}</span>
              </button>

              <div v-if="annotExpanded" class="mt-2 space-y-2">
                <!-- Existing -->
                <div
                  v-for="(val, key) in form.annotations"
                  :key="key"
                  class="flex items-center gap-2"
                >
                  <span class="text-[11px] text-slate-500 font-mono shrink-0">{{ key }}</span>
                  <span class="text-[11px] text-slate-400 flex-1 min-w-0 truncate">{{ val }}</span>
                  <UButton
                    icon="i-heroicons-x-mark"
                    color="neutral"
                    variant="ghost"
                    size="sm"
                    class="text-slate-600 hover:text-red-400 shrink-0"
                    @click="removeAnnot(String(key))"
                  />
                </div>
                <!-- Add new -->
                <div class="flex items-center gap-1.5">
                  <UInput
                    v-model="newAnnotKey"
                    placeholder="key"
                    size="xs"
                    variant="outline"
                    class="flex-1"
                    @keydown.enter="commitAnnot"
                  />
                  <UInput
                    v-model="newAnnotVal"
                    placeholder="value"
                    size="xs"
                    variant="outline"
                    class="flex-1"
                    @keydown.enter="commitAnnot"
                  />
                  <UButton size="xs" variant="soft" color="neutral" @click="commitAnnot">Add</UButton>
                </div>
              </div>
            </div>

          </div>

          <!-- Footer -->
          <div class="flex justify-end gap-2 px-4 py-3 border-t border-slate-800 shrink-0">
            <UButton variant="ghost" color="neutral" @click="close">Cancel</UButton>
            <UButton
              :loading="saving"
              :disabled="saving || !canSave"
              @click="save"
            >
              {{ editing ? 'Save' : 'Create' }}
            </UButton>
          </div>

        </div>
      </template>
    </UModal>

  </div>
</template>
