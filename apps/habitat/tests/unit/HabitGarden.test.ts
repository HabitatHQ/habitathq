import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import HabitGarden from '~/components/HabitGarden.vue'
import type { StreakStatus } from '~/lib/streak-engine'

interface P {
  id: string
  name: string
  color: string
  streak: number
  level: number
  status: StreakStatus
}
function plant(over: Partial<P> = {}): P {
  return { id: 'h1', name: 'Read', color: '#22c55e', streak: 7, level: 7, status: 'active', ...over }
}
function mountGarden(plants: P[], cap = 8) {
  return mount(HabitGarden, { props: { plants, cap } })
}

const DAISY_EYE = '#fbbf24'
const SEED_REST = 'rx="3.4"' // shared SproutFigure dormant seed
const BRANCH_R = 'C 26,20 32,14 30,8'
const FROST = '#7dd3fc'

describe('HabitGarden', () => {
  it('renders one plant per habit', () => {
    const w = mountGarden([plant({ id: 'a' }), plant({ id: 'b' }), plant({ id: 'c' })])
    expect(w.findAll('g.plant')).toHaveLength(3)
  })

  it('maps level to the right growth stage', () => {
    expect(mountGarden([plant({ level: 30 })]).html()).toContain(DAISY_EYE)
    expect(mountGarden([plant({ level: 14 })]).html()).toContain(BRANCH_R)
    expect(mountGarden([plant({ level: 0 })]).html()).toContain(SEED_REST)
  })

  it('frosts frozen/thawing plants with crystals (consistent with SproutPlant)', () => {
    const frozen = mountGarden([plant({ status: 'frozen' })]).html()
    expect(frozen).toContain(FROST) // icy tint
    expect(frozen).toContain('#bae6fd') // crystal stroke
    expect(frozen).toContain('frosted')
    expect(mountGarden([plant({ status: 'thawing' })]).html()).toContain('#bae6fd')
    const active = mountGarden([plant({ status: 'active' })]).html()
    expect(active).not.toContain('frosted')
    expect(active).not.toContain('#bae6fd')
  })

  it('caps the bed and reveals the rest on "view all"', async () => {
    const plants = Array.from({ length: 10 }, (_, i) => plant({ id: `h${i}` }))
    const w = mountGarden(plants, 8)
    expect(w.findAll('g.plant')).toHaveLength(8)
    expect(w.text()).toContain('View all 10')
    await w.get('button').trigger('click')
    expect(w.findAll('g.plant')).toHaveLength(10)
  })

  it('toggles the name label on tap (no navigation)', async () => {
    const w = mountGarden([plant({ id: 'a', name: 'Meditate' })])
    expect(w.find('.plant-label').exists()).toBe(false)
    await w.get('g.plant').trigger('click')
    expect(w.find('.plant-label').text()).toBe('Meditate')
    await w.get('g.plant').trigger('click')
    expect(w.find('.plant-label').exists()).toBe(false)
    expect(w.emitted('open')).toBeUndefined()
  })

  it('exposes an aria-label per plant', () => {
    const w = mountGarden([plant({ name: 'Run', streak: 21, level: 21, status: 'frozen' })])
    const label = w.get('g.plant').attributes('aria-label')
    expect(label).toContain('Run')
    expect(label).toContain('21-day streak')
    expect(label).toContain('frozen')
  })
})
