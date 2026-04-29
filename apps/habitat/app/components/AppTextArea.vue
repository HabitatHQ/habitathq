<script setup lang="ts">
defineOptions({ inheritAttrs: false })

const emit = defineEmits<{
  'update:modelValue': [value: string]
  keydown: [event: KeyboardEvent]
  blur: [event: FocusEvent]
  focus: [event: FocusEvent]
}>()
</script>

<template>
  <UTextarea
    v-bind="$attrs"
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
