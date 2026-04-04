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
  <div class="flex gap-1.5">
    <button
      v-for="opt in options"
      :key="opt.value"
      type="button"
      class="flex-1 py-1.5 px-2 rounded-lg text-xs font-medium border transition-colors"
      :class="modelValue === opt.value
        ? 'bg-primary-500/20 border-primary-500 text-primary-300'
        : 'border-(--ui-border-accented) text-(--ui-text-dimmed) hover:border-(--ui-border-accented) hover:text-(--ui-text-muted)'"
      :aria-pressed="modelValue === opt.value"
      @click="select(opt.value)"
    >
      {{ opt.label }}
    </button>
  </div>
</template>
