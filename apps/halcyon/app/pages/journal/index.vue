<script setup lang="ts">
import { useDatabase } from '~/composables/useDatabase'
import { useVault } from '~/composables/useVault'
import type { JournalEntry } from '~/types/database'
import { localDateString } from '~/utils/format'

const db = useDatabase()
const { activeVaultId } = useVault()

const entries = ref<JournalEntry[]>([])
const loading = ref(true)
const today = localDateString(new Date())

async function load() {
  if (!activeVaultId.value) return
  loading.value = true
  try {
    entries.value = await db.getJournalEntries(activeVaultId.value)
  } finally {
    loading.value = false
  }
}

onMounted(load)
watch(activeVaultId, load)
</script>

<template>
  <div class="max-w-2xl mx-auto px-4 py-6 space-y-4">
    <div class="flex items-center justify-between">
      <h1 class="text-2xl font-semibold text-zinc-100">Journal</h1>
      <UButton :to="`/journal/${today}`" icon="i-heroicons-plus" color="violet" variant="soft" size="sm">
        Today
      </UButton>
    </div>

    <div v-if="loading" class="space-y-2">
      <USkeleton v-for="i in 4" :key="i" class="h-16 rounded-xl" />
    </div>

    <template v-else-if="entries.length > 0">
      <ul class="space-y-2">
        <li v-for="entry in entries" :key="entry.id">
          <NuxtLink
            :to="`/journal/${entry.date}`"
            class="block bg-zinc-900 rounded-xl px-4 py-3 hover:bg-zinc-800 transition-colors"
          >
            <p class="text-xs text-zinc-500">{{ formatDate(entry.date) }}</p>
            <p v-if="entry.title" class="font-medium text-zinc-100 truncate mt-0.5">{{ entry.title }}</p>
            <p class="text-sm text-zinc-400 line-clamp-2 mt-0.5">{{ entry.body }}</p>
          </NuxtLink>
        </li>
      </ul>
    </template>

    <div v-else class="text-center py-16">
      <UIcon name="i-heroicons-book-open" class="size-12 text-zinc-700 mx-auto mb-3" />
      <p class="text-zinc-500 mb-4">No journal entries yet</p>
      <UButton :to="`/journal/${today}`" color="violet" variant="soft">
        Write today's entry
      </UButton>
    </div>
  </div>
</template>
