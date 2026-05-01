<script setup lang="ts">
import { generateDropSetPlan, generatePyramidPlan, parseSetScheme } from '~/lib/set-schemes'
import type { DropSetConfig, PyramidConfig, SetSchemeConfig } from '~/types/database'

const props = defineProps<{
  open: boolean
  exerciseName: string
  currentScheme?: string | null
}>()

const emit = defineEmits<{
  close: []
  confirm: [config: SetSchemeConfig | null]
}>()

// ─── Step state ───────────────────────────────────────────────────────────────

type WizardStep = 'choose' | 'configure'
const step = ref<WizardStep>('choose')

type SchemeChoice = 'straight' | 'drop_set' | 'pyramid' | 'rest_pause'
const selectedScheme = ref<SchemeChoice>('straight')

// ─── Drop set state ───────────────────────────────────────────────────────────

const dropDrops = ref(2)
const dropType = ref<'percent' | 'absolute'>('percent')
const dropValue = ref(10)

// ─── Pyramid state ────────────────────────────────────────────────────────────

type PyramidSubType = 'ascending' | 'descending' | 'full' | 'rep_only'
const pyramidSubType = ref<PyramidSubType>('ascending')
const pyramidSteps = ref(4)
const pyramidStartWeight = ref(60)
const pyramidWeightStep = ref(5)
const pyramidStepType = ref<'absolute' | 'percent'>('absolute')
const pyramidRepsPerStep = ref<number[]>([10, 8, 6, 5])

// ─── Rest pause state ────────────────────────────────────────────────────────

const rpClusterRest = ref(15)
const rpClusters = ref(3)

// ─── Sync repsPerStep array length with pyramidSteps ─────────────────────────

watch(pyramidSteps, (n) => {
  const arr = pyramidRepsPerStep.value
  if (arr.length < n) {
    const last = arr[arr.length - 1] ?? 10
    pyramidRepsPerStep.value = [...arr, ...Array.from({ length: n - arr.length }, () => last)]
  } else if (arr.length > n) {
    pyramidRepsPerStep.value = arr.slice(0, n)
  }
})

// ─── Reset state when sheet opens ────────────────────────────────────────────

watch(
  () => props.open,
  (open) => {
    if (!open) return
    step.value = 'choose'

    // Populate from currentScheme if present
    const parsed = parseSetScheme(props.currentScheme ?? null)

    if (parsed.type === 'drop_set') {
      selectedScheme.value = 'drop_set'
      dropDrops.value = parsed.config.drops
      dropType.value = parsed.config.dropType
      dropValue.value = parsed.config.dropValue
    } else if (
      parsed.type === 'pyramid_ascending' ||
      parsed.type === 'pyramid_descending' ||
      parsed.type === 'pyramid_full' ||
      parsed.type === 'pyramid_rep'
    ) {
      selectedScheme.value = 'pyramid'
      const subtypeMap: Record<string, PyramidSubType> = {
        pyramid_ascending: 'ascending',
        pyramid_descending: 'descending',
        pyramid_full: 'full',
        pyramid_rep: 'rep_only',
      }
      pyramidSubType.value = subtypeMap[parsed.type] ?? 'ascending'
      pyramidSteps.value = parsed.config.steps
      pyramidStartWeight.value = parsed.config.startWeight
      pyramidWeightStep.value = parsed.config.weightStep
      pyramidStepType.value = parsed.config.stepType
      pyramidRepsPerStep.value = [...parsed.config.repsPerStep]
    } else if (parsed.type === 'rest_pause') {
      selectedScheme.value = 'rest_pause'
      rpClusterRest.value = parsed.config.clusterRestSec
      rpClusters.value = parsed.config.clustersPlanned
    } else {
      selectedScheme.value = 'straight'
    }
  },
)

// ─── Drop set preview ─────────────────────────────────────────────────────────

const dropPreview = computed(() => {
  const cfg: DropSetConfig = {
    drops: dropDrops.value,
    dropType: dropType.value,
    dropValue: dropValue.value,
  }
  return generateDropSetPlan(100, cfg)
})

// ─── Pyramid preview ──────────────────────────────────────────────────────────

const pyramidPreview = computed(() => {
  const cfg: PyramidConfig = {
    type: pyramidSubType.value,
    steps: pyramidSteps.value,
    startWeight: pyramidStartWeight.value,
    weightStep: pyramidWeightStep.value,
    stepType: pyramidStepType.value,
    repsPerStep: pyramidRepsPerStep.value,
    restPerStep: Array.from({ length: pyramidSteps.value }, () => 90),
  }
  return generatePyramidPlan(cfg)
})

// ─── Actions ─────────────────────────────────────────────────────────────────

function selectScheme(choice: SchemeChoice) {
  selectedScheme.value = choice
  if (choice === 'straight') {
    emit('confirm', { type: 'straight' })
    return
  }
  step.value = 'configure'
}

function handleConfirm() {
  if (selectedScheme.value === 'drop_set') {
    const config: SetSchemeConfig = {
      type: 'drop_set',
      config: {
        drops: dropDrops.value,
        dropType: dropType.value,
        dropValue: dropValue.value,
      },
    }
    emit('confirm', config)
  } else if (selectedScheme.value === 'pyramid') {
    const typeMap: Record<
      PyramidSubType,
      'pyramid_ascending' | 'pyramid_descending' | 'pyramid_full' | 'pyramid_rep'
    > = {
      ascending: 'pyramid_ascending',
      descending: 'pyramid_descending',
      full: 'pyramid_full',
      rep_only: 'pyramid_rep',
    }
    const config: SetSchemeConfig = {
      type: typeMap[pyramidSubType.value],
      config: {
        type: pyramidSubType.value,
        steps: pyramidSteps.value,
        startWeight: pyramidStartWeight.value,
        weightStep: pyramidWeightStep.value,
        stepType: pyramidStepType.value,
        repsPerStep: [...pyramidRepsPerStep.value],
        restPerStep: Array.from({ length: pyramidSteps.value }, () => 90),
      },
    }
    emit('confirm', config)
  } else if (selectedScheme.value === 'rest_pause') {
    const config: SetSchemeConfig = {
      type: 'rest_pause',
      config: {
        clusterRestSec: rpClusterRest.value,
        clustersPlanned: rpClusters.value,
      },
    }
    emit('confirm', config)
  }
}

function handleClear() {
  emit('confirm', null)
}

// ─── Stepper helpers ──────────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
</script>

<template>
  <div>
    <!-- Backdrop -->
    <Transition name="fade">
      <div
        v-if="open"
        class="fixed inset-0 bg-black/50 z-[100]"
        role="presentation"
        @click="emit('close')"
      />
    </Transition>

    <!-- Sheet -->
    <Transition name="slide-up">
      <div
        v-if="open"
        class="fixed bottom-0 left-0 right-0 z-[100] rounded-t-2xl bg-(--color-surface) safe-area-bottom"
        role="dialog"
        :aria-label="`Set Scheme · ${exerciseName}`"
        aria-modal="true"
      >
        <!-- Header -->
        <header class="flex items-center justify-between px-6 pt-5 pb-4 border-b border-(--ui-border)/50">
          <div class="flex items-center gap-2">
            <button
              v-if="step === 'configure'"
              class="text-(--ui-text-muted) hover:text-(--ui-text) mr-1"
              aria-label="Back to scheme selection"
              @click="step = 'choose'"
            >
              <UIcon name="i-heroicons-arrow-left" class="w-5 h-5" aria-hidden="true" />
            </button>
            <h2 class="font-semibold text-sm">
              Set Scheme
              <span class="text-(--ui-text-muted) font-normal"> · {{ exerciseName }}</span>
            </h2>
          </div>
          <button
            class="text-(--ui-text-muted) hover:text-(--ui-text)"
            aria-label="Close"
            @click="emit('close')"
          >
            <UIcon name="i-heroicons-x-mark" class="w-5 h-5" aria-hidden="true" />
          </button>
        </header>

        <!-- Step 1: Choose scheme type -->
        <div v-if="step === 'choose'" class="p-6 space-y-3">
          <p class="text-xs text-(--ui-text-muted) uppercase tracking-wider font-medium mb-4">Choose scheme type</p>

          <!-- Straight sets -->
          <button
            class="w-full flex items-center gap-4 p-4 rounded-xl border-2 transition-colors text-left"
            :class="selectedScheme === 'straight'
              ? 'border-(--color-accent) bg-(--color-accent)/5'
              : 'border-(--ui-border) bg-(--color-surface-2) hover:border-(--color-accent)/40'"
            aria-pressed="false"
            @click="selectScheme('straight')"
          >
            <span class="w-10 h-10 rounded-xl bg-(--color-surface) border border-(--ui-border) flex items-center justify-center shrink-0">
              <UIcon name="i-heroicons-bars-3" class="w-5 h-5 text-(--ui-text-muted)" aria-hidden="true" />
            </span>
            <div class="min-w-0">
              <p class="font-semibold text-sm">Straight sets</p>
              <p class="text-xs text-(--ui-text-muted)">Same weight and reps each set</p>
            </div>
          </button>

          <!-- Drop sets -->
          <button
            class="w-full flex items-center gap-4 p-4 rounded-xl border-2 transition-colors text-left"
            :class="selectedScheme === 'drop_set'
              ? 'border-(--color-accent) bg-(--color-accent)/5'
              : 'border-(--ui-border) bg-(--color-surface-2) hover:border-(--color-accent)/40'"
            @click="selectScheme('drop_set')"
          >
            <span class="w-10 h-10 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center shrink-0">
              <span class="text-sm font-bold text-red-400">D</span>
            </span>
            <div class="min-w-0">
              <p class="font-semibold text-sm">Drop sets</p>
              <p class="text-xs text-(--ui-text-muted)">Reduce weight after each set without rest</p>
            </div>
          </button>

          <!-- Pyramid -->
          <button
            class="w-full flex items-center gap-4 p-4 rounded-xl border-2 transition-colors text-left"
            :class="selectedScheme === 'pyramid'
              ? 'border-(--color-accent) bg-(--color-accent)/5'
              : 'border-(--ui-border) bg-(--color-surface-2) hover:border-(--color-accent)/40'"
            @click="selectScheme('pyramid')"
          >
            <span class="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0">
              <span class="text-sm font-bold text-amber-400">↑↓</span>
            </span>
            <div class="min-w-0">
              <p class="font-semibold text-sm">Pyramid</p>
              <p class="text-xs text-(--ui-text-muted)">Ascending, descending or full pyramid</p>
            </div>
          </button>

          <!-- Rest-pause -->
          <button
            class="w-full flex items-center gap-4 p-4 rounded-xl border-2 transition-colors text-left"
            :class="selectedScheme === 'rest_pause'
              ? 'border-(--color-accent) bg-(--color-accent)/5'
              : 'border-(--ui-border) bg-(--color-surface-2) hover:border-(--color-accent)/40'"
            @click="selectScheme('rest_pause')"
          >
            <span class="w-10 h-10 rounded-xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center shrink-0">
              <span class="text-xs font-bold text-violet-400">RP</span>
            </span>
            <div class="min-w-0">
              <p class="font-semibold text-sm">Rest-pause</p>
              <p class="text-xs text-(--ui-text-muted)">Short intra-set rest to extend the set</p>
            </div>
          </button>

          <!-- Clear scheme button -->
          <button
            class="w-full text-center text-xs text-(--ui-text-muted) hover:text-red-400 transition-colors pt-2 pb-1"
            @click="handleClear"
          >
            Clear scheme (revert to straight sets)
          </button>
        </div>

        <!-- Step 2: Configure -->
        <div v-else-if="step === 'configure'" class="p-6 space-y-5 max-h-[80vh] overflow-y-auto">

          <!-- ─── Drop set config ─── -->
          <template v-if="selectedScheme === 'drop_set'">
            <p class="text-xs text-(--ui-text-muted) uppercase tracking-wider font-medium">Configure drop sets</p>

            <!-- Number of drops -->
            <div class="space-y-2">
              <label class="text-sm font-medium">Number of drops</label>
              <div class="flex items-center gap-3">
                <button
                  class="w-9 h-9 rounded-full bg-(--color-surface-2) text-lg font-bold flex items-center justify-center"
                  aria-label="Decrease drops"
                  @click="dropDrops = clamp(dropDrops - 1, 1, 5)"
                >
                  −
                </button>
                <span class="text-xl font-bold w-8 text-center">{{ dropDrops }}</span>
                <button
                  class="w-9 h-9 rounded-full bg-(--color-surface-2) text-lg font-bold flex items-center justify-center"
                  aria-label="Increase drops"
                  @click="dropDrops = clamp(dropDrops + 1, 1, 5)"
                >
                  +
                </button>
              </div>
            </div>

            <!-- Drop type -->
            <div class="space-y-2">
              <label class="text-sm font-medium">Drop type</label>
              <div class="flex rounded-xl bg-(--color-surface-2) p-0.5" role="group" aria-label="Drop type">
                <button
                  class="flex-1 py-1.5 text-sm font-medium rounded-[10px] transition-colors"
                  :class="dropType === 'percent'
                    ? 'bg-(--color-surface) text-(--color-accent) shadow-sm'
                    : 'text-(--ui-text-muted)'"
                  :aria-pressed="dropType === 'percent'"
                  @click="dropType = 'percent'"
                >
                  % reduction
                </button>
                <button
                  class="flex-1 py-1.5 text-sm font-medium rounded-[10px] transition-colors"
                  :class="dropType === 'absolute'
                    ? 'bg-(--color-surface) text-(--ui-text) shadow-sm'
                    : 'text-(--ui-text-muted)'"
                  :aria-pressed="dropType === 'absolute'"
                  @click="dropType = 'absolute'"
                >
                  Fixed kg/lbs
                </button>
              </div>
            </div>

            <!-- Drop value -->
            <div class="space-y-2">
              <label class="text-sm font-medium" for="drop-value">
                {{ dropType === 'percent' ? 'Reduction (%)' : 'Reduction per drop (kg)' }}
              </label>
              <div class="flex items-center gap-3">
                <button
                  class="w-9 h-9 rounded-full bg-(--color-surface-2) text-lg font-bold flex items-center justify-center"
                  aria-label="Decrease drop value"
                  @click="dropValue = clamp(dropValue - (dropType === 'percent' ? 5 : 2.5), 1, dropType === 'percent' ? 50 : 100)"
                >
                  −
                </button>
                <input
                  id="drop-value"
                  v-model.number="dropValue"
                  type="number"
                  min="1"
                  :max="dropType === 'percent' ? 50 : 100"
                  :step="dropType === 'percent' ? 5 : 2.5"
                  class="flex-1 text-center text-xl font-bold bg-transparent border-b border-(--ui-border) py-1 outline-none"
                  aria-label="Drop value"
                />
                <button
                  class="w-9 h-9 rounded-full bg-(--color-surface-2) text-lg font-bold flex items-center justify-center"
                  aria-label="Increase drop value"
                  @click="dropValue = clamp(dropValue + (dropType === 'percent' ? 5 : 2.5), 1, dropType === 'percent' ? 50 : 100)"
                >
                  +
                </button>
              </div>
            </div>

            <!-- Preview -->
            <div class="space-y-2">
              <p class="text-xs text-(--ui-text-muted) uppercase tracking-wider font-medium">Preview (100 kg base)</p>
              <div class="flex gap-2 flex-wrap">
                <span
                  v-for="(set, i) in dropPreview"
                  :key="i"
                  class="px-3 py-1.5 rounded-lg text-sm font-semibold"
                  :class="i === 0
                    ? 'bg-(--color-accent)/15 text-(--color-accent)'
                    : 'bg-red-500/10 text-red-400'"
                >
                  {{ i === 0 ? 'Work' : `Drop ${i}` }}: {{ set.weight }} kg
                </span>
              </div>
            </div>
          </template>

          <!-- ─── Pyramid config ─── -->
          <template v-else-if="selectedScheme === 'pyramid'">
            <p class="text-xs text-(--ui-text-muted) uppercase tracking-wider font-medium">Configure pyramid</p>

            <!-- Sub-type -->
            <div class="space-y-2">
              <label class="text-sm font-medium">Pyramid style</label>
              <div class="grid grid-cols-2 gap-2" role="group" aria-label="Pyramid style">
                <button
                  v-for="(label, val) in ({ ascending: 'Ascending', descending: 'Descending', full: 'Full', rep_only: 'Rep-only' } as Record<PyramidSubType, string>)"
                  :key="val"
                  class="py-2 px-3 rounded-xl text-sm font-medium border-2 transition-colors"
                  :class="pyramidSubType === val
                    ? 'border-(--color-accent) bg-(--color-accent)/10 text-(--color-accent)'
                    : 'border-(--ui-border) bg-(--color-surface-2) text-(--ui-text-muted) hover:border-(--color-accent)/40'"
                  :aria-pressed="pyramidSubType === val"
                  @click="pyramidSubType = val"
                >
                  {{ label }}
                </button>
              </div>
            </div>

            <!-- Steps count -->
            <div class="space-y-2">
              <label class="text-sm font-medium">Steps</label>
              <div class="flex items-center gap-3">
                <button
                  class="w-9 h-9 rounded-full bg-(--color-surface-2) text-lg font-bold flex items-center justify-center"
                  aria-label="Decrease steps"
                  @click="pyramidSteps = clamp(pyramidSteps - 1, 2, 6)"
                >
                  −
                </button>
                <span class="text-xl font-bold w-8 text-center">{{ pyramidSteps }}</span>
                <button
                  class="w-9 h-9 rounded-full bg-(--color-surface-2) text-lg font-bold flex items-center justify-center"
                  aria-label="Increase steps"
                  @click="pyramidSteps = clamp(pyramidSteps + 1, 2, 6)"
                >
                  +
                </button>
              </div>
            </div>

            <!-- Start weight -->
            <div class="space-y-2">
              <label class="text-sm font-medium" for="pyramid-start-weight">Start weight (kg)</label>
              <div class="flex items-center gap-3">
                <button
                  class="w-9 h-9 rounded-full bg-(--color-surface-2) text-lg font-bold flex items-center justify-center"
                  aria-label="Decrease start weight"
                  @click="pyramidStartWeight = clamp(pyramidStartWeight - 5, 0, 500)"
                >
                  −
                </button>
                <input
                  id="pyramid-start-weight"
                  v-model.number="pyramidStartWeight"
                  type="number"
                  min="0"
                  step="5"
                  class="flex-1 text-center text-xl font-bold bg-transparent border-b border-(--ui-border) py-1 outline-none"
                  aria-label="Start weight"
                />
                <button
                  class="w-9 h-9 rounded-full bg-(--color-surface-2) text-lg font-bold flex items-center justify-center"
                  aria-label="Increase start weight"
                  @click="pyramidStartWeight = clamp(pyramidStartWeight + 5, 0, 500)"
                >
                  +
                </button>
              </div>
            </div>

            <!-- Weight step + type (hidden for rep_only) -->
            <template v-if="pyramidSubType !== 'rep_only'">
              <div class="space-y-2">
                <div class="flex items-center justify-between">
                  <label class="text-sm font-medium" for="pyramid-weight-step">
                    Weight step {{ pyramidStepType === 'percent' ? '(%)' : '(kg)' }}
                  </label>
                  <button
                    class="text-xs px-2 py-0.5 rounded-md bg-(--color-surface-2) text-(--ui-text-muted) hover:text-(--ui-text) transition-colors"
                    @click="pyramidStepType = pyramidStepType === 'absolute' ? 'percent' : 'absolute'"
                  >
                    {{ pyramidStepType === 'absolute' ? 'kg' : '%' }}
                  </button>
                </div>
                <div class="flex items-center gap-3">
                  <button
                    class="w-9 h-9 rounded-full bg-(--color-surface-2) text-lg font-bold flex items-center justify-center"
                    aria-label="Decrease weight step"
                    @click="pyramidWeightStep = clamp(pyramidWeightStep - (pyramidStepType === 'percent' ? 5 : 2.5), 0, 100)"
                  >
                    −
                  </button>
                  <input
                    id="pyramid-weight-step"
                    v-model.number="pyramidWeightStep"
                    type="number"
                    min="0"
                    :step="pyramidStepType === 'percent' ? 5 : 2.5"
                    class="flex-1 text-center text-xl font-bold bg-transparent border-b border-(--ui-border) py-1 outline-none"
                    aria-label="Weight step"
                  />
                  <button
                    class="w-9 h-9 rounded-full bg-(--color-surface-2) text-lg font-bold flex items-center justify-center"
                    aria-label="Increase weight step"
                    @click="pyramidWeightStep = clamp(pyramidWeightStep + (pyramidStepType === 'percent' ? 5 : 2.5), 0, 100)"
                  >
                    +
                  </button>
                </div>
              </div>
            </template>

            <!-- Reps per step -->
            <div class="space-y-2">
              <label class="text-sm font-medium">Reps per step</label>
              <div class="grid gap-2" :style="{ gridTemplateColumns: `repeat(${Math.min(pyramidSteps, 4)}, 1fr)` }">
                <div
                  v-for="(_, si) in pyramidRepsPerStep"
                  :key="si"
                  class="space-y-0.5"
                >
                  <label class="text-[10px] text-(--ui-text-muted) text-center block" :for="`pyr-rep-${si}`">
                    Step {{ si + 1 }}
                  </label>
                  <input
                    :id="`pyr-rep-${si}`"
                    v-model.number="pyramidRepsPerStep[si]"
                    type="number"
                    min="1"
                    max="30"
                    class="w-full text-center text-sm font-bold bg-(--color-surface-2) rounded-lg py-1.5 outline-none focus-visible:ring-1 focus-visible:ring-(--color-accent)"
                    :aria-label="`Reps for step ${si + 1}`"
                  />
                </div>
              </div>
            </div>

            <!-- Preview -->
            <div class="space-y-2">
              <p class="text-xs text-(--ui-text-muted) uppercase tracking-wider font-medium">Preview</p>
              <div class="flex gap-2 flex-wrap">
                <span
                  v-for="(set, i) in pyramidPreview"
                  :key="i"
                  class="px-3 py-1.5 rounded-lg text-sm font-semibold bg-amber-500/10 text-amber-400"
                >
                  {{ set.reps }}×{{ set.weight }} kg
                </span>
              </div>
            </div>
          </template>

          <!-- ─── Rest-pause config ─── -->
          <template v-else-if="selectedScheme === 'rest_pause'">
            <p class="text-xs text-(--ui-text-muted) uppercase tracking-wider font-medium">Configure rest-pause</p>

            <!-- Cluster rest -->
            <div class="space-y-2">
              <label class="text-sm font-medium">Cluster rest (seconds)</label>
              <div class="flex items-center gap-3">
                <button
                  class="w-9 h-9 rounded-full bg-(--color-surface-2) text-lg font-bold flex items-center justify-center"
                  aria-label="Decrease cluster rest"
                  @click="rpClusterRest = clamp(rpClusterRest - 5, 5, 120)"
                >
                  −
                </button>
                <span class="text-xl font-bold w-12 text-center">{{ rpClusterRest }}s</span>
                <button
                  class="w-9 h-9 rounded-full bg-(--color-surface-2) text-lg font-bold flex items-center justify-center"
                  aria-label="Increase cluster rest"
                  @click="rpClusterRest = clamp(rpClusterRest + 5, 5, 120)"
                >
                  +
                </button>
              </div>
            </div>

            <!-- Clusters planned -->
            <div class="space-y-2">
              <label class="text-sm font-medium">Clusters planned</label>
              <div class="flex items-center gap-3">
                <button
                  class="w-9 h-9 rounded-full bg-(--color-surface-2) text-lg font-bold flex items-center justify-center"
                  aria-label="Decrease clusters"
                  @click="rpClusters = clamp(rpClusters - 1, 2, 4)"
                >
                  −
                </button>
                <span class="text-xl font-bold w-8 text-center">{{ rpClusters }}</span>
                <button
                  class="w-9 h-9 rounded-full bg-(--color-surface-2) text-lg font-bold flex items-center justify-center"
                  aria-label="Increase clusters"
                  @click="rpClusters = clamp(rpClusters + 1, 2, 4)"
                >
                  +
                </button>
              </div>
              <p class="text-xs text-(--ui-text-muted)">
                Perform {{ rpClusters }} clusters with {{ rpClusterRest }}s rest between each.
              </p>
            </div>
          </template>

          <!-- Confirm button -->
          <UButton
            color="primary"
            size="lg"
            class="w-full mt-2"
            @click="handleConfirm"
          >
            <UIcon name="i-heroicons-check" class="w-5 h-5" aria-hidden="true" />
            Confirm Scheme
          </UButton>

          <!-- Clear scheme -->
          <button
            class="w-full text-center text-xs text-(--ui-text-muted) hover:text-red-400 transition-colors pb-1"
            @click="handleClear"
          >
            Clear scheme (revert to straight sets)
          </button>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.slide-up-enter-active,
.slide-up-leave-active {
  transition: transform 0.25s ease;
}
.slide-up-enter-from,
.slide-up-leave-to {
  transform: translateY(100%);
}
</style>
