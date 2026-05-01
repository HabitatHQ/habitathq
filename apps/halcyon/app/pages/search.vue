<script setup lang="ts">
import { useDatabase } from '~/composables/useDatabase'
import { useVault } from '~/composables/useVault'
import type { SearchResult } from '~/types/database'

const db = useDatabase()
const { activeVaultId } = useVault()

const query = ref('')
const results = ref<SearchResult | null>(null)
const loading = ref(false)

const debouncedSearch = useDebounceFn(async (q: string) => {
  if (!q.trim() || !activeVaultId.value) {
    results.value = null
    return
  }
  loading.value = true
  try {
    results.value = await db.search(activeVaultId.value, q)
  } finally {
    loading.value = false
  }
}, 300)

watch(query, debouncedSearch)

const hasResults = computed(
  () => results.value && (results.value.contacts.length > 0 || results.value.notes.length > 0),
)
</script>

<template>
  <div class="max-w-2xl mx-auto px-4 py-6 space-y-4">
    <h1 class="text-2xl font-semibold text-zinc-100">Search</h1>

    <UInput
      v-model="query"
      placeholder="Search contacts, notes…"
      icon="i-heroicons-magnifying-glass"
      class="w-full"
      autofocus
      size="lg"
    />

    <div v-if="loading" class="space-y-2">
      <USkeleton v-for="i in 3" :key="i" class="h-12 rounded-xl" />
    </div>

    <template v-else-if="hasResults">
      <!-- Contacts -->
      <section v-if="results!.contacts.length > 0">
        <p class="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">Contacts</p>
        <ul class="space-y-1">
          <li v-for="contact in results!.contacts" :key="contact.id">
            <NuxtLink
              :to="`/contacts/${contact.id}`"
              class="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-zinc-900 transition-colors"
            >
              <div
                class="size-9 rounded-full bg-violet-900 flex items-center justify-center text-violet-200 text-sm font-medium shrink-0"
              >
                {{ contactInitials(contact) }}
              </div>
              <p class="text-zinc-200">{{ contactDisplayName(contact) }}</p>
            </NuxtLink>
          </li>
        </ul>
      </section>

      <!-- Notes -->
      <section v-if="results!.notes.length > 0">
        <p class="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">Notes</p>
        <ul class="space-y-2">
          <li
            v-for="item in results!.notes"
            :key="item.id"
            class="bg-zinc-900 rounded-xl px-4 py-3"
          >
            <NuxtLink :to="`/contacts/${item.contact_id}`" class="block">
              <p class="text-xs text-zinc-500 mb-1">{{ contactDisplayName(item.contact) }}</p>
              <p class="text-sm text-zinc-300 line-clamp-2">{{ item.body }}</p>
            </NuxtLink>
          </li>
        </ul>
      </section>
    </template>

    <div v-else-if="query.trim() && !loading" class="text-center py-12">
      <p class="text-zinc-500">No results for "{{ query }}"</p>
    </div>

    <div v-else-if="!query.trim()" class="text-center py-12">
      <UIcon name="i-heroicons-magnifying-glass" class="size-12 text-zinc-700 mx-auto mb-3" />
      <p class="text-zinc-500">Search by name or note content</p>
    </div>
  </div>
</template>
