<script setup lang="ts">
import { serialiseSetRests } from '~/lib/set-rest'
import { parseSetScheme, serialiseSetScheme } from '~/lib/set-schemes'
import type { ExerciseRow, GroupType, SetSchemeConfig } from '~/types/database'

const { exercises, load: loadExercises } = useExercises()
const { create } = useTemplates()
const db = useDatabase()
const { settings } = useAppSettings()

onMounted(loadExercises)

// ─── Types ────────────────────────────────────────────────────────────────────

interface ExerciseItem {
  id: string // local ID for keying
  exerciseId: string
  name: string
  movement: string
  setsPlanned: number
  repsPlanned: string
  restSeconds: number
  // per-set rests: null = use restSeconds for all sets; array = override per set
  setRests: number[] | null
  supersetGroup: string | null // 'A', 'B', etc.
  showAdvanced: boolean
  setScheme: string | null
}

interface GroupConfig {
  label: string // 'A', 'B', 'C'…
  name: string
  groupType: GroupType
  transitionRestSec: number
  restAfterRoundSec: number
}

// ─── State ────────────────────────────────────────────────────────────────────

const templateName = ref('')
const templateDesc = ref('')
const items = ref<ExerciseItem[]>([])
const groups = ref<GroupConfig[]>([])
const showPicker = ref(false)
const pickerSearch = ref('')
const saving = ref(false)
// per-exercise context menu
const menuOpenFor = ref<string | null>(null)
// set scheme wizard
const showSchemeWizardFor = ref<string | null>(null)

// ─── Exercise picker ──────────────────────────────────────────────────────────

const filteredExercises = computed(() => {
  const q = pickerSearch.value.trim().toLowerCase()
  if (!q) return exercises.value
  return exercises.value.filter((e) => e.name.toLowerCase().includes(q))
})

function addExercise(ex: ExerciseRow) {
  showPicker.value = false
  pickerSearch.value = ''
  items.value.push({
    id: crypto.randomUUID(),
    exerciseId: ex.id,
    name: ex.name,
    movement: ex.movement,
    setsPlanned: 3,
    repsPlanned: '8-12',
    restSeconds: 120,
    setRests: null,
    supersetGroup: null,
    showAdvanced: false,
    setScheme: null,
  })
}

// ─── Per-set rest helpers ─────────────────────────────────────────────────────

function toggleVariableRest(item: ExerciseItem) {
  if (item.setRests === null) {
    // Enable: initialise with the default rest for each set
    item.setRests = Array.from({ length: item.setsPlanned }, () => item.restSeconds)
  } else {
    item.setRests = null
  }
}

function syncSetRestLength(item: ExerciseItem) {
  if (item.setRests === null) return
  const current = item.setRests
  const n = item.setsPlanned
  if (current.length < n) {
    const last = current[current.length - 1] ?? item.restSeconds
    item.setRests = [...current, ...Array.from({ length: n - current.length }, () => last)]
  } else if (current.length > n) {
    item.setRests = current.slice(0, n)
  }
}

// ─── Scheme badge helper ──────────────────────────────────────────────────────

function schemeBadge(setScheme: string | null): { label: string; classes: string } | null {
  const parsed = parseSetScheme(setScheme)
  if (parsed.type === 'straight') return null
  if (parsed.type === 'drop_set') {
    return { label: 'D', classes: 'bg-red-500/15 text-red-400' }
  }
  if (parsed.type === 'pyramid_ascending' || parsed.type === 'pyramid_full') {
    return { label: '↑', classes: 'bg-amber-500/15 text-amber-400' }
  }
  if (parsed.type === 'pyramid_descending') {
    return { label: '↓', classes: 'bg-amber-500/15 text-amber-400' }
  }
  if (parsed.type === 'pyramid_rep') {
    return { label: '↑↓', classes: 'bg-amber-500/15 text-amber-400' }
  }
  if (parsed.type === 'rest_pause') {
    return { label: 'RP', classes: 'bg-violet-500/15 text-violet-400' }
  }
  return null
}

// ─── Scheme wizard ────────────────────────────────────────────────────────────

function handleSchemeConfirm(itemId: string, config: SetSchemeConfig | null) {
  const item = items.value.find((i) => i.id === itemId)
  if (item) {
    item.setScheme = config ? serialiseSetScheme(config) : null
  }
  showSchemeWizardFor.value = null
}

// ─── Superset groups ──────────────────────────────────────────────────────────

const nextGroupLabel = computed(() => {
  return String.fromCharCode(65 + groups.value.length) // A, B, C…
})

function addGroup(): GroupConfig {
  const g: GroupConfig = {
    label: nextGroupLabel.value,
    name: '',
    groupType: 'superset',
    transitionRestSec: 0,
    restAfterRoundSec: 120,
  }
  groups.value.push(g)
  return g
}

function removeGroup(label: string) {
  // Unassign all exercises in this group
  for (const item of items.value) {
    if (item.supersetGroup === label) item.supersetGroup = null
  }
  groups.value = groups.value.filter((g) => g.label !== label)
}

function assignToGroup(item: ExerciseItem, label: string | null) {
  if (label !== null && !groups.value.some((g) => g.label === label)) {
    addGroup()
    // The newly added group has nextGroupLabel which should match `label`
  }
  item.supersetGroup = label
  menuOpenFor.value = null
}

const exercisesInGroup = (label: string) => items.value.filter((i) => i.supersetGroup === label)

// ─── Reorder ──────────────────────────────────────────────────────────────────

function removeItem(index: number) {
  items.value.splice(index, 1)
}

function moveUp(index: number) {
  if (index === 0) return
  const arr = [...items.value]
  ;[arr[index - 1], arr[index]] = [arr[index] as ExerciseItem, arr[index - 1] as ExerciseItem]
  items.value = arr
}

function moveDown(index: number) {
  if (index === items.value.length - 1) return
  const arr = [...items.value]
  ;[arr[index], arr[index + 1]] = [arr[index + 1] as ExerciseItem, arr[index] as ExerciseItem]
  items.value = arr
}

// ─── Save ─────────────────────────────────────────────────────────────────────

const canSave = computed(() => templateName.value.trim().length > 0 && items.value.length > 0)

async function handleSave() {
  if (!canSave.value) return
  saving.value = true
  try {
    const templateId = await create(
      templateName.value.trim(),
      templateDesc.value.trim() || null,
      items.value.map((item, i) => ({
        exerciseId: item.exerciseId,
        orderNum: i + 1,
        setsPlanned: item.setsPlanned,
        repsPlanned: item.repsPlanned,
        restSeconds: item.restSeconds,
        ...(item.supersetGroup !== null ? { supersetGroup: item.supersetGroup } : {}),
        ...(item.setRests !== null ? { setRestSeconds: serialiseSetRests(item.setRests) } : {}),
        ...(item.setScheme !== null ? { setScheme: item.setScheme } : {}),
      })),
    )

    // Persist superset groups
    for (const g of groups.value) {
      const id = crypto.randomUUID()
      await db.exec(
        `INSERT INTO template_groups (id, template_id, label, name, group_type, transition_rest_sec, rest_after_round_sec, circuit_rest_mode)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          templateId,
          g.label,
          g.name || null,
          g.groupType,
          g.transitionRestSec,
          g.restAfterRoundSec,
          'after_round',
        ],
      )
    }

    await navigateTo(`/templates/${templateId}`)
  } finally {
    saving.value = false
  }
}

// Close context menu on outside click
function onDocClick(e: Event) {
  if (menuOpenFor.value === null) return
  const target = e.target as HTMLElement
  if (!target.closest('[data-menu-container]')) {
    menuOpenFor.value = null
  }
}
onMounted(() => document.addEventListener('click', onDocClick, { capture: true }))
onUnmounted(() => document.removeEventListener('click', onDocClick, { capture: true }))

const groupTypeLabels: Record<GroupType, string> = {
  superset: 'Superset',
  giant_set: 'Giant set',
  circuit: 'Circuit',
  pre_exhaust: 'Pre-exhaust',
}

const groupTypeDefaults: Record<
  GroupType,
  { transitionRestSec: number; restAfterRoundSec: number }
> = {
  superset: { transitionRestSec: 0, restAfterRoundSec: 120 },
  giant_set: { transitionRestSec: 0, restAfterRoundSec: 180 },
  circuit: { transitionRestSec: 15, restAfterRoundSec: 90 },
  pre_exhaust: { transitionRestSec: 0, restAfterRoundSec: 90 },
}

function onGroupTypeChange(g: GroupConfig) {
  const defaults = groupTypeDefaults[g.groupType]
  g.transitionRestSec = defaults.transitionRestSec
  g.restAfterRoundSec = defaults.restAfterRoundSec
}
</script>

<template>
  <div>
    <article class="p-4 pb-24 space-y-5">
      <header class="flex items-center gap-3 pt-2">
        <NuxtLink to="/templates" aria-label="Back to templates">
          <UIcon name="i-heroicons-arrow-left" class="w-6 h-6 text-(--ui-text-muted)" aria-hidden="true" />
        </NuxtLink>
        <h1 class="text-xl font-bold flex-1">New Template</h1>
        <UButton
          size="sm"
          color="primary"
          :disabled="!canSave || saving"
          :loading="saving"
          @click="handleSave"
        >
          Save
        </UButton>
      </header>

      <!-- Name -->
      <div class="space-y-1">
        <label class="text-xs font-medium text-(--ui-text-muted) uppercase tracking-wider" for="tpl-name">
          Name
        </label>
        <input
          id="tpl-name"
          v-model="templateName"
          type="text"
          placeholder="e.g. Push Day A"
          class="w-full bg-(--color-surface) rounded-xl px-3 py-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-(--color-accent)"
        />
      </div>

      <!-- Description -->
      <div class="space-y-1">
        <label class="text-xs font-medium text-(--ui-text-muted) uppercase tracking-wider" for="tpl-desc">
          Description <span class="normal-case font-normal">(optional)</span>
        </label>
        <input
          id="tpl-desc"
          v-model="templateDesc"
          type="text"
          placeholder="Brief note about this template"
          class="w-full bg-(--color-surface) rounded-xl px-3 py-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-(--color-accent)"
        />
      </div>

      <!-- Exercises -->
      <section aria-labelledby="exercises-heading">
        <div class="flex items-center justify-between mb-3">
          <h2 id="exercises-heading" class="text-sm font-semibold uppercase tracking-wider text-(--ui-text-muted)">
            Exercises
          </h2>
          <span class="text-xs text-(--ui-text-muted)" aria-live="polite">{{ items.length }} added</span>
        </div>

        <ul v-if="items.length > 0" role="list" class="space-y-3 mb-4">
          <li
            v-for="(item, i) in items"
            :key="item.id"
            class="rounded-xl bg-(--color-surface) overflow-hidden"
          >
            <!-- Exercise header -->
            <div class="flex items-center gap-2 px-4 pt-4 pb-3">
              <!-- Group badge -->
              <span
                v-if="item.supersetGroup"
                class="shrink-0 w-6 h-6 rounded-full bg-(--color-accent)/20 text-(--color-accent) text-xs font-bold flex items-center justify-center"
                :aria-label="`Superset group ${item.supersetGroup}`"
              >
                {{ item.supersetGroup }}
              </span>

              <div class="min-w-0 flex-1">
                <p class="font-medium text-sm truncate">{{ item.name }}</p>
                <!-- Scheme badge -->
                <span
                  v-if="schemeBadge(item.setScheme)"
                  class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold mt-0.5"
                  :class="schemeBadge(item.setScheme)!.classes"
                  :aria-label="`Set scheme: ${schemeBadge(item.setScheme)!.label}`"
                >
                  {{ schemeBadge(item.setScheme)!.label }}
                </span>
              </div>

              <div class="flex items-center gap-1 shrink-0">
                <button
                  class="w-7 h-7 flex items-center justify-center rounded-lg text-(--ui-text-muted)
                    hover:text-(--ui-text) disabled:opacity-30"
                  :disabled="i === 0"
                  :aria-label="`Move ${item.name} up`"
                  @click="moveUp(i)"
                >
                  <UIcon name="i-heroicons-chevron-up" class="w-4 h-4" aria-hidden="true" />
                </button>
                <button
                  class="w-7 h-7 flex items-center justify-center rounded-lg text-(--ui-text-muted)
                    hover:text-(--ui-text) disabled:opacity-30"
                  :disabled="i === items.length - 1"
                  :aria-label="`Move ${item.name} down`"
                  @click="moveDown(i)"
                >
                  <UIcon name="i-heroicons-chevron-down" class="w-4 h-4" aria-hidden="true" />
                </button>

                <!-- Context menu trigger -->
                <div class="relative" data-menu-container>
                  <button
                    class="w-7 h-7 flex items-center justify-center rounded-lg text-(--ui-text-muted) hover:text-(--ui-text)"
                    :aria-label="`Options for ${item.name}`"
                    :aria-expanded="menuOpenFor === item.id"
                    aria-haspopup="menu"
                    @click.stop="menuOpenFor = menuOpenFor === item.id ? null : item.id"
                  >
                    <UIcon name="i-heroicons-ellipsis-vertical" class="w-4 h-4" aria-hidden="true" />
                  </button>

                  <!-- Context menu -->
                  <div
                    v-if="menuOpenFor === item.id"
                    role="menu"
                    :aria-label="`Options for ${item.name}`"
                    class="absolute right-0 top-8 z-20 bg-(--color-surface-2) border border-(--ui-border) rounded-xl shadow-lg py-1 min-w-44"
                  >
                    <!-- Assign to group -->
                    <template v-if="settings.showSupersets">
                      <p class="px-3 py-1 text-[10px] text-(--ui-text-muted) uppercase tracking-wider">Group</p>
                      <button
                        v-for="g in groups"
                        :key="g.label"
                        role="menuitem"
                        class="w-full text-left px-3 py-2 text-sm hover:bg-(--color-surface) flex items-center gap-2"
                        :class="item.supersetGroup === g.label ? 'text-(--color-accent)' : ''"
                        @click="assignToGroup(item, item.supersetGroup === g.label ? null : g.label)"
                      >
                        <span
                          class="w-5 h-5 rounded-full bg-(--color-accent)/20 text-(--color-accent) text-xs font-bold flex items-center justify-center shrink-0"
                        >{{ g.label }}</span>
                        Group {{ g.label }}
                        <UIcon v-if="item.supersetGroup === g.label" name="i-heroicons-check" class="w-3 h-3 ml-auto" aria-hidden="true" />
                      </button>
                      <button
                        role="menuitem"
                        class="w-full text-left px-3 py-2 text-sm hover:bg-(--color-surface) text-(--color-accent)"
                        @click="assignToGroup(item, nextGroupLabel)"
                      >
                        <UIcon name="i-heroicons-plus" class="w-3.5 h-3.5 inline mr-1" aria-hidden="true" />
                        New group {{ nextGroupLabel }}
                      </button>
                      <div class="border-t border-(--ui-border) my-1" role="separator" />
                    </template>

                    <!-- Set Scheme -->
                    <template v-if="settings.showSetSchemes">
                      <button
                        role="menuitem"
                        class="w-full text-left px-3 py-2 text-sm hover:bg-(--color-surface) flex items-center gap-2"
                        @click="showSchemeWizardFor = item.id; menuOpenFor = null"
                      >
                        <UIcon name="i-heroicons-adjustments-horizontal" class="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                        Set Scheme…
                      </button>
                      <div class="border-t border-(--ui-border) my-1" role="separator" />
                    </template>

                    <!-- Remove -->
                    <button
                      role="menuitem"
                      class="w-full text-left px-3 py-2 text-sm hover:bg-(--color-surface) text-red-400"
                      @click="removeItem(i); menuOpenFor = null"
                    >
                      <UIcon name="i-heroicons-trash" class="w-3.5 h-3.5 inline mr-1" aria-hidden="true" />
                      Remove
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <!-- Config row -->
            <div class="grid grid-cols-3 gap-2 px-4 pb-3">
              <div class="space-y-1">
                <label class="text-xs text-(--ui-text-muted)" :for="`sets-${item.id}`">Sets</label>
                <input
                  :id="`sets-${item.id}`"
                  v-model.number="item.setsPlanned"
                  type="number"
                  min="1"
                  max="20"
                  class="w-full text-center text-sm font-bold bg-(--color-surface-2) rounded-lg py-1.5 outline-none focus-visible:ring-1 focus-visible:ring-(--color-accent)"
                  @change="syncSetRestLength(item)"
                />
              </div>
              <div class="space-y-1">
                <label class="text-xs text-(--ui-text-muted)" :for="`reps-${item.id}`">Reps</label>
                <input
                  :id="`reps-${item.id}`"
                  v-model="item.repsPlanned"
                  type="text"
                  placeholder="8-12"
                  class="w-full text-center text-sm font-bold bg-(--color-surface-2) rounded-lg py-1.5 outline-none focus-visible:ring-1 focus-visible:ring-(--color-accent)"
                />
              </div>
              <div class="space-y-1">
                <label class="text-xs text-(--ui-text-muted)" :for="`rest-${item.id}`">Rest (s)</label>
                <input
                  :id="`rest-${item.id}`"
                  v-model.number="item.restSeconds"
                  type="number"
                  min="0"
                  step="15"
                  :disabled="item.setRests !== null"
                  class="w-full text-center text-sm font-bold bg-(--color-surface-2) rounded-lg py-1.5 outline-none focus-visible:ring-1 focus-visible:ring-(--color-accent) disabled:opacity-40"
                />
              </div>
            </div>

            <!-- Advanced toggle -->
            <button
              v-if="settings.showVariableRest"
              class="w-full flex items-center justify-between px-4 py-2 text-xs text-(--ui-text-muted) hover:text-(--ui-text) border-t border-(--ui-border)/50 transition-colors"
              :aria-expanded="item.showAdvanced"
              :aria-controls="`advanced-${item.id}`"
              @click="item.showAdvanced = !item.showAdvanced"
            >
              <span class="flex items-center gap-1.5">
                Advanced
                <span v-if="item.setRests !== null" class="px-1.5 py-0.5 rounded bg-(--color-accent)/15 text-(--color-accent) font-semibold" aria-label="variable rest enabled">
                  Variable rest
                </span>
              </span>
              <UIcon
                :name="item.showAdvanced ? 'i-heroicons-chevron-up' : 'i-heroicons-chevron-down'"
                class="w-3.5 h-3.5"
                aria-hidden="true"
              />
            </button>

            <!-- Per-set rests -->
            <div
              v-if="settings.showVariableRest"
              :id="`advanced-${item.id}`"
              v-show="item.showAdvanced"
              class="px-4 pb-4 pt-2 space-y-3 border-t border-(--ui-border)/50"
            >
              <div class="flex items-center justify-between">
                <p class="text-xs text-(--ui-text-muted)">Per-set rest override</p>
                <button
                  class="text-xs px-2 py-0.5 rounded-md transition-colors"
                  :class="item.setRests !== null
                    ? 'bg-(--color-accent)/20 text-(--color-accent)'
                    : 'bg-(--color-surface-2) text-(--ui-text-muted)'"
                  :aria-pressed="item.setRests !== null"
                  @click="toggleVariableRest(item)"
                >
                  {{ item.setRests !== null ? 'On' : 'Off' }}
                </button>
              </div>

              <div v-if="item.setRests !== null" class="grid gap-2" :style="{ gridTemplateColumns: `repeat(${Math.min(item.setsPlanned, 5)}, 1fr)` }">
                <div
                  v-for="(_, si) in item.setRests"
                  :key="si"
                  class="space-y-0.5"
                >
                  <label class="text-[10px] text-(--ui-text-muted) text-center block" :for="`sr-${item.id}-${si}`">
                    Set {{ si + 1 }}
                  </label>
                  <input
                    :id="`sr-${item.id}-${si}`"
                    v-model.number="item.setRests[si]"
                    type="number"
                    min="0"
                    step="15"
                    class="w-full text-center text-xs font-bold bg-(--color-surface-2) rounded-lg py-1.5 outline-none focus-visible:ring-1 focus-visible:ring-(--color-accent)"
                    :aria-label="`Rest after set ${si + 1} for ${item.name}`"
                  />
                </div>
              </div>
              <p v-else class="text-xs text-(--ui-text-muted)">
                All sets use the same rest ({{ item.restSeconds }}s). Toggle on to set different rests per set.
              </p>
            </div>
          </li>
        </ul>

        <div v-else class="rounded-xl bg-(--color-surface) px-4 py-6 text-center text-(--ui-text-muted) text-sm mb-4">
          Add exercises to your template below.
        </div>

        <UButton
          variant="ghost"
          color="primary"
          class="w-full border-2 border-dashed border-(--ui-border) rounded-xl h-12"
          aria-label="Add exercise to template"
          @click="showPicker = true"
        >
          <UIcon name="i-heroicons-plus" class="w-5 h-5" aria-hidden="true" />
          Add Exercise
        </UButton>
      </section>

      <!-- Superset groups -->
      <section v-if="settings.showSupersets && groups.length > 0" aria-labelledby="groups-heading" class="space-y-3">
        <h2 id="groups-heading" class="text-sm font-semibold uppercase tracking-wider text-(--ui-text-muted)">
          Superset Groups
        </h2>

        <div
          v-for="g in groups"
          :key="g.label"
          class="rounded-xl bg-(--color-surface) p-4 space-y-3"
        >
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <span
                class="w-7 h-7 rounded-full bg-(--color-accent)/20 text-(--color-accent) text-sm font-bold flex items-center justify-center"
                :aria-label="`Group ${g.label}`"
              >{{ g.label }}</span>
              <span class="text-sm font-medium">
                {{ exercisesInGroup(g.label).map(e => e.name).join(' + ') || 'No exercises assigned' }}
              </span>
            </div>
            <button
              class="text-xs text-(--ui-text-muted) hover:text-red-400 transition-colors"
              :aria-label="`Remove group ${g.label}`"
              @click="removeGroup(g.label)"
            >
              <UIcon name="i-heroicons-x-mark" class="w-4 h-4" aria-hidden="true" />
            </button>
          </div>

          <!-- Custom name -->
          <div class="space-y-1">
            <label class="text-xs text-(--ui-text-muted)" :for="`gn-${g.label}`">Custom name <span class="normal-case font-normal">(optional)</span></label>
            <input
              :id="`gn-${g.label}`"
              v-model="g.name"
              type="text"
              placeholder="e.g. Chest superset"
              class="w-full bg-(--color-surface-2) rounded-lg px-3 py-1.5 text-sm outline-none focus-visible:ring-1 focus-visible:ring-(--color-accent)"
            />
          </div>

          <!-- Group type -->
          <div class="space-y-1">
            <label class="text-xs text-(--ui-text-muted)" :for="`gt-${g.label}`">Type</label>
            <select
              :id="`gt-${g.label}`"
              v-model="g.groupType"
              class="w-full bg-(--color-surface-2) rounded-lg px-3 py-1.5 text-sm outline-none focus-visible:ring-1 focus-visible:ring-(--color-accent)"
              @change="onGroupTypeChange(g)"
            >
              <option v-for="(label, value) in groupTypeLabels" :key="value" :value="value">
                {{ label }}
              </option>
            </select>
          </div>

          <!-- Rest config -->
          <div class="grid grid-cols-2 gap-2">
            <div class="space-y-1">
              <label class="text-xs text-(--ui-text-muted)" :for="`tr-${g.label}`">Transition rest (s)</label>
              <input
                :id="`tr-${g.label}`"
                v-model.number="g.transitionRestSec"
                type="number"
                min="0"
                step="5"
                class="w-full text-center text-sm font-bold bg-(--color-surface-2) rounded-lg py-1.5 outline-none focus-visible:ring-1 focus-visible:ring-(--color-accent)"
              />
            </div>
            <div class="space-y-1">
              <label class="text-xs text-(--ui-text-muted)" :for="`rr-${g.label}`">Round rest (s)</label>
              <input
                :id="`rr-${g.label}`"
                v-model.number="g.restAfterRoundSec"
                type="number"
                min="0"
                step="15"
                class="w-full text-center text-sm font-bold bg-(--color-surface-2) rounded-lg py-1.5 outline-none focus-visible:ring-1 focus-visible:ring-(--color-accent)"
              />
            </div>
          </div>
        </div>
      </section>
    </article>

    <!-- Exercise picker -->
    <Transition name="slide-up">
      <div
        v-if="showPicker"
        class="fixed inset-0 z-50 bg-(--color-bg) flex flex-col"
        role="dialog"
        aria-label="Add exercise to template"
        aria-modal="true"
      >
        <header class="flex items-center gap-3 p-4 border-b border-(--ui-border)">
          <button
            class="text-(--ui-text-muted)"
            aria-label="Close exercise picker"
            @click="showPicker = false; pickerSearch = ''"
          >
            <UIcon name="i-heroicons-x-mark" class="w-6 h-6" aria-hidden="true" />
          </button>
          <input
            v-model="pickerSearch"
            type="search"
            placeholder="Search exercises…"
            class="flex-1 bg-transparent text-lg outline-none"
            aria-label="Search exercises"
            autofocus
          />
        </header>
        <div
          v-if="exercises.length === 0"
          class="flex-1 flex items-center justify-center p-8 text-(--ui-text-muted)"
          role="status"
          aria-live="polite"
        >
          <p class="text-sm">Loading exercises…</p>
        </div>
        <ul v-else role="list" class="overflow-y-auto flex-1 divide-y divide-(--ui-border)">
          <li v-for="ex in filteredExercises" :key="ex.id">
            <button
              class="w-full text-left px-4 py-3 hover:bg-(--color-surface) transition-colors flex items-center gap-3"
              @click="addExercise(ex)"
            >
              <ExerciseAvatar :icon="ex.icon ?? null" :movement="ex.movement as any" />
              <div class="min-w-0">
                <p class="font-medium text-sm truncate">{{ ex.name }}</p>
                <p class="text-xs text-(--ui-text-muted) capitalize">
                  {{ ex.equipment }} · {{ ex.movement }}
                </p>
              </div>
            </button>
          </li>
        </ul>
      </div>
    </Transition>

    <!-- Set Scheme Wizard -->
    <WorkoutSetSchemeWizard
      :open="showSchemeWizardFor !== null"
      :exercise-name="items.find(i => i.id === showSchemeWizardFor)?.name ?? ''"
      :current-scheme="items.find(i => i.id === showSchemeWizardFor)?.setScheme ?? null"
      @close="showSchemeWizardFor = null"
      @confirm="(config) => handleSchemeConfirm(showSchemeWizardFor!, config)"
    />
  </div>
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
</style>
