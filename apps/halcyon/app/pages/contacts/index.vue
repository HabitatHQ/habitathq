<script setup lang="ts">
import { useDatabase } from '~/composables/useDatabase'
import { useVault } from '~/composables/useVault'
import type { Contact } from '~/types/database'
import { contactDisplayName, contactInitials, contactSortKey } from '~/utils/contact-helpers'
import { daysUntilBirthday } from '~/utils/dashboard-helpers'
import { localDateString } from '~/utils/format'

const db = useDatabase()
const { activeVaultId } = useVault()

const contacts = ref<Contact[]>([])
const query = ref('')
const loading = ref(true)
const today = localDateString(new Date())

async function load() {
  if (!activeVaultId.value) return
  loading.value = true
  try {
    contacts.value = await db.getContacts(activeVaultId.value)
  } finally {
    loading.value = false
  }
}

onMounted(load)
watch(activeVaultId, load)

const filtered = computed(() => {
  const q = query.value.toLowerCase().trim()
  if (!q) return contacts.value
  return contacts.value.filter((c) =>
    contactDisplayName(c).toLowerCase().includes(q) ||
    c.nickname.toLowerCase().includes(q),
  )
})

const grouped = computed(() => {
  const map = new Map<string, Contact[]>()
  for (const c of [...filtered.value].sort((a, b) => contactSortKey(a).localeCompare(contactSortKey(b)))) {
    const letter = contactSortKey(c)[0]?.toUpperCase() ?? '#'
    const key = /[A-Z]/.test(letter) ? letter : '#'
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(c)
  }
  return [...map.entries()].sort(([a], [b]) => (a === '#' ? 1 : b === '#' ? -1 : a.localeCompare(b)))
})

function birthdaySoon(contact: Contact): boolean {
  if (!contact.birthday) return false
  return daysUntilBirthday(contact.birthday, today) <= 7
}
</script>

<template>
  <div class="max-w-2xl mx-auto">
    <!-- Header -->
    <div class="sticky top-0 z-10 bg-zinc-950/95 backdrop-blur px-4 pt-6 pb-3 space-y-3">
      <div class="flex items-center justify-between">
        <h1 class="text-2xl font-semibold text-zinc-100">Contacts</h1>
        <div class="flex items-center gap-2">
          <UButton to="/groups" icon="i-heroicons-user-group" color="neutral" variant="ghost" size="sm" />
          <UButton to="/contacts/new" icon="i-heroicons-plus" color="violet" variant="soft" size="sm">
            Add
          </UButton>
        </div>
      </div>
      <UInput
        v-model="query"
        placeholder="Search contacts…"
        icon="i-heroicons-magnifying-glass"
        class="w-full"
        variant="soft"
      />
    </div>

    <div class="px-4 pb-6">
      <div v-if="loading" class="space-y-2 mt-4">
        <USkeleton v-for="i in 5" :key="i" class="h-14 rounded-xl" />
      </div>

      <template v-else-if="grouped.length > 0">
        <div v-for="[letter, group] in grouped" :key="letter" class="mt-4">
          <p class="text-xs font-semibold text-zinc-600 mb-1 px-1">{{ letter }}</p>
          <ul class="space-y-0.5">
            <li v-for="contact in group" :key="contact.id">
              <NuxtLink
                :to="`/contacts/${contact.id}`"
                class="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-zinc-900 transition-colors"
              >
                <div
                  class="size-10 rounded-full flex items-center justify-center font-medium text-sm shrink-0"
                  :class="birthdaySoon(contact) ? 'bg-violet-600 text-white' : 'bg-violet-900 text-violet-200'"
                >
                  {{ birthdaySoon(contact) ? '🎂' : contactInitials(contact) }}
                </div>
                <div class="min-w-0 flex-1">
                  <p class="font-medium text-zinc-100 truncate">{{ contactDisplayName(contact) }}</p>
                  <p v-if="contact.last_contacted_at" class="text-xs text-zinc-500">
                    Last contact ·
                    {{
                      (() => {
                        const d = new Date(contact.last_contacted_at).getTime()
                        const now = Date.now()
                        const days = Math.floor((now - d) / 86400000)
                        return days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days}d ago`
                      })()
                    }}
                  </p>
                </div>
                <UIcon
                  v-if="contact.is_starred"
                  name="i-heroicons-star-solid"
                  class="size-4 text-violet-400 shrink-0"
                />
              </NuxtLink>
            </li>
          </ul>
        </div>
      </template>

      <div v-else class="text-center py-16 space-y-3">
        <div class="size-14 rounded-full bg-zinc-900 flex items-center justify-center mx-auto">
          <UIcon name="i-heroicons-users" class="size-7 text-zinc-600" />
        </div>
        <p class="text-zinc-500">
          {{ query ? 'No contacts match your search' : 'No contacts yet' }}
        </p>
        <UButton v-if="!query" to="/contacts/new" color="violet" variant="soft" icon="i-heroicons-plus">
          Add your first contact
        </UButton>
      </div>
    </div>
  </div>
</template>
