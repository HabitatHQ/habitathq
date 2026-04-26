<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import AppIcon from '~/components/AppIcon.vue'
import BackNav from '~/components/BackNav.vue'
import EmptyState from '~/components/EmptyState.vue'
import type { CheckinEntry, CheckinHistoryRow } from '~/types/database'
import { toLocalDateKey } from '~/utils/format'

const { getCheckinHistory, getCheckinEntries, getCheckinResponseDates } = useDatabase()
const { impact } = useHaptics()

// ─── State ──────────────────────────────────────────────────────────────────

const loading = ref(true)
const viewMode = ref<'calendar' | 'timeline'>('calendar')
const todayKey = toLocalDateKey(new Date())

// Dates that have *any* check-in data
const activeDates = ref<Set<string>>(new Set())

// Raw data we've loaded
const loadedHistory = ref<CheckinHistoryRow[]>([])
const loadedEntries = ref<CheckinEntry[]>([])

// Grouped data structure: Map<date, { templates: Map<template_id, {...}>, entries: CheckinEntry[] }>
type DayData = {
  templates: Map<string, { title: string; schedule_type: string; rows: CheckinHistoryRow[] }>
  entries: CheckinEntry[]
}

const dataByDate = computed(() => {
  const map = new Map<string, DayData>()

  for (const row of loadedHistory.value) {
    let day = map.get(row.logged_date)
    if (!day) {
      day = { templates: new Map(), entries: [] }
      map.set(row.logged_date, day)
    }
    let tpl = day.templates.get(row.template_id)
    if (!tpl) {
      tpl = { title: row.template_title, schedule_type: row.schedule_type, rows: [] }
      day.templates.set(row.template_id, tpl)
    }
    tpl.rows.push(row)
  }

  for (const entry of loadedEntries.value) {
    let day = map.get(entry.entry_date)
    if (!day) {
      day = { templates: new Map(), entries: [] }
      map.set(entry.entry_date, day)
    }
    day.entries.push(entry)
  }

  return map
})

// ─── Initial Load ─────────────────────────────────────────────────────────────

onMounted(async () => {
  // First get dates to know where dots go
  const dates = await getCheckinResponseDates()
  // also need to get checkin_entries dates? The current getCheckinResponseDates only checks responses.
  // We'll rely on it for dots. If someone only has a free-form entry, it might not show a dot,
  // but template responses are primary anyway.
  activeDates.value = new Set(dates.map((d) => d.date))

  // Start by loading the current month's range for calendar view
  await loadRange(calendarRange.value.start, calendarRange.value.end)
  loading.value = false
})

// ─── Data Loading ─────────────────────────────────────────────────────────────

async function loadRange(start: string, end: string) {
  loading.value = true
  const [h, e] = await Promise.all([getCheckinHistory(start, end), getCheckinEntries(start, end)])

  // Merge into our loaded sets avoiding duplicates
  const hSet = new Set(loadedHistory.value.map((r) => `${r.question_id}_${r.logged_date}`))
  for (const r of h) {
    if (!hSet.has(`${r.question_id}_${r.logged_date}`)) {
      loadedHistory.value.push(r)
    }
  }

  const eSet = new Set(loadedEntries.value.map((x) => x.id))
  for (const x of e) {
    if (!eSet.has(x.id)) {
      loadedEntries.value.push(x)
    }
  }
  loading.value = false
}

// ─── Calendar View ────────────────────────────────────────────────────────────

const calendarMonthDate = ref(new Date())

function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function prevMonth() {
  const d = new Date(calendarMonthDate.value)
  d.setMonth(d.getMonth() - 1)
  calendarMonthDate.value = d
  void impact('light')
}

function nextMonth() {
  const d = new Date(calendarMonthDate.value)
  d.setMonth(d.getMonth() + 1)
  calendarMonthDate.value = d
  void impact('light')
}

const calendarRange = computed(() => {
  const year = calendarMonthDate.value.getFullYear()
  const month = calendarMonthDate.value.getMonth()
  const startDow = new Date(year, month, 1).getDay()
  const lastDate = new Date(year, month + 1, 0).getDate()
  const totalCells = Math.ceil((startDow + lastDate) / 7) * 7
  const start = new Date(year, month, 1 - startDow)
  const end = new Date(start)
  end.setDate(end.getDate() + totalCells - 1)
  return { start: localDateStr(start), end: localDateStr(end) }
})

// When month changes, load data if needed
watch(calendarMonthDate, async () => {
  if (viewMode.value === 'calendar') {
    await loadRange(calendarRange.value.start, calendarRange.value.end)
  }
})

const calendarCells = computed(() => {
  const year = calendarMonthDate.value.getFullYear()
  const month = calendarMonthDate.value.getMonth()
  const startDow = new Date(year, month, 1).getDay()
  const lastDate = new Date(year, month + 1, 0).getDate()
  const totalCells = Math.ceil((startDow + lastDate) / 7) * 7
  const cells: { date: string; inMonth: boolean; hasData: boolean }[] = []
  const d = new Date(year, month, 1 - startDow)
  for (let i = 0; i < totalCells; i++) {
    const ds = localDateStr(d)
    cells.push({
      date: ds,
      inMonth: d.getMonth() === month,
      hasData: activeDates.value.has(ds) || dataByDate.value.has(ds),
    })
    d.setDate(d.getDate() + 1)
  }
  return cells
})

const selectedDate = ref<string>(todayKey)
const selectedDayData = computed(() => dataByDate.value.get(selectedDate.value))

function selectDate(date: string) {
  selectedDate.value = date
}

// ─── Timeline View ────────────────────────────────────────────────────────────

// For timeline, we just take all dates we've loaded that have data, sort descending
const timelineDays = computed(() => {
  const dates = Array.from(dataByDate.value.keys()).sort().reverse()
  return dates
})

// We'll auto-load a big range for timeline if switched
watch(viewMode, async (newMode) => {
  if (newMode === 'timeline' && timelineDays.value.length === 0) {
    // Load last 90 days
    const d = new Date()
    d.setDate(d.getDate() - 90)
    await loadRange(localDateStr(d), todayKey)
  }
})

const reachedEnd = computed(() => timelineDays.value.length >= activeDates.value.size)

async function loadMoreTimeline() {
  if (timelineDays.value.length > 0) {
    const oldestLoaded = timelineDays.value[timelineDays.value.length - 1]!
    const d = new Date(`${oldestLoaded}T12:00:00`)
    const endStr = localDateStr(new Date(d.getTime() - 86400000))
    d.setDate(d.getDate() - 90)
    const startStr = localDateStr(d)
    await loadRange(startStr, endStr)
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseFreeformEntry(content: string) {
  try {
    const obj = JSON.parse(content)
    if (typeof obj === 'object' && obj !== null) return obj
  } catch {}
  return { content }
}

function formatDateHeader(dateStr: string) {
  const d = new Date(`${dateStr}T12:00:00`)
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
}

// Expandable text state
const expandedTexts = ref<Set<string>>(new Set())
function toggleText(id: string) {
  if (expandedTexts.value.has(id)) expandedTexts.value.delete(id)
  else expandedTexts.value.add(id)
}
</script>

<template>
  <div class="pb-20 max-w-2xl mx-auto space-y-6">
    <!-- Header -->
    <header class="flex items-center justify-between">
      <BackNav to="/checkin" label="Check-ins" />
      <ViewSwitcher
        v-model="viewMode"
        :options="[
          { value: 'timeline', icon: 'list-bullet', ariaLabel: 'Timeline view' },
          { value: 'calendar', icon: 'calendar-days', ariaLabel: 'Calendar view' }
        ]"
      />
    </header>

    <h2 class="text-2xl font-bold px-1">History</h2>

    <!-- Calendar View -->
    <div v-if="viewMode === 'calendar'" class="space-y-6">
      
      <!-- Mini Calendar -->
      <div class="bg-(--ui-bg-muted) border border-(--ui-border)/60 rounded-xl p-4">
        <!-- Calendar Header -->
        <div class="flex items-center justify-between mb-4">
          <button @click="prevMonth" class="p-1.5 hover:bg-(--ui-bg-elevated) rounded-lg transition-colors">
            <AppIcon name="chevron-left" class="w-4 h-4 text-(--ui-text-toned)" />
          </button>
          <span class="font-semibold text-(--ui-text)">
            {{ calendarMonthDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) }}
          </span>
          <button @click="nextMonth" class="p-1.5 hover:bg-(--ui-bg-elevated) rounded-lg transition-colors">
            <AppIcon name="chevron-right" class="w-4 h-4 text-(--ui-text-toned)" />
          </button>
        </div>
        
        <!-- Days Grid -->
        <div class="grid grid-cols-7 mb-2">
          <div v-for="d in ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']" :key="d" class="text-center text-[10px] font-semibold text-(--ui-text-dimmed)">
            {{ d }}
          </div>
        </div>
        <div class="grid grid-cols-7 gap-y-2">
          <button
            v-for="cell in calendarCells"
            :key="cell.date"
            class="flex flex-col items-center p-1 rounded-full aspect-square w-8 mx-auto transition-colors relative"
            :class="[
              cell.inMonth ? (selectedDate === cell.date ? 'bg-primary-500 text-white font-bold' : 'text-(--ui-text) hover:bg-(--ui-bg-elevated)') : 'text-(--ui-text-muted)',
              cell.date === todayKey && selectedDate !== cell.date ? 'border border-primary-500/30' : ''
            ]"
            @click="selectDate(cell.date)"
          >
            <span class="text-sm mt-0.5">{{ Number(cell.date.slice(8)) }}</span>
            <div v-if="cell.hasData" class="absolute bottom-1 w-1 h-1 rounded-full" :class="selectedDate === cell.date ? 'bg-white/80' : 'bg-primary-500'" />
          </button>
        </div>
      </div>

      <!-- Selected Day Detail -->
      <div>
        <h3 class="font-semibold text-lg mb-4 pl-1 border-b border-(--ui-border)/60 pb-2">
          {{ formatDateHeader(selectedDate) }}
        </h3>
        
        <div v-if="loading && !selectedDayData" class="flex justify-center py-8 text-(--ui-text-dimmed)">
          <AppIcon name="arrow-path" class="w-5 h-5 animate-spin" />
        </div>
        <div v-else-if="!selectedDayData || (selectedDayData.templates.size === 0 && selectedDayData.entries.length === 0)">
          <EmptyState icon="calendar" title="No check-ins" description="There are no check-ins recorded for this date." />
        </div>
        <div v-else class="space-y-4">
          <!-- Template Cards -->
          <div
            v-for="[tplId, tpl] in selectedDayData.templates.entries()"
            :key="tplId"
            class="block bg-(--ui-bg-elevated) border border-(--ui-border) rounded-xl p-4"
          >
            <div class="flex items-center justify-between mb-3">
              <h4 class="font-semibold text-primary-500">{{ tpl.title }}</h4>
              <span class="text-xs px-2 py-0.5 bg-(--ui-bg-muted) rounded-md text-(--ui-text-toned)">
                {{ tpl.schedule_type === 'DAILY' ? 'Daily' : tpl.schedule_type === 'MONTHLY' ? 'Monthly' : 'Weekly' }}
              </span>
            </div>
            
            <div class="space-y-3">
              <div v-for="q in tpl.rows" :key="q.question_id" class="text-sm">
                <p class="text-(--ui-text-toned) mb-1">{{ q.prompt }}</p>
                
                <!-- SCALE -->
                <div v-if="q.response_type === 'SCALE'" class="inline-flex">
                  <span class="px-2 py-0.5 bg-primary-500/10 text-primary-600 dark:text-primary-400 font-semibold rounded-md tabular-nums">
                    {{ q.value_numeric ?? '-' }}/10
                  </span>
                </div>
                
                <!-- BOOLEAN -->
                <div v-else-if="q.response_type === 'BOOLEAN'" class="inline-flex">
                  <span v-if="q.value_numeric === 1" class="px-2 py-0.5 bg-green-500/10 text-green-600 dark:text-green-400 font-medium rounded-md flex items-center gap-1">
                    Yes <AppIcon name="check" class="w-3 h-3" />
                  </span>
                  <span v-else-if="q.value_numeric === 0" class="px-2 py-0.5 bg-red-500/10 text-red-600 dark:text-red-400 font-medium rounded-md flex items-center gap-1">
                    No <AppIcon name="x-mark" class="w-3 h-3" />
                  </span>
                  <span v-else class="text-(--ui-text-dimmed)">-</span>
                </div>
                
                <!-- TEXT -->
                <div v-else class="text-(--ui-text)">
                  <template v-if="q.value_text">
                    <p class="whitespace-pre-wrap" :class="!expandedTexts.has(q.question_id + q.logged_date) && 'line-clamp-3'">{{ q.value_text }}</p>
                    <button 
                      v-if="q.value_text.split('\\n').length > 3 || q.value_text.length > 150"
                      class="text-xs text-primary-500 mt-1 font-medium hover:underline"
                      @click="toggleText(q.question_id + q.logged_date)"
                    >
                      {{ expandedTexts.has(q.question_id + q.logged_date) ? 'Show less' : 'Show more' }}
                    </button>
                  </template>
                  <span v-else class="text-(--ui-text-dimmed)">No answer</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Free-form Entries -->
          <div
            v-for="entry in selectedDayData.entries"
            :key="entry.id"
            class="bg-(--ui-bg-elevated) border border-(--ui-border) rounded-xl p-4"
          >
            <h4 class="font-semibold text-(--ui-text-toned) mb-3">Free-form Entry</h4>
            <div class="text-sm space-y-2">
              <template v-for="(val, key) in parseFreeformEntry(entry.content)" :key="key">
                <div>
                  <p class="text-(--ui-text-dimmed) text-xs uppercase tracking-wider mb-0.5">{{ key }}</p>
                  <p class="text-(--ui-text) whitespace-pre-wrap">{{ val }}</p>
                </div>
              </template>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Timeline View -->
    <div v-else class="space-y-8">
      <div v-if="loading && timelineDays.length === 0" class="flex justify-center py-10">
        <AppIcon name="arrow-path" class="w-6 h-6 animate-spin text-(--ui-text-dimmed)" />
      </div>
      <div v-else-if="timelineDays.length === 0">
        <EmptyState icon="list-bullet" title="No history found" description="No check-ins were found in the past 90 days." />
      </div>
      
      <div v-else class="space-y-8">
        <div v-for="date in timelineDays" :key="date" class="relative pl-6">
          <!-- Timeline line -->
          <div class="absolute left-[9px] top-8 bottom-[-32px] w-0.5 bg-(--ui-border)/60 last:hidden" />
          
          <!-- Timeline dot -->
          <div class="absolute left-0 top-2 w-5 h-5 bg-(--ui-bg) border-2 border-primary-500 rounded-full flex items-center justify-center">
            <div class="w-1.5 h-1.5 bg-primary-500 rounded-full" />
          </div>

          <h3 class="font-semibold text-lg mb-3 pl-2">
            {{ formatDateHeader(date) }}
          </h3>
          
          <div class="space-y-4 pl-2">
            <!-- Reuse card logic here -->
            <div
              v-for="[tplId, tpl] in dataByDate.get(date)?.templates.entries()"
              :key="tplId"
              class="block bg-(--ui-bg-elevated) border border-(--ui-border) rounded-xl p-4"
            >
              <div class="flex items-center justify-between mb-3">
                <h4 class="font-semibold text-primary-500">{{ tpl.title }}</h4>
                <span class="text-xs px-2 py-0.5 bg-(--ui-bg-muted) rounded-md text-(--ui-text-toned)">
                  {{ tpl.schedule_type === 'DAILY' ? 'Daily' : tpl.schedule_type === 'MONTHLY' ? 'Monthly' : 'Weekly' }}
                </span>
              </div>
              
              <div class="space-y-3">
                <div v-for="q in tpl.rows" :key="q.question_id" class="text-sm">
                  <p class="text-(--ui-text-toned) mb-1">{{ q.prompt }}</p>
                  
                  <div v-if="q.response_type === 'SCALE'" class="inline-flex">
                    <span class="px-2 py-0.5 bg-primary-500/10 text-primary-600 dark:text-primary-400 font-semibold rounded-md tabular-nums">
                      {{ q.value_numeric ?? '-' }}/10
                    </span>
                  </div>
                  
                  <div v-else-if="q.response_type === 'BOOLEAN'" class="inline-flex">
                    <span v-if="q.value_numeric === 1" class="px-2 py-0.5 bg-green-500/10 text-green-600 dark:text-green-400 font-medium rounded-md flex items-center gap-1">
                      Yes <AppIcon name="check" class="w-3 h-3" />
                    </span>
                    <span v-else-if="q.value_numeric === 0" class="px-2 py-0.5 bg-red-500/10 text-red-600 dark:text-red-400 font-medium rounded-md flex items-center gap-1">
                      No <AppIcon name="x-mark" class="w-3 h-3" />
                    </span>
                    <span v-else class="text-(--ui-text-dimmed)">-</span>
                  </div>
                  
                  <div v-else class="text-(--ui-text)">
                    <template v-if="q.value_text">
                      <p class="whitespace-pre-wrap" :class="!expandedTexts.has(q.question_id + q.logged_date) && 'line-clamp-3'">{{ q.value_text }}</p>
                      <button 
                        v-if="q.value_text.split('\\n').length > 3 || q.value_text.length > 150"
                        class="text-xs text-primary-500 mt-1 font-medium hover:underline"
                        @click="toggleText(q.question_id + q.logged_date)"
                      >
                        {{ expandedTexts.has(q.question_id + q.logged_date) ? 'Show less' : 'Show more' }}
                      </button>
                    </template>
                    <span v-else class="text-(--ui-text-dimmed)">No answer</span>
                  </div>
                </div>
              </div>
            </div>

            <div
              v-for="entry in dataByDate.get(date)?.entries"
              :key="entry.id"
              class="bg-(--ui-bg-elevated) border border-(--ui-border) rounded-xl p-4"
            >
              <h4 class="font-semibold text-(--ui-text-toned) mb-3">Free-form Entry</h4>
              <div class="text-sm space-y-2">
                <template v-for="(val, key) in parseFreeformEntry(entry.content)" :key="key">
                  <div>
                    <p class="text-(--ui-text-dimmed) text-xs uppercase tracking-wider mb-0.5">{{ key }}</p>
                    <p class="text-(--ui-text) whitespace-pre-wrap">{{ val }}</p>
                  </div>
                </template>
              </div>
            </div>
          </div>
        </div>
        
        <!-- Load More -->
        <div class="pt-4 pl-8">
          <p v-if="reachedEnd" class="text-center text-xs text-(--ui-text-dimmed) py-3">
            No older check-ins
          </p>
          <UButton
            v-else-if="timelineDays.length > 0"
            variant="soft"
            color="neutral"
            class="w-full justify-center"
            :loading="loading"
            @click="loadMoreTimeline"
          >
            Load older
          </UButton>
        </div>
      </div>
    </div>
  </div>
</template>
