<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    icon: string
    iconColor?: 'red' | 'amber' | 'primary'
    title: string
    message: string
    confirmLabel?: string
    confirmColor?: string
    cancelLabel?: string
  }>(),
  {
    iconColor: 'primary',
    confirmLabel: 'Confirm',
    confirmColor: 'primary',
    cancelLabel: 'Cancel',
  },
)

const emit = defineEmits<{
  confirm: []
  cancel: []
}>()

const modelValue = defineModel<boolean>({ default: false })
const { notification } = useHaptics()

const iconBg = computed(() => {
  if (props.iconColor === 'red') return 'bg-red-500/10'
  if (props.iconColor === 'amber') return 'bg-amber-500/10'
  return 'bg-primary-500/10'
})

const iconText = computed(() => {
  if (props.iconColor === 'red') return 'text-red-400'
  if (props.iconColor === 'amber') return 'text-amber-400'
  return 'text-primary-400'
})

function handleConfirm() {
  void notification('warning')
  emit('confirm')
  modelValue.value = false
}

function handleCancel() {
  emit('cancel')
  modelValue.value = false
}
</script>

<template>
  <AppBottomSheet v-model="modelValue" variant="centered" max-width="sm" :closeable="false">
    <div class="space-y-4">
      <div class="flex items-start gap-3">
        <div
          class="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
          :class="iconBg"
        >
          <AppIcon :name="icon" class="w-5 h-5" :class="iconText" />
        </div>
        <div class="space-y-1">
          <p class="font-semibold">{{ title }}</p>
          <p class="text-sm text-(--ui-text-muted)">{{ message }}</p>
        </div>
      </div>
      <div class="flex justify-end gap-2">
        <UButton variant="ghost" color="neutral" @click="handleCancel">
          {{ cancelLabel }}
        </UButton>
        <UButton :color="(confirmColor as any)" class="btn-press" @click="handleConfirm">
          {{ confirmLabel }}
        </UButton>
      </div>
    </div>
  </AppBottomSheet>
</template>
