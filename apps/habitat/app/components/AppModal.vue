<script setup lang="ts">
defineProps<{
  title?: string
}>()

const modelValue = defineModel<boolean>({ default: false })
</script>

<template>
  <AppBottomSheet v-model="modelValue" :title="title" :closeable="false">
    <template v-if="$slots['title']" #title>
      <slot name="title" />
    </template>
    <slot />
    <template v-if="$slots['footer']" #footer>
      <slot name="footer" />
    </template>
  </AppBottomSheet>
</template>
