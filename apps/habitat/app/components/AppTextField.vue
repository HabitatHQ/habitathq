<script setup lang="ts">
defineOptions({ inheritAttrs: false })

const emit = defineEmits<{
  'update:modelValue': [value: string | number]
  keydown: [event: KeyboardEvent]
  blur: [event: FocusEvent]
  focus: [event: FocusEvent]
}>()
</script>

<template>
  <UInput
    v-bind="$attrs"
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
