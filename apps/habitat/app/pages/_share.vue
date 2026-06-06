<script setup lang="ts">
const route = useRoute()
const router = useRouter()
const { ingestFromPwaParams } = useShareIngest()

onMounted(async () => {
  const title = (route.query['title'] as string) || ''
  const text = (route.query['text'] as string) || ''
  const url = (route.query['url'] as string) || ''

  if (title || text || url) {
    await ingestFromPwaParams({ title, text, url })
    if (navigator.vibrate) navigator.vibrate(10)
  }

  await router.replace('/jots')
})
</script>

<template>
  <div class="flex items-center justify-center min-h-[60vh]">
    <p class="text-sm text-(--ui-text-dimmed)">Saving to Habitat...</p>
  </div>
</template>
