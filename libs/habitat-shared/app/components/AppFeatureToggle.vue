<script setup lang="ts">
import { computed, useId } from 'vue'

const props = withDefaults(
  defineProps<{
    modelValue: boolean
    label: string
    description?: string
    disabled?: boolean
    busy?: boolean
    id?: string
  }>(),
  {
    disabled: false,
    busy: false,
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const generatedId = useId()
const inputId = computed(() => props.id ?? `feature-toggle-${generatedId}`)
const descriptionId = computed(() => `${inputId.value}-description`)

function update(event: Event) {
  const input = event.currentTarget
  if (!(input instanceof HTMLInputElement)) return
  emit('update:modelValue', input.checked)
  input.checked = props.modelValue
}
</script>

<template>
  <label :for="inputId" class="inline-flex items-center gap-3 cursor-pointer">
    <span class="min-w-0">
      <span class="block"><slot name="label">{{ label }}</slot></span>
      <span v-if="description || $slots['description']" :id="descriptionId" class="block text-sm">
        <slot name="description">{{ description }}</slot>
      </span>
    </span>
    <input
      :id="inputId"
      class="h-5 w-5 shrink-0 accent-current"
      type="checkbox"
      role="switch"
      :checked="modelValue"
      :disabled="disabled || busy"
      :aria-label="$slots['label'] ? undefined : label"
      :aria-describedby="description || $slots['description'] ? descriptionId : undefined"
      :aria-busy="busy || undefined"
      @change="update"
    />
  </label>
</template>
