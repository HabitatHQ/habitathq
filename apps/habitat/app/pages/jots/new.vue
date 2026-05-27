<script setup lang="ts">
// New text jot — full page editor
const store = useJotsStore()
const saving = ref(false)

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

async function save() {
  if (saving.value || !canSave.value) return
  saving.value = true
  try {
    await store.db.createScribble({
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

onMounted(() => void loadTags())
</script>

<template>
  <div class="space-y-5">
    <BackNav to="/jots" label="New Jot" title>
      <UButton :loading="saving" :disabled="saving || !canSave" size="sm" @click="save">Create</UButton>
    </BackNav>

    <div class="space-y-3">
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
            class="w-4 h-4"
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
  </div>
</template>
