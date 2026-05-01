<script setup lang="ts">
import { useAppSettings } from '~/composables/useAppSettings'

const { settings } = useAppSettings()
const colorMode = useColorMode()

// Apply theme class and data attribute on mount and when settings change
watchEffect(() => {
  if (!import.meta.client) return
  const html = document.documentElement
  const theme = settings.value.theme ?? 'hearth'
  // Remove existing theme attributes
  html.removeAttribute('data-theme')
  if (theme !== 'hearth') html.setAttribute('data-theme', theme)
  // Reduce motion
  html.classList.toggle('reduce-motion', settings.value.reduceMotion ?? false)
})

// Sync color mode preference
watchEffect(() => {
  if (!import.meta.client) return
  if (settings.value.colorMode) {
    colorMode.preference = settings.value.colorMode
  }
})
</script>

<template>
  <UApp>
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
