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
const { tagInput, addTag: commitTag, removeTag, onTagKeydown } = useTagInput(textForm.tags)
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
</script>

<template>
  <div class="space-y-5">
    <div class="flex items-center justify-between">
      <BackNav to="/jots" label="New Jot" />
      <UButton :loading="saving" :disabled="saving || !canSave" size="sm" @click="save">Create</UButton>
    </div>

    <div class="space-y-3">
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
  </div>
</template>
