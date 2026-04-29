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
const { loadTags, suggest: suggestJotTags } = useTagSuggestions('scribble')
const annotExpanded = ref(false)
const newAnnotKey = ref('')
const newAnnotVal = ref('')

const annotationCount = computed(() => Object.keys(textForm.annotations).length)
const canSave = computed(
  () => textForm.title.trim().length > 0 || textForm.content.trim().length > 0,
)

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
  if (saving.value || !canSave.value) return
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

onMounted(() => {
  void load()
  void loadTags()
})
</script>

<template>
  <div class="space-y-5">
    <div class="flex items-center justify-between">
      <BackNav to="/jots" label="Jot" />
      <div class="flex items-center gap-2">
        <UButton
          :icon="resolveIcon('trash')"
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
        class="w-full bg-transparent font-medium text-(--ui-text)
               placeholder-slate-600 outline-none border-0 type-input"
      />

      <div class="border-t border-(--ui-border)/60" />

      <AppTextArea
        v-model="textForm.content"
        placeholder="Start writing…"
        autoresize
        :rows="8"
        variant="none"
        class="w-full"
      />

      <div class="border-t border-(--ui-border) pt-3">
        <UFormField label="Tags">
          <TagInput v-model="textForm.tags" :suggest="suggestJotTags" />
        </UFormField>
      </div>

      <div class="border-t border-(--ui-border) pt-3 pb-1">
        <button
          class="text-xs text-(--ui-text-dimmed) hover:text-(--ui-text-muted) flex items-center gap-1.5 transition-colors"
          @click="annotExpanded = !annotExpanded"
        >
          <AppIcon
            :name="annotExpanded ? 'chevron-down' : 'tag'"
            class="w-3.5 h-3.5"
          />
          <span v-if="annotationCount > 0">{{ annotationCount }} annotation{{ annotationCount !== 1 ? 's' : '' }}</span>
          <span v-else>{{ annotExpanded ? 'Hide annotations' : 'Add annotations' }}</span>
        </button>
        <div v-if="annotExpanded" class="mt-2 space-y-2">
          <div v-for="(val, key) in textForm.annotations" :key="key" class="flex items-center gap-2">
            <span class="text-[11px] text-(--ui-text-dimmed) font-mono shrink-0">{{ key }}</span>
            <span class="text-[11px] text-(--ui-text-muted) flex-1 min-w-0 truncate">{{ val }}</span>
            <UButton :icon="resolveIcon('x-mark')" color="neutral" variant="ghost" size="sm" class="text-slate-600 hover:text-red-400 shrink-0" @click="removeAnnot(String(key))" />
          </div>
          <div class="flex items-center gap-1.5">
            <AppTextField v-model="newAnnotKey" placeholder="key" variant="outline" class="flex-1" @keydown="(e: KeyboardEvent) => e.key === 'Enter' && commitAnnot()" />
            <AppTextField v-model="newAnnotVal" placeholder="value" variant="outline" class="flex-1" @keydown="(e: KeyboardEvent) => e.key === 'Enter' && commitAnnot()" />
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
