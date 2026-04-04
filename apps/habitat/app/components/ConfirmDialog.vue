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

watch(() => props.open, (isOpen) => {
  if (isOpen) void impact('light')
})

function handleConfirm() {
  void notification('warning')
  emit('confirm')
}

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
</script>

<template>
  <UModal :open="open" @update:open="(v) => emit('update:open', v)">
    <template #content>
      <div class="p-5 space-y-4">
        <div class="flex items-start gap-3">
          <div
            class="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
            :class="iconBg"
          >
            <UIcon :name="icon" class="w-5 h-5" :class="iconText" />
          </div>
          <div class="space-y-1">
            <p class="font-semibold">{{ title }}</p>
            <p class="text-sm text-(--ui-text-muted)">{{ message }}</p>
          </div>
        </div>
        <div class="flex justify-end gap-2">
          <UButton variant="ghost" color="neutral" @click="emit('cancel')">
            {{ cancelLabel ?? 'Cancel' }}
          </UButton>
          <UButton :color="(confirmColor ?? 'primary') as any" @click="handleConfirm">
            {{ confirmLabel ?? 'Confirm' }}
          </UButton>
        </div>
      </div>
    </template>
  </UModal>
</template>
