<script setup lang="ts">
import { useDatabase } from '~/composables/useDatabase'
import { useVault } from '~/composables/useVault'
import type { RelationshipType } from '~/types/database'

const db = useDatabase()
const toast = useToast()
const { activeVaultId } = useVault()

const relTypes = ref<RelationshipType[]>([])
const loading = ref(true)
const showNew = ref(false)
const saving = ref(false)

const newForm = reactive({ name: '', name_reverse: '', is_symmetric: false })
const editingId = ref<string | null>(null)
const editForm = reactive({ name: '', name_reverse: '', is_symmetric: false })

async function load() {
  if (!activeVaultId.value) return
  loading.value = true
  try {
    relTypes.value = await db.getRelationshipTypes(activeVaultId.value)
  } finally {
    loading.value = false
  }
}

onMounted(load)

async function create() {
  if (!activeVaultId.value || !newForm.name.trim()) return
  saving.value = true
  try {
    const rt = await db.createRelationshipType({
      vault_id: activeVaultId.value,
      name: newForm.name.trim(),
      name_reverse: newForm.is_symmetric ? newForm.name.trim() : (newForm.name_reverse.trim() || newForm.name.trim()),
      is_symmetric: newForm.is_symmetric,
    })
    relTypes.value.push(rt)
    Object.assign(newForm, { name: '', name_reverse: '', is_symmetric: false })
    showNew.value = false
    toast.add({ title: 'Relationship type created', color: 'success' })
  } finally {
    saving.value = false
  }
}

function startEdit(rt: RelationshipType) {
  editingId.value = rt.id
  Object.assign(editForm, { name: rt.name, name_reverse: rt.name_reverse, is_symmetric: rt.is_symmetric })
}

async function saveEdit(rt: RelationshipType) {
  await db.updateRelationshipType({
    id: rt.id,
    name: editForm.name,
    name_reverse: editForm.is_symmetric ? editForm.name : editForm.name_reverse,
    is_symmetric: editForm.is_symmetric,
  })
  const idx = relTypes.value.findIndex((r) => r.id === rt.id)
  if (idx !== -1) relTypes.value[idx] = { ...relTypes.value[idx], ...editForm }
  editingId.value = null
  toast.add({ title: 'Relationship type updated', color: 'success' })
}

async function deleteRelType(id: string) {
  await db.deleteRelationshipType(id)
  relTypes.value = relTypes.value.filter((r) => r.id !== id)
  toast.add({ title: 'Relationship type deleted', color: 'success' })
}
</script>

<template>
  <div class="max-w-2xl mx-auto">
    <div class="flex items-center gap-3 px-4 pt-6 pb-4 sticky top-0 bg-zinc-950/90 backdrop-blur z-10">
      <UButton icon="i-heroicons-arrow-left" variant="ghost" color="neutral" to="/settings" />
      <h1 class="font-semibold text-zinc-100 flex-1">Relationship types</h1>
      <UButton icon="i-heroicons-plus" color="violet" variant="soft" size="sm" @click="showNew = !showNew">New</UButton>
    </div>

    <!-- New form -->
    <div v-if="showNew" class="px-4 pb-4">
      <div class="bg-zinc-900 rounded-xl p-4 space-y-3">
        <UFormField label="Label (A → B)">
          <UInput v-model="newForm.name" placeholder="e.g. parent of" />
        </UFormField>
        <div class="flex items-center gap-2">
          <UCheckbox v-model="newForm.is_symmetric" label="Symmetric (same in both directions)" />
        </div>
        <UFormField v-if="!newForm.is_symmetric" label="Reverse label (B → A)">
          <UInput v-model="newForm.name_reverse" placeholder="e.g. child of" />
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
        v-for="rt in relTypes"
        :key="rt.id"
        class="bg-zinc-900 rounded-xl px-4 py-3"
      >
        <template v-if="editingId === rt.id">
          <div class="space-y-2">
            <UInput v-model="editForm.name" placeholder="Label A → B" />
            <UCheckbox v-model="editForm.is_symmetric" label="Symmetric" />
            <UInput v-if="!editForm.is_symmetric" v-model="editForm.name_reverse" placeholder="Label B → A" />
            <div class="flex gap-2">
              <UButton size="xs" color="violet" @click="saveEdit(rt)">Save</UButton>
              <UButton size="xs" variant="ghost" color="neutral" @click="editingId = null">Cancel</UButton>
            </div>
          </div>
        </template>
        <template v-else>
          <div class="flex items-center gap-3">
            <div class="flex-1 min-w-0">
              <p class="font-medium text-zinc-100">{{ rt.name }}</p>
              <p class="text-sm text-zinc-500">
                <template v-if="rt.is_symmetric">
                  <UBadge label="symmetric" variant="subtle" color="violet" />
                </template>
                <template v-else>
                  reverse: {{ rt.name_reverse }}
                </template>
              </p>
            </div>
            <div class="flex gap-1">
              <UButton size="xs" variant="ghost" icon="i-heroicons-pencil" @click="startEdit(rt)" />
              <UButton size="xs" variant="ghost" color="red" icon="i-heroicons-trash" @click="deleteRelType(rt.id)" />
            </div>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>
