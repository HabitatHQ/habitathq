<script setup lang="ts">
import { nextTick, ref, useId, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    modelValue: boolean
    title: string
    message?: string
    confirmLabel?: string
    cancelLabel?: string
    busy?: boolean
  }>(),
  {
    confirmLabel: 'Confirm',
    cancelLabel: 'Cancel',
    busy: false,
  },
)

const emit = defineEmits<{
  confirm: []
  cancel: []
  'update:modelValue': [value: boolean]
}>()

const titleId = `destructive-confirm-title-${useId()}`
const descriptionId = `${titleId}-description`
const dialog = ref<HTMLDialogElement | null>(null)

watch(
  () => props.modelValue,
  async (open) => {
    await nextTick()
    if (open && dialog.value && !dialog.value.open) dialog.value.showModal()
    else if (!open && dialog.value?.open) dialog.value.close()
  },
  { immediate: true },
)

function cancel() {
  if (props.busy) return
  emit('update:modelValue', false)
  emit('cancel')
}

function confirm() {
  if (props.busy) return
  emit('confirm')
  emit('update:modelValue', false)
}
</script>

<template>
  <dialog
    v-if="modelValue"
    ref="dialog"
    role="alertdialog"
    aria-modal="true"
    :aria-labelledby="titleId"
    :aria-describedby="message || $slots['default'] ? descriptionId : undefined"
    :aria-busy="busy || undefined"
    @cancel.prevent="cancel"
  >
    <section class="space-y-4 p-5">
      <header>
        <h2 :id="titleId" class="text-lg font-semibold">
          <slot name="title">{{ title }}</slot>
        </h2>
        <div v-if="message || $slots['default']" :id="descriptionId" class="mt-2">
          <slot>{{ message }}</slot>
        </div>
      </header>
      <div class="flex justify-end gap-2">
        <slot name="actions" :cancel="cancel" :confirm="confirm">
          <button type="button" :disabled="busy" @click="cancel">{{ cancelLabel }}</button>
          <button type="button" :disabled="busy" @click="confirm">{{ confirmLabel }}</button>
        </slot>
      </div>
    </section>
  </dialog>
</template>
