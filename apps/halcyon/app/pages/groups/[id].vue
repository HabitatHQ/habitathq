<script setup lang="ts">
import { useDatabase } from '~/composables/useDatabase'
import { useVault } from '~/composables/useVault'
import type { Contact, Group } from '~/types/database'
import { contactDisplayName, contactInitials } from '~/utils/contact-helpers'

const route = useRoute()
const router = useRouter()
const db = useDatabase()
const toast = useToast()
const { activeVaultId } = useVault()

const group = ref<Group | null>(null)
const members = ref<Contact[]>([])
const loading = ref(true)
const editing = ref(false)
const saving = ref(false)

const form = reactive({ name: '', description: '' })

// Contact search for adding members
const searchQuery = ref('')
const searchResults = ref<Contact[]>([])
const adding = ref(false)

async function load() {
  const id = route.params['id'] as string
  loading.value = true
  try {
    const [g, ms] = await Promise.all([
      db.getGroup(id),
      db.getGroupContacts(id),
    ])
    group.value = g
    members.value = ms
    if (g) Object.assign(form, { name: g.name, description: g.description ?? '' })
  } finally {
    loading.value = false
  }
}

onMounted(load)

async function save() {
  if (!group.value) return
  saving.value = true
  try {
    await db.updateGroup({ id: group.value.id, ...form })
    group.value = { ...group.value, ...form }
    editing.value = false
    toast.add({ title: 'Group updated', color: 'success' })
  } finally {
    saving.value = false
  }
}

async function deleteGroup() {
  if (!group.value) return
  await db.deleteGroup(group.value.id)
  toast.add({ title: 'Group deleted', color: 'success' })
  router.push('/groups')
}

async function removeMember(contactId: string) {
  if (!group.value) return
  await db.removeFromGroup(group.value.id, contactId)
  members.value = members.value.filter((c) => c.id !== contactId)
  toast.add({ title: 'Member removed', color: 'success' })
}

const searchDebounce = useDebounceFn(async () => {
  if (!searchQuery.value.trim() || !activeVaultId.value) return
  const results = await db.search(activeVaultId.value, searchQuery.value)
  searchResults.value = results.contacts.filter((c) => !members.value.some((m) => m.id === c.id))
}, 300)

watch(searchQuery, searchDebounce)

async function addMember(contact: Contact) {
  if (!group.value) return
  adding.value = true
  try {
    await db.addToGroup(group.value.id, contact.id)
    members.value.push(contact)
    searchQuery.value = ''
    searchResults.value = []
    toast.add({ title: 'Member added', color: 'success' })
  } finally {
    adding.value = false
  }
}
</script>

<template>
  <div v-if="loading" class="max-w-2xl mx-auto px-4 py-6 space-y-4">
    <USkeleton class="h-20 rounded-xl" />
    <USkeleton class="h-40 rounded-xl" />
  </div>

  <div v-else-if="!group" class="max-w-2xl mx-auto px-4 py-16 text-center">
    <p class="text-zinc-500">Group not found</p>
    <UButton to="/groups" class="mt-4" variant="soft" color="violet">Back to groups</UButton>
  </div>

  <div v-else class="max-w-2xl mx-auto pb-6">
    <!-- Header -->
    <div class="flex items-center gap-3 px-4 pt-6 pb-4 sticky top-0 bg-zinc-950/90 backdrop-blur z-10">
      <UButton icon="i-heroicons-arrow-left" variant="ghost" color="neutral" to="/groups" />
      <h1 class="font-semibold text-zinc-100 flex-1 truncate">{{ group.name }}</h1>
      <UButton icon="i-heroicons-pencil" variant="ghost" color="neutral" @click="editing = !editing" />
      <UButton icon="i-heroicons-trash" variant="ghost" color="red" @click="deleteGroup" />
    </div>

    <div class="px-4 space-y-4">
      <!-- Edit form -->
      <div v-if="editing" class="bg-zinc-900 rounded-xl p-4 space-y-3">
        <UFormField label="Group name">
          <UInput v-model="form.name" />
        </UFormField>
        <UFormField label="Description">
          <UInput v-model="form.description" placeholder="Optional" />
        </UFormField>
        <div class="flex gap-2">
          <UButton color="violet" :loading="saving" @click="save">Save</UButton>
          <UButton variant="ghost" color="neutral" @click="editing = false">Cancel</UButton>
        </div>
      </div>

      <p v-else-if="group.description" class="text-sm text-zinc-400 px-1">{{ group.description }}</p>

      <!-- Add member search -->
      <div class="space-y-2">
        <UInput v-model="searchQuery" placeholder="Add a contact…" icon="i-heroicons-user-plus" />
        <div v-if="searchResults.length > 0" class="bg-zinc-900 rounded-xl divide-y divide-zinc-800">
          <button
            v-for="c in searchResults"
            :key="c.id"
            class="w-full flex items-center gap-3 px-4 py-2 hover:bg-zinc-800 text-left"
            @click="addMember(c)"
          >
            <div class="size-8 rounded-full bg-violet-900 flex items-center justify-center text-violet-200 text-xs font-semibold shrink-0">
              {{ contactInitials(c) }}
            </div>
            <span class="text-sm text-zinc-200">{{ contactDisplayName(c) }}</span>
          </button>
        </div>
      </div>

      <!-- Members list -->
      <div v-if="members.length > 0" class="space-y-2">
        <p class="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
          {{ members.length }} member{{ members.length !== 1 ? 's' : '' }}
        </p>
        <div class="bg-zinc-900 rounded-xl divide-y divide-zinc-800">
          <div
            v-for="member in members"
            :key="member.id"
            class="flex items-center gap-3 px-4 py-3"
          >
            <div class="size-9 rounded-full bg-violet-900 flex items-center justify-center text-violet-200 text-sm font-semibold shrink-0">
              {{ contactInitials(member) }}
            </div>
            <NuxtLink :to="`/contacts/${member.id}`" class="flex-1 min-w-0 hover:text-violet-300 transition-colors">
              <p class="text-zinc-100 font-medium truncate">{{ contactDisplayName(member) }}</p>
            </NuxtLink>
            <UButton size="xs" variant="ghost" color="red" icon="i-heroicons-x-mark" @click="removeMember(member.id)" />
          </div>
        </div>
      </div>

      <div v-else class="py-8 text-center text-zinc-600 text-sm">
        No members yet. Search for contacts above to add them.
      </div>
    </div>
  </div>
</template>
