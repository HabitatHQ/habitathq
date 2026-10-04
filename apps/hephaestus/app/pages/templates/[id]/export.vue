<script setup lang="ts">
import { downloadBlob } from '@habitathq/shared/app/composables/downloadBlob'
import type { PortableBundle } from '~/lib/data-transfer'

const route = useRoute()
const db = useDatabase()
const templateId = computed(() => String(route.params['id'] ?? ''))
const templateName = ref('Template')
const exportPayload = ref<PortableBundle | null>(null)
const loading = ref(true)
const copied = ref(false)
const qrData = ref<string | null>(null)

watch(
  db.status,
  async (status) => {
    if (status !== 'ready') return
    loading.value = true
    try {
      exportPayload.value = await db.transfer<PortableBundle>('TRANSFER_EXPORT_PORTABLE', {
        templateId: templateId.value,
      })
      templateName.value = String(
        exportPayload.value.tables['templates']?.[0]?.['name'] ?? 'Template',
      )
    } finally {
      loading.value = false
    }
  },
  { immediate: true },
)

const exportJson = computed(() =>
  exportPayload.value ? JSON.stringify(exportPayload.value, null, 2) : '',
)
async function handleCopyJson() {
  if (!exportJson.value) return
  await navigator.clipboard.writeText(exportJson.value)
  copied.value = true
  setTimeout(() => {
    copied.value = false
  }, 2000)
}
function handleDownload() {
  if (!exportJson.value) return
  downloadBlob(
    new Blob([exportJson.value], { type: 'application/json' }),
    `${templateName.value.replace(/\s+/g, '-').toLowerCase()}.json`,
  )
}
function handleShowQr() {
  if (!exportJson.value) return
  const bytes = new TextEncoder().encode(exportJson.value)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  qrData.value = btoa(binary)
}
const payloadSizeKb = computed(() =>
  exportJson.value ? (new Blob([exportJson.value]).size / 1024).toFixed(1) : '0.0',
)
</script>


<template>
  <article class="p-4 pb-24 space-y-5">
    <header class="flex items-center gap-3 pt-2">
      <NuxtLink :to="`/templates/${templateId}`" class="text-(--ui-text-muted)" aria-label="Back">
        <UIcon name="i-ph-arrow-left" class="w-6 h-6" aria-hidden="true" />
      </NuxtLink>
      <h1 class="text-xl font-bold flex-1">Export Template</h1>
    </header>

    <div v-if="loading" class="text-center py-12 text-(--ui-text-muted)">
      <p>Loading…</p>
    </div>

    <template v-else-if="exportPayload">
      <div class="rounded-xl bg-(--color-surface) p-4 space-y-2">
        <p class="font-semibold">{{ templateName }}</p>
        <p class="text-xs text-(--ui-text-muted)">
          {{ exportPayload.tables['template_exercises']?.length ?? 0 }} exercises · {{ payloadSizeKb }}KB
        </p>
        <p v-if="Number(payloadSizeKb) > 3" class="text-xs text-amber-400">
          Bundle exceeds 3KB; QR text may be difficult to transfer.
        </p>
      </div>

      <div class="space-y-3">
        <UButton class="w-full" color="primary" @click="handleDownload">
          <UIcon name="i-ph-download-simple" class="w-4 h-4" aria-hidden="true" />
          Download JSON
        </UButton>
        <UButton class="w-full" variant="outline" @click="handleCopyJson">
          <UIcon :name="copied ? 'i-ph-check' : 'i-ph-clipboard'" class="w-4 h-4" aria-hidden="true" />
          {{ copied ? 'Copied!' : 'Copy JSON' }}
        </UButton>
        <UButton class="w-full" variant="ghost" @click="handleShowQr">
          <UIcon name="i-ph-qr-code" class="w-4 h-4" aria-hidden="true" />
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
