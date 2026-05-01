<script setup lang="ts">
import { useDatabase } from '~/composables/useDatabase'
import { useVault } from '~/composables/useVault'

const db = useDatabase()
const toast = useToast()
const { activeVaultId } = useVault()
const router = useRouter()

const saving = ref(false)

const form = reactive({
  first_name: '',
  last_name: '',
  nickname: '',
  pronouns: '',
  birthday: '',
  how_we_met: '',
})

async function save() {
  if (!activeVaultId.value || !form.first_name.trim()) return
  saving.value = true
  try {
    const contact = await db.createContact({
      vault_id: activeVaultId.value,
      first_name: form.first_name.trim(),
      last_name: form.last_name.trim(),
      nickname: form.nickname.trim(),
      maiden_name: '',
      middle_name: '',
      pronouns: form.pronouns.trim(),
      gender: '',
      how_we_met: form.how_we_met.trim(),
      is_deceased: false,
      deceased_at: null,
      birthday: form.birthday || null,
      is_starred: false,
      avatar_url: null,
      tags: [],
      annotations: {},
    })
    toast.add({ title: 'Contact created', color: 'success' })
    await router.push(`/contacts/${contact.id}`)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="max-w-2xl mx-auto px-4 py-6">
    <div class="flex items-center gap-3 mb-6">
      <UButton
        icon="i-heroicons-arrow-left"
        variant="ghost"
        color="neutral"
        to="/contacts"
      />
      <h1 class="text-2xl font-semibold text-zinc-100">New contact</h1>
    </div>

    <form class="space-y-4" @submit.prevent="save">
      <UFormField label="First name" required>
        <UInput
          v-model="form.first_name"
          placeholder="Alice"
          autofocus
          class="w-full"
        />
      </UFormField>

      <UFormField label="Last name">
        <UInput v-model="form.last_name" placeholder="Smith" class="w-full" />
      </UFormField>

      <UFormField label="Nickname">
        <UInput v-model="form.nickname" placeholder="Ali" class="w-full" />
      </UFormField>

      <UFormField label="Pronouns">
        <UInput v-model="form.pronouns" placeholder="she/her" class="w-full" />
      </UFormField>

      <UFormField label="Birthday">
        <UInput v-model="form.birthday" type="date" class="w-full" />
      </UFormField>

      <UFormField label="How we met">
        <UTextarea v-model="form.how_we_met" placeholder="We met at…" class="w-full" rows="2" />
      </UFormField>

      <div class="pt-2">
        <UButton
          type="submit"
          color="violet"
          class="w-full"
          :loading="saving"
          :disabled="!form.first_name.trim()"
        >
          Create contact
        </UButton>
      </div>
    </form>
  </div>
</template>
