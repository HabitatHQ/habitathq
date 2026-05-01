export type IntervalType = 'tabata' | 'emom' | 'amrap' | 'custom'

export interface IntervalTemplate {
  type: IntervalType
  name: string
  rounds: number
  work_sec: number
  rest_sec: number
  time_cap_sec: number | null
}

export function buildTabata(): IntervalTemplate {
  return {
    type: 'tabata',
    name: 'Tabata',
    rounds: 8,
    work_sec: 20,
    rest_sec: 10,
    time_cap_sec: null,
  }
}

export function buildEmom(rounds: number): IntervalTemplate {
  return {
    type: 'emom',
    name: `EMOM ${rounds}`,
    rounds,
    work_sec: 60,
    rest_sec: 0,
    time_cap_sec: rounds * 60,
  }
}

export function buildAmrap(timeCapSec: number): IntervalTemplate {
  return {
    type: 'amrap',
    name: `AMRAP ${Math.round(timeCapSec / 60)}min`,
    rounds: 0,
    work_sec: timeCapSec,
    rest_sec: 0,
    time_cap_sec: timeCapSec,
  }
}

export function calculateIntervalTotalTime(template: IntervalTemplate): number {
  if (template.type === 'amrap') {
    return template.time_cap_sec ?? 0
  }
  return template.rounds * (template.work_sec + template.rest_sec)
}
