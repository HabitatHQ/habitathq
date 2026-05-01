<script setup lang="ts">
import { useDatabase } from '~/composables/useDatabase'
import { useVault } from '~/composables/useVault'

const { dbError } = useNuxtApp().$dbError
  ? useNuxtApp()
  : { dbError: ref(null) }

const db = useDatabase()
const { activeVaultId, setActiveVaultId } = useVault()

// On first load, resolve the active vault
onMounted(async () => {
  if (!activeVaultId.value) {
    const vaults = await db.getVaults()
    if (vaults.length > 0) {
      setActiveVaultId(vaults[0]!.id)
    }
  }
})
</script>

<template>
  <div>
    <!-- DB error banner -->
    <div
      v-if="dbError"
      class="fixed top-0 inset-x-0 z-[100] bg-red-900 text-red-100 text-sm p-3 text-center"
    >
      {{ dbError }}
    </div>

    <UNotifications />

    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </div>
</template>
