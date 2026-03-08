<script setup lang="ts">
const { settings } = useAppSettings()
const db = useDatabase()
const { ensureSeeded } = useSeed()

onMounted(() => {
  // Theme + motion preference
  watchEffect(() => {
    document.documentElement.setAttribute('data-theme', settings.value.theme ?? 'hephaestus')
    document.documentElement.classList.toggle('reduce-motion', settings.value.reduceMotion ?? false)
  })

  // Seed exercises once DB is ready
  watch(
    db.status,
    async (s) => {
      if (s === 'ready') await ensureSeeded()
    },
    { immediate: true },
  )
})
</script>

<template>
  <UApp>
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
