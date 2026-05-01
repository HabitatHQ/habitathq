<script setup lang="ts">
import { useDatabase } from '~/composables/useDatabase'
import { useVault } from '~/composables/useVault'
import { contactToVCard, parseVCardBlock } from '~/utils/import-export-helpers'
import { contactToJSContact, parseJSContact } from '~/utils/jscontact-helpers'

const db = useDatabase()
const { activeVaultId } = useVault()

// Export
const exporting = ref(false)
const exportDone = ref(false)

async function exportJSON() {
  if (!activeVaultId.value) return
  exporting.value = true
  try {
    const data = await db.exportVault(activeVaultId.value)
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `halcyon-export-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    exportDone.value = true
    setTimeout(() => (exportDone.value = false), 3000)
  } finally {
    exporting.value = false
  }
}

function buildFieldsWithType(data: Awaited<ReturnType<typeof db.exportVault>>, contactId: string) {
  const fields = data.contact_fields.filter((f) => f.contact_id === contactId)
  return fields.map((f) => ({
    ...f,
    type: data.contact_field_types.find((t) => t.id === f.type_id)!,
  }))
}

async function exportVCard() {
  if (!activeVaultId.value) return
  exporting.value = true
  try {
    const data = await db.exportVault(activeVaultId.value)
    const vcards = data.contacts.map((c) => contactToVCard(c, buildFieldsWithType(data, c.id)))
    const blob = new Blob([vcards.join('\n\n')], { type: 'text/vcard' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `halcyon-contacts-${new Date().toISOString().slice(0, 10)}.vcf`
    a.click()
    URL.revokeObjectURL(url)
  } finally {
    exporting.value = false
  }
}

async function exportJSContact() {
  if (!activeVaultId.value) return
  exporting.value = true
  try {
    const data = await db.exportVault(activeVaultId.value)
    const cards = data.contacts.map((c) => contactToJSContact(c, buildFieldsWithType(data, c.id)))
    const blob = new Blob([JSON.stringify(cards, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `halcyon-jscontact-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  } finally {
    exporting.value = false
  }
}

// Import
const importFile = ref<File | null>(null)
const importing = ref(false)
const importResult = ref<{ added: number; errors: number } | null>(null)
const importError = ref('')

function onFileChange(e: Event) {
  const target = e.target as HTMLInputElement
  importFile.value = target.files?.[0] ?? null
  importResult.value = null
  importError.value = ''
}

async function createContactFromParsed(parsed: {
  first_name: string
  last_name: string
  nickname: string
  birthday: string | null
}) {
  await db.createContact({
    vault_id: activeVaultId.value!,
    first_name: parsed.first_name || 'Unknown',
    last_name: parsed.last_name,
    nickname: parsed.nickname,
    maiden_name: '',
    middle_name: '',
    pronouns: '',
    gender: '',
    how_we_met: '',
    is_deceased: false,
    deceased_at: null,
    birthday: parsed.birthday,
    is_starred: false,
    avatar_url: null,
    tags: [],
    annotations: {},
  })
}

async function importVCard() {
  if (!importFile.value || !activeVaultId.value) return
  importing.value = true
  importResult.value = null
  importError.value = ''
  try {
    const text = await importFile.value.text()
    const blocks = text
      .split(/(?=BEGIN:VCARD)/i)
      .map((b) => b.trim())
      .filter((b) => /^BEGIN:VCARD/i.test(b))

    let added = 0
    let errors = 0
    for (const block of blocks) {
      try {
        const parsed = parseVCardBlock(block)
        if (!parsed.first_name && !parsed.last_name) {
          errors++
          continue
        }
        await createContactFromParsed(parsed)
        added++
      } catch {
        errors++
      }
    }
    importResult.value = { added, errors }
  } catch (e) {
    importError.value = e instanceof Error ? e.message : 'Failed to parse file'
  } finally {
    importing.value = false
  }
}

async function importJSContact() {
  if (!importFile.value || !activeVaultId.value) return
  importing.value = true
  importResult.value = null
  importError.value = ''
  try {
    const text = await importFile.value.text()
    const raw = JSON.parse(text)
    // Accept a single card object or an array of cards
    const cards: unknown[] = Array.isArray(raw) ? raw : [raw]

    let added = 0
    let errors = 0
    for (const card of cards) {
      try {
        const parsed = parseJSContact(card as Record<string, unknown>)
        if (!parsed.first_name && !parsed.last_name) {
          errors++
          continue
        }
        await createContactFromParsed(parsed)
        added++
      } catch {
        errors++
      }
    }
    importResult.value = { added, errors }
  } catch (e) {
    importError.value = e instanceof Error ? e.message : 'Failed to parse file'
  } finally {
    importing.value = false
  }
}
</script>

<template>
  <div class="max-w-2xl mx-auto">
    <div class="flex items-center gap-3 px-4 pt-6 pb-4 sticky top-0 bg-zinc-950/90 backdrop-blur z-10">
      <UButton icon="i-heroicons-arrow-left" variant="ghost" color="neutral" to="/settings" />
      <h1 class="font-semibold text-zinc-100 flex-1">Import & Export</h1>
    </div>

    <div class="px-4 space-y-4">
      <!-- Export -->
      <div class="bg-zinc-900 rounded-xl p-4 space-y-3">
        <div class="flex items-center gap-2 mb-1">
          <UIcon name="i-heroicons-arrow-down-tray" class="size-4 text-zinc-400" />
          <p class="font-semibold text-zinc-100">Export</p>
        </div>
        <p class="text-sm text-zinc-400">Download a copy of all your data.</p>
        <div class="flex flex-wrap gap-2">
          <UButton color="violet" variant="soft" :loading="exporting" icon="i-heroicons-document-text" @click="exportJSON">
            JSON (full backup)
          </UButton>
          <UButton color="neutral" variant="soft" :loading="exporting" icon="i-heroicons-user-group" @click="exportVCard">
            vCard (.vcf)
          </UButton>
          <UButton color="neutral" variant="soft" :loading="exporting" icon="i-heroicons-code-bracket" @click="exportJSContact">
            JSContact (.json)
          </UButton>
        </div>
        <p v-if="exportDone" class="text-sm text-green-400">
          <UIcon name="i-heroicons-check-circle" class="size-4 inline mr-1" />
          Downloaded!
        </p>
      </div>

      <!-- Import vCard -->
      <div class="bg-zinc-900 rounded-xl p-4 space-y-3">
        <div class="flex items-center gap-2 mb-1">
          <UIcon name="i-heroicons-arrow-up-tray" class="size-4 text-zinc-400" />
          <p class="font-semibold text-zinc-100">Import contacts</p>
        </div>
        <p class="text-sm text-zinc-400">Import from a vCard (.vcf) or JSContact (.json) file.</p>
        <input
          type="file"
          accept=".vcf,.vcard,.json,text/vcard,text/x-vcard,application/json"
          class="block text-sm text-zinc-400 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-sm file:bg-violet-900/50 file:text-violet-300 hover:file:bg-violet-900 cursor-pointer"
          @change="onFileChange"
        />
        <div v-if="importFile" class="flex gap-2 flex-wrap">
          <UButton
            v-if="importFile.name.endsWith('.vcf') || importFile.name.endsWith('.vcard')"
            color="violet"
            variant="soft"
            :loading="importing"
            icon="i-heroicons-arrow-up-tray"
            @click="importVCard"
          >
            Import vCard
          </UButton>
          <UButton
            v-else-if="importFile.name.endsWith('.json')"
            color="violet"
            variant="soft"
            :loading="importing"
            icon="i-heroicons-arrow-up-tray"
            @click="importJSContact"
          >
            Import JSContact
          </UButton>
          <template v-else>
            <UButton color="violet" variant="soft" :loading="importing" @click="importVCard">
              Import as vCard
            </UButton>
            <UButton color="neutral" variant="soft" :loading="importing" @click="importJSContact">
              Import as JSContact
            </UButton>
          </template>
        </div>
        <div v-if="importResult" class="text-sm">
          <p class="text-green-400">
            <UIcon name="i-heroicons-check-circle" class="size-4 inline mr-1" />
            {{ importResult.added }} contact{{ importResult.added !== 1 ? 's' : '' }} imported
          </p>
          <p v-if="importResult.errors > 0" class="text-yellow-400 mt-1">
            {{ importResult.errors }} skipped (parse errors)
          </p>
        </div>
        <p v-if="importError" class="text-sm text-red-400">{{ importError }}</p>
      </div>
    </div>
  </div>
</template>
