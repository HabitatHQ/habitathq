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

const sheetRef = ref<HTMLElement | null>(null)
let triggerElement: HTMLElement | null = null

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

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && !props.persistent) {
    e.stopPropagation()
    modelValue.value = false
    return
  }

  if (e.key !== 'Tab' || !sheetRef.value) return
  const focusable = sheetRef.value.querySelectorAll<HTMLElement>(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )
  if (focusable.length === 0) return
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault()
    first.focus()
  }
}

// Lock the page behind the sheet: `overflow: hidden` stops scrolling and
// `overscroll-behavior: none` on the root stops the viewport rubber-band (the
// slight sideways drag-and-bounce when scrolling a picker inside the sheet).
function lockScroll(locked: boolean) {
  document.body.style.overflow = locked ? 'hidden' : ''
  document.documentElement.style.overscrollBehavior = locked ? 'none' : ''
}

watch(modelValue, async (open) => {
  if (open) {
    triggerElement = document.activeElement as HTMLElement | null
    lockScroll(true)
    void impact('light')
    await nextTick()
    const firstFocusable = sheetRef.value?.querySelector<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )
    firstFocusable?.focus()
  } else {
    lockScroll(false)
    triggerElement?.focus()
    triggerElement = null
  }
})

onUnmounted(() => {
  lockScroll(false)
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
        ref="sheetRef"
        class="fixed inset-0 z-50 flex justify-center"
        :class="variant === 'sheet' ? 'items-end sm:items-center' : 'items-center'"
        role="dialog"
        aria-modal="true"
        :aria-label="title"
        @keydown="handleKeydown"
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
