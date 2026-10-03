<script setup lang="ts">
import type { PortableBundle } from '~/lib/data-transfer'
import { type LegacyTemplatePayload, parseLegacyTemplatePayload } from '~/lib/template-export'

type ImportPayload = PortableBundle | LegacyTemplatePayload
function isPortableBundle(value: unknown): value is PortableBundle {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  return (
    candidate['format'] === 'hephaestus-portable' &&
    Number(candidate['version']) === 2 &&
    typeof candidate['tables'] === 'object' &&
    candidate['tables'] !== null &&
    !Array.isArray(candidate['tables'])
  )
}
interface Props {
  open: boolean
}

const props = defineProps<Props>()
const modalFocus = useModalFocus(() => props.open)
const emit = defineEmits<{
  close: []
  import: [payload: ImportPayload]
}>()

const jsonInput = ref('')
const error = ref<string | null>(null)
const parsed = ref<ImportPayload | null>(null)
const templates = computed(() => {
  const value = parsed.value
  if (!value) return []
  return 'tables' in value ? (value.tables['templates'] ?? []) : [value.template]
})
const exercises = computed(() => {
  const value = parsed.value
  if (!value) return []
  return 'tables' in value ? (value.tables['template_exercises'] ?? []) : value.exercises
})

function handleParse() {
  error.value = null
  parsed.value = null
  const input = jsonInput.value.trim()
  let obj: unknown
  try {
    obj = JSON.parse(input)
  } catch {
    try {
      const bytes = Uint8Array.from(atob(input), (char) => char.charCodeAt(0))
      obj = JSON.parse(new TextDecoder().decode(bytes))
    } catch {
      error.value = 'Could not parse input. Paste valid JSON or legacy QR data.'
      return
    }
  }
  if (isPortableBundle(obj)) parsed.value = obj
  else {
    const legacy = parseLegacyTemplatePayload(obj)
    if (legacy) parsed.value = legacy
    else error.value = 'Invalid or unsupported training export.'
  }
}

function handleImport() {
  if (!parsed.value) return
  emit('import', parsed.value)
  jsonInput.value = ''
  parsed.value = null
  error.value = null
}

function handleClose() {
  jsonInput.value = ''
  parsed.value = null
  error.value = null
  emit('close')
}

async function handleFileInput(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  const text = await file.text()
  jsonInput.value = text
  handleParse()
}
</script>

<template>
  <UModal :open="open" :content="modalFocus" title="Import Template" description="Validate portable training data before importing." @update:open="value => { if (!value) handleClose() }">
    <template #content>
    <div class="max-h-[85dvh] flex flex-col">
      <div class="flex-none p-4 border-b border-(--ui-border) flex items-center justify-between">
        <h2 class="font-bold">Import Template</h2>
        <button class="text-(--ui-text-muted)" aria-label="Close" @click="handleClose">
          <UIcon name="i-ph-x" class="w-5 h-5" aria-hidden="true" />
        </button>
      </div>

      <div class="flex-1 overflow-y-auto p-4 space-y-4">
        <p class="text-sm text-(--ui-text-muted)">
          Paste template JSON or QR data, or upload a .json file.
        </p>

        <!-- File upload -->
        <label class="block">
          <span class="text-xs font-medium text-(--ui-text-muted) uppercase tracking-wider">Upload .json file</span>
          <input
            type="file"
            accept=".json,application/json"
            class="mt-1 block w-full text-sm text-(--ui-text-muted) file:mr-4 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-medium file:bg-(--color-surface) file:text-(--ui-text)"
            @change="handleFileInput"
          />
        </label>

        <!-- JSON textarea -->
        <div class="space-y-1">
          <label class="text-xs font-medium text-(--ui-text-muted) uppercase tracking-wider" for="import-json">
            Or paste JSON / QR data
          </label>
          <textarea
            id="import-json"
            v-model="jsonInput"
            rows="6"
            placeholder='{"version":1,"template":{"name":"..."}...}'
            class="w-full bg-(--color-surface) rounded-xl px-3 py-2.5 text-xs font-mono outline-none focus-visible:ring-2 focus-visible:ring-(--color-accent) resize-none"
          />
        </div>

        <UButton class="w-full" variant="outline" @click="handleParse">
          Preview
        </UButton>

        <p v-if="error" class="text-xs text-red-400" role="alert">{{ error }}</p>

        <div v-if="parsed" class="rounded-xl bg-(--color-surface) p-4 space-y-2">
          <p class="font-semibold">{{ templates.length }} template{{ templates.length !== 1 ? 's' : '' }}</p>
          <p class="text-xs text-(--ui-text-muted)">
            {{ exercises.length }} template exercise{{ exercises.length !== 1 ? 's' : '' }}
          </p>
        </div>
      </div>

      <div class="flex-none p-4 border-t border-(--ui-border)">
        <UButton
          color="primary"
          size="lg"
          class="w-full"
          :disabled="!parsed"
          @click="handleImport"
        >
          Import Template
        </UButton>
      </div>
    </div>
    </template>
  </UModal>
</template>

