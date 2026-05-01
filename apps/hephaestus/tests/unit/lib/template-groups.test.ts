import { describe, expect, it } from 'vitest'
import { estimateGroupDuration, groupDisplayLabel, groupTypeColor } from '~/lib/template-groups'
import type { TemplateGroupRow } from '~/types/database'

function makeGroup(overrides: Partial<TemplateGroupRow> = {}): TemplateGroupRow {
  return {
    id: 'g1',
    template_id: 'tpl1',
    label: 'A',
    name: null,
    group_type: 'superset',
    transition_rest_sec: 15,
    rest_after_round_sec: 120,
    circuit_rest_mode: 'after_round',
    sort_order: 0,
    display_name: null,
    rounds: 1,
    amrap: 0,
    time_cap_sec: null,
    ...overrides,
  }
}

describe('groupTypeColor', () => {
  it('returns blue for superset', () => {
    expect(groupTypeColor('superset')).toBe('blue')
  })

  it('returns green for circuit', () => {
    expect(groupTypeColor('circuit')).toBe('green')
  })

  it('returns amber for pre_exhaust', () => {
    expect(groupTypeColor('pre_exhaust')).toBe('amber')
  })

  it('returns indigo for giant_set', () => {
    expect(groupTypeColor('giant_set')).toBe('indigo')
  })
})

describe('groupDisplayLabel', () => {
  it('returns display_name when set', () => {
    const group = makeGroup({ display_name: 'Chest Pre-Exhaust' })
    expect(groupDisplayLabel(group)).toBe('A · Chest Pre-Exhaust')
  })

  it('returns just the label when no display_name', () => {
    const group = makeGroup()
    expect(groupDisplayLabel(group)).toBe('A')
  })
})

describe('estimateGroupDuration', () => {
  it('estimates duration as exCount × 45s + rest_after_round_sec for 1 round', () => {
    const group = makeGroup({ rest_after_round_sec: 60 })
    // 3 exercises × 45s + 60s rest = 195s
    expect(estimateGroupDuration(group, 3)).toBe(195)
  })

  it('multiplies by rounds for circuits', () => {
    const group = makeGroup({ group_type: 'circuit', rounds: 3, rest_after_round_sec: 60 })
    // 3 exercises × 45s × 3 rounds + 60s × 3 = 405 + 180 = 585
    expect(estimateGroupDuration(group, 3)).toBe(585)
  })
})
