<script setup lang="ts">
/**
 * CompletionHeatmap — a GitHub-style activity grid shared by the Insights
 * surfaces (habits + check-ins). Caller supplies a date→count map and the
 * per-day denominator; this owns the week layout, colour scale, and tap detail.
 */
const props = withDefaults(
  defineProps<{
    /** date (YYYY-MM-DD) → items done that day. */
    counts: Map<string, number>
    /** Per-day denominator (e.g. habit count, template count). */
    total: number
    today: string
    weeks?: number
    /** Plural noun for the tap detail, e.g. "habits" / "check-ins". */
    unit?: string
  }>(),
  { weeks: 17, unit: 'items' },
)

interface HeatmapDay {
  date: string
  doneCount: number
  total: number
  rate: number
  isToday: boolean
  isFuture: boolean
}

function buildWeek(start: Date, weekOffset: number): HeatmapDay[] {
  const week: HeatmapDay[] = []
  for (let dow = 0; dow < 7; dow++) {
    const d = new Date(start)
    d.setDate(start.getDate() + weekOffset * 7 + dow)
    const date = d.toISOString().slice(0, 10)
    const isFuture = date > props.today
    const doneCount = !isFuture && props.total > 0 ? (props.counts.get(date) ?? 0) : 0
    week.push({
      date,
      doneCount,
      total: props.total,
      rate: props.total && !isFuture ? Math.round((doneCount / props.total) * 100) : 0,
      isToday: date === props.today,
      isFuture,
    })
  }
  return week
}

const heatmapWeeks = computed((): HeatmapDay[][] => {
  // Align start to the Sunday `weeks` weeks before today
  const start = new Date(props.today)
  start.setDate(start.getDate() - (props.weeks * 7 - 1) - start.getDay())
  return Array.from({ length: props.weeks }, (_, wi) => buildWeek(start, wi))
})

function weekMonthLabel(week: HeatmapDay[]): string {
  const day1 = week.find((d) => d.date.slice(8) === '01')
  return day1
    ? new Date(`${day1.date}T12:00:00`).toLocaleDateString('en-US', { month: 'short' })
    : ''
}

// 5-level color scale: empty → dim cyan → bright cyan
const HEAT_COLORS: [string, string, string, string, string] = [
  '#1e293b',
  '#083344',
  '#0e4d6c',
  '#0e7490',
  '#22d3ee',
]

function heatColor(day: HeatmapDay): string {
  if (day.isFuture || day.total === 0 || day.rate === 0) return HEAT_COLORS[0]
  if (day.rate <= 33) return HEAT_COLORS[1]
  if (day.rate <= 66) return HEAT_COLORS[2]
  if (day.rate < 100) return HEAT_COLORS[3]
  return HEAT_COLORS[4]
}

const selectedDay = ref<HeatmapDay | null>(null)
function selectDay(day: HeatmapDay) {
  selectedDay.value = selectedDay.value?.date === day.date ? null : day
}

// Only show Mo, We, Fr labels to avoid crowding
const DOW_LABELS = ['', 'Mo', '', 'We', '', 'Fr', '']
</script>

<template>
  <div class="overflow-x-auto -mx-1 px-1">
    <div class="inline-flex flex-col gap-1">

      <!-- Month labels row -->
      <div class="flex gap-0.5 ml-5">
        <div
          v-for="(week, wi) in heatmapWeeks"
          :key="wi"
          class="w-3.5 flex-shrink-0 h-3 text-[9px] text-(--ui-text-dimmed) leading-none"
        >{{ weekMonthLabel(week) }}</div>
      </div>

      <!-- Day labels + week columns -->
      <div class="flex gap-1">
        <div class="flex flex-col gap-0.5 w-4 flex-shrink-0">
          <div
            v-for="(label, i) in DOW_LABELS"
            :key="i"
            class="h-3.5 text-[9px] text-slate-600 flex items-center justify-end"
          >{{ label }}</div>
        </div>

        <div class="flex gap-0.5">
          <div
            v-for="(week, wi) in heatmapWeeks"
            :key="wi"
            class="flex flex-col gap-0.5"
          >
            <button
              v-for="day in week"
              :key="day.date"
              class="w-3.5 h-3.5 rounded-[3px] flex-shrink-0 transition-transform active:scale-110"
              :class="selectedDay?.date === day.date ? 'ring-1 ring-white/60 ring-offset-[1.5px] ring-offset-slate-900' : day.isToday ? 'ring-1 ring-cyan-400/80 ring-offset-[1.5px] ring-offset-slate-900' : ''"
              :style="{ backgroundColor: heatColor(day) }"
              @click="selectDay(day)"
            />
          </div>
        </div>
      </div>

      <!-- Tap detail row -->
      <div class="h-6 flex items-center ml-5">
        <transition name="swap">
          <p v-if="selectedDay" class="text-xs">
            <span class="text-(--ui-text-toned) font-medium">{{ selectedDay.date }}</span>
            <span class="text-(--ui-text-dimmed) mx-1">—</span>
            <span v-if="selectedDay.isFuture" class="text-slate-600">future</span>
            <span v-else class="text-(--ui-text-muted)">{{ selectedDay.doneCount }}/{{ selectedDay.total }} {{ unit }}</span>
            <span v-if="!selectedDay.isFuture && selectedDay.doneCount === selectedDay.total && selectedDay.total > 0" class="text-cyan-400 ml-1">✓ Perfect day</span>
          </p>
          <p v-else class="text-[10px] text-slate-700">Tap any cell</p>
        </transition>
      </div>

      <!-- Legend -->
      <div class="flex items-center gap-1 ml-5">
        <span class="text-[10px] text-slate-600 mr-0.5">Less</span>
        <div
          v-for="col in HEAT_COLORS"
          :key="col"
          class="w-3.5 h-3.5 rounded-[3px]"
          :style="{ backgroundColor: col }"
        />
        <span class="text-[10px] text-slate-600 ml-0.5">More</span>
      </div>

    </div>
  </div>
</template>
