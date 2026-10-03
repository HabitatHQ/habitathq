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

const dialogProps = computed(() => ({
  icon: props.icon,
  title: props.title,
  message: props.message,
  ...(props.iconColor === undefined ? {} : { iconColor: props.iconColor }),
  ...(props.confirmLabel === undefined ? {} : { confirmLabel: props.confirmLabel }),
  ...(props.confirmColor === undefined ? {} : { confirmColor: props.confirmColor }),
  ...(props.cancelLabel === undefined ? {} : { cancelLabel: props.cancelLabel }),
}))

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
    v-bind="dialogProps"
    @confirm="handleConfirm"
    @cancel="emit('cancel')"
  />
</template>
