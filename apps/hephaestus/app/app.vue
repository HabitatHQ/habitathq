<script setup lang="ts">
const { settings } = useAppSettings()
const db = useDatabase()
const { ensureSeeded } = useSeed()
const { load: loadExercises } = useExercises()

onMounted(() => {
  // Theme + motion preference
  watchEffect(() => {
    document.documentElement.setAttribute('data-theme', settings.value.theme ?? 'hephaestus')
    document.documentElement.classList.toggle('reduce-motion', settings.value.reduceMotion ?? false)
  })

  // Seed exercises once DB is ready, then load them into shared state.
  // Using watch here means any rpc calls already awaiting readyPromise will
  // resolve first, so seeding always runs before page-level queries return.
  watch(
    db.status,
    async (s) => {
      if (s !== 'ready') return
      try {
        await ensureSeeded()
      } catch (e) {
        console.error('[app] seeding failed:', e)
      }
      await loadExercises()
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
