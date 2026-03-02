import { describe, it, expect } from 'vitest'
import {
  formatMmSs,
  computeElapsed,
  formatTimerDisplay,
  nextPomodoroPhase,
} from '~/composables/useTimer'
import type { ActiveTimer, PomodoroPhase, TimerMode } from '~/composables/useTimer'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTimer(overrides: Partial<ActiveTimer> = {}): ActiveTimer {
  return {
    itemId: 'item-1',
    itemType: 'todo',
    itemTitle: 'Test item',
    mode: 'stopwatch',
    elapsed: 0,
    startedAt: null,
    durationSeconds: 0,
    pomodoroPhase: 'work',
    pomodoroWorkBlock: 0,
    pomodoroWorkSeconds: 1500,
    pomodoroShortBreakSeconds: 300,
    pomodoroLongBreakSeconds: 900,
    pomodoroCyclesBeforeLong: 4,
    ...overrides,
  }
}

// ─── formatMmSs ──────────────────────────────────────────────────────────────

describe('formatMmSs', () => {
  it('formats zero as 00:00', () => {
    expect(formatMmSs(0)).toBe('00:00')
  })

  it('formats 61 seconds as 01:01', () => {
    expect(formatMmSs(61)).toBe('01:01')
  })

  it('formats 3600 seconds as 60:00', () => {
    expect(formatMmSs(3600)).toBe('60:00')
  })

  it('formats 90 seconds as 01:30', () => {
    expect(formatMmSs(90)).toBe('01:30')
  })

  it('handles negative values by using absolute', () => {
    expect(formatMmSs(-65)).toBe('01:05')
  })

  it('pads single-digit seconds', () => {
    expect(formatMmSs(65)).toBe('01:05')
  })
})

// ─── computeElapsed ──────────────────────────────────────────────────────────

describe('computeElapsed', () => {
  it('returns elapsed when paused (startedAt is null)', () => {
    const timer = makeTimer({ elapsed: 120, startedAt: null })
    expect(computeElapsed(timer, Date.now())).toBe(120)
  })

  it('adds running time when startedAt is set', () => {
    const now = Date.now()
    const timer = makeTimer({ elapsed: 60, startedAt: now - 10_000 })
    expect(computeElapsed(timer, now)).toBe(70)
  })

  it('returns 0 elapsed for a freshly started timer', () => {
    const now = Date.now()
    const timer = makeTimer({ elapsed: 0, startedAt: now })
    expect(computeElapsed(timer, now)).toBe(0)
  })

  it('floors partial seconds', () => {
    const now = Date.now()
    const timer = makeTimer({ elapsed: 0, startedAt: now - 1500 }) // 1.5s
    expect(computeElapsed(timer, now)).toBe(1)
  })

  it('accumulates elapsed across pauses', () => {
    const now = Date.now()
    const timer = makeTimer({ elapsed: 30, startedAt: now - 5_000 })
    expect(computeElapsed(timer, now)).toBe(35)
  })
})

// ─── formatTimerDisplay ──────────────────────────────────────────────────────

describe('formatTimerDisplay', () => {
  const anyPhase: PomodoroPhase = 'work'

  describe('stopwatch mode', () => {
    it('shows elapsed as MM:SS', () => {
      expect(formatTimerDisplay(90, 'stopwatch', 0, anyPhase)).toBe('01:30')
    })

    it('shows 00:00 at start', () => {
      expect(formatTimerDisplay(0, 'stopwatch', 0, anyPhase)).toBe('00:00')
    })
  })

  describe('countdown mode', () => {
    it('shows elapsed / total format', () => {
      expect(formatTimerDisplay(60, 'countdown', 1500, anyPhase)).toBe('01:00 / 25:00')
    })

    it('shows +MM:SS when in overtime', () => {
      expect(formatTimerDisplay(1560, 'countdown', 1500, anyPhase)).toBe('+01:00')
    })

    it('shows 00:00 / total at start', () => {
      expect(formatTimerDisplay(0, 'countdown', 600, anyPhase)).toBe('00:00 / 10:00')
    })

    it('shows exactly at duration boundary (not overtime)', () => {
      expect(formatTimerDisplay(1500, 'countdown', 1500, anyPhase)).toBe('25:00 / 25:00')
    })
  })

  describe('pomodoro mode', () => {
    it('shows Work phase with remaining time', () => {
      expect(formatTimerDisplay(60, 'pomodoro', 1500, 'work')).toBe('🍅 Work · 24:00')
    })

    it('shows Break phase for short-break', () => {
      expect(formatTimerDisplay(30, 'pomodoro', 300, 'short-break')).toBe('🍅 Break · 04:30')
    })

    it('shows Break phase for long-break', () => {
      expect(formatTimerDisplay(60, 'pomodoro', 900, 'long-break')).toBe('🍅 Break · 14:00')
    })

    it('clamps remaining to 0 when elapsed exceeds duration', () => {
      expect(formatTimerDisplay(1600, 'pomodoro', 1500, 'work')).toBe('🍅 Work · 00:00')
    })
  })
})

// ─── nextPomodoroPhase ───────────────────────────────────────────────────────

describe('nextPomodoroPhase', () => {
  const WORK = 1500
  const SHORT = 300
  const LONG = 900
  const CYCLES = 4

  it('work → short-break on cycles 1, 2, 3', () => {
    for (const block of [0, 1, 2]) {
      const result = nextPomodoroPhase('work', block, CYCLES, WORK, SHORT, LONG)
      expect(result.phase).toBe('short-break')
      expect(result.durationSeconds).toBe(SHORT)
    }
  })

  it('work → long-break on 4th cycle (block 3 → newBlock 4)', () => {
    const result = nextPomodoroPhase('work', 3, CYCLES, WORK, SHORT, LONG)
    expect(result.phase).toBe('long-break')
    expect(result.durationSeconds).toBe(LONG)
    expect(result.workBlock).toBe(4)
  })

  it('short-break → work', () => {
    const result = nextPomodoroPhase('short-break', 1, CYCLES, WORK, SHORT, LONG)
    expect(result.phase).toBe('work')
    expect(result.durationSeconds).toBe(WORK)
    expect(result.workBlock).toBe(1) // unchanged on break → work
  })

  it('long-break → work', () => {
    const result = nextPomodoroPhase('long-break', 4, CYCLES, WORK, SHORT, LONG)
    expect(result.phase).toBe('work')
    expect(result.durationSeconds).toBe(WORK)
  })

  it('increments workBlock when transitioning from work', () => {
    const result = nextPomodoroPhase('work', 0, CYCLES, WORK, SHORT, LONG)
    expect(result.workBlock).toBe(1)
  })

  it('cycles correctly: work → short → work → short → work → short → work → long', () => {
    let phase: PomodoroPhase = 'work'
    let workBlock = 0

    const phases: PomodoroPhase[] = []
    for (let i = 0; i < 8; i++) {
      const next = nextPomodoroPhase(phase, workBlock, 4, WORK, SHORT, LONG)
      phases.push(next.phase)
      phase = next.phase
      workBlock = next.workBlock
    }

    expect(phases).toEqual([
      'short-break', 'work',
      'short-break', 'work',
      'short-break', 'work',
      'long-break', 'work',
    ])
  })
})

// ─── Overtime detection ──────────────────────────────────────────────────────

describe('overtime detection (via formatTimerDisplay)', () => {
  it('not overtime at exactly duration', () => {
    const display = formatTimerDisplay(300, 'countdown', 300, 'work')
    expect(display).not.toMatch(/^\+/)
  })

  it('overtime at elapsed > duration', () => {
    const display = formatTimerDisplay(301, 'countdown', 300, 'work')
    expect(display).toMatch(/^\+/)
    expect(display).toBe('+00:01')
  })
})

// ─── Persist / restore round-trip ────────────────────────────────────────────

describe('persist/restore round-trip', () => {
  it('ActiveTimer interface serialises to JSON and back without loss', () => {
    const original: ActiveTimer = {
      itemId: 'todo-abc',
      itemType: 'todo',
      itemTitle: 'Write tests',
      mode: 'pomodoro',
      elapsed: 450,
      startedAt: 1700000000000,
      durationSeconds: 1500,
      pomodoroPhase: 'work',
      pomodoroWorkBlock: 2,
      pomodoroWorkSeconds: 1500,
      pomodoroShortBreakSeconds: 300,
      pomodoroLongBreakSeconds: 900,
      pomodoroCyclesBeforeLong: 4,
    }

    const json = JSON.stringify(original)
    const restored = JSON.parse(json) as ActiveTimer

    expect(restored.itemId).toBe(original.itemId)
    expect(restored.mode).toBe(original.mode)
    expect(restored.elapsed).toBe(original.elapsed)
    expect(restored.startedAt).toBe(original.startedAt)
    expect(restored.pomodoroPhase).toBe(original.pomodoroPhase)
    expect(restored.pomodoroWorkBlock).toBe(original.pomodoroWorkBlock)
  })

  it('handles null startedAt (paused state)', () => {
    const paused: ActiveTimer = makeTimer({ elapsed: 300, startedAt: null })
    const json = JSON.stringify(paused)
    const restored = JSON.parse(json) as ActiveTimer
    expect(restored.startedAt).toBeNull()
    expect(restored.elapsed).toBe(300)
  })
})
