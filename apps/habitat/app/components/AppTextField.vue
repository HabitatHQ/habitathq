<script setup lang="ts">
const props = defineProps<{
  modelValue?: string | number
  type?: string
  placeholder?: string
  autofocus?: boolean
  disabled?: boolean
  min?: string | number
  max?: string | number
  variant?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string | number]
  keydown: [event: KeyboardEvent]
  blur: [event: FocusEvent]
  focus: [event: FocusEvent]
}>()

const attrs = useAttrs()
</script>

<template>
  <UInput
    :model-value="props.modelValue"
    :type="props.type"
    :placeholder="props.placeholder"
    :autofocus="props.autofocus"
    :disabled="props.disabled"
    :min="props.min"
    :max="props.max"
    :variant="(props.variant as any)"
    v-bind="attrs"
    class="app-text-field"
    @update:model-value="emit('update:modelValue', $event)"
    @keydown="emit('keydown', $event)"
    @blur="emit('blur', $event)"
    @focus="emit('focus', $event)"
  />
</template>

<style scoped>
.app-text-field :deep(input) {
  font-size: 1rem;
  line-height: 1.5;
}
</style>
