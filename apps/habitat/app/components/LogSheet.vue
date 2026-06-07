<script setup lang="ts">
/**
 * LogSheet — logging numeric habit values. Built on the shared AppBottomSheet
 * (focus trap, scroll lock, a11y, transitions); this component supplies the
 * ScrollPicker + manual-entry + quick-adjust UI.
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

const { selectionChanged } = useHaptics()

const pickerValue = ref(0)
const manualMode = ref(false)
const manualInput = ref('')

// When opened, initialise the picker to the current value.
watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      pickerValue.value = props.current
      manualInput.value = props.current > 0 ? String(props.current) : ''
      manualMode.value = false
    }
  },
)

function onModelUpdate(value: boolean) {
  if (!value) emit('close')
}

function switchToManual() {
  manualInput.value = String(pickerValue.value)
  manualMode.value = true
  nextTick(() => {
    document.getElementById('log-sheet-manual-input')?.focus()
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

const progressPct = computed(() => {
  if (props.target <= 0) return 0
  const val = manualMode.value ? Number.parseFloat(manualInput.value) || 0 : pickerValue.value
  return Math.min(100, (val / props.target) * 100)
})

const displayValue = computed(() =>
  manualMode.value ? Number.parseFloat(manualInput.value) || 0 : pickerValue.value,
)

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
  <AppBottomSheet
    :model-value="open"
    :title="title ? `Log ${title}` : 'Log value'"
    :closeable="false"
    max-width="md"
    @update:model-value="onModelUpdate"
  >
    <!-- Header: icon + name + progress + picker/manual toggle -->
    <template #title>
      <div class="flex items-center gap-3 w-full">
        <div
          v-if="icon"
          class="w-11 h-11 rounded-2xl flex-shrink-0 flex items-center justify-center"
          :style="{ backgroundColor: `${iconColor}18`, border: `1px solid ${iconColor}33` }"
        >
          <AppIcon :name="icon" class="w-5 h-5" :color="iconColor" />
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
          class="text-xs font-medium px-2.5 py-1.5 rounded-lg transition-colors shrink-0"
          :class="manualMode
            ? 'bg-(--ui-bg-elevated) text-primary-400 hover:bg-(--ui-bg-accented)'
            : 'bg-(--ui-bg-elevated) text-(--ui-text-dimmed) hover:text-(--ui-text-toned)'"
          :aria-label="manualMode ? 'Switch to picker' : 'Switch to manual input'"
          @click="manualMode ? switchToPicker() : switchToManual()"
        >
          <AppIcon
            :name="manualMode ? 'adjustments-horizontal' : 'pencil-square'"
            class="w-4 h-4 inline-block mr-1 -mt-0.5"
          />
          {{ manualMode ? 'Picker' : 'Type' }}
        </button>
      </div>
    </template>

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
      <button
        type="button"
        class="icon-btn bg-(--ui-bg-elevated) border border-(--ui-border) text-(--ui-text-muted) hover:text-(--ui-text) hover:bg-(--ui-bg-accented) disable-text-select"
        :class="{ 'opacity-30 pointer-events-none': pickerValue <= min }"
        aria-label="Decrease value"
        @click="quickAdjust(-1)"
      >
        <AppIcon name="minus" class="w-4 h-4" />
      </button>

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

      <button
        type="button"
        class="icon-btn bg-(--ui-bg-elevated) border border-(--ui-border) text-(--ui-text-muted) hover:text-(--ui-text) hover:bg-(--ui-bg-accented) disable-text-select"
        :class="{ 'opacity-30 pointer-events-none': pickerValue >= max }"
        aria-label="Increase value"
        @click="quickAdjust(1)"
      >
        <AppIcon name="plus" class="w-4 h-4" />
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
      <p class="text-xs text-(--ui-text-dimmed)">Enter value{{ unit ? ` (${unit})` : '' }}</p>
    </div>

    <template #footer>
      <div class="flex gap-3">
        <UButton variant="ghost" color="neutral" class="flex-1 justify-center" @click="emit('close')">
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
    </template>
  </AppBottomSheet>
</template>

<style scoped>
.disable-text-select {
  -webkit-user-select: none;
  user-select: none;
}
</style>
