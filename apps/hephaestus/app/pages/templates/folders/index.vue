<script setup lang="ts">
import type { TemplateFolderRow } from '~/types/database'

const { load, create, remove } = useTemplateFolders()
const db = useDatabase()

const folders = ref<TemplateFolderRow[]>([])
const loading = ref(true)
const newFolderName = ref('')
const showCreate = ref(false)
const creating = ref(false)

watch(
  db.status,
  async (s) => {
    if (s !== 'ready') return
    loading.value = true
    folders.value = await load()
    loading.value = false
  },
  { immediate: true },
)

async function handleCreate() {
  if (!newFolderName.value.trim()) return
  creating.value = true
  try {
    await create(newFolderName.value.trim())
    folders.value = await load()
    newFolderName.value = ''
    showCreate.value = false
  } finally {
    creating.value = false
  }
}

async function handleDelete(id: string) {
  await remove(id)
  folders.value = folders.value.filter((f) => f.id !== id)
}
</script>

<template>
  <article class="p-4 space-y-4">
    <header class="flex items-center justify-between pt-2">
      <div class="flex items-center gap-3">
        <NuxtLink to="/templates" class="text-(--ui-text-muted)" aria-label="Back to templates">
          <UIcon name="i-heroicons-arrow-left" class="w-6 h-6" aria-hidden="true" />
        </NuxtLink>
        <h1 class="text-2xl font-bold">Folders</h1>
      </div>
      <UButton size="sm" color="primary" @click="showCreate = !showCreate">
        <UIcon name="i-heroicons-plus" class="w-4 h-4" aria-hidden="true" />
        New
      </UButton>
    </header>

    <div v-if="showCreate" class="rounded-xl bg-(--color-surface) p-4 space-y-3">
      <input
        v-model="newFolderName"
        type="text"
        placeholder="Folder name"
        class="w-full bg-(--color-surface-2) rounded-lg px-3 py-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-(--color-accent)"
        @keydown.enter="handleCreate"
      />
      <div class="flex gap-2">
        <UButton size="sm" variant="ghost" @click="showCreate = false">Cancel</UButton>
        <UButton size="sm" color="primary" :loading="creating" @click="handleCreate">Create</UButton>
      </div>
    </div>

    <div v-if="loading" class="text-center py-12 text-(--ui-text-muted)">
      <p>Loading…</p>
    </div>

    <ul v-else-if="folders.length > 0" role="list" class="space-y-2">
      <li v-for="f in folders" :key="f.id">
        <div class="rounded-xl bg-(--color-surface) px-4 py-3 flex items-center gap-3">
          <NuxtLink :to="`/templates/folders/${f.id}`" class="flex-1 flex items-center gap-3">
            <div
              class="w-8 h-8 rounded-lg flex items-center justify-center"
              :style="f.color ? `background-color: ${f.color}20` : ''"
            >
              <UIcon name="i-heroicons-folder" class="w-5 h-5" :style="f.color ? `color: ${f.color}` : ''" />
            </div>
            <span class="font-medium text-sm">{{ f.name }}</span>
          </NuxtLink>
          <button
            class="text-(--ui-text-muted) hover:text-red-400"
            :aria-label="`Delete folder ${f.name}`"
            @click="handleDelete(f.id)"
          >
            <UIcon name="i-heroicons-trash" class="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      </li>
    </ul>

    <div v-else class="rounded-xl bg-(--color-surface) p-10 text-center space-y-3">
      <UIcon name="i-heroicons-folder-open" class="w-10 h-10 text-(--ui-text-muted) mx-auto" />
      <p class="text-sm text-(--ui-text-muted)">No folders yet. Create one to organize your templates.</p>
    </div>
  </article>
</template>
