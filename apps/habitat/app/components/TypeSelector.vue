<script setup lang="ts">
defineProps<{
  modelValue: string
  options: { value: string; label: string }[]
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const { selectionChanged } = useHaptics()

function select(value: string) {
  emit('update:modelValue', value)
  void selectionChanged()
}
</script>

<template>
  <div class="flex gap-2">
    <button
      v-for="opt in options"
      :key="opt.value"
      type="button"
      class="flex-1 py-1.5 rounded-lg text-sm font-medium transition-colors"
      :class="modelValue === opt.value
        ? 'bg-primary-600 text-white'
        : 'bg-(--ui-bg-elevated) text-(--ui-text-toned)'"
      :aria-pressed="modelValue === opt.value"
      @click="select(opt.value)"
    >
      {{ opt.label }}
    </button>
  </div>
</template>
