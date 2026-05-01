<script setup lang="ts">
import { useDatabase } from '~/composables/useDatabase'
import { useVault } from '~/composables/useVault'

const db = useDatabase()
const toast = useToast()
const { activeVaultId } = useVault()
const router = useRouter()

const form = reactive({ name: '', website: '', description: '' })
const saving = ref(false)

async function save() {
  if (!activeVaultId.value || !form.name.trim()) return
  saving.value = true
  try {
    const c = await db.createCompany({
      vault_id: activeVaultId.value,
      name: form.name.trim(),
      website: form.website,
      description: form.description,
    })
    toast.add({ title: 'Company created', color: 'success' })
    router.push(`/companies/${c.id}`)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="max-w-2xl mx-auto">
    <div class="flex items-center gap-3 px-4 pt-6 pb-4 sticky top-0 bg-zinc-950/90 backdrop-blur z-10">
      <UButton icon="i-heroicons-arrow-left" variant="ghost" color="neutral" to="/companies" />
      <h1 class="font-semibold text-zinc-100 flex-1">New company</h1>
      <UButton color="violet" :loading="saving" :disabled="!form.name.trim()" @click="save">Create</UButton>
    </div>

    <div class="px-4 space-y-3">
      <div class="bg-zinc-900 rounded-xl p-4 space-y-3">
        <UFormField label="Company name" required>
          <UInput v-model="form.name" placeholder="Acme Corp" autofocus />
        </UFormField>
        <UFormField label="Website">
          <UInput v-model="form.website" placeholder="https://example.com" />
        </UFormField>
        <UFormField label="Description">
          <UTextarea v-model="form.description" rows="3" placeholder="What do they do?" />
        </UFormField>
      </div>
    </div>
  </div>
</template>
