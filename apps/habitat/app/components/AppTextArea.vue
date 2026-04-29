<script setup lang="ts">
const props = defineProps<{
  modelValue?: string
  placeholder?: string
  rows?: number
  autoresize?: boolean
  disabled?: boolean
  variant?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  keydown: [event: KeyboardEvent]
  blur: [event: FocusEvent]
  focus: [event: FocusEvent]
}>()

const attrs = useAttrs()
</script>

<template>
  <UTextarea
    :model-value="props.modelValue"
    :placeholder="props.placeholder"
    :rows="props.rows"
    :autoresize="props.autoresize"
    :disabled="props.disabled"
    :variant="(props.variant as any)"
    v-bind="attrs"
    class="app-text-area"
    @update:model-value="emit('update:modelValue', $event)"
    @keydown="emit('keydown', $event)"
    @blur="emit('blur', $event)"
    @focus="emit('focus', $event)"
  />
</template>

<style scoped>
.app-text-area :deep(textarea) {
  font-size: 1rem;
  line-height: 1.625;
}
</style>
