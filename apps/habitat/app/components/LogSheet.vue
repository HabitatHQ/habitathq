<script setup lang="ts">
/**
 * LogSheet — A bottom-sheet wrapper for logging numeric habit values.
 * Combines the ScrollPicker with the option to fall back to manual keyboard entry.
 * Includes ± quick-adjust buttons for fine-tuning without scrolling.
 */

const props = withDefaults(
  defineProps<{
    open: boolean
    title?: string
    icon?: string
    iconColor?: string
    current?: number
    target?: number
    min?: number
    max?: number
    step?: number
    unit?: string
    accent?: string
    loading?: boolean
  }>(),
  {
    title: '',
    icon: '',
    iconColor: '#22d3ee',
    current: 0,
    target: 0,
    min: 0,
    max: 100,
    step: 1,
    unit: '',
    accent: 'primary',
    loading: false,
  },
)

const emit = defineEmits<{
  save: [value: number]
  close: []
}>()

const { impact, selectionChanged } = useHaptics()

const pickerValue = ref(0)
const manualMode = ref(false)
const manualInput = ref('')
const sheetVisible = ref(false)

// When opened, initialise picker to the current value; animate in
watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      pickerValue.value = props.current
      manualInput.value = props.current > 0 ? String(props.current) : ''
      manualMode.value = false
      // Trigger slide-up animation on next frame
      requestAnimationFrame(() => {
        sheetVisible.value = true
        void impact('light')
      })
    } else {
      sheetVisible.value = false
    }
  },
)

function closeSheet() {
  sheetVisible.value = false
  setTimeout(() => emit('close'), 200)
}

function switchToManual() {
  manualInput.value = String(pickerValue.value)
  manualMode.value = true
  nextTick(() => {
    const el = document.getElementById('log-sheet-manual-input')
    el?.focus()
  })
}

function switchToPicker() {
  const parsed = Number.parseFloat(manualInput.value)
  if (!Number.isNaN(parsed) && parsed >= props.min && parsed <= props.max) {
    pickerValue.value = parsed
  }
  manualMode.value = false
}

function handleSave() {
  const value = manualMode.value ? Number.parseFloat(manualInput.value) || 0 : pickerValue.value
  emit('save', value)
}

function handleManualKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') handleSave()
}

// Quick-adjust: increment or decrement by step
function quickAdjust(direction: 1 | -1) {
  const newVal = Math.round((pickerValue.value + props.step * direction) * 1000) / 1000
  if (newVal >= props.min && newVal <= props.max) {
    pickerValue.value = newVal
    void selectionChanged()
  }
}

// Progress bar percentage
const progressPct = computed(() => {
  if (props.target <= 0) return 0
  const val = manualMode.value ? Number.parseFloat(manualInput.value) || 0 : pickerValue.value
  return Math.min(100, (val / props.target) * 100)
})

const displayValue = computed(() =>
  manualMode.value ? Number.parseFloat(manualInput.value) || 0 : pickerValue.value,
)

// Format for the header display
const displayFormatted = computed(() => {
  const v = displayValue.value
  if (props.step >= 1) return v.toLocaleString('en-US')
  return v.toFixed(1)
})

const targetFormatted = computed(() => {
  if (props.step >= 1) return props.target.toLocaleString('en-US')
  return props.target.toFixed(1)
})
</script>

<template>
  <div v-if="open" class="fixed inset-0 z-50 flex items-end justify-center">
    <!-- Backdrop -->
    <Transition name="fade">
      <div v-if="sheetVisible" class="modal-backdrop absolute inset-0 bg-black/60 backdrop-blur-sm" @click="closeSheet" />
    </Transition>

    <!-- Sheet -->
    <Transition name="slide-sheet">
      <div
        v-if="sheetVisible"
        class="log-sheet relative w-full sm:max-w-md bg-(--ui-bg-muted) border border-(--ui-border) rounded-t-3xl sm:rounded-2xl overflow-hidden"
      >
        <!-- Drag handle -->
        <div class="flex justify-center pt-3 pb-1">
          <div class="w-10 h-1 rounded-full bg-(--ui-border-accented)" />
        </div>

        <div class="px-5 pb-2 space-y-3">
          <!-- Header -->
          <div class="flex items-center gap-3">
            <div
              v-if="icon"
              class="w-11 h-11 rounded-2xl flex-shrink-0 flex items-center justify-center"
              :style="{ backgroundColor: iconColor + '18', border: `1px solid ${iconColor}33` }"
            >
              <UIcon :name="icon" class="w-5 h-5" :style="{ color: iconColor }" />
            </div>
            <div class="flex-1 min-w-0">
              <p class="text-base font-semibold truncate text-(--ui-text)">{{ title }}</p>
              <p v-if="target > 0" class="text-xs text-(--ui-text-dimmed)">
                <span class="font-semibold text-(--ui-text-toned) tabular-nums">{{ displayFormatted }}</span>
                <span class="mx-0.5 opacity-40">/</span>
                <span class="tabular-nums">{{ targetFormatted }}</span>
                <span v-if="unit" class="ml-0.5">{{ unit }}</span>
              </p>
            </div>
            <button
              class="text-xs font-medium px-2.5 py-1.5 rounded-lg transition-colors"
              :class="manualMode
                ? 'bg-(--ui-bg-elevated) text-primary-400 hover:bg-(--ui-bg-accented)'
                : 'bg-(--ui-bg-elevated) text-(--ui-text-dimmed) hover:text-(--ui-text-toned)'"
              @click="manualMode ? switchToPicker() : switchToManual()"
            >
              <UIcon
                :name="manualMode ? 'i-heroicons-adjustments-horizontal' : 'i-heroicons-pencil-square'"
                class="w-3.5 h-3.5 inline-block mr-1 -mt-0.5"
              />
              {{ manualMode ? 'Picker' : 'Type' }}
            </button>
          </div>

          <!-- Progress bar (only if target > 0) -->
          <div v-if="target > 0" class="h-1.5 bg-(--ui-bg-elevated) rounded-full overflow-hidden">
            <div
              class="h-full rounded-full transition-all duration-300 ease-out"
              :class="progressPct >= 100 ? 'bg-emerald-500' : `bg-${accent}-500`"
              :style="{ width: `${progressPct}%` }"
            />
          </div>

          <!-- Picker mode -->
          <div v-if="!manualMode" class="flex items-center justify-center gap-4 py-1">
            <!-- Minus button -->
            <button
              class="w-10 h-10 rounded-full bg-(--ui-bg-elevated) border border-(--ui-border) flex items-center justify-center text-(--ui-text-muted) hover:text-(--ui-text) hover:bg-(--ui-bg-accented) transition-colors active:scale-90 disable-text-select"
              :class="{ 'opacity-30 pointer-events-none': pickerValue <= min }"
              @click="quickAdjust(-1)"
            >
              <UIcon name="i-heroicons-minus" class="w-4 h-4" />
            </button>

            <!-- Scroll picker -->
            <div class="w-44">
              <ScrollPicker
                v-model="pickerValue"
                :min="min"
                :max="max"
                :step="step"
                :unit="unit"
                :visible-items="3"
              />
            </div>

            <!-- Plus button -->
            <button
              class="w-10 h-10 rounded-full bg-(--ui-bg-elevated) border border-(--ui-border) flex items-center justify-center text-(--ui-text-muted) hover:text-(--ui-text) hover:bg-(--ui-bg-accented) transition-colors active:scale-90 disable-text-select"
              :class="{ 'opacity-30 pointer-events-none': pickerValue >= max }"
              @click="quickAdjust(1)"
            >
              <UIcon name="i-heroicons-plus" class="w-4 h-4" />
            </button>
          </div>

          <!-- Manual input mode -->
          <div v-else class="flex flex-col items-center gap-3 py-6">
            <input
              id="log-sheet-manual-input"
              v-model="manualInput"
              type="number"
              :min="min"
              :max="max"
              :step="step"
              class="w-44 bg-(--ui-bg-elevated) border border-(--ui-border-accented) rounded-xl px-4 py-3 text-2xl font-bold text-(--ui-text) text-center focus:outline-none focus:border-primary-500 transition-colors tabular-nums"
              :placeholder="String(min)"
              @keydown="handleManualKeydown"
            />
            <p class="text-xs text-(--ui-text-dimmed)">
              Enter value{{ unit ? ` (${unit})` : '' }}
            </p>
          </div>

          <!-- Actions -->
          <div class="flex gap-3 pb-1">
            <UButton
              variant="ghost"
              color="neutral"
              class="flex-1 justify-center"
              @click="closeSheet"
            >
              Cancel
            </UButton>
            <UButton
              :color="accent === 'amber' ? 'warning' : 'primary'"
              class="flex-1 justify-center"
              :loading="loading"
              @click="handleSave"
            >
              Save
            </UButton>
          </div>
        </div>

        <div class="safe-area-bottom" aria-hidden="true" />
      </div>
    </Transition>
  </div>
</template>

<style scoped>
/* ── Slide-up animation ──────────────────────────────────── */
.slide-sheet-enter-active {
  transition: transform 0.3s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.2s ease;
}

.slide-sheet-leave-active {
  transition: transform 0.2s cubic-bezier(0.55, 0, 1, 0.45), opacity 0.15s ease;
}

.slide-sheet-enter-from {
  transform: translateY(100%);
  opacity: 0.5;
}

.slide-sheet-leave-to {
  transform: translateY(100%);
  opacity: 0;
}

/* ── Backdrop fade ──────────────────────────────────────── */
.fade-enter-active {
  transition: opacity 0.25s ease;
}

.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.disable-text-select {
  -webkit-user-select: none;
  user-select: none;
}
</style>
