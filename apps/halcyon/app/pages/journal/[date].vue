<script setup lang="ts">
import { useDatabase } from '~/composables/useDatabase'
import { useVault } from '~/composables/useVault'
import type { JournalEntry } from '~/types/database'
import { formatDate } from '~/utils/format'

const route = useRoute()
const db = useDatabase()
const { activeVaultId } = useVault()

const date = computed(() => route.params['date'] as string)
const entry = ref<JournalEntry | null>(null)
const form = reactive({ title: '', body: '' })
const saving = ref(false)
const saved = ref(false)

async function load() {
  if (!activeVaultId.value) return
  const e = await db.getJournalEntry(date.value, activeVaultId.value)
  entry.value = e
  if (e) {
    form.title = e.title
    form.body = e.body
  }
}

onMounted(load)

async function save() {
  if (!activeVaultId.value) return
  saving.value = true
  try {
    const updated = await db.upsertJournalEntry({
      vault_id: activeVaultId.value,
      date: date.value,
      title: form.title.trim(),
      body: form.body,
    })
    entry.value = updated
    saved.value = true
    setTimeout(() => { saved.value = false }, 1500)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="max-w-2xl mx-auto px-4 py-6 space-y-4">
    <div class="flex items-center gap-3">
      <UButton icon="i-heroicons-arrow-left" variant="ghost" color="neutral" to="/journal" />
      <div class="flex-1">
        <p class="text-sm text-zinc-500">{{ formatDate(date) }}</p>
      </div>
      <UButton
        variant="soft"
        color="violet"
        :loading="saving"
        :icon="saved ? 'i-heroicons-check' : 'i-heroicons-cloud-arrow-up'"
        @click="save"
      >
        {{ saved ? 'Saved' : 'Save' }}
      </UButton>
    </div>

    <UInput
      v-model="form.title"
      placeholder="Title (optional)"
      variant="ghost"
      class="w-full text-lg font-semibold"
    />

    <UTextarea
      v-model="form.body"
      placeholder="What's on your mind?"
      class="w-full min-h-[60vh] resize-none"
      variant="ghost"
      autofocus
      @keydown.meta.s.prevent="save"
    />
  </div>
</template>
