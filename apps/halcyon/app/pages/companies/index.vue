<script setup lang="ts">
import { useDatabase } from '~/composables/useDatabase'
import { useVault } from '~/composables/useVault'
import type { Company } from '~/types/database'

const db = useDatabase()
const { activeVaultId } = useVault()

const companies = ref<Company[]>([])
const loading = ref(true)
const search = ref('')

async function load() {
  if (!activeVaultId.value) return
  loading.value = true
  try {
    companies.value = await db.getCompanies(activeVaultId.value)
  } finally {
    loading.value = false
  }
}

onMounted(load)

const filtered = computed(() => {
  if (!search.value) return companies.value
  const q = search.value.toLowerCase()
  return companies.value.filter((c) => c.name.toLowerCase().includes(q))
})
</script>

<template>
  <div class="max-w-2xl mx-auto">
    <div class="flex items-center gap-3 px-4 pt-6 pb-4 sticky top-0 bg-zinc-950/90 backdrop-blur z-10">
      <h1 class="font-semibold text-zinc-100 flex-1 text-lg">Companies</h1>
      <UButton to="/companies/new" icon="i-heroicons-plus" color="violet" variant="soft" size="sm">New</UButton>
    </div>

    <div class="px-4 pb-4">
      <UInput v-model="search" placeholder="Search companies…" icon="i-heroicons-magnifying-glass" />
    </div>

    <div v-if="loading" class="px-4 space-y-2">
      <USkeleton v-for="i in 4" :key="i" class="h-14 rounded-xl" />
    </div>

    <div v-else-if="filtered.length === 0" class="px-4 py-16 text-center text-zinc-500">
      {{ search ? 'No companies match your search.' : 'No companies yet.' }}
    </div>

    <div v-else class="px-4 space-y-2">
      <NuxtLink
        v-for="company in filtered"
        :key="company.id"
        :to="`/companies/${company.id}`"
        class="block bg-zinc-900 rounded-xl px-4 py-3 hover:bg-zinc-800 transition-colors"
      >
        <p class="font-medium text-zinc-100">{{ company.name }}</p>
        <p v-if="company.website" class="text-sm text-zinc-500 truncate">{{ company.website }}</p>
      </NuxtLink>
    </div>
  </div>
</template>
