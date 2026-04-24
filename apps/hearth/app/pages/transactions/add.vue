<script setup lang="ts">
import type { Account, Category, User } from '~/types/database'

const db = useDatabase()
const router = useRouter()

// ── Form state ────────────────────────────────────────────────────────────

type TxType = 'expense' | 'income' | 'transfer'

const form = reactive({
  type: 'expense' as TxType,
  amountStr: '',
  date: new Date().toISOString().slice(0, 10),
  accountId: '',
  toAccountId: '',
  categoryId: '',
  merchant: '',
  description: '',
  isPrivate: false,
  isSplit: false,
  splitUserId: '',
  splitAmount: '',
})

const saving = ref(false)
const error = ref<string | null>(null)

// ── Load reference data ────────────────────────────────────────────────────

const accounts = ref<Account[]>([])
const categories = ref<Array<Category & { children: Category[] }>>([])
const users = ref<User[]>([])

onMounted(async () => {
  const [accts, cats, usrs] = await Promise.all([
    db.getAccounts(),
    db.getCategoryTree(),
    db.getUsers(),
  ])
  accounts.value = accts
  categories.value = cats
  users.value = usrs
  if (accts[0]) form.accountId = accts[0].id
  if (accts[1]) form.toAccountId = accts[1].id
})

// ── Category options flat list for current type ────────────────────────────

const categoryOptions = computed(() => {
  const result: { id: string; label: string; icon: string }[] = []
  for (const parent of categories.value) {
    if (form.type === 'income' && parent.id !== 'c7') continue
    if (form.type === 'expense' && parent.id === 'c7') continue
    result.push({ id: parent.id, label: parent.name, icon: parent.icon })
    for (const child of parent.children ?? []) {
      if (form.type === 'income' && parent.id !== 'c7') continue
      result.push({ id: child.id, label: `${parent.icon} ${child.name}`, icon: child.icon })
    }
  }
  return result
})

const otherUsers = computed(() => users.value.filter((u) => !u.is_current))

// ── Amount display ─────────────────────────────────────────────────────────

const amountNum = computed(() => {
  const n = parseFloat(form.amountStr)
  return Number.isNaN(n) ? 0 : n
})

const amountFormatted = computed(() => {
  if (!form.amountStr) return '$0.00'
  const n = parseFloat(form.amountStr)
  if (Number.isNaN(n)) return '$0.00'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
})

// ── Number pad ────────────────────────────────────────────────────────────

function pad(key: string) {
  if (key === 'backspace') {
    form.amountStr = form.amountStr.slice(0, -1)
    return
  }
  if (key === '.' && form.amountStr.includes('.')) return
  if (form.amountStr.includes('.')) {
    const decimals = form.amountStr.split('.')[1] ?? ''
    if (decimals.length >= 2) return
  }
  form.amountStr += key
}

// ── Submit ────────────────────────────────────────────────────────────────

async function submit() {
  if (!amountNum.value) {
    error.value = 'Please enter an amount'
    return
  }
  if (!form.accountId) {
    error.value = 'Please select an account'
    return
  }
  saving.value = true
  error.value = null
  try {
    const currentUser = await db.getCurrentUser()
    const tx = await db.createTransaction({
      date: form.date,
      amount: form.type === 'expense' ? -amountNum.value : amountNum.value,
      currency: 'USD',
      account_id: form.accountId,
      user_id: currentUser?.id ?? users.value[0]?.id ?? '',
      type: form.type,
      category_id: form.categoryId || null,
      description: form.description,
      merchant: form.merchant,
      is_private: form.isPrivate ? 1 : 0,
      is_recurring: 0,
      transfer_to_account_id: form.type === 'transfer' ? form.toAccountId : null,
      split_id: null,
      source: 'manual',
    })

    // Create IOU split if requested
    if (form.isSplit && form.splitUserId && form.splitAmount) {
      const splitAmt = parseFloat(form.splitAmount)
      if (!Number.isNaN(splitAmt) && splitAmt > 0) {
        await db.createIouSplit({
          transaction_id: tx.id,
          from_user_id: currentUser?.id ?? '',
          to_user_id: form.splitUserId,
          amount: splitAmt,
          is_settled: 0,
          settled_at: null,
        })
      }
    }

    router.back()
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to save transaction'
  } finally {
    saving.value = false
  }
}

const TYPE_OPTIONS: { value: TxType; label: string; icon: string }[] = [
  { value: 'expense', label: 'Expense', icon: 'i-heroicons-arrow-up' },
  { value: 'income', label: 'Income', icon: 'i-heroicons-arrow-down' },
  { value: 'transfer', label: 'Transfer', icon: 'i-heroicons-arrows-right-left' },
]
</script>

<template>
  <form class="flex flex-col h-full max-w-lg mx-auto" @submit.prevent="submit">

    <!-- ── Header ───────────────────────────────────────────────────────── -->
    <div class="flex items-center justify-between px-4 py-3 border-b border-(--ui-border)">
      <button
        type="button"
        class="min-h-[44px] min-w-[44px] flex items-center justify-center text-(--ui-text-muted) hover:text-(--ui-text) transition-colors"
        aria-label="Cancel"
        @click="router.back()"
      >
        <UIcon name="i-heroicons-x-mark" class="w-5 h-5" />
      </button>
      <h1 class="text-base font-semibold">New Transaction</h1>
      <button
        type="submit"
        class="min-h-[44px] px-4 font-semibold text-primary-400 hover:text-primary-300 transition-colors disabled:opacity-40"
        :disabled="saving || !amountNum"
        aria-label="Save transaction"
      >
        {{ saving ? 'Saving…' : 'Save' }}
      </button>
    </div>

    <div class="flex-1 overflow-y-auto">

      <!-- ── Type toggle ─────────────────────────────────────────────────── -->
      <div class="flex gap-1 p-4 pb-0" role="group" aria-label="Transaction type">
        <button
          v-for="opt in TYPE_OPTIONS"
          type="button"
          :key="opt.value"
          class="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-sm font-medium transition-all min-h-[44px]"
          :class="form.type === opt.value
            ? 'bg-primary-500/15 text-primary-400 border border-primary-500/30'
            : 'text-(--ui-text-muted) hover:text-(--ui-text) hover:bg-(--ui-bg-muted) border border-transparent'"
          :aria-pressed="form.type === opt.value"
          @click="form.type = opt.value"
        >
          <UIcon :name="opt.icon" class="w-4 h-4" />
          {{ opt.label }}
        </button>
      </div>

      <!-- ── Amount display ──────────────────────────────────────────────── -->
      <div
        class="text-center py-8 px-4"
        aria-label="Amount to enter"
        aria-live="polite"
      >
        <p
          class="text-5xl font-bold font-mono tracking-tight amount-display"
          :class="form.type === 'income' ? 'text-green-400' : 'text-(--ui-text)'"
        >
          {{ amountFormatted }}
        </p>
        <p v-if="form.type === 'expense'" class="text-xs text-(--ui-text-muted) mt-2">Expense</p>
        <p v-else-if="form.type === 'income'" class="text-xs text-green-500 mt-2">Income</p>
        <p v-else class="text-xs text-(--ui-text-muted) mt-2">Transfer</p>
      </div>

      <!-- ── Number pad ──────────────────────────────────────────────────── -->
      <div class="grid grid-cols-4 gap-2 px-4" role="group" aria-label="Number pad">
        <template v-for="key in ['1','2','3','backspace','4','5','6','.','7','8','9','00','','0','','']" :key="key">
          <button
            v-if="key && key !== ''"
            type="button"
            class="flex items-center justify-center h-14 rounded-2xl text-xl font-semibold transition-all active:scale-95 min-h-[44px]"
            :class="key === 'backspace'
              ? 'bg-(--ui-bg-muted) text-(--ui-text-muted) hover:bg-(--ui-bg-elevated)'
              : 'bg-(--ui-bg-muted) text-(--ui-text) hover:bg-(--ui-bg-elevated)'"
            :aria-label="key === 'backspace' ? 'Backspace' : key"
            @click="pad(key)"
          >
            <UIcon v-if="key === 'backspace'" name="i-heroicons-backspace" class="w-5 h-5" />
            <span v-else>{{ key }}</span>
          </button>
          <div v-else class="h-14" />
        </template>
      </div>

      <!-- ── Form fields ─────────────────────────────────────────────────── -->
      <div class="px-4 py-4 space-y-3">

        <!-- Date -->
        <div class="flex items-center gap-3 py-2 px-3 rounded-xl bg-(--ui-bg-muted) min-h-[52px]">
          <UIcon name="i-heroicons-calendar" class="w-5 h-5 text-(--ui-text-muted) shrink-0" aria-hidden="true" />
          <label class="text-sm text-(--ui-text-muted) w-20 shrink-0" for="tx-date">Date</label>
          <input
            id="tx-date"
            v-model="form.date"
            type="date"
            class="flex-1 bg-transparent text-sm text-(--ui-text) focus:outline-none"
          />
        </div>

        <!-- Account -->
        <div class="flex items-center gap-3 py-2 px-3 rounded-xl bg-(--ui-bg-muted) min-h-[52px]">
          <UIcon name="i-heroicons-building-library" class="w-5 h-5 text-(--ui-text-muted) shrink-0" aria-hidden="true" />
          <label class="text-sm text-(--ui-text-muted) w-20 shrink-0" for="tx-account">Account</label>
          <select
            id="tx-account"
            v-model="form.accountId"
            class="flex-1 bg-transparent text-sm text-(--ui-text) focus:outline-none"
          >
            <option v-for="acct in accounts" :key="acct.id" :value="acct.id">
              {{ acct.name }}
            </option>
          </select>
        </div>

        <!-- To account (transfer only) -->
        <div
          v-if="form.type === 'transfer'"
          class="flex items-center gap-3 py-2 px-3 rounded-xl bg-(--ui-bg-muted) min-h-[52px]"
        >
          <UIcon name="i-heroicons-arrows-right-left" class="w-5 h-5 text-(--ui-text-muted) shrink-0" aria-hidden="true" />
          <label class="text-sm text-(--ui-text-muted) w-20 shrink-0" for="tx-to-account">To</label>
          <select
            id="tx-to-account"
            v-model="form.toAccountId"
            class="flex-1 bg-transparent text-sm text-(--ui-text) focus:outline-none"
          >
            <option v-for="acct in accounts.filter(a => a.id !== form.accountId)" :key="acct.id" :value="acct.id">
              {{ acct.name }}
            </option>
          </select>
        </div>

        <!-- Category -->
        <div
          v-if="form.type !== 'transfer'"
          class="flex items-center gap-3 py-2 px-3 rounded-xl bg-(--ui-bg-muted) min-h-[52px]"
        >
          <UIcon name="i-heroicons-tag" class="w-5 h-5 text-(--ui-text-muted) shrink-0" aria-hidden="true" />
          <label class="text-sm text-(--ui-text-muted) w-20 shrink-0" for="tx-category">Category</label>
          <select
            id="tx-category"
            v-model="form.categoryId"
            class="flex-1 bg-transparent text-sm text-(--ui-text) focus:outline-none"
          >
            <option value="">Uncategorized</option>
            <option v-for="cat in categoryOptions" :key="cat.id" :value="cat.id">
              {{ cat.icon }} {{ cat.label }}
            </option>
          </select>
        </div>

        <!-- Merchant -->
        <div class="flex items-center gap-3 py-2 px-3 rounded-xl bg-(--ui-bg-muted) min-h-[52px]">
          <UIcon name="i-heroicons-building-storefront" class="w-5 h-5 text-(--ui-text-muted) shrink-0" aria-hidden="true" />
          <label class="text-sm text-(--ui-text-muted) w-20 shrink-0" for="tx-merchant">Merchant</label>
          <input
            id="tx-merchant"
            v-model="form.merchant"
            type="text"
            placeholder="Where?"
            class="flex-1 bg-transparent text-sm text-(--ui-text) placeholder:text-(--ui-text-dimmed) focus:outline-none"
          />
        </div>

        <!-- Note -->
        <div class="flex items-start gap-3 py-2 px-3 rounded-xl bg-(--ui-bg-muted) min-h-[52px]">
          <UIcon name="i-heroicons-pencil" class="w-5 h-5 text-(--ui-text-muted) shrink-0 mt-0.5" aria-hidden="true" />
          <label class="text-sm text-(--ui-text-muted) w-20 shrink-0 pt-0.5" for="tx-note">Note</label>
          <textarea
            id="tx-note"
            v-model="form.description"
            rows="2"
            placeholder="Optional note…"
            class="flex-1 bg-transparent text-sm text-(--ui-text) placeholder:text-(--ui-text-dimmed) focus:outline-none resize-none"
          />
        </div>

        <!-- Privacy toggle -->
        <div class="flex items-center gap-3 py-2 px-3 rounded-xl bg-(--ui-bg-muted) min-h-[52px]">
          <UIcon name="i-heroicons-eye-slash" class="w-5 h-5 text-(--ui-text-muted) shrink-0" aria-hidden="true" />
          <span class="text-sm text-(--ui-text) flex-1">Private transaction</span>
          <button
            type="button"
            class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
            :class="form.isPrivate ? 'bg-primary-500' : 'bg-(--ui-bg-elevated)'"
            role="switch"
            :aria-checked="form.isPrivate"
            aria-label="Mark as private"
            @click="form.isPrivate = !form.isPrivate"
          >
            <span
              class="inline-block h-4 w-4 rounded-full bg-white transition-transform"
              :class="form.isPrivate ? 'translate-x-6' : 'translate-x-1'"
            />
          </button>
        </div>

        <!-- Split expense (not for income/transfer) -->
        <template v-if="form.type === 'expense' && otherUsers.length">
          <div class="flex items-center gap-3 py-2 px-3 rounded-xl bg-(--ui-bg-muted) min-h-[52px]">
            <UIcon name="i-heroicons-user-group" class="w-5 h-5 text-(--ui-text-muted) shrink-0" aria-hidden="true" />
            <span class="text-sm text-(--ui-text) flex-1">Split with household</span>
            <button
              type="button"
              class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
              :class="form.isSplit ? 'bg-primary-500' : 'bg-(--ui-bg-elevated)'"
              role="switch"
              :aria-checked="form.isSplit"
              aria-label="Split with household member"
              @click="form.isSplit = !form.isSplit"
            >
              <span
                class="inline-block h-4 w-4 rounded-full bg-white transition-transform"
                :class="form.isSplit ? 'translate-x-6' : 'translate-x-1'"
              />
            </button>
          </div>

          <template v-if="form.isSplit">
            <div class="flex items-center gap-3 py-2 px-3 rounded-xl bg-(--ui-bg-muted) min-h-[52px] ml-4">
              <UIcon name="i-heroicons-user" class="w-5 h-5 text-(--ui-text-muted) shrink-0" aria-hidden="true" />
              <label class="text-sm text-(--ui-text-muted) w-20 shrink-0" for="split-user">Split with</label>
              <select
                id="split-user"
                v-model="form.splitUserId"
                class="flex-1 bg-transparent text-sm text-(--ui-text) focus:outline-none"
              >
                <option v-for="u in otherUsers" :key="u.id" :value="u.id">
                  {{ u.avatar_emoji }} {{ u.name }}
                </option>
              </select>
            </div>
            <div class="flex items-center gap-3 py-2 px-3 rounded-xl bg-(--ui-bg-muted) min-h-[52px] ml-4">
              <UIcon name="i-heroicons-currency-dollar" class="w-5 h-5 text-(--ui-text-muted) shrink-0" aria-hidden="true" />
              <label class="text-sm text-(--ui-text-muted) w-20 shrink-0" for="split-amount">They owe</label>
              <input
                id="split-amount"
                v-model="form.splitAmount"
                type="number"
                step="0.01"
                :placeholder="`${(amountNum / 2).toFixed(2)}`"
                class="flex-1 bg-transparent text-sm text-(--ui-text) placeholder:text-(--ui-text-dimmed) focus:outline-none font-mono"
              />
            </div>
          </template>
        </template>

        <!-- Error -->
        <UAlert
          v-if="error"
          :description="error"
          color="error"
          variant="soft"
          icon="i-heroicons-exclamation-triangle"
        />

        <!-- Bottom padding for nav -->
        <div class="h-4" />
      </div>
    </div>
  </form>
</template>
