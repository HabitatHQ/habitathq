<script setup lang="ts">
import { generateUuidV7 } from '@palladium/core'

// Image capture / gallery picker bottom sheet
const emit = defineEmits<{ close: [] }>()
const store = useJotsStore()
const media = getMediaStore()
const { impact, notification } = useHaptics()

const errorMsg = ref<string | null>(null)
const imagePreview = ref<{ url: string; file: File } | null>(null)
const saving = ref(false)
const galleryInput = ref<HTMLInputElement | null>(null)
const cameraInput = ref<HTMLInputElement | null>(null)
let disposed = false
let savingUrl: string | null = null

function pickFromGallery() {
  void impact('light')
  galleryInput.value?.click()
}

function pickFromCamera() {
  void impact('light')
  cameraInput.value?.click()
}

function onImageSelected(event: Event) {
  const input = event.target
  if (!(input instanceof HTMLInputElement)) return
  const file = input.files?.[0]
  if (file) showPreview(file)
  input.value = ''
}

function releasePreview(preserveUrl: string | null = null) {
  const preview = imagePreview.value
  imagePreview.value = null
  if (preview && preview.url !== preserveUrl) media.revokeObjectURL(preview.url)
}

function showPreview(file: File) {
  const url = media.createObjectURL(file)
  releasePreview(savingUrl)
  imagePreview.value = { url, file }
}

function cancelPreview() {
  releasePreview(savingUrl)
}

async function saveImage() {
  const preview = imagePreview.value
  if (!preview || saving.value) return
  saving.value = true
  savingUrl = preview.url
  try {
    const { file, url } = preview
    const id = generateUuidV7()
    const arrayBuffer = await file.arrayBuffer()
    const blob = new Blob([arrayBuffer], { type: file.type })
    await store.addImageNote(
      {
        id,
        blob,
        mimeType: file.type,
        filename: file.name,
        title: '',
        created_at: new Date().toISOString(),
      },
      url,
    )
    releasePreview(savingUrl)
    void notification('success')
    emit('close')
  } catch (err: unknown) {
    if (disposed || imagePreview.value?.url !== preview.url) media.revokeObjectURL(preview.url)
    if (!disposed) errorMsg.value = err instanceof Error ? err.message : String(err)
  } finally {
    savingUrl = null
    saving.value = false
  }
}

onUnmounted(() => {
  disposed = true
  releasePreview(savingUrl)
})
</script>

<template>
  <div class="space-y-4">
    <input ref="galleryInput" type="file" accept="image/*" hidden @change="onImageSelected" />
    <input ref="cameraInput" type="file" accept="image/*" capture="environment" hidden @change="onImageSelected" />
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2">
        <AppIconButton v-if="imagePreview" icon="arrow-left" label="Back to camera" @click="cancelPreview" />
        <h3 class="text-base font-semibold">Photograph</h3>
      </div>
      <AppIconButton icon="x-mark" label="Close camera" @click="emit('close')" />
    </div>

    <UAlert
      v-if="errorMsg"
      :title="errorMsg"
      color="error"
      variant="soft"
      :icon="resolveIcon('exclamation-circle')"
      :close-button="{ icon: resolveIcon('x-mark'), color: 'error', variant: 'ghost', size: 'sm' }"
      @close="errorMsg = null"
    />

    <div v-if="!imagePreview" class="flex flex-col items-center gap-5 py-4">
      <div class="w-20 h-20 rounded-2xl bg-(--ui-bg-elevated) border border-(--ui-border-accented) flex items-center justify-center">
        <AppIcon name="photo" class="w-10 h-10 text-(--ui-text-dimmed)" />
      </div>
      <p class="text-xs text-(--ui-text-dimmed)">Choose an image source</p>
      <div class="flex gap-3">
        <UButton :icon="resolveIcon('photo')" variant="soft" color="neutral" @click="pickFromGallery">Gallery</UButton>
        <UButton :icon="resolveIcon('camera')" variant="soft" color="neutral" @click="pickFromCamera">Camera</UButton>
      </div>
    </div>

    <div v-else class="flex flex-col items-center gap-4 py-2">
      <img :src="imagePreview.url" :alt="imagePreview.file.name" class="max-h-[50vh] w-auto rounded-2xl border border-(--ui-border) object-contain" />
      <p class="text-xs text-(--ui-text-muted) truncate max-w-full px-2">{{ imagePreview.file.name }}</p>
      <div class="flex gap-3">
        <UButton variant="soft" color="neutral" @click="cancelPreview">Choose another</UButton>
        <UButton :loading="saving" @click="saveImage">Save</UButton>
      </div>
    </div>
  </div>
</template>
