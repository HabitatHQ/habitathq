<script setup lang="ts">
import { type ExportPayload, qrDataToPayload, validateImportPayload } from '~/lib/template-export'

interface Props {
  open: boolean
}

defineProps<Props>()
const emit = defineEmits<{
  close: []
  import: [payload: ExportPayload]
}>()

const jsonInput = ref('')
const error = ref<string | null>(null)
const parsed = ref<ExportPayload | null>(null)

function handleParse() {
  error.value = null
  parsed.value = null
  const text = jsonInput.value.trim()
  if (!text) {
    error.value = 'Please paste JSON or QR data.'
    return
  }

  // Try JSON first
  try {
    const obj = JSON.parse(text)
    if (!validateImportPayload(obj)) {
      error.value = 'Invalid template format.'
      return
    }
    parsed.value = obj as ExportPayload
    return
  } catch {
    // Not JSON — try QR base64
  }

  const fromQr = qrDataToPayload(text)
  if (fromQr) {
    parsed.value = fromQr
    return
  }

  error.value = 'Could not parse input. Paste valid JSON or QR data.'
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
  <Transition name="slide-up">
    <div
      v-if="open"
      class="fixed inset-x-0 bottom-0 z-50 bg-(--ui-bg) rounded-t-2xl shadow-2xl max-h-[80vh] flex flex-col"
      role="dialog"
      aria-label="Import Template"
      aria-modal="true"
    >
      <div class="flex-none p-4 border-b border-(--ui-border) flex items-center justify-between">
        <h2 class="font-bold">Import Template</h2>
        <button class="text-(--ui-text-muted)" aria-label="Close" @click="handleClose">
          <UIcon name="i-heroicons-x-mark" class="w-5 h-5" />
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

        <!-- Preview -->
        <div v-if="parsed" class="rounded-xl bg-(--color-surface) p-4 space-y-2">
          <p class="font-semibold">{{ parsed.template.name }}</p>
          <p v-if="parsed.template.description" class="text-xs text-(--ui-text-muted)">
            {{ parsed.template.description }}
          </p>
          <p class="text-xs text-(--ui-text-muted)">
            {{ parsed.exercises.length }} exercise{{ parsed.exercises.length !== 1 ? 's' : '' }}
          </p>
          <ul class="text-xs text-(--ui-text-muted) space-y-0.5">
            <li v-for="ex in parsed.exercises.slice(0, 5)" :key="ex.order_num">
              {{ ex.order_num }}. {{ ex.exercise_name }}
            </li>
            <li v-if="parsed.exercises.length > 5" class="text-(--ui-text-muted)">
              +{{ parsed.exercises.length - 5 }} more…
            </li>
          </ul>
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
  </Transition>
</template>

<style scoped>
.slide-up-enter-active,
.slide-up-leave-active {
  transition: transform 0.25s ease;
}
.slide-up-enter-from,
.slide-up-leave-to {
  transform: translateY(100%);
}
</style>
