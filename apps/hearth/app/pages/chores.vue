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

async function deleteChore(id: string) {
  await db.deleteChore(id)
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
        icon="i-heroicons-plus"
        size="sm"
        class="min-h-[44px] min-w-[44px]"
        aria-label="Add chore"
        @click="openAdd"
      />
    </div>

    <!-- Filter chips -->
    <div class="flex gap-2 flex-wrap" role="group" aria-label="Filter by frequency">
      <button
        v-for="f in (['all', 'daily', 'weekly', 'monthly'] as const)"
        :key="f"
        class="px-3 py-1.5 rounded-full text-xs font-medium transition-colors min-h-[36px]"
        :class="filterFreq === f
          ? 'bg-primary-500 text-white'
          : 'bg-(--ui-bg-muted) text-(--ui-text-muted) hover:bg-(--ui-bg-elevated)'"
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
    <div v-if="loading" class="py-12 flex justify-center">
      <UIcon name="i-heroicons-arrow-path" class="w-6 h-6 animate-spin text-(--ui-text-muted)" />
    </div>

    <!-- Empty state -->
    <div
      v-else-if="chores.length === 0"
      class="py-16 text-center space-y-3"
    >
      <div class="text-5xl">✅</div>
      <p class="font-semibold">No chores yet</p>
      <p class="text-sm text-(--ui-text-muted)">Add recurring tasks to keep your household running smoothly.</p>
      <UButton size="sm" class="mt-2" @click="openAdd">Add your first chore</UButton>
    </div>

    <!-- Chore list -->
    <ul v-else class="space-y-2">
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
          <UIcon
            :name="chore.is_done ? 'i-heroicons-check' : 'i-heroicons-circle-stack'"
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
              <UIcon name="i-heroicons-check-circle" class="w-3 h-3" />
              {{ chore.completed_by_avatar }} {{ chore.completed_by_name }}
            </span>
            <span v-if="!chore.assigned_to_name && !chore.is_done" class="text-xs text-(--ui-text-muted)">
              {{ PERIOD_LABEL[chore.frequency] }}
            </span>
          </div>
        </div>

        <!-- Edit / Delete (show on hover) -->
        <div class="flex gap-0.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
          <UButton
            icon="i-heroicons-pencil-square"
            variant="ghost"
            color="neutral"
            size="xs"
            class="min-h-[44px] min-w-[44px]"
            :aria-label="`Edit ${chore.name}`"
            @click="openEdit(chore)"
          />
          <UButton
            icon="i-heroicons-trash"
            variant="ghost"
            color="error"
            size="xs"
            class="min-h-[44px] min-w-[44px]"
            :aria-label="`Delete ${chore.name}`"
            @click="deleteChore(chore.id)"
          />
        </div>
      </li>
    </ul>

    <!-- Add/Edit modal -->
    <Teleport to="body">
      <Transition name="sheet">
        <div
          v-if="showModal"
          class="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
          role="dialog"
          :aria-label="editingId ? 'Edit chore' : 'Add chore'"
          aria-modal="true"
        >
          <!-- Backdrop -->
          <div class="absolute inset-0 bg-black/50" @click="showModal = false" />

          <!-- Sheet -->
          <div class="relative w-full sm:max-w-md bg-(--ui-bg) rounded-t-2xl sm:rounded-2xl p-5 space-y-4 shadow-xl"
            :style="{ paddingBottom: 'calc(1.25rem + env(safe-area-inset-bottom))' }"
          >
            <div class="flex items-center justify-between">
              <h2 class="text-lg font-semibold">{{ editingId ? 'Edit Chore' : 'Add Chore' }}</h2>
              <UButton
                icon="i-heroicons-x-mark"
                variant="ghost"
                color="neutral"
                size="sm"
                class="min-h-[44px] min-w-[44px]"
                aria-label="Close"
                @click="showModal = false"
              />
            </div>

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
                  class="flex-1 py-2 rounded-xl text-sm font-medium transition-colors min-h-[44px]"
                  :class="form.frequency === f
                    ? 'bg-primary-500 text-white'
                    : 'bg-(--ui-bg-muted) text-(--ui-text-muted) hover:bg-(--ui-bg-elevated)'"
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
                  class="flex-1 py-2 rounded-xl text-sm font-medium transition-colors capitalize min-h-[44px]"
                  :class="form.scope === s
                    ? 'bg-primary-500 text-white'
                    : 'bg-(--ui-bg-muted) text-(--ui-text-muted) hover:bg-(--ui-bg-elevated)'"
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
                  class="px-3 py-2 rounded-xl text-sm font-medium transition-colors min-h-[44px]"
                  :class="form.assigned_to === null
                    ? 'bg-primary-500 text-white'
                    : 'bg-(--ui-bg-muted) text-(--ui-text-muted) hover:bg-(--ui-bg-elevated)'"
                  @click="form.assigned_to = null"
                >
                  Anyone
                </button>
                <button
                  v-for="u in users"
                  :key="u.id"
                  class="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium transition-colors min-h-[44px]"
                  :class="form.assigned_to === u.id
                    ? 'bg-primary-500 text-white'
                    : 'bg-(--ui-bg-muted) text-(--ui-text-muted) hover:bg-(--ui-bg-elevated)'"
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

            <!-- Save -->
            <UButton
              block
              :loading="saving"
              :disabled="!form.name.trim()"
              class="min-h-[48px]"
              @click="saveChore"
            >
              {{ editingId ? 'Save Changes' : 'Add Chore' }}
            </UButton>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.sheet-enter-active,
.sheet-leave-active {
  transition: opacity 0.2s ease;
}
.sheet-enter-active .relative,
.sheet-leave-active .relative {
  transition: transform 0.25s ease;
}
.sheet-enter-from,
.sheet-leave-to {
  opacity: 0;
}
.sheet-enter-from .relative {
  transform: translateY(100%);
}
.sheet-leave-to .relative {
  transform: translateY(100%);
}
</style>
