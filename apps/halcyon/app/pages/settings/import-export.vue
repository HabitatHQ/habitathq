<script setup lang="ts">
import AppOperationFeedback from '@habitathq/shared/app/components/AppOperationFeedback.vue'
import { downloadBlob } from '@habitathq/shared/app/composables/downloadBlob'
import { useAsyncOperation } from '@habitathq/shared/app/composables/useAsyncOperation'
import { localCalendarDate } from '@habitathq/utils'
import { useDatabase } from '~/composables/useDatabase'
import { useVault } from '~/composables/useVault'
import { contactToVCard, parseVCardBlock } from '~/utils/import-export-helpers'
import { contactToJSContact, parseJSContact } from '~/utils/jscontact-helpers'

const db = useDatabase()
const { activeVaultId } = useVault()

// Export
const exportOperation = useAsyncOperation({
  action: async (format: 'json' | 'vcard' | 'jscontact') => {
    if (!activeVaultId.value) throw new Error('Select a vault before exporting')
    const data = await db.exportVault(activeVaultId.value)
    if (format === 'json') {
      downloadBlob(
        new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
        `halcyon-export-${localCalendarDate()}.json`,
      )
      return
    }
    if (format === 'vcard') {
      const vcards = data.contacts.map((c) => contactToVCard(c, buildFieldsWithType(data, c.id)))
      downloadBlob(
        new Blob([vcards.join('\n\n')], { type: 'text/vcard' }),
        `halcyon-contacts-${localCalendarDate()}.vcf`,
      )
      return
    }
    const cards = data.contacts.map((c) => contactToJSContact(c, buildFieldsWithType(data, c.id)))
    downloadBlob(
      new Blob([JSON.stringify(cards, null, 2)], { type: 'application/json' }),
      `halcyon-jscontact-${localCalendarDate()}.json`,
    )
  },
})

function buildFieldsWithType(data: Awaited<ReturnType<typeof db.exportVault>>, contactId: string) {
  const fields = data.contact_fields.filter((f) => f.contact_id === contactId)
  return fields.map((f) => ({
    ...f,
    type: data.contact_field_types.find((t) => t.id === f.type_id)!,
  }))
}

function runExport(format: 'json' | 'vcard' | 'jscontact') {
  void exportOperation.run(format).catch(() => {})
}

// Import
const importFile = ref<File | null>(null)
const importResult = ref<{ added: number; errors: number } | null>(null)

type ParsedContact = {
  first_name: string
  last_name: string
  nickname: string
  birthday: string | null
}

async function createContactFromParsed(parsed: ParsedContact) {
  if (!activeVaultId.value) throw new Error('Select a vault before importing')
  await db.createContact({
    vault_id: activeVaultId.value,
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

const importOperation = useAsyncOperation({
  action: async (format: 'vcard' | 'jscontact') => {
    if (!importFile.value || !activeVaultId.value)
      throw new Error('Choose a contact file to import')
    const text = await importFile.value.text()
    let added = 0
    let errors = 0

    if (format === 'vcard') {
      const blocks = text
        .split(/(?=BEGIN:VCARD)/i)
        .map((b) => b.trim())
        .filter((b) => /^BEGIN:VCARD/i.test(b))
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
    } else {
      const raw = JSON.parse(text)
      // Accept a single card object or an array of cards.
      const cards: unknown[] = Array.isArray(raw) ? raw : [raw]
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
    }

    return { added, errors }
  },
  onSuccess: (result) => {
    importResult.value = result
  },
})

function onFileChange(e: Event) {
  const target = e.target as HTMLInputElement
  importFile.value = target.files?.[0] ?? null
  importResult.value = null
  importOperation.reset()
}

function runImport(format: 'vcard' | 'jscontact') {
  void importOperation.run(format).catch(() => {})
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
          <UButton color="primary" variant="soft" :loading="exportOperation.busy.value" icon="i-heroicons-document-text" @click="runExport('json')">
            JSON (full backup)
          </UButton>
          <UButton color="neutral" variant="soft" :loading="exportOperation.busy.value" icon="i-heroicons-user-group" @click="runExport('vcard')">
            vCard (.vcf)
          </UButton>
          <UButton color="neutral" variant="soft" :loading="exportOperation.busy.value" icon="i-heroicons-code-bracket" @click="runExport('jscontact')">
            JSContact (.json)
          </UButton>
        </div>
        <AppOperationFeedback
          :busy="exportOperation.busy.value"
          :error="exportOperation.error.value"
          :success="exportOperation.success.value"
          busy-label="Preparing download…"
          success-label="Downloaded!"
          error-label="Export failed"
        />
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
            color="primary"
            variant="soft"
            :loading="importOperation.busy.value"
            icon="i-heroicons-arrow-up-tray"
            @click="runImport('vcard')"
          >
            Import vCard
          </UButton>
          <UButton
            v-else-if="importFile.name.endsWith('.json')"
            color="primary"
            variant="soft"
            :loading="importOperation.busy.value"
            icon="i-heroicons-arrow-up-tray"
            @click="runImport('jscontact')"
          >
            Import JSContact
          </UButton>
          <template v-else>
            <UButton color="primary" variant="soft" :loading="importOperation.busy.value" @click="runImport('vcard')">
              Import as vCard
            </UButton>
            <UButton color="neutral" variant="soft" :loading="importOperation.busy.value" @click="runImport('jscontact')">
              Import as JSContact
            </UButton>
          </template>
        </div>
        <AppOperationFeedback
          :busy="importOperation.busy.value"
          :error="importOperation.error.value"
          :success="importOperation.success.value"
          busy-label="Importing contacts…"
          success-label="Import complete"
          error-label="Import failed"
        >
          <template #success>
            <div v-if="importResult" class="text-sm">
              <p class="text-green-400">
                <UIcon name="i-heroicons-check-circle" class="size-4 inline mr-1" />
                {{ importResult.added }} contact{{ importResult.added !== 1 ? 's' : '' }} imported
              </p>
              <p v-if="importResult.errors > 0" class="text-yellow-400 mt-1">
                {{ importResult.errors }} skipped (parse errors)
              </p>
            </div>
          </template>
        </AppOperationFeedback>
      </div>
    </div>
  </div>
</template>
