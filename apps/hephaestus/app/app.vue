<script setup lang="ts">
const { settings } = useAppSettings()

onMounted(() => {
  watchEffect(() => {
    document.documentElement.setAttribute('data-theme', settings.value.theme ?? 'hephaestus')
    document.documentElement.classList.toggle('reduce-motion', settings.value.reduceMotion ?? false)
  })
})
</script>

<template>
  <UApp>
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
