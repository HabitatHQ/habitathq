<script setup lang="ts">
// Image capture / gallery picker bottom sheet
const emit = defineEmits<{ close: [] }>()
const store = useJotsStore()
const { impact, notification } = useHaptics()

const errorMsg = ref<string | null>(null)
const imagePreview = ref<{ url: string; file: File } | null>(null)
const saving = ref(false)

function pickFromGallery() {
  void impact('light')
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
  input.onchange = () => {
    const file = input.files?.[0]
    if (file) showPreview(file)
  }
  input.click()
}

function pickFromCamera() {
  void impact('light')
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
  input.setAttribute('capture', 'environment')
  input.onchange = () => {
    const file = input.files?.[0]
    if (file) showPreview(file)
  }
  input.click()
}

function showPreview(file: File) {
  if (imagePreview.value) URL.revokeObjectURL(imagePreview.value.url)
  imagePreview.value = { url: URL.createObjectURL(file), file }
}

function cancelPreview() {
  if (imagePreview.value) {
    URL.revokeObjectURL(imagePreview.value.url)
    imagePreview.value = null
  }
}

async function saveImage() {
  if (!imagePreview.value || saving.value) return
  saving.value = true
  try {
    const { file, url } = imagePreview.value
    const id = crypto.randomUUID()
    const arrayBuffer = await file.arrayBuffer()
    const blob = new Blob([arrayBuffer], { type: file.type })
    await store.addImageNote(
      {
        id,
        blob,
        mimeType: file.type,
        filename: file.name,
        created_at: new Date().toISOString(),
      },
      url,
    )
    imagePreview.value = null
    void notification('success')
    emit('close')
  } catch (err: unknown) {
    errorMsg.value = err instanceof Error ? err.message : String(err)
  } finally {
    saving.value = false
  }
}

onUnmounted(() => {
  if (imagePreview.value) URL.revokeObjectURL(imagePreview.value.url)
})
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2">
        <UButton v-if="imagePreview" :icon="resolveIcon('arrow-left')" variant="ghost" color="neutral" size="sm" @click="cancelPreview" />
        <h3 class="text-base font-semibold">Photograph</h3>
      </div>
      <UButton :icon="resolveIcon('x-mark')" variant="ghost" color="neutral" size="sm" @click="emit('close')" />
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
