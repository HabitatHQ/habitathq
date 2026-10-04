import { normalizePomodoroSettingValue, POMODORO_SETTING_RULES } from '~/composables/useAppSettings'

export type TimerMode = 'stopwatch' | 'countdown' | 'pomodoro'
export type PomodoroPhase = 'work' | 'short-break' | 'long-break'

export interface ActiveTimer {
  itemId: string
  itemType: 'todo' | 'bored'
  itemTitle: string
  mode: TimerMode
  elapsed: number
  startedAt: number | null
  durationSeconds: number
  pomodoroPhase: PomodoroPhase
  pomodoroWorkBlock: number
  pomodoroWorkSeconds: number
  pomodoroShortBreakSeconds: number
  pomodoroLongBreakSeconds: number
  pomodoroCyclesBeforeLong: number
}

export interface PomodoroConfig {
  workSeconds: number
  shortBreakSeconds: number
  longBreakSeconds: number
  cyclesBeforeLong: number
}

export function buildPomodoroConfig(settings: {
  pomodoroWorkMinutes: number
  pomodoroShortBreakMinutes: number
  pomodoroLongBreakMinutes: number
  pomodoroCyclesBeforeLong: number
}): PomodoroConfig {
  return {
    workSeconds:
      normalizePomodoroSettingValue('pomodoroWorkMinutes', settings.pomodoroWorkMinutes) * 60,
    shortBreakSeconds:
      normalizePomodoroSettingValue(
        'pomodoroShortBreakMinutes',
        settings.pomodoroShortBreakMinutes,
      ) * 60,
    longBreakSeconds:
      normalizePomodoroSettingValue('pomodoroLongBreakMinutes', settings.pomodoroLongBreakMinutes) *
      60,
    cyclesBeforeLong: normalizePomodoroSettingValue(
      'pomodoroCyclesBeforeLong',
      settings.pomodoroCyclesBeforeLong,
    ),
  }
}

// ── Pure helper functions (exported for unit tests) ───────────────────────────

export function formatMmSs(totalSeconds: number): string {
  const s = Math.abs(Math.floor(totalSeconds))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

export function computeElapsed(timer: ActiveTimer, now: number): number {
  return timer.elapsed + (timer.startedAt === null ? 0 : Math.floor((now - timer.startedAt) / 1000))
}

export function formatTimerDisplay(
  elapsed: number,
  mode: TimerMode,
  durationSeconds: number,
  pomodoroPhase: PomodoroPhase,
): string {
  if (mode === 'stopwatch') {
    return formatMmSs(elapsed)
  }
  if (mode === 'countdown') {
    if (elapsed > durationSeconds) {
      return `+${formatMmSs(elapsed - durationSeconds)}`
    }
    return `${formatMmSs(elapsed)} / ${formatMmSs(durationSeconds)}`
  }
  // pomodoro
  const remaining = Math.max(0, durationSeconds - elapsed)
  const phaseLabel = pomodoroPhase === 'work' ? 'Work' : 'Break'
  return `🍅 ${phaseLabel} · ${formatMmSs(remaining)}`
}

function normalizeDurationSeconds(
  value: number,
  key: 'pomodoroWorkMinutes' | 'pomodoroShortBreakMinutes' | 'pomodoroLongBreakMinutes',
): number {
  const { min, max, defaultValue } = POMODORO_SETTING_RULES[key]
  return Number.isInteger(value) && value >= min * 60 && value <= max * 60
    ? value
    : defaultValue * 60
}

function normalizeCycleCount(value: number): number {
  return normalizePomodoroSettingValue('pomodoroCyclesBeforeLong', value)
}

export function nextPomodoroPhase(
  currentPhase: PomodoroPhase,
  workBlock: number,
  cyclesBeforeLong: number,
  workSeconds: number,
  shortBreakSeconds: number,
  longBreakSeconds: number,
): { phase: PomodoroPhase; durationSeconds: number; workBlock: number } {
  const safeCycles = normalizeCycleCount(cyclesBeforeLong)
  const safeWorkBlock = Number.isInteger(workBlock) && workBlock >= 0 ? workBlock : 0
  const safeWorkSeconds = normalizeDurationSeconds(workSeconds, 'pomodoroWorkMinutes')
  const safeShortBreakSeconds = normalizeDurationSeconds(
    shortBreakSeconds,
    'pomodoroShortBreakMinutes',
  )
  const safeLongBreakSeconds = normalizeDurationSeconds(
    longBreakSeconds,
    'pomodoroLongBreakMinutes',
  )
  if (currentPhase === 'work') {
    const newBlock = safeWorkBlock + 1
    if (newBlock % safeCycles === 0) {
      return { phase: 'long-break', durationSeconds: safeLongBreakSeconds, workBlock: newBlock }
    }
    return { phase: 'short-break', durationSeconds: safeShortBreakSeconds, workBlock: newBlock }
  }
  return { phase: 'work', durationSeconds: safeWorkSeconds, workBlock: safeWorkBlock }
}

function normalizeRestoredPomodoroTimer(timer: ActiveTimer): ActiveTimer | null {
  if (timer.mode !== 'pomodoro') return timer
  if (
    timer.pomodoroPhase !== 'work' &&
    timer.pomodoroPhase !== 'short-break' &&
    timer.pomodoroPhase !== 'long-break'
  ) {
    return null
  }
  const workSeconds = normalizeDurationSeconds(timer.pomodoroWorkSeconds, 'pomodoroWorkMinutes')
  const shortBreakSeconds = normalizeDurationSeconds(
    timer.pomodoroShortBreakSeconds,
    'pomodoroShortBreakMinutes',
  )
  const longBreakSeconds = normalizeDurationSeconds(
    timer.pomodoroLongBreakSeconds,
    'pomodoroLongBreakMinutes',
  )
  const fallbackDurationSeconds =
    timer.pomodoroPhase === 'work'
      ? workSeconds
      : timer.pomodoroPhase === 'short-break'
        ? shortBreakSeconds
        : longBreakSeconds
  const durationSeconds =
    Number.isFinite(timer.durationSeconds) && timer.durationSeconds > 0
      ? timer.durationSeconds
      : fallbackDurationSeconds
  return {
    ...timer,
    elapsed: Number.isFinite(timer.elapsed) && timer.elapsed >= 0 ? timer.elapsed : 0,
    durationSeconds,
    pomodoroWorkBlock:
      Number.isInteger(timer.pomodoroWorkBlock) && timer.pomodoroWorkBlock >= 0
        ? timer.pomodoroWorkBlock
        : 0,
    pomodoroWorkSeconds: workSeconds,
    pomodoroShortBreakSeconds: shortBreakSeconds,
    pomodoroLongBreakSeconds: longBreakSeconds,
    pomodoroCyclesBeforeLong: normalizeCycleCount(timer.pomodoroCyclesBeforeLong),
  }
}

// ── Persistence ───────────────────────────────────────────────────────────────

const LS_KEY = 'habitat-timer'

function persist(timer: ActiveTimer | null): void {
  if (!import.meta.client) return
  if (timer === null) {
    localStorage.removeItem(LS_KEY)
  } else {
    localStorage.setItem(LS_KEY, JSON.stringify(timer))
  }
}

function restoreFromLS(): ActiveTimer | null {
  if (!import.meta.client) return null
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return null
    return normalizeRestoredPomodoroTimer(JSON.parse(raw) as ActiveTimer)
  } catch {
    return null
  }
}

// ── Composable ────────────────────────────────────────────────────────────────

export function useTimer() {
  const timer = useState<ActiveTimer | null>('active-timer', () => restoreFromLS())
  const _tick = useState<number>('timer-tick', () => 0)

  const currentElapsed = computed(() => {
    void _tick.value // establish reactive dependency on tick
    if (!timer.value) return 0
    return computeElapsed(timer.value, Date.now())
  })

  const isActive = computed(() => timer.value !== null)
  const isRunning = computed(() => timer.value !== null && timer.value.startedAt !== null)
  const isPaused = computed(() => timer.value !== null && timer.value.startedAt === null)

  const isOvertime = computed(() => {
    if (!timer.value || timer.value.mode !== 'countdown') return false
    return currentElapsed.value > timer.value.durationSeconds
  })

  const displayTime = computed(() => {
    if (!timer.value) return '00:00'
    return formatTimerDisplay(
      currentElapsed.value,
      timer.value.mode,
      timer.value.durationSeconds,
      timer.value.pomodoroPhase,
    )
  })

  function startTimer(
    itemId: string,
    itemType: 'todo' | 'bored',
    itemTitle: string,
    mode: TimerMode,
    durationSeconds: number,
    pomodoroConfig: PomodoroConfig,
  ): void {
    const safeConfig = {
      workSeconds: normalizeDurationSeconds(pomodoroConfig.workSeconds, 'pomodoroWorkMinutes'),
      shortBreakSeconds: normalizeDurationSeconds(
        pomodoroConfig.shortBreakSeconds,
        'pomodoroShortBreakMinutes',
      ),
      longBreakSeconds: normalizeDurationSeconds(
        pomodoroConfig.longBreakSeconds,
        'pomodoroLongBreakMinutes',
      ),
      cyclesBeforeLong: normalizeCycleCount(pomodoroConfig.cyclesBeforeLong),
    }
    const newTimer: ActiveTimer = {
      itemId,
      itemType,
      itemTitle,
      mode,
      elapsed: 0,
      startedAt: Date.now(),
      durationSeconds: mode === 'pomodoro' ? safeConfig.workSeconds : durationSeconds,
      pomodoroPhase: 'work',
      pomodoroWorkBlock: 0,
      pomodoroWorkSeconds: safeConfig.workSeconds,
      pomodoroShortBreakSeconds: safeConfig.shortBreakSeconds,
      pomodoroLongBreakSeconds: safeConfig.longBreakSeconds,
      pomodoroCyclesBeforeLong: safeConfig.cyclesBeforeLong,
    }
    timer.value = newTimer
    persist(timer.value)
  }

  function pauseTimer(): void {
    if (!timer.value || timer.value.startedAt === null) return
    const elapsed = computeElapsed(timer.value, Date.now())
    timer.value = { ...timer.value, elapsed, startedAt: null }
    persist(timer.value)
  }

  function resumeTimer(): void {
    if (!timer.value || timer.value.startedAt !== null) return
    timer.value = { ...timer.value, startedAt: Date.now() }
    persist(timer.value)
  }

  function stopTimer(): void {
    timer.value = null
    persist(null)
  }

  function addTime(seconds: number): void {
    if (!timer.value) return
    if (timer.value.mode === 'stopwatch') return // +1 min naturally doesn't make sense for stopwatch, or we can just ignore it
    timer.value = {
      ...timer.value,
      durationSeconds: timer.value.durationSeconds + seconds,
    }
    persist(timer.value)
  }

  function onTick(): { overtime: boolean; phaseTransition: PomodoroPhase | null } {
    _tick.value++

    if (!timer.value || timer.value.startedAt === null) {
      return { overtime: false, phaseTransition: null }
    }

    const now = Date.now()
    const elapsed = computeElapsed(timer.value, now)

    if (timer.value.mode === 'pomodoro' && elapsed >= timer.value.durationSeconds) {
      const next = nextPomodoroPhase(
        timer.value.pomodoroPhase,
        timer.value.pomodoroWorkBlock,
        timer.value.pomodoroCyclesBeforeLong,
        timer.value.pomodoroWorkSeconds,
        timer.value.pomodoroShortBreakSeconds,
        timer.value.pomodoroLongBreakSeconds,
      )
      timer.value = {
        ...timer.value,
        elapsed: 0,
        startedAt: now,
        pomodoroPhase: next.phase,
        durationSeconds: next.durationSeconds,
        pomodoroWorkBlock: next.workBlock,
      }
      persist(timer.value)
      return { overtime: false, phaseTransition: next.phase }
    }

    if (timer.value.mode === 'countdown') {
      return { overtime: elapsed > timer.value.durationSeconds, phaseTransition: null }
    }

    return { overtime: false, phaseTransition: null }
  }

  return {
    timer: readonly(timer),
    currentElapsed,
    isActive,
    isRunning,
    isPaused,
    isOvertime,
    displayTime,
    startTimer,
    pauseTimer,
    resumeTimer,
    stopTimer,
    addTime,
    onTick,
  }
}
