import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import SproutPlant from '~/components/SproutPlant.vue'
import type { StreakStatus } from '~/lib/streak-engine'

// Signature fragments of each part's SVG (stable across renders).
const SEED_REST = 'rx="3.4"'
const SEED_SPROUT = 'M 20,39 C 17,35'
const STEM_MID = 'y2="30"'
const STEM_FULL = 'y2="24"'
const SMALL_LEAF = 'M 20,30 C 14,29'
const LEAF_L = 'M 20,24 C 11,23'
const BRANCH_R = 'C 26,20 32,14 30,8'
const BUD = 'M 17.5,22'
const DAISY_EYE = '#fbbf24'
const FROST = '#7dd3fc'

function render(level: number, status: StreakStatus = 'active') {
  return mount(SproutPlant, { props: { level, status, color: '#22c55e', animate: false } })
}

describe('SproutPlant — stage by level', () => {
  it('level 0 shows the dormant seed only', () => {
    const html = render(0).html()
    expect(html).toContain(SEED_REST)
    expect(html).not.toContain(STEM_FULL)
  })

  it('maps level to the right growth stage', () => {
    expect(render(1).html()).toContain(SEED_SPROUT)
    expect(render(3).html()).toContain(STEM_MID)
    expect(render(3).html()).toContain(SMALL_LEAF)
    expect(render(7).html()).toContain(LEAF_L)
    expect(render(7).html()).not.toContain(BRANCH_R)
    expect(render(14).html()).toContain(BRANCH_R)
    expect(render(21).html()).toContain(BUD)
    expect(render(30).html()).toContain(DAISY_EYE)
    expect(render(30).html()).not.toContain(BUD)
  })
})

describe('SproutPlant — frost states', () => {
  it('frozen tints the plant icy-cyan with crystals', () => {
    const html = render(14, 'frozen').html()
    expect(html).toContain(FROST) // svg color
    expect(html).toContain('#bae6fd') // crystal stroke
    expect(html).toContain('frosted')
  })

  it('thawing keeps the habit colour with a couple of crystals', () => {
    const html = render(14, 'thawing').html()
    expect(html).toContain('#bae6fd')
    expect(html).toContain('frosted')
  })

  it('active has no frost', () => {
    const html = render(14, 'active').html()
    expect(html).not.toContain('#bae6fd')
    expect(html).not.toContain('frosted')
  })

  it('exposes a descriptive aria-label', () => {
    expect(
      mount(SproutPlant, { props: { level: 7, status: 'active', streak: 7, animate: false } })
        .get('svg')
        .attributes('aria-label'),
    ).toContain('sapling')
    expect(render(14, 'frozen').get('svg').attributes('aria-label')).toContain('frozen')
  })
})

describe('SproutPlant — level-advance animation', () => {
  it('marks newly-entered parts when the level advances a stage', async () => {
    const wrapper = mount(SproutPlant, {
      props: { level: 6, status: 'active' as StreakStatus, color: '#22c55e', animate: true },
    })
    expect(wrapper.html()).not.toContain('enter')
    await wrapper.setProps({ level: 7 })
    expect(wrapper.html()).toContain('enter')
  })

  it('does not animate when disabled', async () => {
    const wrapper = mount(SproutPlant, {
      props: { level: 6, status: 'active' as StreakStatus, color: '#22c55e', animate: false },
    })
    await wrapper.setProps({ level: 7 })
    expect(wrapper.html()).not.toContain('enter')
  })
})
