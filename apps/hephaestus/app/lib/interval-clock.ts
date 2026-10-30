import type { IntervalTemplate } from '~/lib/interval-templates'

export interface IntervalClockState {
  phase: 'work' | 'rest' | 'complete'
  round: number
  phase_deadline_ms: number | null
  paused_remaining_sec: number | null
}

/** A session owns its configuration even if its reusable plan is edited or removed. */
export function parseIntervalConfiguration(value: unknown): IntervalTemplate {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('Interval configuration is missing')
  const source: Record<string, unknown> = Object.fromEntries(Object.entries(value))
  const type = source['type']
  if (
    type !== 'tabata' &&
    type !== 'emom' &&
    type !== 'amrap' &&
    type !== 'custom' &&
    type !== 'mobility'
  )
    throw new Error('Interval type is unsupported')
  const name = source['name']
  const rounds = source['rounds']
  const work = source['work_sec']
  const rest = source['rest_sec']
  if (
    typeof name !== 'string' ||
    !name.trim() ||
    typeof rounds !== 'number' ||
    !Number.isSafeInteger(rounds) ||
    (type === 'amrap' ? rounds !== 0 : rounds < 1) ||
    typeof work !== 'number' ||
    !Number.isFinite(work) ||
    work <= 0 ||
    typeof rest !== 'number' ||
    !Number.isFinite(rest) ||
    rest < 0 ||
    !Number.isSafeInteger((type === 'amrap' ? work : rounds * (work + rest)) * 1000)
  )
    throw new Error('Interval durations and rounds must be finite, positive training values')
  return {
    type,
    name,
    rounds,
    work_sec: work,
    rest_sec: rest,
    time_cap_sec: type === 'amrap' ? work : null,
  }
}

function intervalPosition(
  state: IntervalClockState,
  config: IntervalTemplate,
  now: number,
): number {
  const cycles = config.type === 'amrap' ? 1 : config.rounds
  const rest = config.type === 'amrap' ? 0 : config.rest_sec
  const cycle = config.work_sec + rest
  if (state.phase === 'complete') return cycles * cycle
  const duration = state.phase === 'work' ? config.work_sec : rest
  const remaining = state.paused_remaining_sec ?? ((state.phase_deadline_ms ?? now) - now) / 1000
  return Math.max(
    0,
    Math.min(
      cycles * cycle,
      (state.round - 1) * cycle +
        (state.phase === 'rest' ? config.work_sec : 0) +
        duration -
        remaining,
    ),
  )
}

/** Deadline arithmetic catches up across arbitrarily many rounds without replaying callbacks. */
export function intervalProgressAt(
  state: IntervalClockState,
  config: IntervalTemplate,
  now: number,
): IntervalClockState {
  if (state.paused_remaining_sec !== null || state.phase === 'complete') return state
  const position = intervalPosition(state, config, now)
  const rest = config.type === 'amrap' ? 0 : config.rest_sec
  const cycle = config.work_sec + rest
  const cycles = config.type === 'amrap' ? 1 : config.rounds
  if (position >= cycles * cycle)
    return { phase: 'complete', round: cycles, phase_deadline_ms: null, paused_remaining_sec: null }
  const round = Math.floor(position / cycle) + 1
  const offset = position % cycle
  const phase = offset < config.work_sec ? 'work' : 'rest'
  const remaining = (phase === 'work' ? config.work_sec : cycle) - offset
  return { phase, round, phase_deadline_ms: now + remaining * 1000, paused_remaining_sec: null }
}

export function intervalElapsedSeconds(
  state: IntervalClockState,
  config: IntervalTemplate,
  now: number,
): number {
  return Math.round(intervalPosition(state, config, now))
}
