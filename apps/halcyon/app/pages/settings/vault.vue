<script setup lang="ts">
import { useDatabase } from '~/composables/useDatabase'
import { useVault } from '~/composables/useVault'
import type { Vault } from '~/types/database'

const db = useDatabase()
const toast = useToast()
const { activeVaultId, setActiveVaultId } = useVault()

const vaults = ref<Vault[]>([])
const loading = ref(true)
const showNew = ref(false)
const newName = ref('')
const creating = ref(false)
const editingId = ref<string | null>(null)
const editName = ref('')

async function load() {
  loading.value = true
  try {
    vaults.value = await db.getVaults()
  } finally {
    loading.value = false
  }
}

onMounted(load)

async function create() {
  if (!newName.value.trim()) return
  creating.value = true
  try {
    const v = await db.createVault({ name: newName.value.trim(), description: '' })
    vaults.value.push(v)
    if (!activeVaultId.value) await setActiveVaultId(v.id)
    newName.value = ''
    showNew.value = false
    toast.add({ title: 'Vault created', color: 'success' })
  } finally {
    creating.value = false
  }
}

async function saveEdit(vault: Vault) {
  if (!editName.value.trim()) return
  await db.updateVault({ id: vault.id, name: editName.value.trim() })
  const idx = vaults.value.findIndex((v) => v.id === vault.id)
  if (idx !== -1) vaults.value[idx] = { ...vaults.value[idx], name: editName.value.trim() }
  editingId.value = null
  toast.add({ title: 'Vault updated', color: 'success' })
}

async function deleteVault(vault: Vault) {
  if (vaults.value.length <= 1) return
  await db.deleteVault(vault.id)
  vaults.value = vaults.value.filter((v) => v.id !== vault.id)
  if (activeVaultId.value === vault.id) {
    await setActiveVaultId(vaults.value[0]?.id ?? null)
  }
  toast.add({ title: 'Vault deleted', color: 'success' })
}

function startEdit(vault: Vault) {
  editingId.value = vault.id
  editName.value = vault.name
}
</script>

<template>
  <div class="max-w-2xl mx-auto">
    <div class="flex items-center gap-3 px-4 pt-6 pb-4 sticky top-0 bg-zinc-950/90 backdrop-blur z-10">
      <UButton icon="i-heroicons-arrow-left" variant="ghost" color="neutral" to="/settings" />
      <h1 class="font-semibold text-zinc-100 flex-1">Vaults</h1>
      <UButton icon="i-heroicons-plus" color="violet" variant="soft" size="sm" @click="showNew = !showNew">New</UButton>
    </div>

    <!-- New vault form -->
    <div v-if="showNew" class="px-4 pb-4">
      <div class="bg-zinc-900 rounded-xl p-4 flex gap-2">
        <UInput v-model="newName" placeholder="Vault name (e.g. Personal)" class="flex-1" autofocus @keydown.enter="create" />
        <UButton color="violet" :loading="creating" :disabled="!newName.trim()" @click="create">Create</UButton>
        <UButton variant="ghost" color="neutral" @click="showNew = false">Cancel</UButton>
      </div>
    </div>

    <div v-if="loading" class="px-4 space-y-2">
      <USkeleton v-for="i in 2" :key="i" class="h-14 rounded-xl" />
    </div>

    <div v-else class="px-4 space-y-2">
      <div
        v-for="vault in vaults"
        :key="vault.id"
        class="bg-zinc-900 rounded-xl px-4 py-3 flex items-center gap-3"
      >
        <div class="flex-1 min-w-0">
          <template v-if="editingId === vault.id">
            <UInput v-model="editName" class="mb-1" @keydown.enter="saveEdit(vault)" />
            <div class="flex gap-2 mt-1">
              <UButton size="xs" color="violet" @click="saveEdit(vault)">Save</UButton>
              <UButton size="xs" variant="ghost" color="neutral" @click="editingId = null">Cancel</UButton>
            </div>
          </template>
          <template v-else>
            <p class="font-medium text-zinc-100">{{ vault.name }}</p>
            <p v-if="activeVaultId === vault.id" class="text-xs text-violet-400">Active vault</p>
          </template>
        </div>
        <div v-if="editingId !== vault.id" class="flex gap-1">
          <UButton
            v-if="activeVaultId !== vault.id"
            size="xs"
            variant="soft"
            color="violet"
            @click="setActiveVaultId(vault.id)"
          >
            Switch
          </UButton>
          <UButton size="xs" variant="ghost" color="neutral" icon="i-heroicons-pencil" @click="startEdit(vault)" />
          <UButton
            v-if="vaults.length > 1"
            size="xs"
            variant="ghost"
            color="red"
            icon="i-heroicons-trash"
            @click="deleteVault(vault)"
          />
        </div>
      </div>
    </div>
  </div>
</template>
