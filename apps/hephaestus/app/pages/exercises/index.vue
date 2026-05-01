<script setup lang="ts">
import type { Equipment, EquipmentSub, MovementPattern } from '~/types/database'

const db = useDatabase()
const { exercises, load, addCustom } = useExercises()

watch(
  db.status,
  (s) => {
    if (s === 'ready') load()
  },
  { immediate: true },
)

const searchQuery = ref('')
const equipFilter = ref<Equipment | 'all'>('all')
const movFilter = ref<MovementPattern | 'all'>('all')
const showCreateSheet = ref(false)

const newName = ref('')
const newEquipment = ref<EquipmentSub>('barbell')
const newMovement = ref<MovementPattern>('press')
const saving = ref(false)

const equipOptions: Array<{ value: Equipment | 'all'; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'barbell', label: 'Barbell' },
  { value: 'dumbbell', label: 'Dumbbell' },
  { value: 'machine', label: 'Machine' },
  { value: 'cable', label: 'Cable' },
  { value: 'bodyweight', label: 'BW' },
  { value: 'other', label: 'Other' },
]

const movOptions: Array<{ value: MovementPattern | 'all'; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'squat', label: 'Squat' },
  { value: 'hinge', label: 'Hinge' },
  { value: 'press', label: 'Press' },
  { value: 'row', label: 'Row' },
  { value: 'carry', label: 'Carry' },
  { value: 'isolation', label: 'Isolation' },
  { value: 'cardio', label: 'Cardio' },
]

// Subcategory choices for the "create exercise" form
const equipmentSubChoices: EquipmentSub[] = [
  'barbell',
  'ez-bar',
  'trap-bar',
  'smith-machine',
  'dumbbell',
  'cable',
  'selectorized',
  'plate-loaded',
  'bodyweight',
  'pull-up-bar',
  'suspension',
  'kettlebell',
  'bands',
  'swiss-ball',
  'medicine-ball',
  'foam-roller',
  'sled',
  'other',
]
const movementChoices: MovementPattern[] = [
  'squat',
  'hinge',
  'press',
  'row',
  'carry',
  'isolation',
  'cardio',
]

const filtered = computed(() => {
  let result = exercises.value
  if (equipFilter.value !== 'all') result = result.filter((e) => e.equipment === equipFilter.value)
  if (movFilter.value !== 'all') result = result.filter((e) => e.movement === movFilter.value)
  if (searchQuery.value.trim()) {
    const q = searchQuery.value.toLowerCase()
    result = result.filter((e) => e.name.toLowerCase().includes(q))
  }
  return result
})

async function handleCreate() {
  if (!newName.value.trim()) return
  saving.value = true
  try {
    await addCustom(newName.value.trim(), newEquipment.value, newMovement.value, [])
    showCreateSheet.value = false
    newName.value = ''
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <article class="p-4 space-y-4">
    <header class="pt-2">
      <div class="flex items-center justify-between mb-3">
        <h1 class="text-2xl font-bold">Exercises</h1>
        <UButton size="sm" color="primary" @click="showCreateSheet = true">
          <UIcon name="i-heroicons-plus" class="w-4 h-4" aria-hidden="true" />
          New
        </UButton>
      </div>

      <!-- Search -->
      <div class="relative mb-3">
        <UIcon
          name="i-heroicons-magnifying-glass"
          class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-(--ui-text-muted)"
          aria-hidden="true"
        />
        <input
          v-model="searchQuery"
          type="search"
          placeholder="Search exercises…"
          class="w-full pl-9 pr-3 py-2 rounded-xl bg-(--color-surface) text-sm outline-none"
          aria-label="Search exercises"
        />
      </div>

      <!-- Movement filter -->
      <div class="flex gap-2 overflow-x-auto pb-1 scrollbar-none mb-2" role="group" aria-label="Filter by movement">
        <button
          v-for="opt in movOptions"
          :key="opt.value"
          class="shrink-0 px-3 py-1.5 text-xs font-medium rounded-full transition-colors"
          :class="
            movFilter === opt.value
              ? 'bg-(--color-accent) text-white'
              : 'bg-(--color-surface) text-(--ui-text-muted)'
          "
          :aria-pressed="movFilter === opt.value"
          @click="movFilter = opt.value"
        >
          {{ opt.label }}
        </button>
      </div>

      <!-- Equipment filter -->
      <div class="flex gap-2 overflow-x-auto pb-1 scrollbar-none" role="group" aria-label="Filter by equipment">
        <button
          v-for="opt in equipOptions"
          :key="opt.value"
          class="shrink-0 px-3 py-1 text-xs font-medium rounded-full border transition-colors"
          :class="
            equipFilter === opt.value
              ? 'border-(--color-accent) text-(--color-accent) bg-(--color-accent)/10'
              : 'border-(--ui-border) text-(--ui-text-muted)'
          "
          :aria-pressed="equipFilter === opt.value"
          @click="equipFilter = opt.value"
        >
          {{ opt.label }}
        </button>
      </div>
    </header>

    <!-- Count -->
    <p class="text-xs text-(--ui-text-muted)">{{ filtered.length }} exercise{{ filtered.length !== 1 ? 's' : '' }}</p>

    <!-- List -->
    <ul role="list" class="space-y-px divide-y divide-(--ui-border)">
      <li v-for="ex in filtered" :key="ex.id" class="py-3">
        <div class="flex items-center gap-3">
          <ExerciseAvatar :icon="ex.icon" :movement="ex.movement" />
          <div class="min-w-0 flex-1">
            <p class="text-sm font-medium">{{ ex.name }}</p>
            <p class="text-xs text-(--ui-text-muted) capitalize mt-0.5">
              {{ ex.movement }} · {{ ex.equipment }}
            </p>
          </div>
          <span
            v-if="ex.is_custom === 1"
            class="shrink-0 text-xs px-2 py-0.5 rounded-full bg-(--color-accent)/10 text-(--color-accent)"
          >
            Custom
          </span>
        </div>
      </li>
      <li v-if="filtered.length === 0" class="py-12 text-center text-(--ui-text-muted)">
        <p>No exercises found.</p>
      </li>
    </ul>

    <!-- Create custom exercise sheet -->
    <Transition name="slide-up">
      <div
        v-if="showCreateSheet"
        class="fixed inset-0 z-[100] bg-black/50"
        role="presentation"
        @click.self="showCreateSheet = false"
      >
        <div
          class="absolute bottom-0 left-0 right-0 bg-(--color-surface) rounded-t-2xl p-6 space-y-4 safe-area-bottom"
          role="dialog"
          aria-label="Create custom exercise"
          aria-modal="true"
        >
          <h2 class="text-lg font-semibold">New Exercise</h2>

          <div class="space-y-1">
            <label class="text-xs font-medium text-(--ui-text-muted) uppercase tracking-wider">Name</label>
            <input
              v-model="newName"
              type="text"
              placeholder="Exercise name"
              class="w-full bg-(--color-surface-2) rounded-xl px-3 py-2.5 text-sm outline-none"
              aria-label="Exercise name"
            />
          </div>

          <div class="space-y-2">
            <p class="text-xs font-medium text-(--ui-text-muted) uppercase tracking-wider">Equipment</p>
            <div class="flex flex-wrap gap-2" role="group" aria-label="Equipment type">
              <button
                v-for="eq in equipmentSubChoices"
                :key="eq"
                class="px-3 py-1.5 text-xs font-medium rounded-full border capitalize transition-colors"
                :class="
                  newEquipment === eq
                    ? 'border-(--color-accent) text-(--color-accent) bg-(--color-accent)/10'
                    : 'border-(--ui-border) text-(--ui-text-muted)'
                "
                :aria-pressed="newEquipment === eq"
                @click="newEquipment = eq"
              >
                {{ eq }}
              </button>
            </div>
          </div>

          <div class="space-y-2">
            <p class="text-xs font-medium text-(--ui-text-muted) uppercase tracking-wider">Movement</p>
            <div class="flex flex-wrap gap-2" role="group" aria-label="Movement pattern">
              <button
                v-for="mv in movementChoices"
                :key="mv"
                class="px-3 py-1.5 text-xs font-medium rounded-full border capitalize transition-colors"
                :class="
                  newMovement === mv
                    ? 'border-(--color-accent) text-(--color-accent) bg-(--color-accent)/10'
                    : 'border-(--ui-border) text-(--ui-text-muted)'
                "
                :aria-pressed="newMovement === mv"
                @click="newMovement = mv"
              >
                {{ mv }}
              </button>
            </div>
          </div>

          <div class="flex gap-3">
            <UButton variant="ghost" color="neutral" class="flex-1" @click="showCreateSheet = false">
              Cancel
            </UButton>
            <UButton
              color="primary"
              class="flex-1"
              :disabled="!newName.trim() || saving"
              :loading="saving"
              @click="handleCreate"
            >
              Create
            </UButton>
          </div>
        </div>
      </div>
    </Transition>
  </article>
</template>

<style scoped>
.slide-up-enter-active,
.slide-up-leave-active {
  transition: transform 0.25s ease;
}
.slide-up-enter-from,
.slide-up-leave-to {
  transform: translateY(100%);
}
.scrollbar-none {
  scrollbar-width: none;
}
.scrollbar-none::-webkit-scrollbar {
  display: none;
}
</style>
