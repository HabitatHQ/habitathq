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

// ── Pure helper functions (exported for unit tests) ───────────────────────────

export function formatMmSs(totalSeconds: number): string {
  const s = Math.abs(Math.floor(totalSeconds))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

export function computeElapsed(timer: ActiveTimer, now: number): number {
  return timer.elapsed + (timer.startedAt !== null ? Math.floor((now - timer.startedAt) / 1000) : 0)
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

export function nextPomodoroPhase(
  currentPhase: PomodoroPhase,
  workBlock: number,
  cyclesBeforeLong: number,
  workSeconds: number,
  shortBreakSeconds: number,
  longBreakSeconds: number,
): { phase: PomodoroPhase; durationSeconds: number; workBlock: number } {
  if (currentPhase === 'work') {
    const newBlock = workBlock + 1
    if (newBlock % cyclesBeforeLong === 0) {
      return { phase: 'long-break', durationSeconds: longBreakSeconds, workBlock: newBlock }
    }
    return { phase: 'short-break', durationSeconds: shortBreakSeconds, workBlock: newBlock }
  }
  return { phase: 'work', durationSeconds: workSeconds, workBlock }
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
    return JSON.parse(raw) as ActiveTimer
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
    const newTimer: ActiveTimer = {
      itemId,
      itemType,
      itemTitle,
      mode,
      elapsed: 0,
      startedAt: Date.now(),
      durationSeconds: mode === 'pomodoro' ? pomodoroConfig.workSeconds : durationSeconds,
      pomodoroPhase: 'work',
      pomodoroWorkBlock: 0,
      pomodoroWorkSeconds: pomodoroConfig.workSeconds,
      pomodoroShortBreakSeconds: pomodoroConfig.shortBreakSeconds,
      pomodoroLongBreakSeconds: pomodoroConfig.longBreakSeconds,
      pomodoroCyclesBeforeLong: pomodoroConfig.cyclesBeforeLong,
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
    onTick,
  }
}
