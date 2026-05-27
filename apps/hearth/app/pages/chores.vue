<script setup lang="ts">
import type { ChoreFrequency, ChoreWithStatus } from '~/types/database'

const db = useDatabase()
const today = new Date().toISOString().slice(0, 10)

const chores = ref<ChoreWithStatus[]>([])
const loading = ref(true)
const filterFreq = ref<'all' | ChoreFrequency>('all')

async function load() {
  loading.value = true
  chores.value = await db.getChoresWithStatus(today)
  loading.value = false
}

onMounted(load)

const filtered = computed(() =>
  filterFreq.value === 'all'
    ? chores.value
    : chores.value.filter((c) => c.frequency === filterFreq.value),
)

const doneCount = computed(() => filtered.value.filter((c) => c.is_done).length)
const totalCount = computed(() => filtered.value.length)
const progressPct = computed(() =>
  totalCount.value === 0 ? 0 : Math.round((doneCount.value / totalCount.value) * 100),
)

async function toggleComplete(chore: ChoreWithStatus) {
  if (chore.is_done) {
    await db.uncompleteChore(chore.id, today)
  } else {
    const currentUser = await db.getCurrentUser()
    if (!currentUser) return
    await db.completeChore(chore.id, currentUser.id, today)
  }
  await load()
}

// ── Add / Edit modal ──────────────────────────────────────────────────────

const showModal = ref(false)
const editingId = ref<string | null>(null)

const form = reactive<{
  name: string
  icon: string
  frequency: ChoreFrequency
  scope: 'personal' | 'household'
  color: string
  assigned_to: string | null
}>({
  name: '',
  icon: '✅',
  frequency: 'weekly',
  scope: 'household',
  color: '#f59e0b',
  assigned_to: null,
})

const users = ref<Array<{ id: string; name: string; avatar_emoji: string }>>([])
onMounted(async () => {
  users.value = await db.getUsers()
})

function openAdd() {
  editingId.value = null
  form.name = ''
  form.icon = '✅'
  form.frequency = 'weekly'
  form.scope = 'household'
  form.color = '#f59e0b'
  form.assigned_to = null
  showModal.value = true
}

function openEdit(chore: ChoreWithStatus) {
  editingId.value = chore.id
  form.name = chore.name
  form.icon = chore.icon
  form.frequency = chore.frequency
  form.scope = chore.scope
  form.color = chore.color
  form.assigned_to = chore.assigned_to
  showModal.value = true
}

const saving = ref(false)

async function saveChore() {
  if (!form.name.trim()) return
  saving.value = true
  try {
    if (editingId.value) {
      await db.updateChore({ id: editingId.value, ...form })
    } else {
      await db.createChore(form)
    }
    showModal.value = false
    await load()
  } finally {
    saving.value = false
  }
}

const showDeleteConfirm = ref(false)
const pendingDeleteChoreId = ref<string | null>(null)

function requestDeleteChore(id: string) {
  pendingDeleteChoreId.value = id
  showDeleteConfirm.value = true
}

async function confirmDeleteChore() {
  if (!pendingDeleteChoreId.value) return
  await db.deleteChore(pendingDeleteChoreId.value)
  pendingDeleteChoreId.value = null
  await load()
}

// ── Helpers ───────────────────────────────────────────────────────────────

const FREQ_LABELS: Record<ChoreFrequency, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
}

const PERIOD_LABEL: Record<ChoreFrequency, string> = {
  daily: 'Today',
  weekly: 'This Week',
  monthly: new Date().toLocaleString('default', { month: 'long' }),
}

const COLORS = [
  '#f59e0b',
  '#6366f1',
  '#22c55e',
  '#ec4899',
  '#ef4444',
  '#0ea5e9',
  '#a855f7',
  '#f97316',
]
</script>

<template>
  <div class="max-w-lg mx-auto px-4 py-4 space-y-4">

    <!-- Header -->
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-xl font-bold">Chores</h1>
        <p class="text-xs text-(--ui-text-muted)">{{ today }}</p>
      </div>
      <UButton
        :icon="resolveIcon('plus')"
        size="sm"
        class="min-h-[44px] min-w-[44px]"
        aria-label="Add chore"
        @click="openAdd"
      />
    </div>

    <!-- Filter chips -->
    <div class="flex gap-1.5 flex-wrap" role="group" aria-label="Filter by frequency">
      <button
        v-for="f in (['all', 'daily', 'weekly', 'monthly'] as const)"
        :key="f"
        type="button"
        class="chip-btn"
        :aria-pressed="filterFreq === f"
        @click="filterFreq = f"
      >
        {{ f === 'all' ? 'All' : FREQ_LABELS[f] }}
      </button>
    </div>

    <!-- Summary bar -->
    <div v-if="totalCount > 0" class="space-y-1.5">
      <div class="flex justify-between items-center text-sm">
        <span class="text-(--ui-text-muted)">
          <span class="font-mono font-semibold text-(--ui-text)">{{ doneCount }}</span>
          of
          <span class="font-mono font-semibold text-(--ui-text)">{{ totalCount }}</span>
          done
        </span>
        <span class="text-xs text-(--ui-text-muted)">{{ progressPct }}%</span>
      </div>
      <div class="h-1.5 rounded-full bg-(--ui-bg-muted) overflow-hidden">
        <div
          class="h-full rounded-full transition-all duration-500"
          :class="progressPct === 100 ? 'bg-green-500' : progressPct >= 50 ? 'bg-amber-500' : 'bg-(--ui-border-accented)'"
          :style="{ width: `${progressPct}%` }"
        />
      </div>
    </div>

    <!-- Loading -->
    <AppSkeleton v-if="loading" variant="row" :count="4" />

    <!-- Empty state -->
    <AppEmptyState
      v-else-if="chores.length === 0"
      title="No chores yet"
      description="Add recurring tasks to keep your household running smoothly."
    >
      <template #icon><span class="text-4xl">✅</span></template>
      <template #actions>
        <UButton size="sm" @click="openAdd">Add your first chore</UButton>
      </template>
    </AppEmptyState>

    <!-- Chore list -->
    <ul v-else class="space-y-2 stagger-list">
      <li
        v-for="chore in filtered"
        :key="chore.id"
        class="group relative bg-(--ui-bg-muted) border border-(--ui-border) rounded-xl flex items-center gap-3 p-3 transition-opacity"
        :class="chore.is_done ? 'opacity-60' : ''"
      >
        <!-- Complete toggle -->
        <button
          class="shrink-0 w-8 h-8 rounded-full border-2 flex items-center justify-center transition-all min-h-[44px] min-w-[44px]"
          :class="chore.is_done
            ? 'bg-green-500 border-green-500 text-white'
            : 'border-(--ui-border-accented) text-(--ui-text-muted) hover:border-primary-400'"
          :aria-label="chore.is_done ? `Mark ${chore.name} incomplete` : `Complete ${chore.name}`"
          @click="toggleComplete(chore)"
        >
          <AppIcon
            :name="chore.is_done ? 'check' : 'circle-stack'"
            class="w-4 h-4"
          />
        </button>

        <!-- Icon -->
        <span class="text-xl shrink-0" aria-hidden="true">{{ chore.icon }}</span>

        <!-- Info -->
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <span
              class="font-medium text-sm"
              :class="chore.is_done ? 'line-through text-(--ui-text-muted)' : ''"
            >{{ chore.name }}</span>
            <span class="text-xs px-1.5 py-0.5 rounded-full bg-(--ui-bg-elevated) text-(--ui-text-muted)">
              {{ FREQ_LABELS[chore.frequency] }}
            </span>
          </div>
          <div class="flex items-center gap-1.5 mt-0.5 flex-wrap">
            <span v-if="chore.assigned_to_name" class="text-xs text-(--ui-text-muted) flex items-center gap-1">
              <span>{{ chore.assigned_to_avatar }}</span>
              <span>{{ chore.assigned_to_name }}</span>
            </span>
            <span v-if="chore.is_done && chore.completed_by_name" class="text-xs text-green-500 flex items-center gap-1">
              <AppIcon name="check-circle" class="w-3 h-3" />
              {{ chore.completed_by_avatar }} {{ chore.completed_by_name }}
            </span>
            <span v-if="!chore.assigned_to_name && !chore.is_done" class="text-xs text-(--ui-text-muted)">
              {{ PERIOD_LABEL[chore.frequency] }}
            </span>
          </div>
        </div>

        <!-- Edit / Delete (show on hover) -->
        <div class="flex gap-0.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
          <AppIconButton icon="pencil-square" :label="`Edit ${chore.name}`" @click="openEdit(chore)" />
          <AppIconButton icon="trash" class="text-red-500" :label="`Delete ${chore.name}`" @click="requestDeleteChore(chore.id)" />
        </div>
      </li>
    </ul>

    <!-- Add/Edit modal -->
    <AppBottomSheet v-model="showModal" :title="editingId ? 'Edit Chore' : 'Add Chore'">
      <!-- Icon + Name -->
      <div class="flex gap-2">
        <div class="relative">
          <input
            v-model="form.icon"
            type="text"
            maxlength="2"
            class="w-14 h-12 text-2xl text-center rounded-xl border border-(--ui-border) bg-(--ui-bg-muted) focus:outline-none focus:ring-2 focus:ring-primary-500"
            aria-label="Chore icon (emoji)"
          />
        </div>
        <input
          v-model="form.name"
          type="text"
          placeholder="Chore name"
          class="flex-1 h-12 px-3 rounded-xl border border-(--ui-border) bg-(--ui-bg-muted) text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
          aria-label="Chore name"
          @keyup.enter="saveChore"
        />
      </div>

      <!-- Frequency -->
      <div class="space-y-1.5">
        <label class="text-sm font-medium text-(--ui-text-muted)">Frequency</label>
        <div class="flex gap-2" role="group" aria-label="Frequency">
          <button
            v-for="f in (['daily', 'weekly', 'monthly'] as const)"
            :key="f"
            type="button"
            class="inline-flex items-center justify-center flex-1 min-h-[44px] py-2 px-3 rounded-xl text-sm font-medium transition-colors"
            :class="form.frequency === f
              ? 'bg-primary-500/15 text-primary-400 border border-primary-500/30'
              : 'bg-(--ui-bg-muted) text-(--ui-text-muted) hover:bg-(--ui-bg-elevated)'"
            :aria-pressed="form.frequency === f"
            @click="form.frequency = f"
          >
            {{ FREQ_LABELS[f] }}
          </button>
        </div>
      </div>

      <!-- Scope -->
      <div class="space-y-1.5">
        <label class="text-sm font-medium text-(--ui-text-muted)">Scope</label>
        <div class="flex gap-2" role="group" aria-label="Scope">
          <button
            v-for="s in (['household', 'personal'] as const)"
            :key="s"
            type="button"
            class="inline-flex items-center justify-center flex-1 min-h-[44px] py-2 px-3 rounded-xl text-sm font-medium capitalize transition-colors"
            :class="form.scope === s
              ? 'bg-primary-500/15 text-primary-400 border border-primary-500/30'
              : 'bg-(--ui-bg-muted) text-(--ui-text-muted) hover:bg-(--ui-bg-elevated)'"
            :aria-pressed="form.scope === s"
            @click="form.scope = s"
          >
            {{ s }}
          </button>
        </div>
      </div>

      <!-- Assignee -->
      <div class="space-y-1.5">
        <label class="text-sm font-medium text-(--ui-text-muted)">Assign to</label>
        <div class="flex gap-2 flex-wrap" role="group" aria-label="Assignee">
          <button
            type="button"
            class="inline-flex items-center justify-center min-h-[44px] py-2 px-3 rounded-xl text-sm font-medium transition-colors"
            :class="form.assigned_to === null
              ? 'bg-primary-500/15 text-primary-400 border border-primary-500/30'
              : 'bg-(--ui-bg-muted) text-(--ui-text-muted) hover:bg-(--ui-bg-elevated)'"
            :aria-pressed="form.assigned_to === null"
            @click="form.assigned_to = null"
          >
            Anyone
          </button>
          <button
            v-for="u in users"
            :key="u.id"
            type="button"
            class="inline-flex items-center justify-center gap-1.5 min-h-[44px] py-2 px-3 rounded-xl text-sm font-medium transition-colors"
            :class="form.assigned_to === u.id
              ? 'bg-primary-500/15 text-primary-400 border border-primary-500/30'
              : 'bg-(--ui-bg-muted) text-(--ui-text-muted) hover:bg-(--ui-bg-elevated)'"
            :aria-pressed="form.assigned_to === u.id"
            @click="form.assigned_to = u.id"
          >
            <span>{{ u.avatar_emoji }}</span>
            <span>{{ u.name }}</span>
          </button>
        </div>
      </div>

      <!-- Color -->
      <div class="space-y-1.5">
        <label class="text-sm font-medium text-(--ui-text-muted)">Color</label>
        <div class="flex gap-2 flex-wrap">
          <button
            v-for="c in COLORS"
            :key="c"
            class="w-8 h-8 rounded-full transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
            :class="form.color === c ? 'ring-2 ring-offset-2 ring-offset-(--ui-bg) ring-primary-500 scale-110' : 'hover:scale-110'"
            :style="{ background: c }"
            :aria-label="`Color ${c}`"
            @click="form.color = c"
          />
        </div>
      </div>

      <template #footer>
        <UButton
          block
          :loading="saving"
          :disabled="!form.name.trim()"
          class="min-h-[48px] btn-press"
          @click="saveChore"
        >
          {{ editingId ? 'Save Changes' : 'Add Chore' }}
        </UButton>
      </template>
    </AppBottomSheet>

    <!-- Delete confirmation -->
    <AppConfirmDialog
      v-model="showDeleteConfirm"
      icon="trash"
      icon-color="red"
      title="Delete chore?"
      message="This chore will be permanently removed."
      confirm-label="Delete"
      confirm-color="error"
      @confirm="confirmDeleteChore"
    />
  </div>
</template>
