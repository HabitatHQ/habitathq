<script setup lang="ts">
const props = defineProps<{
  modelValue: number[]
  labels: string[]
}>()

const emit = defineEmits<{
  'update:modelValue': [days: number[]]
}>()

function toggle(day: number) {
  const current = [...props.modelValue]
  const idx = current.indexOf(day)
  if (idx >= 0) {
    current.splice(idx, 1)
  } else {
    current.push(day)
    current.sort((a, b) => a - b)
  }
  emit('update:modelValue', current)
}
</script>

<template>
  <div class="flex gap-1.5">
    <button
      v-for="(label, i) in labels"
      :key="i"
      type="button"
      class="w-8 h-8 rounded-full text-xs font-medium border transition-colors"
      :class="modelValue.includes(i)
        ? 'bg-primary-500/20 border-primary-500 text-primary-300'
        : 'border-(--ui-border-accented) text-(--ui-text-dimmed) hover:border-(--ui-border-accented)'"
      :aria-pressed="modelValue.includes(i)"
      @click="toggle(i)"
    >
      {{ label }}
    </button>
  </div>
</template>
