<script setup lang="ts">
const props = defineProps<{
  modelValue: string
  options: {
    value: string
    icon: string
    label?: string
    ariaLabel?: string
  }[]
  /** Accessible group label */
  groupLabel?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  change: [value: string]
}>()

const { selectionChanged } = useHaptics()

function select(val: string) {
  if (props.modelValue === val) return
  emit('update:modelValue', val)
  emit('change', val)
  void selectionChanged()
}
</script>

<template>
  <div
    class="flex items-center bg-(--ui-bg-elevated) p-1 rounded-lg gap-1"
    role="group"
    :aria-label="groupLabel"
  >
    <button
      v-for="opt in options"
      :key="opt.value"
      type="button"
      class="toggle-btn"
      :class="modelValue === opt.value
        ? 'bg-(--ui-bg) shadow-sm text-(--ui-text)'
        : 'text-(--ui-text-dimmed) hover:text-(--ui-text-toned)'"
      :aria-label="opt.ariaLabel || opt.label"
      :aria-pressed="modelValue === opt.value"
      @click="select(opt.value)"
    >
      <AppIcon :name="opt.icon" class="w-4 h-4" />
      <span v-if="opt.label" class="ml-1.5 text-sm font-medium">{{ opt.label }}</span>
    </button>
  </div>
</template>
