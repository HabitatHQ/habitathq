<script setup lang="ts">
import type { ParsedTransaction, ParserContext } from '~/lib/nlp/types'
import type { Account, Category, Transaction, User } from '~/types/database'
import { formatAmount, transactionAmountPrefix } from '~/utils/format'

// ── Composables ──────────────────────────────────────────────────────────
const db = useDatabase()
const router = useRouter()
const toast = useToast()
const { settings } = useAppSettings()
const nlp = useNlpParser()
const speech = useSpeechInput()
const camera = useCamera()
const ocr = useOcr()

// ── Reference data ───────────────────────────────────────────────────────
const accounts = ref<Account[]>([])
const categoryTree = ref<Array<Category & { children: Category[] }>>([])
const currentUser = ref<User | null>(null)
const merchantMappings = ref<Map<string, { category_id: string; account_id: string | null }>>(
  new Map(),
)

// Flat category list for dropdowns
const flatCategories = computed(() => {
  const list: Array<{ id: string; label: string; icon: string }> = []
  for (const parent of categoryTree.value) {
    list.push({ id: parent.id, label: parent.name, icon: parent.icon })
    for (const child of parent.children ?? []) {
      list.push({ id: child.id, label: `${parent.name} > ${child.name}`, icon: child.icon })
    }
  }
  return list
})

// ── Input state ──────────────────────────────────────────────────────────
const inputText = ref('')
const isProcessing = ref(false)

// ── Voice confirmation state ─────────────────────────────────────────────
type VoiceMode = 'idle' | 'listening' | 'confirming'
const voiceMode = ref<VoiceMode>('idle')
const autoSubmitTimer = ref<ReturnType<typeof setTimeout> | null>(null)
const voiceTipDismissed = ref(false)

// Persist tip dismissal in localStorage
if (import.meta.client) {
  voiceTipDismissed.value = localStorage.getItem('hearth-voice-tip-dismissed') === '1'
}
function dismissVoiceTip() {
  voiceTipDismissed.value = true
  if (import.meta.client) localStorage.setItem('hearth-voice-tip-dismissed', '1')
}

// ── Card stack ───────────────────────────────────────────────────────────
interface QuickAddCard extends ParsedTransaction {
  saved: boolean
  undoTimer: ReturnType<typeof setTimeout> | null
  fading: boolean
  savedTxId: string | null
  source: 'manual' | 'voice' | 'ocr'
}

const cards = ref<QuickAddCard[]>([])

// ── Init ─────────────────────────────────────────────────────────────────
onMounted(async () => {
  const [accts, cats, user, mappingsRaw] = await Promise.all([
    db.getAccounts(),
    db.getCategoryTree(),
    db.getCurrentUser(),
    db.getMerchantMappings(),
  ])
  accounts.value = accts
  categoryTree.value = cats
  currentUser.value = user
  for (const m of mappingsRaw) {
    merchantMappings.value.set(m.merchant, {
      category_id: m.category_id,
      account_id: m.account_id,
    })
  }
  nlp.init(settings.value.nlpTier)
})

// ── Build parser context ─────────────────────────────────────────────────
function buildContext(): ParserContext {
  const allCategories = categoryTree.value.flatMap((p) => [p, ...(p.children ?? [])])
  return {
    categories: allCategories,
    accounts: accounts.value,
    merchantMappings: merchantMappings.value,
    defaultAccountByType: {
      expense: settings.value.defaultExpenseAccount ?? accounts.value[0]?.id ?? null,
      income: settings.value.defaultIncomeAccount ?? accounts.value[0]?.id ?? null,
      transfer: accounts.value[0]?.id ?? null,
    },
    currentUserId: currentUser.value?.id ?? '',
    today: new Date().toISOString().slice(0, 10),
  }
}

// Track whether current input originated from voice
let inputFromVoice = false

// ── Submit ────────────────────────────────────────────────────────────────
async function handleSubmit() {
  const text = inputText.value.trim()
  if (!text || isProcessing.value) return
  isProcessing.value = true
  inputText.value = ''
  cancelAutoSubmit()
  voiceMode.value = 'idle'

  const wasVoice = inputFromVoice
  inputFromVoice = false

  try {
    const result = await nlp.parse(text, buildContext())
    for (const tx of result.transactions) {
      const card: QuickAddCard = {
        ...tx,
        saved: false,
        undoTimer: null,
        fading: false,
        savedTxId: null,
        source: wasVoice ? 'voice' : 'manual',
      }
      cards.value.unshift(card)
      autoSave(card)
    }
  } finally {
    isProcessing.value = false
  }
}

// ── Auto-save + undo ─────────────────────────────────────────────────────
async function autoSave(card: QuickAddCard) {
  if (card.amount == null) return // wait for user to fill in amount

  try {
    const tx = await db.createTransaction({
      date: card.date,
      amount: card.type === 'expense' ? -card.amount : card.amount,
      currency: 'USD',
      account_id: card.accountId ?? accounts.value[0]?.id ?? null,
      user_id: currentUser.value?.id ?? null,
      type: card.type,
      category_id: card.categoryId,
      description: card.description,
      merchant: card.merchant,
      is_private: 0,
      is_recurring: 0,
      transfer_to_account_id: card.transferToAccountId,
      split_id: null,
      source: card.source,
    } as Omit<Transaction, 'id' | 'created_at' | 'updated_at'>)

    card.savedTxId = tx.id
    card.saved = true

    // Learn merchant → category mapping
    if (card.merchant && card.categoryId) {
      const normalized = card.merchant.toLowerCase().trim()
      await db.upsertMerchantMapping(normalized, card.categoryId, card.accountId)
      merchantMappings.value.set(normalized, {
        category_id: card.categoryId,
        account_id: card.accountId,
      })
    }

    toast.add({
      title: `Saved: ${card.merchant || 'Transaction'}`,
      description: `${transactionAmountPrefix(card.type)}${formatAmount(card.amount)}`,
      color: 'success' as const,
      duration: 5000,
      actions: [
        {
          label: 'Undo',
          onClick: () => undoSave(card),
        },
      ],
    })

    // Fade out after undo window
    card.undoTimer = setTimeout(() => {
      card.fading = true
      setTimeout(() => {
        cards.value = cards.value.filter((c) => c.clientId !== card.clientId)
      }, 300)
    }, 5000)
  } catch (e) {
    toast.add({
      title: 'Save failed',
      description: e instanceof Error ? e.message : 'Unknown error',
      color: 'error' as const,
    })
  }
}

async function undoSave(card: QuickAddCard) {
  if (card.undoTimer) clearTimeout(card.undoTimer)
  card.fading = false
  if (card.savedTxId) {
    await db.deleteTransaction(card.savedTxId)
    card.savedTxId = null
    card.saved = false
    toast.add({ title: 'Transaction undone', color: 'neutral' as const, duration: 2000 })
  }
}

// ── Inline edit ──────────────────────────────────────────────────────────
function updateCardField(
  clientId: string,
  field: keyof ParsedTransaction,
  value: string | number | null,
) {
  const card = cards.value.find((c) => c.clientId === clientId)
  if (!card) return
  ;(card as Record<string, unknown>)[field] = value

  // If already saved, update the DB
  if (card.savedTxId) {
    const update: Partial<Transaction> & { id: string } = { id: card.savedTxId }
    if (field === 'categoryId') update.category_id = value as string | null
    if (field === 'accountId') update.account_id = value as string
    if (field === 'merchant') update.merchant = value as string
    if (field === 'amount') {
      update.amount = card.type === 'expense' ? -(value as number) : (value as number)
    }
    if (field === 'date') update.date = value as string
    db.updateTransaction(update)

    // Update learning on category/account corrections
    if ((field === 'categoryId' || field === 'accountId') && card.merchant && card.categoryId) {
      const normalized = card.merchant.toLowerCase().trim()
      db.upsertMerchantMapping(normalized, card.categoryId, card.accountId)
      merchantMappings.value.set(normalized, {
        category_id: card.categoryId,
        account_id: card.accountId,
      })
    }
  }

  // If amount was null and is now filled, trigger auto-save
  if (field === 'amount' && value != null && !card.saved) {
    autoSave(card)
  }
}

// ── Voice input ──────────────────────────────────────────────────────────
async function toggleVoice() {
  if (speech.isListening.value) {
    speech.stop()
    return
  }
  cancelAutoSubmit()
  voiceMode.value = 'listening'
  inputFromVoice = true
  await speech.start()
}

function cancelAutoSubmit() {
  if (autoSubmitTimer.value) {
    clearTimeout(autoSubmitTimer.value)
    autoSubmitTimer.value = null
  }
}

function reRecord() {
  cancelAutoSubmit()
  inputText.value = ''
  voiceMode.value = 'listening'
  inputFromVoice = true
  speech.start()
}

function confirmSend() {
  cancelAutoSubmit()
  handleSubmit()
}

// Auto-fill input from speech transcript
watch(
  () => speech.transcript.value,
  (val) => {
    if (val) inputText.value = val
  },
)

// Transition from listening → confirming when speech ends with a transcript
watch(
  () => speech.isListening.value,
  (listening, wasListening) => {
    if (wasListening && !listening && inputText.value.trim()) {
      voiceMode.value = 'confirming'

      // Don't auto-submit if confidence is low or auto-submit is disabled
      const timeout = settings.value.voiceAutoSubmitTimeout
      if (timeout > 0 && speech.confidence.value >= 0.7) {
        autoSubmitTimer.value = setTimeout(() => {
          handleSubmit()
        }, timeout * 1000)
      }
    } else if (wasListening && !listening && !inputText.value.trim()) {
      // Speech ended with no transcript
      voiceMode.value = 'idle'
    }
  },
)

// Low confidence indicator
const isLowConfidence = computed(() => speech.confidence.value < 0.7)

// ── Receipt scanning ─────────────────────────────────────────────────────
const scanningReceipt = ref(false)

async function scanReceipt() {
  const photo = await camera.capturePhoto()
  if (!photo) return

  scanningReceipt.value = true
  try {
    const parsed = await ocr.recognize(photo)
    if (!parsed || (!parsed.total && !parsed.merchant)) {
      toast.add({ title: "Couldn't read this receipt", color: 'warning' as const })
      return
    }

    // Build a card from OCR result
    const ctx = buildContext()
    const amount = parsed.total
    const merchant = parsed.merchant ?? ''
    const date = parsed.date ?? new Date().toISOString().slice(0, 10)

    // Try to resolve category from merchant
    let categoryId: string | null = null
    if (merchant) {
      const normalized = merchant.toLowerCase().trim()
      const mapping = merchantMappings.value.get(normalized)
      if (mapping) categoryId = mapping.category_id
    }

    const card: QuickAddCard = {
      clientId: crypto.randomUUID(),
      rawText: `Receipt: ${merchant}`,
      type: 'expense',
      typeConfidence: 'high',
      amount,
      amountConfidence: amount != null ? 'high' : 'low',
      merchant,
      merchantConfidence: merchant ? 'medium' : 'low',
      categoryId,
      categoryConfidence: categoryId ? 'medium' : 'low',
      accountId: ctx.defaultAccountByType.expense,
      accountConfidence: 'medium',
      transferToAccountId: null,
      date,
      dateConfidence: parsed.date ? 'medium' : 'low',
      description: '',
      saved: false,
      undoTimer: null,
      fading: false,
      savedTxId: null,
      source: 'ocr',
    }
    cards.value.unshift(card)
    if (amount != null) autoSave(card)
  } finally {
    scanningReceipt.value = false
  }
}

// Category name lookup
function categoryLabel(id: string | null): string {
  if (!id) return 'Uncategorized'
  const cat = flatCategories.value.find((c) => c.id === id)
  return cat ? `${cat.icon} ${cat.label}` : 'Uncategorized'
}
</script>

<template>
  <div class="flex flex-col h-full max-w-2xl mx-auto">
    <!-- ── Header ──────────────────────────────────────────────────────────── -->
    <div class="flex items-center justify-between px-4 py-3 border-b border-(--ui-border)">
      <button
        class="flex items-center justify-center w-10 h-10 rounded-xl text-(--ui-text-muted) hover:text-(--ui-text) transition-colors"
        aria-label="Back"
        @click="router.back()"
      >
        <UIcon name="i-heroicons-arrow-left" class="w-5 h-5" />
      </button>
      <h1 class="text-sm font-semibold text-(--ui-text)">Quick Add</h1>
      <NuxtLink
        to="/transactions/add"
        class="text-xs text-primary-400 hover:text-primary-300 transition-colors min-h-[44px] flex items-center"
      >
        Detailed form
      </NuxtLink>
    </div>

    <!-- ── Input bar ───────────────────────────────────────────────────────── -->
    <div class="flex items-center gap-2 px-4 py-3 border-b border-(--ui-border)">
      <button
        class="flex items-center justify-center w-10 h-10 rounded-xl text-(--ui-text-muted) hover:text-(--ui-text) hover:bg-(--ui-bg-muted) transition-colors"
        :disabled="scanningReceipt"
        aria-label="Scan receipt"
        @click="scanReceipt"
      >
        <UIcon
          name="i-heroicons-camera"
          class="w-5 h-5"
          :class="scanningReceipt ? 'animate-pulse' : ''"
        />
      </button>
      <input
        v-model="inputText"
        type="text"
        placeholder="$6 coffee at Blue Bottle yesterday..."
        class="flex-1 bg-transparent text-sm text-(--ui-text) placeholder:text-(--ui-text-dimmed) outline-none min-h-[44px]"
        :class="voiceMode === 'confirming' && isLowConfidence ? 'bg-amber-500/10 rounded-lg px-2' : ''"
        @keydown.enter="handleSubmit"
      />
      <button
        v-if="speech.isSupported.value"
        class="flex items-center justify-center w-10 h-10 rounded-xl transition-colors"
        :class="
          speech.isListening.value
            ? 'text-rose-400 bg-rose-500/10 voice-pulse'
            : 'text-(--ui-text-muted) hover:text-(--ui-text) hover:bg-(--ui-bg-muted)'
        "
        :aria-label="speech.isListening.value ? 'Stop voice input' : 'Start voice input'"
        @click="toggleVoice"
      >
        <UIcon name="i-heroicons-microphone" class="w-5 h-5" />
      </button>
      <button
        class="flex items-center justify-center w-10 h-10 rounded-xl text-primary-400 hover:bg-primary-500/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        :disabled="!inputText.trim() || isProcessing"
        aria-label="Parse and save"
        @click="handleSubmit"
      >
        <UIcon name="i-heroicons-paper-airplane" class="w-5 h-5" />
      </button>
    </div>

    <!-- ── Listening / Confirming feedback ─────────────────────────────────── -->
    <div
      v-if="voiceMode === 'listening' || voiceMode === 'confirming'"
      aria-live="polite"
      class="px-4 pt-2 space-y-2"
    >
      <!-- Listening state -->
      <p
        v-if="voiceMode === 'listening'"
        class="text-xs text-rose-400 font-medium listening-dots"
      >
        Listening
      </p>

      <!-- Confirming state -->
      <template v-if="voiceMode === 'confirming'">
        <p class="text-xs text-(--ui-text-muted)">
          I heard:
        </p>
        <div class="flex items-center gap-2">
          <button
            class="flex items-center gap-1 px-3 min-h-[36px] rounded-lg text-xs font-medium text-(--ui-text-muted) hover:text-(--ui-text) bg-(--ui-bg-muted) hover:bg-(--ui-bg-elevated) transition-colors"
            :class="isLowConfidence ? 'ring-1 ring-amber-500/50' : ''"
            @click="reRecord"
          >
            <UIcon name="i-heroicons-arrow-path" class="w-3.5 h-3.5" />
            Re-record
          </button>
          <button
            class="flex items-center gap-1 px-3 min-h-[36px] rounded-lg text-xs font-medium text-white bg-primary-500 hover:bg-primary-600 transition-colors"
            @click="confirmSend"
          >
            <UIcon name="i-heroicons-paper-airplane" class="w-3.5 h-3.5" />
            Send
          </button>
          <span
            v-if="isLowConfidence"
            class="text-[10px] text-amber-400 ml-auto"
          >
            Low confidence — review before sending
          </span>
        </div>
      </template>
    </div>

    <!-- ── Speech error ────────────────────────────────────────────────────── -->
    <div v-if="speech.error.value" class="px-4 pt-2">
      <UAlert :description="speech.error.value" color="error" variant="soft" icon="i-heroicons-exclamation-triangle" />
    </div>

    <!-- ── OCR scanning progress ─────────────────────────────────────────── -->
    <div v-if="scanningReceipt" class="px-4 pt-2 space-y-2">
      <div class="h-2 rounded-full bg-(--ui-bg-elevated) overflow-hidden">
        <div class="h-full rounded-full bg-primary-500 transition-all" :style="{ width: `${ocr.progress.value}%` }" />
      </div>
      <p class="text-xs text-(--ui-text-muted) text-center">Scanning receipt... {{ ocr.progress.value }}%</p>
    </div>

    <!-- ── Card stack ──────────────────────────────────────────────────────── -->
    <div class="flex-1 overflow-y-auto px-4 py-3 space-y-3">
      <!-- Loading skeleton -->
      <div v-if="isProcessing" class="h-24 rounded-xl bg-(--ui-bg-muted) animate-pulse" />

      <!-- Transaction cards -->
      <TransitionGroup name="card">
        <div
          v-for="card in cards"
          :key="card.clientId"
          class="rounded-xl border-l-4 p-3 transition-all duration-300"
          :class="[
            transactionStripeClass(card.type),
            card.fading ? 'opacity-0 scale-95' : 'opacity-100 scale-100',
            card.saved
              ? 'bg-(--ui-bg) border border-(--ui-border) border-l-4'
              : 'bg-amber-500/5 border border-amber-500/30 border-l-4',
          ]"
        >
          <!-- Row 1: type badge + amount + date -->
          <div class="flex items-center justify-between">
            <span
              class="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full"
              :class="{
                'bg-rose-500/10 text-rose-400': card.type === 'expense',
                'bg-green-500/10 text-green-400': card.type === 'income',
                'bg-blue-500/10 text-blue-400': card.type === 'transfer',
              }"
            >
              {{ card.type }}
            </span>
            <div class="flex items-center gap-2">
              <!-- Editable amount if null -->
              <input
                v-if="card.amount == null"
                type="number"
                step="0.01"
                placeholder="$ ___"
                class="w-20 text-right font-mono text-sm bg-amber-500/10 border border-amber-500/30 rounded-lg px-2 py-1 text-(--ui-text) outline-none focus:border-primary-500"
                @change="
                  (e: Event) =>
                    updateCardField(
                      card.clientId,
                      'amount',
                      parseFloat((e.target as HTMLInputElement).value) || null,
                    )
                "
              />
              <span
                v-else
                class="font-mono text-sm font-semibold"
                :class="[
                  transactionAmountClass(card.type),
                  card.amountConfidence === 'low' ? 'bg-amber-500/10 px-1.5 py-0.5 rounded' : '',
                ]"
              >
                {{ transactionAmountPrefix(card.type) }}{{ formatAmount(card.amount) }}
              </span>
              <span class="text-xs text-(--ui-text-dimmed)">
                {{ formatDateRelative(card.date) }}
              </span>
            </div>
          </div>

          <!-- Row 2: merchant + category -->
          <div class="flex items-center gap-2 mt-2">
            <input
              :value="card.merchant"
              class="flex-1 text-sm bg-transparent border-b border-dashed outline-none text-(--ui-text) placeholder:text-(--ui-text-dimmed) py-0.5"
              :class="
                card.merchantConfidence === 'low'
                  ? 'border-amber-500/50'
                  : 'border-(--ui-border) focus:border-primary-500'
              "
              placeholder="Merchant"
              @blur="
                (e: Event) =>
                  updateCardField(card.clientId, 'merchant', (e.target as HTMLInputElement).value)
              "
            />
            <select
              :value="card.categoryId ?? ''"
              class="text-xs bg-(--ui-bg-muted) rounded-lg px-2 py-1.5 border text-(--ui-text) outline-none min-h-[32px] max-w-[140px]"
              :class="
                card.categoryConfidence === 'low'
                  ? 'border-amber-500/50'
                  : 'border-(--ui-border)'
              "
              @change="
                (e: Event) =>
                  updateCardField(
                    card.clientId,
                    'categoryId',
                    (e.target as HTMLSelectElement).value || null,
                  )
              "
            >
              <option value="">Uncategorized</option>
              <option v-for="cat in flatCategories" :key="cat.id" :value="cat.id">
                {{ cat.icon }} {{ cat.label }}
              </option>
            </select>
          </div>

          <!-- Row 3: account + status -->
          <div class="flex items-center gap-2 mt-1.5 text-xs text-(--ui-text-muted)">
            <select
              :value="card.accountId ?? ''"
              class="bg-transparent outline-none py-0.5"
              :class="card.accountConfidence === 'low' ? 'text-amber-400' : ''"
              @change="
                (e: Event) =>
                  updateCardField(
                    card.clientId,
                    'accountId',
                    (e.target as HTMLSelectElement).value || null,
                  )
              "
            >
              <option v-for="acct in accounts" :key="acct.id" :value="acct.id">
                {{ acct.name }}
              </option>
            </select>

            <!-- Transfer destination -->
            <template v-if="card.type === 'transfer'">
              <span class="text-(--ui-text-dimmed)">→</span>
              <select
                :value="card.transferToAccountId ?? ''"
                class="bg-transparent outline-none py-0.5"
                @change="
                  (e: Event) =>
                    updateCardField(
                      card.clientId,
                      'transferToAccountId' as keyof ParsedTransaction,
                      (e.target as HTMLSelectElement).value || null,
                    )
                "
              >
                <option value="">Select account</option>
                <option v-for="acct in accounts" :key="acct.id" :value="acct.id">
                  {{ acct.name }}
                </option>
              </select>
            </template>

            <span class="ml-auto flex items-center gap-1">
              <template v-if="card.saved">
                <UIcon name="i-heroicons-check-circle" class="w-3.5 h-3.5 text-green-400" />
                <span class="text-green-400">Saved</span>
              </template>
            </span>
          </div>

          <!-- Missing amount hint -->
          <div
            v-if="card.amount == null"
            class="mt-2 text-xs text-amber-400 flex items-center gap-1"
          >
            <UIcon name="i-heroicons-exclamation-triangle" class="w-3 h-3" />
            Enter amount to save
          </div>
        </div>
      </TransitionGroup>

      <!-- Empty state -->
      <div
        v-if="!cards.length && !isProcessing"
        class="flex flex-col items-center justify-center py-16 text-center"
      >
        <UIcon
          name="i-heroicons-bolt"
          class="w-12 h-12 text-(--ui-text-dimmed) mb-4"
        />
        <p class="text-(--ui-text-muted) font-medium">Quick Add</p>
        <p class="text-sm text-(--ui-text-dimmed) mt-1">
          Type or say something like<br />
          "$6 coffee at Blue Bottle yesterday"
        </p>

        <!-- First-use voice tip -->
        <div
          v-if="speech.isSupported.value && !voiceTipDismissed"
          class="mt-6 max-w-xs mx-auto rounded-xl bg-(--ui-bg-muted) border border-(--ui-border) p-3 text-left"
        >
          <div class="flex items-start gap-2">
            <UIcon name="i-heroicons-microphone" class="w-5 h-5 text-primary-400 shrink-0 mt-0.5" />
            <div class="flex-1">
              <p class="text-xs font-medium text-(--ui-text)">Tip: Voice input</p>
              <p class="text-xs text-(--ui-text-dimmed) mt-0.5">
                Tap the mic button to add expenses by voice. Just say "six dollars coffee at Starbucks" and it'll be parsed automatically.
              </p>
            </div>
            <button
              class="shrink-0 text-(--ui-text-dimmed) hover:text-(--ui-text) p-1"
              aria-label="Dismiss tip"
              @click="dismissVoiceTip"
            >
              <UIcon name="i-heroicons-x-mark" class="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.card-enter-active {
  transition: all 0.3s cubic-bezier(0.22, 1, 0.36, 1);
}
.card-leave-active {
  transition: all 0.2s ease-in;
}
.card-enter-from {
  opacity: 0;
  transform: translateY(-12px) scale(0.97);
}
.card-leave-to {
  opacity: 0;
  transform: scale(0.95);
}
</style>
