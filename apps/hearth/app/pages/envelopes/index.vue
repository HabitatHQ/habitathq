<script setup lang="ts">
import { getCategoryOptions } from '~/lib/category-options'
import type { Category, EnvelopeWithSpending } from '~/types/database'

const db = useDatabase()
const { settings } = useAppSettings()
const homeCurrency = computed(() => settings.value.currency)
const loading = ref(true)
const categories = ref<Category[]>([])
const expenseCategoryOptions = computed(() => getCategoryOptions(categories.value, 'expense'))
const { period, isCurrentPeriod, prevPeriod, nextPeriod } = usePeriod()

const envelopes = ref<EnvelopeWithSpending[]>([])
const modalError = ref('')
const saving = ref(false)
const pageError = ref('')

async function load() {
  loading.value = true
  pageError.value = ''
  try {
    const result = await Promise.all([
      db.getEnvelopesWithSpending(period.value, homeCurrency.value),
      db.getCategories(),
    ])
    envelopes.value = result[0]
    categories.value = result[1]
  } catch (cause) {
    pageError.value = cause instanceof Error ? cause.message : 'Could not load envelopes.'
  } finally {
    loading.value = false
  }
}

watch([period, homeCurrency], load)
onMounted(load)

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
const modalEnvelope = reactive({
  name: '',
  icon: '📦',
  color: '#f59e0b',
  budget_amount: '',
  category_ids: [] as string[],
})

const isEditing = computed(() => editingEnvelope.value !== null)

function openAddModal() {
  editingEnvelope.value = null
  modalEnvelope.name = ''
  modalEnvelope.icon = '📦'
  modalEnvelope.color = '#f59e0b'
  modalEnvelope.budget_amount = ''
  modalEnvelope.category_ids = []
  modalError.value = ''
  showAddModal.value = true
}

function openEditModal(env: EnvelopeWithSpending) {
  editingEnvelope.value = env
  modalEnvelope.name = env.name
  modalEnvelope.icon = env.icon
  modalEnvelope.color = env.color
  modalEnvelope.budget_amount = String(env.budget_amount)
  try {
    const parsedCategoryIds: unknown = JSON.parse(env.category_ids)
    modalEnvelope.category_ids = Array.isArray(parsedCategoryIds)
      ? parsedCategoryIds.filter((id): id is string => typeof id === 'string')
      : []
  } catch {
    modalEnvelope.category_ids = []
  }
  modalError.value = ''
  showAddModal.value = true
}

async function saveEnvelope() {
  if (saving.value) return
  const budget = Number.parseFloat(modalEnvelope.budget_amount)
  if (!modalEnvelope.name.trim() || !Number.isFinite(budget) || budget < 0) {
    modalError.value = 'Enter an envelope name and a valid non-negative budget.'
    return
  }
  if (modalEnvelope.category_ids.length === 0) {
    modalError.value =
      'Select at least one expense category so spending can draw from this envelope.'
    return
  }
  saving.value = true
  modalError.value = ''
  try {
    const category_ids = JSON.stringify(modalEnvelope.category_ids)
    if (isEditing.value && editingEnvelope.value) {
      await db.updateEnvelope({
        id: editingEnvelope.value.id,
        name: modalEnvelope.name.trim(),
        icon: modalEnvelope.icon,
        color: modalEnvelope.color,
        budget_amount: budget,
        category_ids,
      })
    } else {
      await db.createEnvelope({
        name: modalEnvelope.name.trim(),
        icon: modalEnvelope.icon,
        color: modalEnvelope.color,
        budget_amount: budget,
        period: 'monthly',
        scope: 'household',
        category_ids,
        rollover: 1,
      })
    }
    showAddModal.value = false
    editingEnvelope.value = null
    await load()
  } catch (error) {
    modalError.value = error instanceof Error ? error.message : 'Could not save this envelope.'
  } finally {
    saving.value = false
  }
}

const showDeleteConfirm = ref(false)
const pendingDeleteId = ref<string | null>(null)

function requestDeleteEnvelope(id: string) {
  pendingDeleteId.value = id
  showDeleteConfirm.value = true
}

async function confirmDeleteEnvelope() {
  if (!pendingDeleteId.value) return
  pageError.value = ''
  try {
    await db.deleteEnvelope(pendingDeleteId.value)
    pendingDeleteId.value = null
    await load()
  } catch (cause) {
    pageError.value = cause instanceof Error ? cause.message : 'Could not delete this envelope.'
  }
}
</script>

<template>
  <div class="p-4 space-y-5 max-w-2xl mx-auto">

    <!-- ── Period navigator ────────────────────────────────────────────────── -->
    <PeriodNavigator
      :period="period"
      :is-current-period="isCurrentPeriod"
      @prev="prevPeriod"
      @next="nextPeriod"
    />
    <p v-if="pageError" role="alert" class="text-sm text-rose-400">{{ pageError }}</p>

    <!-- ── Envelope help ─────────────────────────────────────────────────── -->
    <HelpTip id="envelope-budgeting">
      <template #label>What are envelopes?</template>
      <p>Envelopes are a budgeting method where you divide your money into categories, like putting cash into physical envelopes. Each envelope has a monthly budget.</p>
      <p>When you spend money in a category linked to an envelope, it draws from that envelope's budget. The bar shows how much you've used.</p>
      <dl class="flex gap-3">
        <div><dt class="inline font-medium text-(--ui-text)">Green</dt> <dd class="inline">= on track</dd></div>
        <div><dt class="inline font-medium text-amber-400">Amber</dt> <dd class="inline">= getting close</dd></div>
        <div><dt class="inline font-medium text-rose-400">Red</dt> <dd class="inline">= overspent</dd></div>
      </dl>
    </HelpTip>

    <!-- ── Overall budget summary ──────────────────────────────────────────── -->
    <section class="rounded-2xl bg-(--ui-bg-muted) border border-(--ui-border) p-5 space-y-3" aria-label="Budget overview">
      <div class="flex items-end justify-between">
        <div>
          <p class="text-xs uppercase tracking-widest text-(--ui-text-muted) font-medium mb-1">Total Budget</p>
          <p class="text-3xl font-bold font-mono amount-display">{{ formatAmount(totalBudget, homeCurrency) }}</p>
        </div>
        <div class="text-right">
          <p class="text-xs text-(--ui-text-muted)">remaining</p>
          <p
            class="text-xl font-bold font-mono amount-display"
            :class="totalRemaining < 0 ? 'text-rose-400' : 'text-green-400'"
          >
            {{ totalRemaining < 0 ? '−' : '' }}{{ formatAmount(Math.abs(totalRemaining), homeCurrency) }}
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
        <span class="font-mono">{{ formatAmount(totalSpent, homeCurrency) }} spent</span>
        <span v-if="overspentCount > 0" class="text-rose-400 font-medium">
          {{ overspentCount }} {{ overspentCount === 1 ? 'envelope' : 'envelopes' }} overspent
        </span>
        <span v-else class="font-mono">{{ Math.round(overallPercent) }}%</span>
      </div>
      <p
        v-if="envelopes.some((env) => env.missing_conversion_count > 0)"
        class="text-xs text-amber-400"
        role="status"
        aria-label="Currency conversion notice"
      >
        Some foreign-currency spending is excluded because no conversion rate is available.
      </p>
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
          <AppIcon name="plus" class="w-4 h-4" />
          Add
        </button>
      </div>

      <!-- Loading -->
      <AppSkeleton v-if="loading" variant="card" :count="5" />

      <!-- Empty -->
      <AppEmptyState
        v-else-if="!envelopes.length"
        icon="archive-box"
        title="No envelopes yet"
        description="Create an envelope to start budgeting"
      >
        <template #actions>
          <button
            class="px-4 py-2 bg-primary-500/15 text-primary-400 rounded-xl text-sm font-medium hover:bg-primary-500/20 transition-colors min-h-[44px]"
            @click="openAddModal"
          >
            Create first envelope
          </button>
        </template>
      </AppEmptyState>

      <!-- Envelope cards -->
      <ul v-else class="space-y-3 stagger-list">
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
            <div class="flex items-center gap-1 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
              <button
                class="p-2 rounded-lg text-(--ui-text-dimmed) hover:text-primary-400 hover:bg-primary-500/10 transition-colors min-h-[44px] min-w-[44px]"
                :aria-label="`Edit ${env.name} envelope`"
                @click="openEditModal(env)"
              >
                <AppIcon name="pencil" class="w-4 h-4" />
              </button>
              <button
                class="p-2 rounded-lg text-(--ui-text-dimmed) hover:text-rose-400 hover:bg-rose-500/10 transition-colors min-h-[44px] min-w-[44px]"
                :aria-label="`Delete ${env.name} envelope`"
                @click="requestDeleteEnvelope(env.id)"
              >
                <AppIcon name="trash" class="w-4 h-4" />
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
          <div class="space-y-1">
            <div class="flex justify-between text-sm">
              <span class="font-mono" :class="envelopeColorClass(env.percent_used, env.is_overspent).text">
                {{ formatAmount(env.spent, homeCurrency) }} spent
              </span>
              <span class="font-mono text-(--ui-text-muted)">
                {{ env.remaining < 0 ? '−' : '' }}{{ formatAmount(Math.abs(env.remaining), homeCurrency) }}
                {{ env.remaining < 0 ? 'overspent' : 'left' }}
                of {{ formatAmount(env.budget_amount, homeCurrency) }}
              </span>
            </div>
            <p v-if="env.missing_conversion_count > 0" class="text-xs text-amber-400" role="status">
              {{ env.missing_conversion_count }} transaction{{ env.missing_conversion_count === 1 ? '' : 's' }} excluded: missing exchange rate
            </p>
          </div>
        </li>
      </ul>
    </section>

    <!-- ── Add/Edit Envelope modal ──────────────────────────────────────── -->
    <AppBottomSheet v-model="showAddModal" :title="isEditing ? 'Edit Envelope' : 'New Envelope'" max-width="lg">
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
          <span class="text-sm text-(--ui-text-muted)">{{ getCurrencySymbol(homeCurrency) }}</span>
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
        <fieldset class="space-y-2">
          <legend class="text-sm font-medium text-(--ui-text)">Spending categories</legend>
          <p class="text-xs text-(--ui-text-muted)">Select one or more expense categories used by this envelope.</p>
          <label
            v-for="category in expenseCategoryOptions"
            :key="category.id"
            class="flex items-center gap-2 min-h-[44px] text-sm"
            :class="{ 'ml-6 text-(--ui-text-muted)': category.depth > 0 }"
          >
            <input v-model="modalEnvelope.category_ids" type="checkbox" :value="category.id" />
            <span>{{ category.icon }} {{ category.label }}</span>
          </label>
        </fieldset>
        <p v-if="modalError" class="text-sm text-rose-400" role="alert">{{ modalError }}</p>
      </div>
      <template #footer>
        <button
          class="w-full py-3.5 bg-primary-500 hover:bg-primary-400 text-white font-semibold rounded-2xl transition-colors min-h-[48px] disabled:opacity-40 btn-press"
          :disabled="saving || !modalEnvelope.name || !modalEnvelope.budget_amount"
          :aria-busy="saving"
          @click="saveEnvelope"
        >
          {{ saving ? 'Saving…' : isEditing ? 'Save Changes' : 'Create Envelope' }}
        </button>
      </template>
    </AppBottomSheet>

    <!-- ── Delete confirmation ──────────────────────────────────────────── -->
    <AppConfirmDialog
      v-model="showDeleteConfirm"
      icon="trash"
      icon-color="red"
      title="Delete envelope?"
      message="This envelope and its budget will be permanently removed."
      confirm-label="Delete"
      confirm-color="error"
      @confirm="confirmDeleteEnvelope"
    />

  </div>
</template>
