<script setup lang="ts">
import { useDatabase } from '~/composables/useDatabase'
import { useVault } from '~/composables/useVault'
import type { ContactFieldType } from '~/types/database'

const db = useDatabase()
const toast = useToast()
const { activeVaultId } = useVault()

const fieldTypes = ref<ContactFieldType[]>([])
const loading = ref(true)
const showNew = ref(false)
const saving = ref(false)

const newForm = reactive({ name: '', icon: 'i-heroicons-link', protocol: '' })
const editingId = ref<string | null>(null)
const editForm = reactive({ name: '', icon: '', protocol: '' })

const iconOptions = [
  { label: 'Phone', value: 'i-heroicons-phone' },
  { label: 'Email', value: 'i-heroicons-envelope' },
  { label: 'Link', value: 'i-heroicons-link' },
  { label: 'Chat bubble', value: 'i-heroicons-chat-bubble-left' },
  { label: 'Globe', value: 'i-heroicons-globe-alt' },
  { label: 'Map pin', value: 'i-heroicons-map-pin' },
  { label: 'User', value: 'i-heroicons-user' },
]

async function load() {
  if (!activeVaultId.value) return
  loading.value = true
  try {
    fieldTypes.value = await db.getContactFieldTypes(activeVaultId.value)
  } finally {
    loading.value = false
  }
}

onMounted(load)

async function create() {
  if (!activeVaultId.value || !newForm.name.trim()) return
  saving.value = true
  try {
    const ft = await db.createContactFieldType({
      vault_id: activeVaultId.value,
      name: newForm.name.trim(),
      icon: newForm.icon,
      protocol: newForm.protocol,
      is_default: false,
    })
    fieldTypes.value.push(ft)
    Object.assign(newForm, { name: '', icon: 'i-heroicons-link', protocol: '' })
    showNew.value = false
    toast.add({ title: 'Field type created', color: 'success' })
  } finally {
    saving.value = false
  }
}

function startEdit(ft: ContactFieldType) {
  editingId.value = ft.id
  Object.assign(editForm, { name: ft.name, icon: ft.icon, protocol: ft.protocol })
}

async function saveEdit(ft: ContactFieldType) {
  await db.updateContactFieldType({
    id: ft.id,
    name: editForm.name,
    icon: editForm.icon,
    protocol: editForm.protocol,
  })
  const idx = fieldTypes.value.findIndex((f) => f.id === ft.id)
  if (idx !== -1) fieldTypes.value[idx] = { ...fieldTypes.value[idx], ...editForm }
  editingId.value = null
  toast.add({ title: 'Field type updated', color: 'success' })
}

async function deleteFieldType(id: string) {
  await db.deleteContactFieldType(id)
  fieldTypes.value = fieldTypes.value.filter((f) => f.id !== id)
  toast.add({ title: 'Field type deleted', color: 'success' })
}
</script>

<template>
  <div class="max-w-2xl mx-auto">
    <div class="flex items-center gap-3 px-4 pt-6 pb-4 sticky top-0 bg-zinc-950/90 backdrop-blur z-10">
      <UButton icon="i-heroicons-arrow-left" variant="ghost" color="neutral" to="/settings" />
      <h1 class="font-semibold text-zinc-100 flex-1">Contact field types</h1>
      <UButton icon="i-heroicons-plus" color="violet" variant="soft" size="sm" @click="showNew = !showNew">New</UButton>
    </div>

    <!-- New form -->
    <div v-if="showNew" class="px-4 pb-4">
      <div class="bg-zinc-900 rounded-xl p-4 space-y-3">
        <UFormField label="Name">
          <UInput v-model="newForm.name" placeholder="e.g. LinkedIn" />
        </UFormField>
        <UFormField label="Icon">
          <USelect v-model="newForm.icon" :options="iconOptions" />
        </UFormField>
        <UFormField label="Protocol (optional)">
          <UInput v-model="newForm.protocol" placeholder="e.g. https://linkedin.com/in/" />
        </UFormField>
        <div class="flex gap-2">
          <UButton color="violet" :loading="saving" :disabled="!newForm.name" @click="create">Create</UButton>
          <UButton variant="ghost" color="neutral" @click="showNew = false">Cancel</UButton>
        </div>
      </div>
    </div>

    <div v-if="loading" class="px-4 space-y-2">
      <USkeleton v-for="i in 5" :key="i" class="h-14 rounded-xl" />
    </div>

    <div v-else class="px-4 space-y-2">
      <div
        v-for="ft in fieldTypes"
        :key="ft.id"
        class="bg-zinc-900 rounded-xl px-4 py-3"
      >
        <template v-if="editingId === ft.id">
          <div class="space-y-2">
            <UInput v-model="editForm.name" />
            <USelect v-model="editForm.icon" :options="iconOptions" />
            <UInput v-model="editForm.protocol" placeholder="Protocol" />
            <div class="flex gap-2">
              <UButton size="xs" color="violet" @click="saveEdit(ft)">Save</UButton>
              <UButton size="xs" variant="ghost" color="neutral" @click="editingId = null">Cancel</UButton>
            </div>
          </div>
        </template>
        <template v-else>
          <div class="flex items-center gap-3">
            <UIcon :name="ft.icon" class="size-5 text-zinc-400 shrink-0" />
            <div class="flex-1 min-w-0">
              <p class="font-medium text-zinc-100">{{ ft.name }}</p>
              <p v-if="ft.protocol" class="text-xs text-zinc-500 truncate">{{ ft.protocol }}</p>
            </div>
            <div class="flex gap-1">
              <UBadge v-if="ft.is_default" label="default" variant="subtle" color="violet" />
              <UButton size="xs" variant="ghost" icon="i-heroicons-pencil" @click="startEdit(ft)" />
              <UButton v-if="!ft.is_default" size="xs" variant="ghost" color="red" icon="i-heroicons-trash" @click="deleteFieldType(ft.id)" />
            </div>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>
