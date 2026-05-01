<script setup lang="ts">
import { useDatabase } from '~/composables/useDatabase'
import type { Company, Contact } from '~/types/database'

const route = useRoute()
const router = useRouter()
const db = useDatabase()
const toast = useToast()

const company = ref<Company | null>(null)
const contacts = ref<Contact[]>([])
const loading = ref(true)
const editing = ref(false)
const saving = ref(false)

const form = reactive({ name: '', website: '', description: '' })

async function load() {
  const id = route.params.id as string
  loading.value = true
  try {
    const [co, cs] = await Promise.all([db.getCompany(id), db.getCompanyContacts(id)])
    company.value = co
    contacts.value = cs
    if (co)
      Object.assign(form, {
        name: co.name,
        website: co.website ?? '',
        description: co.description ?? '',
      })
  } finally {
    loading.value = false
  }
}

onMounted(load)

async function save() {
  if (!company.value) return
  saving.value = true
  try {
    await db.updateCompany({ id: company.value.id, ...form })
    company.value = { ...company.value, ...form }
    editing.value = false
    toast.add({ title: 'Company updated', color: 'success' })
  } finally {
    saving.value = false
  }
}

async function deleteCompany() {
  if (!company.value) return
  await db.deleteCompany(company.value.id)
  toast.add({ title: 'Company deleted', color: 'success' })
  router.push('/companies')
}
</script>

<template>
  <div v-if="loading" class="max-w-2xl mx-auto px-4 py-6 space-y-4">
    <USkeleton class="h-24 rounded-xl" />
    <USkeleton class="h-40 rounded-xl" />
  </div>

  <div v-else-if="!company" class="max-w-2xl mx-auto px-4 py-16 text-center">
    <p class="text-zinc-500">Company not found</p>
    <UButton to="/companies" class="mt-4" variant="soft" color="violet">Back to companies</UButton>
  </div>

  <div v-else class="max-w-2xl mx-auto pb-6">
    <!-- Header -->
    <div class="flex items-center gap-3 px-4 pt-6 pb-4 sticky top-0 bg-zinc-950/90 backdrop-blur z-10">
      <UButton icon="i-heroicons-arrow-left" variant="ghost" color="neutral" to="/companies" />
      <h1 class="font-semibold text-zinc-100 flex-1 truncate">{{ company.name }}</h1>
      <UButton icon="i-heroicons-pencil" variant="ghost" color="neutral" @click="editing = !editing" />
      <UButton icon="i-heroicons-trash" variant="ghost" color="red" @click="deleteCompany" />
    </div>

    <div class="px-4 space-y-4">
      <!-- Edit form -->
      <div v-if="editing" class="bg-zinc-900 rounded-xl p-4 space-y-3">
        <UFormField label="Company name">
          <UInput v-model="form.name" />
        </UFormField>
        <UFormField label="Website">
          <UInput v-model="form.website" placeholder="https://example.com" />
        </UFormField>
        <UFormField label="Description">
          <UTextarea v-model="form.description" rows="3" />
        </UFormField>
        <div class="flex gap-2">
          <UButton color="violet" :loading="saving" @click="save">Save</UButton>
          <UButton variant="ghost" color="neutral" @click="editing = false">Cancel</UButton>
        </div>
      </div>

      <!-- Details -->
      <div v-else class="bg-zinc-900 rounded-xl p-4 space-y-2">
        <a
          v-if="company.website"
          :href="normalizeWebsite(company.website)"
          target="_blank"
          rel="noopener"
          class="flex items-center gap-2 text-violet-400 text-sm hover:text-violet-300"
        >
          <UIcon name="i-heroicons-globe-alt" class="size-4" />
          {{ company.website }}
        </a>
        <p v-if="company.description" class="text-sm text-zinc-300">{{ company.description }}</p>
      </div>

      <!-- People -->
      <div v-if="contacts.length > 0" class="space-y-2">
        <p class="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
          {{ contacts.length }} person{{ contacts.length !== 1 ? 's' : '' }}
        </p>
        <div class="bg-zinc-900 rounded-xl divide-y divide-zinc-800">
          <NuxtLink
            v-for="c in contacts"
            :key="c.id"
            :to="`/contacts/${c.id}`"
            class="flex items-center gap-3 px-4 py-3 hover:bg-zinc-800 transition-colors"
          >
            <div class="size-8 rounded-full bg-violet-900 flex items-center justify-center text-violet-200 text-xs font-semibold shrink-0">
              {{ contactInitials(c) }}
            </div>
            <p class="font-medium text-zinc-100 truncate">{{ contactDisplayName(c) }}</p>
          </NuxtLink>
        </div>
      </div>
    </div>
  </div>
</template>
