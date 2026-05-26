<script setup lang="ts">
defineProps<{
  modelValue: string
  options: {
    value: string
    icon: string
    label?: string
    ariaLabel?: string
  }[]
}>()

defineEmits<{
  'update:modelValue': [value: string]
  change: [value: string]
}>()
</script>

<template>
  <AppToggleSwitcher
    :model-value="modelValue"
    :options="options"
    @update:model-value="$emit('update:modelValue', $event)"
    @change="$emit('change', $event)"
  />
</template>
