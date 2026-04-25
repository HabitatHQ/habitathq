<script setup lang="ts">
import type { IouBalance, User } from '~/types/database'
import { formatAmount } from '~/utils/format'

const db = useDatabase()
const router = useRouter()

const users = ref<User[]>([])
const balances = ref<IouBalance[]>([])
const loading = ref(true)
const settling = ref<string | null>(null)

async function load() {
  loading.value = true
  try {
    const [u, b] = await Promise.all([db.getUsers(), db.getIouBalances()])
    users.value = u
    balances.value = b
  } finally {
    loading.value = false
  }
}

onMounted(load)

async function settle(balance: IouBalance) {
  const key = `${balance.from_user_id}-${balance.to_user_id}`
  settling.value = key
  try {
    await db.settleIou(balance.from_user_id, balance.to_user_id)
    await load()
  } finally {
    settling.value = null
  }
}

const currentUser = computed(() => users.value.find((u) => u.is_current))

function balanceLabel(b: IouBalance): string {
  // net_amount > 0 means to_user owes from_user
  const debtor = b.net_amount > 0 ? b.to_user_name : b.from_user_name
  const creditor = b.net_amount > 0 ? b.from_user_name : b.to_user_name
  return `${debtor} owes ${creditor} ${formatAmount(Math.abs(b.net_amount))}`
}

function iOwe(b: IouBalance): boolean {
  if (!currentUser.value) return false
  // If net_amount > 0, to_user owes from_user. If current user is to_user → I owe
  return b.net_amount > 0
    ? b.to_user_id === currentUser.value.id
    : b.from_user_id === currentUser.value.id
}
</script>

<template>
  <div class="p-4 space-y-5 max-w-2xl mx-auto">

    <!-- ── Back button ─────────────────────────────────────────────────────── -->
    <button
      class="flex items-center gap-1.5 text-sm text-(--ui-text-muted) hover:text-(--ui-text) transition-colors min-h-[44px] -ml-1 px-1"
      aria-label="Go back"
      @click="router.back()"
    >
      <UIcon name="i-heroicons-chevron-left" class="w-4 h-4" />
      Back
    </button>

    <h1 class="text-xl font-bold">Household</h1>

    <!-- ── Members ────────────────────────────────────────────────────────── -->
    <section aria-label="Household members">
      <h2 class="text-xs uppercase tracking-widest text-(--ui-text-muted) font-medium mb-3">Members</h2>
      <ul class="grid grid-cols-2 gap-3">
        <li
          v-for="user in users"
          :key="user.id"
          class="rounded-2xl bg-(--ui-bg-muted) border border-(--ui-border) p-4 flex items-center gap-3"
          :class="user.is_current ? 'border-primary-500/30' : ''"
        >
          <span class="text-3xl" aria-hidden="true">{{ user.avatar_emoji }}</span>
          <div>
            <p class="font-semibold text-(--ui-text)">{{ user.name }}</p>
            <p class="text-xs text-(--ui-text-muted) capitalize">{{ user.role }}</p>
            <span v-if="user.is_current" class="text-[10px] text-primary-400 font-medium">You</span>
          </div>
        </li>
      </ul>
    </section>

    <!-- ── IOU Balances ───────────────────────────────────────────────────── -->
    <section aria-label="IOU balances">
      <div class="flex items-center gap-2 mb-3">
        <h2 class="text-xs uppercase tracking-widest text-(--ui-text-muted) font-medium">Balances</h2>
      </div>
      <HelpTip id="iou-balances">
        <template #label>How do IOUs work?</template>
        <p>When you split an expense with a household member, Hearth tracks who owes whom. These balances add up across all splits.</p>
        <p><strong class="text-(--ui-text)">Settle Up</strong> clears the balance between two people. Use this after someone pays the other back (in cash, Venmo, etc.).</p>
      </HelpTip>

      <div v-if="loading" class="space-y-3">
        <div v-for="n in 2" :key="n" class="h-24 bg-(--ui-bg-muted) rounded-2xl animate-pulse" />
      </div>

      <div v-else-if="!balances.length" class="text-center py-12">
        <UIcon name="i-heroicons-check-circle" class="w-12 h-12 text-green-400 mx-auto mb-3" aria-hidden="true" />
        <p class="font-semibold text-(--ui-text)">All settled up!</p>
        <p class="text-sm text-(--ui-text-muted) mt-1">No outstanding balances in the household</p>
      </div>

      <ul v-else class="space-y-3">
        <li
          v-for="balance in balances"
          :key="`${balance.from_user_id}-${balance.to_user_id}`"
          class="rounded-2xl bg-(--ui-bg-muted) border border-(--ui-border) p-4 space-y-3"
          :class="iOwe(balance) ? 'border-amber-500/30 bg-amber-500/5' : ''"
        >
          <!-- Balance summary -->
          <div class="flex items-center gap-3">
            <div class="flex items-center -space-x-2">
              <span class="text-2xl" aria-hidden="true">{{ balance.from_user_avatar }}</span>
              <span class="text-2xl" aria-hidden="true">{{ balance.to_user_avatar }}</span>
            </div>
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium text-(--ui-text)">{{ balanceLabel(balance) }}</p>
              <p v-if="iOwe(balance)" class="text-xs text-amber-400 font-medium mt-0.5">You owe this</p>
            </div>
            <p class="font-mono font-bold text-lg shrink-0" :class="iOwe(balance) ? 'text-amber-400' : 'text-(--ui-text)'">
              {{ formatAmount(Math.abs(balance.net_amount)) }}
            </p>
          </div>

          <!-- Settle up button -->
          <button
            class="w-full py-2.5 rounded-xl text-sm font-semibold transition-all min-h-[44px] border"
            :class="iOwe(balance)
              ? 'bg-primary-500 hover:bg-primary-400 text-white border-transparent shadow-sm shadow-primary-500/20'
              : 'bg-(--ui-bg-elevated) hover:bg-(--ui-bg-accented) text-(--ui-text) border-(--ui-border)'"
            :disabled="settling === `${balance.from_user_id}-${balance.to_user_id}`"
            :aria-label="`Settle up with ${balance.net_amount > 0 ? balance.from_user_name : balance.to_user_name}`"
            @click="settle(balance)"
          >
            {{ settling === `${balance.from_user_id}-${balance.to_user_id}` ? 'Settling…' : '✓ Settle Up' }}
          </button>
        </li>
      </ul>
    </section>

  </div>
</template>
