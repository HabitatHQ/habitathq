<script setup lang="ts">
import type { EnvelopeWithSpending } from '~/types/database'
import { currentPeriod } from '~/utils/format'

const db = useDatabase()

const period = ref(currentPeriod())
const envelopes = ref<EnvelopeWithSpending[]>([])
const loading = ref(true)

async function load() {
  loading.value = true
  try {
    envelopes.value = await db.getEnvelopesWithSpending(period.value)
  } finally {
    loading.value = false
  }
}

watch(period, load)
onMounted(load)

const isCurrentPeriod = computed(() => period.value === currentPeriod())

const totalBudget = computed(() => envelopes.value.reduce((s, e) => s + e.budget_amount, 0))
const totalSpent = computed(() => envelopes.value.reduce((s, e) => s + e.spent, 0))
const totalRemaining = computed(() => totalBudget.value - totalSpent.value)
const overallPercent = computed(() =>
  totalBudget.value > 0 ? (totalSpent.value / totalBudget.value) * 100 : 0,
)

const overspentCount = computed(() => envelopes.value.filter((e) => e.is_overspent).length)

// Sort: overspent first, then by % used desc
const sortedEnvelopes = computed(() =>
  [...envelopes.value].sort((a, b) => {
    if (a.is_overspent !== b.is_overspent) return a.is_overspent ? -1 : 1
    return b.percent_used - a.percent_used
  }),
)

const showAddModal = ref(false)
const editingEnvelope = ref<EnvelopeWithSpending | null>(null)
const modalEnvelope = reactive({ name: '', icon: '📦', color: '#f59e0b', budget_amount: '' })

const isEditing = computed(() => editingEnvelope.value !== null)

function openAddModal() {
  editingEnvelope.value = null
  modalEnvelope.name = ''
  modalEnvelope.icon = '📦'
  modalEnvelope.color = '#f59e0b'
  modalEnvelope.budget_amount = ''
  showAddModal.value = true
}

function openEditModal(env: EnvelopeWithSpending) {
  editingEnvelope.value = env
  modalEnvelope.name = env.name
  modalEnvelope.icon = env.icon
  modalEnvelope.color = env.color
  modalEnvelope.budget_amount = String(env.budget_amount)
  showAddModal.value = true
}

async function saveEnvelope() {
  const budget = parseFloat(modalEnvelope.budget_amount)
  if (!modalEnvelope.name || Number.isNaN(budget)) return
  if (isEditing.value && editingEnvelope.value) {
    await db.updateEnvelope({
      id: editingEnvelope.value.id,
      name: modalEnvelope.name,
      icon: modalEnvelope.icon,
      color: modalEnvelope.color,
      budget_amount: budget,
    })
  } else {
    await db.createEnvelope({
      name: modalEnvelope.name,
      icon: modalEnvelope.icon,
      color: modalEnvelope.color,
      budget_amount: budget,
      period: 'monthly',
      scope: 'household',
      category_ids: '[]',
      rollover: 1,
    })
  }
  showAddModal.value = false
  editingEnvelope.value = null
  await load()
}

async function deleteEnvelope(id: string) {
  if (!confirm('Delete this envelope?')) return
  await db.deleteEnvelope(id)
  await load()
}
</script>

<template>
  <div class="p-4 space-y-5 max-w-2xl mx-auto">

    <!-- ── Period navigator ────────────────────────────────────────────────── -->
    <div class="flex items-center justify-between">
      <button
        class="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-(--ui-text-muted) hover:text-(--ui-text) hover:bg-(--ui-bg-elevated) transition-colors"
        aria-label="Previous month"
        @click="period = offsetPeriod(period, -1)"
      >
        <UIcon name="i-heroicons-chevron-left" class="w-5 h-5" />
      </button>
      <h1 class="text-xs font-semibold text-(--ui-text-muted) tracking-wide uppercase">
        {{ formatPeriod(period) }}
      </h1>
      <button
        class="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg transition-colors"
        :class="isCurrentPeriod ? 'text-(--ui-text-dimmed) cursor-default' : 'text-(--ui-text-muted) hover:text-(--ui-text) hover:bg-(--ui-bg-elevated)'"
        :disabled="isCurrentPeriod"
        aria-label="Next month"
        @click="period = offsetPeriod(period, 1)"
      >
        <UIcon name="i-heroicons-chevron-right" class="w-5 h-5" />
      </button>
    </div>

    <!-- ── Envelope help ─────────────────────────────────────────────────── -->
    <HelpTip id="envelope-budgeting">
      <template #label>What are envelopes?</template>
      <p>Envelopes are a budgeting method where you divide your money into categories, like putting cash into physical envelopes. Each envelope has a monthly budget.</p>
      <p>When you spend money in a category linked to an envelope, it draws from that envelope's budget. The bar shows how much you've used.</p>
      <p><strong class="text-(--ui-text)">Green</strong> = on track. <strong class="text-amber-400">Amber</strong> = getting close to the limit. <strong class="text-rose-400">Red</strong> = overspent.</p>
    </HelpTip>

    <!-- ── Overall budget summary ──────────────────────────────────────────── -->
    <section class="rounded-2xl bg-(--ui-bg-muted) border border-(--ui-border) p-5 space-y-3" aria-label="Budget overview">
      <div class="flex items-end justify-between">
        <div>
          <p class="text-xs uppercase tracking-widest text-(--ui-text-muted) font-medium mb-1">Total Budget</p>
          <p class="text-3xl font-bold font-mono amount-display">{{ formatAmount(totalBudget) }}</p>
        </div>
        <div class="text-right">
          <p class="text-xs text-(--ui-text-muted)">remaining</p>
          <p
            class="text-xl font-bold font-mono amount-display"
            :class="totalRemaining < 0 ? 'text-rose-400' : 'text-green-400'"
          >
            {{ formatAmount(Math.abs(totalRemaining)) }}
          </p>
        </div>
      </div>

      <!-- Overall progress bar -->
      <div
        class="h-3 rounded-full bg-(--ui-bg-elevated) overflow-hidden"
        role="progressbar"
        :aria-valuenow="Math.round(clamp(overallPercent))"
        aria-valuemin="0"
        aria-valuemax="100"
        :aria-label="`${Math.round(overallPercent)}% of total budget used`"
      >
        <div
          class="h-full rounded-full envelope-bar"
          :class="overallPercent >= 100 ? 'bg-rose-500' : overallPercent >= 70 ? 'bg-amber-500' : 'bg-primary-500'"
          :style="{ width: `${clamp(overallPercent)}%` }"
        />
      </div>

      <div class="flex justify-between text-sm text-(--ui-text-muted)">
        <span class="font-mono">{{ formatAmount(totalSpent) }} spent</span>
        <span v-if="overspentCount > 0" class="text-rose-400 font-medium">
          {{ overspentCount }} {{ overspentCount === 1 ? 'envelope' : 'envelopes' }} overspent
        </span>
        <span v-else class="font-mono">{{ Math.round(overallPercent) }}%</span>
      </div>
    </section>

    <!-- ── Envelope list ───────────────────────────────────────────────────── -->
    <section aria-label="Budget envelopes">
      <div class="flex items-center justify-between mb-3">
        <h2 class="text-xs uppercase tracking-widest text-(--ui-text-muted) font-medium">Envelopes</h2>
        <button
          class="flex items-center gap-1 text-xs text-primary-400 hover:text-primary-300 transition-colors min-h-[44px] px-2"
          aria-label="Add envelope"
          @click="openAddModal"
        >
          <UIcon name="i-heroicons-plus" class="w-3.5 h-3.5" />
          Add
        </button>
      </div>

      <!-- Loading -->
      <div v-if="loading" class="space-y-3">
        <div v-for="n in 5" :key="n" class="h-20 bg-(--ui-bg-muted) rounded-2xl animate-pulse" />
      </div>

      <!-- Empty -->
      <div v-else-if="!envelopes.length" class="text-center py-12">
        <UIcon name="i-heroicons-archive-box" class="w-12 h-12 text-(--ui-text-dimmed) mb-3 mx-auto" aria-hidden="true" />
        <p class="text-(--ui-text-muted) font-medium">No envelopes yet</p>
        <p class="text-sm text-(--ui-text-dimmed) mt-1">Create an envelope to start budgeting</p>
        <button
          class="mt-4 px-4 py-2 bg-primary-500/15 text-primary-400 rounded-xl text-sm font-medium hover:bg-primary-500/20 transition-colors min-h-[44px]"
          @click="openAddModal"
        >
          Create first envelope
        </button>
      </div>

      <!-- Envelope cards -->
      <ul v-else class="space-y-3">
        <li
          v-for="env in sortedEnvelopes"
          :key="env.id"
          class="group rounded-2xl bg-(--ui-bg-muted) border border-(--ui-border) p-4 space-y-3 hover:border-(--ui-border-accented) transition-colors"
        >
          <!-- Header row -->
          <div class="flex items-start justify-between">
            <div class="flex items-center gap-2.5">
              <span class="text-2xl leading-none" aria-hidden="true">{{ env.icon }}</span>
              <div>
                <div class="flex items-center gap-1.5">
                  <span class="font-semibold text-(--ui-text)">{{ env.name }}</span>
                  <span
                    v-if="env.is_overspent"
                    class="text-[10px] font-bold uppercase tracking-wide text-rose-400 bg-rose-500/10 px-1.5 py-0.5 rounded"
                    role="status"
                  >
                    Overspent
                  </span>
                  <span
                    v-else-if="env.percent_used >= 70"
                    class="text-[10px] font-bold uppercase tracking-wide text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded"
                    role="status"
                  >
                    Almost full
                  </span>
                </div>
                <p class="text-xs text-(--ui-text-muted) mt-0.5">{{ env.scope === 'household' ? 'Household' : 'Personal' }}</p>
              </div>
            </div>
            <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                class="p-2 rounded-lg text-(--ui-text-dimmed) hover:text-primary-400 hover:bg-primary-500/10 transition-colors min-h-[36px] min-w-[36px]"
                :aria-label="`Edit ${env.name} envelope`"
                @click="openEditModal(env)"
              >
                <UIcon name="i-heroicons-pencil" class="w-4 h-4" />
              </button>
              <button
                class="p-2 rounded-lg text-(--ui-text-dimmed) hover:text-rose-400 hover:bg-rose-500/10 transition-colors min-h-[36px] min-w-[36px]"
                :aria-label="`Delete ${env.name} envelope`"
                @click="deleteEnvelope(env.id)"
              >
                <UIcon name="i-heroicons-trash" class="w-4 h-4" />
              </button>
            </div>
          </div>

          <!-- Progress bar -->
          <div
            class="h-2 rounded-full bg-(--ui-bg-elevated) overflow-hidden"
            role="progressbar"
            :aria-valuenow="Math.min(Math.round(env.percent_used), 100)"
            aria-valuemin="0"
            aria-valuemax="100"
            :aria-label="`${env.name}: ${Math.round(env.percent_used)}% of budget used`"
          >
            <div
              class="h-full rounded-full envelope-bar"
              :class="envelopeColorClass(env.percent_used, env.is_overspent).bar"
              :style="{ width: `${clamp(env.percent_used)}%` }"
            />
          </div>

          <!-- Amount row -->
          <div class="flex justify-between text-sm">
            <span class="font-mono" :class="envelopeColorClass(env.percent_used, env.is_overspent).text">
              {{ formatAmount(env.spent) }} spent
            </span>
            <span class="font-mono text-(--ui-text-muted)">
              {{ env.is_overspent ? '−' : '' }}{{ formatAmount(Math.abs(env.remaining)) }}
              {{ env.is_overspent ? 'over' : 'left' }}
              of {{ formatAmount(env.budget_amount) }}
            </span>
          </div>
        </li>
      </ul>
    </section>

    <!-- ── Add Envelope modal ──────────────────────────────────────────────── -->
    <Teleport to="body">
      <Transition
        enter-active-class="transition-all duration-200 ease-out"
        enter-from-class="opacity-0"
        enter-to-class="opacity-100"
        leave-active-class="transition-all duration-150 ease-in"
        leave-from-class="opacity-100"
        leave-to-class="opacity-0"
      >
        <div
          v-if="showAddModal"
          class="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-sm"
          @click.self="showAddModal = false"
        >
          <div
            class="w-full max-w-lg bg-(--ui-bg) rounded-t-3xl border-t border-(--ui-border) p-6 space-y-4"
            role="dialog"
            aria-modal="true"
            :aria-label="isEditing ? 'Edit envelope' : 'Add envelope'"
          >
            <div class="flex items-center justify-between">
              <h2 class="text-lg font-semibold">{{ isEditing ? 'Edit Envelope' : 'New Envelope' }}</h2>
              <button
                type="button"
                class="min-h-[44px] min-w-[44px] flex items-center justify-center text-(--ui-text-muted) hover:text-(--ui-text)"
                aria-label="Close"
                @click="showAddModal = false"
              >
                <UIcon name="i-heroicons-x-mark" class="w-5 h-5" />
              </button>
            </div>

            <div class="space-y-3">
              <div class="flex items-center gap-3 px-3 py-2 bg-(--ui-bg-muted) rounded-xl min-h-[52px]">
                <label class="text-sm text-(--ui-text-muted) w-16 shrink-0" for="env-icon">Icon</label>
                <input
                  id="env-icon"
                  v-model="modalEnvelope.icon"
                  type="text"
                  maxlength="2"
                  class="bg-transparent text-xl w-10 focus:outline-none text-center"
                />
              </div>
              <div class="flex items-center gap-3 px-3 py-2 bg-(--ui-bg-muted) rounded-xl min-h-[52px]">
                <label class="text-sm text-(--ui-text-muted) w-16 shrink-0" for="env-name">Name</label>
                <input
                  id="env-name"
                  v-model="modalEnvelope.name"
                  type="text"
                  placeholder="e.g. Groceries"
                  class="flex-1 bg-transparent text-sm text-(--ui-text) placeholder:text-(--ui-text-dimmed) focus:outline-none"
                />
              </div>
              <div class="flex items-center gap-3 px-3 py-2 bg-(--ui-bg-muted) rounded-xl min-h-[52px]">
                <label class="text-sm text-(--ui-text-muted) w-16 shrink-0" for="env-budget">Budget</label>
                <span class="text-sm text-(--ui-text-muted)">$</span>
                <input
                  id="env-budget"
                  v-model="modalEnvelope.budget_amount"
                  type="number"
                  step="10"
                  min="0"
                  placeholder="500"
                  class="flex-1 bg-transparent text-sm text-(--ui-text) placeholder:text-(--ui-text-dimmed) focus:outline-none font-mono"
                />
                <span class="text-sm text-(--ui-text-muted)">/mo</span>
              </div>
            </div>

            <button
              class="w-full py-3.5 bg-primary-500 hover:bg-primary-400 text-white font-semibold rounded-2xl transition-colors min-h-[52px] disabled:opacity-40"
              :disabled="!modalEnvelope.name || !modalEnvelope.budget_amount"
              @click="saveEnvelope"
            >
              {{ isEditing ? 'Save Changes' : 'Create Envelope' }}
            </button>
          </div>
        </div>
      </Transition>
    </Teleport>

  </div>
</template>
