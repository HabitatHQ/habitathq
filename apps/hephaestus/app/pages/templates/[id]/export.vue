<script setup lang="ts">
import { buildExportPayload, payloadToQrData } from '~/lib/template-export'

const route = useRoute()
const { getById, getExercises } = useTemplates()
const { getForTemplate } = useTemplateGroups()
const db = useDatabase()

const templateId = computed(() => route.params.id as string)
const template = ref<any>(null)
const exercises = ref<any[]>([])
const groups = ref<any[]>([])
const loading = ref(true)
const copied = ref(false)
const qrData = ref<string | null>(null)

watch(
  db.status,
  async (s) => {
    if (s !== 'ready') return
    loading.value = true
    try {
      template.value = await getById(templateId.value)
      exercises.value = await getExercises(templateId.value)
      groups.value = await getForTemplate(templateId.value)
    } finally {
      loading.value = false
    }
  },
  { immediate: true },
)

const exportPayload = computed(() => {
  if (!template.value) return null
  return buildExportPayload(template.value, exercises.value, groups.value)
})

const exportJson = computed(() => {
  if (!exportPayload.value) return ''
  return JSON.stringify(exportPayload.value, null, 2)
})

async function handleCopyJson() {
  if (!exportJson.value) return
  await navigator.clipboard.writeText(exportJson.value)
  copied.value = true
  setTimeout(() => {
    copied.value = false
  }, 2000)
}

async function handleDownload() {
  if (!exportJson.value || !template.value) return
  const blob = new Blob([exportJson.value], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${template.value.name.replace(/\s+/g, '-').toLowerCase()}.json`
  a.click()
  URL.revokeObjectURL(url)
}

function handleShowQr() {
  if (!exportPayload.value) return
  qrData.value = payloadToQrData(exportPayload.value)
}

const payloadSizeKb = computed(() => {
  if (!exportJson.value) return 0
  return (new Blob([exportJson.value]).size / 1024).toFixed(1)
})
</script>

<template>
  <article class="p-4 pb-24 space-y-5">
    <header class="flex items-center gap-3 pt-2">
      <NuxtLink :to="`/templates/${templateId}`" class="text-(--ui-text-muted)" aria-label="Back">
        <UIcon name="i-heroicons-arrow-left" class="w-6 h-6" aria-hidden="true" />
      </NuxtLink>
      <h1 class="text-xl font-bold flex-1">Export Template</h1>
    </header>

    <div v-if="loading" class="text-center py-12 text-(--ui-text-muted)">
      <p>Loading…</p>
    </div>

    <template v-else-if="template">
      <div class="rounded-xl bg-(--color-surface) p-4 space-y-2">
        <p class="font-semibold">{{ template.name }}</p>
        <p class="text-xs text-(--ui-text-muted)">
          {{ exercises.length }} exercise{{ exercises.length !== 1 ? 's' : '' }} · {{ payloadSizeKb }}KB
        </p>
        <p v-if="Number(payloadSizeKb) > 3" class="text-xs text-amber-400">
          ⚠ Payload exceeds 3KB — QR code may not be scannable.
        </p>
      </div>

      <div class="space-y-3">
        <UButton class="w-full" color="primary" @click="handleDownload">
          <UIcon name="i-heroicons-arrow-down-tray" class="w-4 h-4" aria-hidden="true" />
          Download JSON
        </UButton>
        <UButton class="w-full" variant="outline" @click="handleCopyJson">
          <UIcon :name="copied ? 'i-heroicons-check' : 'i-heroicons-clipboard'" class="w-4 h-4" aria-hidden="true" />
          {{ copied ? 'Copied!' : 'Copy JSON' }}
        </UButton>
        <UButton class="w-full" variant="ghost" @click="handleShowQr">
          <UIcon name="i-heroicons-qr-code" class="w-4 h-4" aria-hidden="true" />
          Show QR Code
        </UButton>
      </div>

      <div v-if="qrData" class="rounded-xl bg-(--color-surface) p-4 text-center space-y-2">
        <p class="text-xs text-(--ui-text-muted)">QR data (base64):</p>
        <p class="text-xs font-mono break-all text-(--ui-text-muted) max-h-32 overflow-auto">{{ qrData }}</p>
        <p class="text-xs text-(--ui-text-muted)">Scan with another device running Hephaestus to import.</p>
      </div>
    </template>
  </article>
</template>
