<script setup lang="ts">
import AppDestructiveConfirm from '@habitathq/shared/app/components/AppDestructiveConfirm.vue'
import AppOperationFeedback from '@habitathq/shared/app/components/AppOperationFeedback.vue'
import { refreshAppAssets } from '@habitathq/shared/app/composables/refreshAppAssets'
import { useAsyncOperation } from '@habitathq/shared/app/composables/useAsyncOperation'
import { useDestructiveConfirmation } from '@habitathq/shared/app/composables/useDestructiveConfirmation'
import { useDatabase } from '~/composables/useDatabase'
import { useVault } from '~/composables/useVault'
import type { Vault } from '~/types/database'

type DestructiveTarget = { kind: 'delete-vault'; vault: Vault } | { kind: 'reset-database' }
type VaultCommand =
  | { kind: 'load' }
  | { kind: 'create'; name: string }
  | { kind: 'edit'; vault: Vault; name: string }
  | DestructiveTarget

const db = useDatabase()
const { activeVaultId, setActiveVaultId } = useVault()

const vaults = ref<Vault[]>([])
const loading = ref(true)
const showNew = ref(false)
const newName = ref('')
const editingId = ref<string | null>(null)
const editName = ref('')
const destructiveTarget = ref<DestructiveTarget | null>(null)

const runtimeConfig = useRuntimeConfig()
const assetRefresh = useAsyncOperation({
  action: () =>
    refreshAppAssets({
      scope: new URL(runtimeConfig.app.baseURL, location.origin).href,
      cachePrefix: 'halcyon-',
    }),
})
const operation = useAsyncOperation({
  action: async (command: VaultCommand): Promise<string> => {
    if (command.kind === 'load') {
      vaults.value = await db.getVaults()
      return ''
    }
    if (command.kind === 'create') {
      const vault = await db.createVault({
        name: command.name,
        description: '',
        color: '#7c3aed',
        icon: 'i-heroicons-user',
      })
      vaults.value.push(vault)
      if (!activeVaultId.value) await setActiveVaultId(vault.id)
      newName.value = ''
      showNew.value = false
      return 'Vault created'
    }
    if (command.kind === 'edit') {
      await db.updateVault({ id: command.vault.id, name: command.name })
      const idx = vaults.value.findIndex((vault) => vault.id === command.vault.id)
      if (idx !== -1) {
        const existingVault = vaults.value[idx]
        if (existingVault) vaults.value[idx] = { ...existingVault, name: command.name }
      }
      editingId.value = null
      return 'Vault updated'
    }
    if (command.kind === 'delete-vault') {
      if (vaults.value.length <= 1) throw new Error('At least one vault must remain')
      await db.deleteVault(command.vault.id)
      vaults.value = vaults.value.filter((vault) => vault.id !== command.vault.id)
      if (activeVaultId.value === command.vault.id) {
        const nextVault = vaults.value[0]
        if (nextVault) await setActiveVaultId(nextVault.id)
      }
      return 'Vault deleted'
    }

    await db.resetDatabase()
    vaults.value = await db.getVaults()
    const firstVault = vaults.value[0]
    if (firstVault) await setActiveVaultId(firstVault.id)
    // User preferences remain in local storage; only the database is reset.
    return 'Database reset. Your app preferences were kept.'
  },
})

const confirmation = useDestructiveConfirmation<[DestructiveTarget]>()
const confirmationOpen = computed(() => confirmation.pending.value)

function run(command: VaultCommand) {
  if (command.kind === 'load') loading.value = true
  void operation
    .run(command)
    .catch(() => {})
    .finally(() => {
      if (command.kind === 'load') loading.value = false
    })
}

onMounted(() => run({ kind: 'load' }))
function refreshAssets() {
  void assetRefresh.run().catch(() => {})
}

function create() {
  const name = newName.value.trim()
  if (name) run({ kind: 'create', name })
}

function saveEdit(vault: Vault) {
  const name = editName.value.trim()
  if (name) run({ kind: 'edit', vault, name })
}

function requestDestructive(target: DestructiveTarget) {
  destructiveTarget.value = target
  confirmation.request(target)
}

function cancelDestructive() {
  destructiveTarget.value = null
  confirmation.cancel()
}

function confirmDestructive() {
  const [target] = confirmation.confirm() ?? []
  destructiveTarget.value = null
  if (target) run(target)
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
      <UButton icon="i-heroicons-plus" color="primary" variant="soft" size="sm" @click="showNew = !showNew">New</UButton>
    </div>

    <div class="px-4 pb-4">
      <AppOperationFeedback
        :busy="operation.busy.value"
        :error="operation.error.value"
        :success="operation.success.value && !!operation.result.value"
        busy-label="Updating vaults…"
        error-label="Vault operation failed"
      >
        <template #success>{{ operation.result.value }}</template>
      </AppOperationFeedback>
    </div>

    <!-- New vault form -->
    <div v-if="showNew" class="px-4 pb-4">
      <div class="bg-zinc-900 rounded-xl p-4 flex gap-2">
        <UInput v-model="newName" placeholder="Vault name (e.g. Personal)" class="flex-1" autofocus @keydown.enter="create" />
        <UButton color="primary" :loading="operation.busy.value" :disabled="!newName.trim()" @click="create">Create</UButton>
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
              <UButton size="xs" color="primary" :loading="operation.busy.value" @click="saveEdit(vault)">Save</UButton>
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
            color="primary"
            @click="setActiveVaultId(vault.id)"
          >
            Switch
          </UButton>
          <UButton size="xs" variant="ghost" color="neutral" icon="i-heroicons-pencil" @click="startEdit(vault)" />
          <UButton
            v-if="vaults.length > 1"
            size="xs"
            variant="ghost"
            color="error"
            icon="i-heroicons-trash"
            :aria-label="`Delete ${vault.name} vault`"
            @click="requestDestructive({ kind: 'delete-vault', vault })"
          />
        </div>
      </div>
    </div>

    <section class="mx-4 mt-8 rounded-xl border border-red-900/60 bg-red-950/30 p-4 space-y-3">
      <h2 class="font-semibold text-red-100">Reset database</h2>
      <p class="text-sm text-red-200/80">Permanently delete all vaults and contacts on this device. App preferences will be kept.</p>
      <UButton color="error" variant="soft" :loading="operation.busy.value" @click="requestDestructive({ kind: 'reset-database' })">
        Reset all data
      </UButton>
    </section>

    <section class="mx-4 mt-4 rounded-xl bg-zinc-900 p-4 space-y-3">
      <h2 class="font-semibold text-zinc-100">Refresh app assets</h2>
      <p class="text-sm text-zinc-400">Update this app's offline assets without changing your database or preferences.</p>
      <UButton color="neutral" variant="soft" :loading="assetRefresh.busy.value" @click="refreshAssets">
        Refresh offline assets
      </UButton>
      <AppOperationFeedback
        :busy="assetRefresh.busy.value"
        :error="assetRefresh.error.value"
        :success="assetRefresh.success.value"
        busy-label="Refreshing offline assets…"
        success-label="Offline assets refreshed"
        error-label="Asset refresh failed"
      />
    </section>
    <AppDestructiveConfirm
      :model-value="confirmationOpen"
      :title="destructiveTarget?.kind === 'reset-database' ? 'Reset all database data?' : 'Delete this vault?'"
      :message="destructiveTarget?.kind === 'reset-database'
        ? 'All vaults, contacts, and related data will be permanently deleted. Your app preferences will be kept.'
        : `Vault ${destructiveTarget?.kind === 'delete-vault' ? destructiveTarget.vault.name : ''} and its related data will be permanently deleted.`"
      :confirm-label="destructiveTarget?.kind === 'reset-database' ? 'Reset database' : 'Delete vault'"
      :busy="operation.busy.value"
      @cancel="cancelDestructive"
      @confirm="confirmDestructive"
    />
  </div>
</template>
