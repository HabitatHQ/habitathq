<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    title?: string
    variant?: 'sheet' | 'centered'
    maxWidth?: 'sm' | 'md' | 'lg'
    closeable?: boolean
    persistent?: boolean
  }>(),
  {
    variant: 'sheet',
    maxWidth: 'md',
    closeable: true,
    persistent: false,
  },
)

const modelValue = defineModel<boolean>({ default: false })
const slots = useSlots()
const { impact } = useHaptics()

const maxWidthClass = computed(() => {
  const map = { sm: 'sm:max-w-sm', md: 'sm:max-w-md', lg: 'sm:max-w-lg' }
  return map[props.maxWidth]
})

function handleBackdropClick() {
  if (!props.persistent) {
    modelValue.value = false
  }
}

function handleClose() {
  modelValue.value = false
}

watch(modelValue, (open) => {
  if (open) {
    document.body.style.overflow = 'hidden'
    void impact('light')
  } else {
    document.body.style.overflow = ''
  }
})

onUnmounted(() => {
  document.body.style.overflow = ''
})
</script>

<template>
  <Teleport to="body">
    <Transition
      :enter-active-class="variant === 'sheet' ? 'sheet-slide-enter-active' : 'sheet-scale-enter-active'"
      :enter-from-class="variant === 'sheet' ? 'sheet-slide-enter-from' : 'sheet-scale-enter-from'"
      :leave-active-class="variant === 'sheet' ? 'sheet-slide-leave-active' : 'sheet-scale-leave-active'"
      :leave-to-class="variant === 'sheet' ? 'sheet-slide-leave-to' : 'sheet-scale-leave-to'"
    >
      <div
        v-if="modelValue"
        class="fixed inset-0 z-50 flex justify-center"
        :class="variant === 'sheet' ? 'items-end sm:items-center' : 'items-center'"
        role="dialog"
        aria-modal="true"
        :aria-label="title"
      >
        <!-- Backdrop -->
        <div
          class="absolute inset-0 bg-black/60 backdrop-blur-sm sheet-backdrop"
          @click="handleBackdropClick"
        />

        <!-- Sheet panel -->
        <div
          class="relative w-full bg-(--ui-bg-muted) border border-(--ui-border) flex flex-col max-h-[90dvh] overscroll-contain shadow-xl"
          :class="[
            maxWidthClass,
            variant === 'sheet'
              ? 'rounded-t-3xl sm:rounded-2xl'
              : 'rounded-2xl mx-4',
          ]"
        >
          <!-- Header -->
          <div
            v-if="slots['title'] || title || closeable"
            class="flex items-center justify-between px-5 pt-5 pb-0"
          >
            <div class="flex-1 min-w-0">
              <slot name="title">
                <h2 v-if="title" class="text-lg font-semibold truncate">{{ title }}</h2>
              </slot>
            </div>
            <button
              v-if="closeable"
              type="button"
              class="icon-btn shrink-0 hover:bg-(--ui-bg-elevated) ml-2"
              aria-label="Close"
              @click="handleClose"
            >
              <AppIcon name="x-mark" class="w-5 h-5 text-(--ui-text-muted)" />
            </button>
          </div>

          <!-- Scrollable content -->
          <div class="overflow-y-auto flex-1 px-5 py-4 space-y-4">
            <slot />
          </div>

          <!-- Sticky footer -->
          <div
            v-if="slots['footer']"
            class="sticky bottom-0 bg-(--ui-bg-muted) border-t border-(--ui-border) px-5 py-4 rounded-b-2xl"
          >
            <slot name="footer" />
            <div class="pb-safe" aria-hidden="true" />
          </div>
          <div v-else class="pb-safe" aria-hidden="true" />
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
