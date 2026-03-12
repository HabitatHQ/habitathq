<script setup lang="ts">
// Edit existing text jot — full page editor
const route = useRoute()
const store = useJotsStore()
const saving = ref(false)
const loading = ref(true)
const notFound = ref(false)

const scribbleId = computed(() => (route.params['id'] as string) || '')

const textForm = reactive({
  title: '',
  content: '',
  tags: [] as string[],
  annotations: {} as Record<string, string>,
})
const tagInput = ref('')
const annotExpanded = ref(false)
const newAnnotKey = ref('')
const newAnnotVal = ref('')

const annotationCount = computed(() => Object.keys(textForm.annotations).length)
const canSave = computed(
  () => textForm.title.trim().length > 0 || textForm.content.trim().length > 0,
)

function commitTag() {
  const t = tagInput.value.replace(/,+$/, '').trim()
  if (t && !t.startsWith('habitat-') && !textForm.tags.includes(t)) textForm.tags.push(t)
  tagInput.value = ''
}

function onTagKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' || e.key === ',') {
    e.preventDefault()
    commitTag()
  }
}

function removeTag(tag: string) {
  textForm.tags = textForm.tags.filter((t) => t !== tag)
}

function commitAnnot() {
  if (!newAnnotKey.value.trim() || !newAnnotVal.value.trim()) return
  textForm.annotations[newAnnotKey.value.trim()] = newAnnotVal.value.trim()
  newAnnotKey.value = ''
  newAnnotVal.value = ''
}

function removeAnnot(key: string) {
  delete textForm.annotations[key]
}

const showDeleteConfirm = ref(false)
const deleting = ref(false)

async function load() {
  if (!store.db.isAvailable) {
    loading.value = false
    return
  }
  // Make sure scribbles are loaded
  if (store.scribbles.value.length === 0) {
    await store.refreshScribbles()
  }
  const found = store.scribbles.value.find((s) => s.id === scribbleId.value)
  if (!found) {
    notFound.value = true
    loading.value = false
    return
  }
  textForm.title = found.title
  textForm.content = found.content
  textForm.tags = [...found.tags]
  textForm.annotations = { ...found.annotations }
  annotExpanded.value = Object.keys(found.annotations).length > 0
  loading.value = false
}

async function save() {
  if (!store.db.isAvailable || saving.value || !canSave.value) return
  saving.value = true
  try {
    await store.db.updateScribble({
      id: scribbleId.value,
      title: textForm.title,
      content: textForm.content,
      tags: [...textForm.tags],
      annotations: { ...textForm.annotations },
    })
    await store.refreshScribbles()
    navigateTo('/jots')
  } finally {
    saving.value = false
  }
}

async function confirmDelete() {
  if (deleting.value) return
  deleting.value = true
  try {
    await store.db.deleteScribble(scribbleId.value)
    store.scribbles.value = store.scribbles.value.filter((s) => s.id !== scribbleId.value)
    navigateTo('/jots')
  } finally {
    deleting.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="space-y-5">
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2">
        <UButton icon="i-heroicons-arrow-left" variant="ghost" color="neutral" size="sm" to="/jots" />
        <span class="text-sm text-(--ui-text-dimmed)">Edit Jot</span>
      </div>
      <div class="flex items-center gap-2">
        <UButton
          icon="i-heroicons-trash"
          color="error"
          variant="ghost"
          size="sm"
          @click="showDeleteConfirm = true"
        />
        <UButton :loading="saving" :disabled="saving || !canSave" size="sm" @click="save">Save</UButton>
      </div>
    </div>

    <div v-if="notFound" class="text-center py-12 text-(--ui-text-dimmed) text-sm">
      Jot not found.
    </div>

    <div v-else-if="!loading" class="space-y-3">
      <input
        v-model="textForm.title"
        placeholder="Title (optional)"
        class="w-full bg-transparent text-base font-medium text-(--ui-text)
               placeholder-slate-600 outline-none border-0"
      />

      <div class="border-t border-(--ui-border)/60" />

      <UTextarea
        v-model="textForm.content"
        placeholder="Start writing…"
        autoresize
        :rows="8"
        variant="none"
        class="w-full"
        :ui="{ base: 'resize-none bg-transparent text-(--ui-text) placeholder-slate-600 text-sm leading-relaxed' }"
      />

      <div class="border-t border-(--ui-border) pt-3 space-y-2">
        <p class="text-[10px] font-semibold text-slate-600 uppercase tracking-wider">Tags</p>
        <div class="flex flex-wrap items-center gap-1.5 min-h-[20px]">
          <span
            v-for="tag in textForm.tags"
            :key="tag"
            class="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full text-[11px]
                   bg-(--ui-bg-elevated) text-(--ui-text-toned) border border-(--ui-border-accented)"
          >
            {{ tag }}
            <button
              class="ml-0.5 w-5 h-5 flex items-center justify-center rounded-full
                     text-(--ui-text-dimmed) hover:text-(--ui-text) hover:bg-(--ui-bg-accented) transition-colors"
              @click.stop="removeTag(tag)"
            >&times;</button>
          </span>
          <input
            v-model="tagInput"
            placeholder="+ add tag"
            class="text-[11px] bg-transparent text-(--ui-text-muted) placeholder-slate-600
                   outline-none border-0 min-w-0 w-20"
            @keydown="onTagKeydown"
            @blur="commitTag"
          />
        </div>
      </div>

      <div class="border-t border-(--ui-border) pt-3 pb-1">
        <button
          class="text-xs text-(--ui-text-dimmed) hover:text-(--ui-text-muted) flex items-center gap-1.5 transition-colors"
          @click="annotExpanded = !annotExpanded"
        >
          <UIcon
            :name="annotExpanded ? 'i-heroicons-chevron-down' : 'i-heroicons-tag'"
            class="w-3.5 h-3.5"
          />
          <span v-if="annotationCount > 0">{{ annotationCount }} annotation{{ annotationCount !== 1 ? 's' : '' }}</span>
          <span v-else>{{ annotExpanded ? 'Hide annotations' : 'Add annotations' }}</span>
        </button>
        <div v-if="annotExpanded" class="mt-2 space-y-2">
          <div v-for="(val, key) in textForm.annotations" :key="key" class="flex items-center gap-2">
            <span class="text-[11px] text-(--ui-text-dimmed) font-mono shrink-0">{{ key }}</span>
            <span class="text-[11px] text-(--ui-text-muted) flex-1 min-w-0 truncate">{{ val }}</span>
            <UButton icon="i-heroicons-x-mark" color="neutral" variant="ghost" size="sm" class="text-slate-600 hover:text-red-400 shrink-0" @click="removeAnnot(String(key))" />
          </div>
          <div class="flex items-center gap-1.5">
            <UInput v-model="newAnnotKey" placeholder="key" size="xs" variant="outline" class="flex-1" @keydown.enter="commitAnnot" />
            <UInput v-model="newAnnotVal" placeholder="value" size="xs" variant="outline" class="flex-1" @keydown.enter="commitAnnot" />
            <UButton size="xs" variant="soft" color="neutral" @click="commitAnnot">Add</UButton>
          </div>
        </div>
      </div>
    </div>

    <!-- Delete confirmation -->
    <Teleport to="body">
      <div v-if="showDeleteConfirm" class="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
        <div class="absolute inset-0 bg-black/60 backdrop-blur-sm" @click="showDeleteConfirm = false" />
        <div class="relative w-full sm:max-w-sm bg-(--ui-bg-muted) border border-(--ui-border) rounded-t-3xl sm:rounded-2xl p-5 space-y-3">
          <h3 class="text-base font-semibold">Delete Jot?</h3>
          <p class="text-sm text-(--ui-text-dimmed)">This cannot be undone.</p>
          <div class="flex gap-2 pt-1">
            <UButton variant="soft" color="neutral" class="flex-1" @click="showDeleteConfirm = false">Cancel</UButton>
            <UButton color="error" class="flex-1" :loading="deleting" @click="confirmDelete">Delete</UButton>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
