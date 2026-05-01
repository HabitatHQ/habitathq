<script setup lang="ts">
import { useDatabase } from '~/composables/useDatabase'
import { useVault } from '~/composables/useVault'
import type { GroupWithCount } from '~/types/database'

const db = useDatabase()
const toast = useToast()
const { activeVaultId } = useVault()

const groups = ref<GroupWithCount[]>([])
const loading = ref(true)
const showNew = ref(false)
const newName = ref('')
const newDescription = ref('')
const creating = ref(false)

async function load() {
  if (!activeVaultId.value) return
  loading.value = true
  try {
    groups.value = await db.getGroups(activeVaultId.value)
  } finally {
    loading.value = false
  }
}

onMounted(load)

async function create() {
  if (!activeVaultId.value || !newName.value.trim()) return
  creating.value = true
  try {
    const g = await db.createGroup({ vault_id: activeVaultId.value, name: newName.value.trim(), description: newDescription.value })
    groups.value.push({ ...g, member_count: 0 })
    newName.value = ''
    newDescription.value = ''
    showNew.value = false
    toast.add({ title: 'Group created', color: 'success' })
  } finally {
    creating.value = false
  }
}
</script>

<template>
  <div class="max-w-2xl mx-auto">
    <div class="flex items-center gap-3 px-4 pt-6 pb-4 sticky top-0 bg-zinc-950/90 backdrop-blur z-10">
      <h1 class="font-semibold text-zinc-100 flex-1 text-lg">Groups</h1>
      <UButton icon="i-heroicons-plus" color="violet" variant="soft" size="sm" @click="showNew = !showNew">New</UButton>
    </div>

    <!-- New group form -->
    <div v-if="showNew" class="px-4 pb-4">
      <div class="bg-zinc-900 rounded-xl p-4 space-y-3">
        <UFormField label="Group name">
          <UInput v-model="newName" placeholder="e.g. Close friends" autofocus />
        </UFormField>
        <UFormField label="Description">
          <UInput v-model="newDescription" placeholder="Optional description" />
        </UFormField>
        <div class="flex gap-2">
          <UButton color="violet" :loading="creating" :disabled="!newName.trim()" @click="create">Create</UButton>
          <UButton variant="ghost" color="neutral" @click="showNew = false">Cancel</UButton>
        </div>
      </div>
    </div>

    <div v-if="loading" class="px-4 space-y-2">
      <USkeleton v-for="i in 3" :key="i" class="h-14 rounded-xl" />
    </div>

    <div v-else-if="groups.length === 0 && !showNew" class="px-4 py-16 text-center text-zinc-500">
      No groups yet. Create one to organize your contacts.
    </div>

    <div v-else class="px-4 space-y-2">
      <NuxtLink
        v-for="group in groups"
        :key="group.id"
        :to="`/groups/${group.id}`"
        class="flex items-center gap-3 bg-zinc-900 rounded-xl px-4 py-3 hover:bg-zinc-800 transition-colors"
      >
        <div class="flex-1 min-w-0">
          <p class="font-medium text-zinc-100">{{ group.name }}</p>
          <p v-if="group.description" class="text-sm text-zinc-500 truncate">{{ group.description }}</p>
        </div>
        <span class="text-sm text-zinc-500 tabular-nums">{{ group.member_count }}</span>
      </NuxtLink>
    </div>
  </div>
</template>
