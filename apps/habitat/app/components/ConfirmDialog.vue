<script setup lang="ts">
const props = defineProps<{
  open: boolean
  icon: string
  iconColor?: 'red' | 'amber' | 'primary'
  title: string
  message: string
  confirmLabel?: string
  confirmColor?: string
  cancelLabel?: string
}>()

const emit = defineEmits<{
  confirm: []
  cancel: []
  'update:open': [open: boolean]
}>()

const { impact, notification } = useHaptics()

const openModel = computed({
  get: () => props.open,
  set: (v: boolean) => emit('update:open', v),
})

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) void impact('light')
  },
)

function handleConfirm() {
  void notification('warning')
  emit('confirm')
}
</script>

<template>
  <AppConfirmDialog
    v-model="openModel"
    :icon="icon"
    :icon-color="iconColor"
    :title="title"
    :message="message"
    :confirm-label="confirmLabel"
    :confirm-color="confirmColor"
    :cancel-label="cancelLabel"
    @confirm="handleConfirm"
    @cancel="emit('cancel')"
  />
</template>
