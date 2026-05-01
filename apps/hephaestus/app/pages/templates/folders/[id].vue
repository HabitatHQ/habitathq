<script setup lang="ts">
import type { TemplateFolderRow, TemplateRow } from '~/types/database'

const route = useRoute()
const folderId = computed(() => route.params.id as string)
const { load: loadFolders, getTemplates, removeTemplate } = useTemplateFolders()
const db = useDatabase()

const folder = ref<TemplateFolderRow | null>(null)
const templates = ref<TemplateRow[]>([])
const loading = ref(true)

watch(
  db.status,
  async (s) => {
    if (s !== 'ready') return
    loading.value = true
    try {
      const all = await loadFolders()
      folder.value = all.find((f) => f.id === folderId.value) ?? null
      templates.value = await getTemplates(folderId.value)
    } finally {
      loading.value = false
    }
  },
  { immediate: true },
)

async function handleRemove(templateId: string) {
  await removeTemplate(folderId.value, templateId)
  templates.value = templates.value.filter((t) => t.id !== templateId)
}
</script>

<template>
  <article class="p-4 space-y-4">
    <header class="flex items-center gap-3 pt-2">
      <NuxtLink to="/templates/folders" class="text-(--ui-text-muted)" aria-label="Back to folders">
        <UIcon name="i-heroicons-arrow-left" class="w-6 h-6" aria-hidden="true" />
      </NuxtLink>
      <h1 class="text-2xl font-bold flex-1 truncate">{{ folder?.name ?? 'Folder' }}</h1>
    </header>

    <div v-if="loading" class="text-center py-12 text-(--ui-text-muted)">
      <p>Loading…</p>
    </div>

    <ul v-else-if="templates.length > 0" role="list" class="space-y-2">
      <li v-for="t in templates" :key="t.id">
        <div class="rounded-xl bg-(--color-surface) px-4 py-3 flex items-center gap-3">
          <NuxtLink :to="`/templates/${t.id}`" class="flex-1">
            <p class="font-semibold text-sm">{{ t.cover_emoji ? `${t.cover_emoji} ` : '' }}{{ t.name }}</p>
            <p v-if="t.description" class="text-xs text-(--ui-text-muted) mt-0.5">{{ t.description }}</p>
          </NuxtLink>
          <button
            class="text-(--ui-text-muted) hover:text-red-400"
            :aria-label="`Remove ${t.name} from folder`"
            @click="handleRemove(t.id)"
          >
            <UIcon name="i-heroicons-x-mark" class="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      </li>
    </ul>

    <div v-else class="rounded-xl bg-(--color-surface) p-10 text-center space-y-2">
      <p class="text-sm text-(--ui-text-muted)">No templates in this folder.</p>
    </div>
  </article>
</template>
