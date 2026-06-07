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

function render(streak: number, status: StreakStatus) {
  return mount(SproutPlant, { props: { streak, status, color: '#22c55e', animate: false } })
}

describe('SproutPlant — stage rendering', () => {
  it('broken streak shows the dormant resting seed only', () => {
    const html = render(0, 'broken').html()
    expect(html).toContain(SEED_REST)
    expect(html).not.toContain(STEM_FULL)
    expect(html).not.toContain(BRANCH_R)
  })

  it('day 1 shows the germinating seed', () => {
    const html = render(1, 'active').html()
    expect(html).toContain(SEED_SPROUT)
    expect(html).not.toContain(STEM_FULL)
  })

  it('day 3 shows the sprout (mid stem + small leaf)', () => {
    const html = render(3, 'active').html()
    expect(html).toContain(STEM_MID)
    expect(html).toContain(SMALL_LEAF)
    expect(html).not.toContain(BRANCH_R)
  })

  it('day 7 shows the sapling (full stem + left leaf, no branch)', () => {
    const html = render(7, 'active').html()
    expect(html).toContain(STEM_FULL)
    expect(html).toContain(LEAF_L)
    expect(html).not.toContain(BRANCH_R)
  })

  it('day 14 adds the right branch (leafy = current logo)', () => {
    const html = render(14, 'active').html()
    expect(html).toContain(BRANCH_R)
    expect(html).not.toContain(BUD)
  })

  it('day 21 shows the bud', () => {
    const html = render(21, 'active').html()
    expect(html).toContain(BUD)
    expect(html).not.toContain(DAISY_EYE)
  })

  it('day 30 shows the daisy bloom (not the bud)', () => {
    const html = render(30, 'active').html()
    expect(html).toContain(DAISY_EYE)
    expect(html).not.toContain(BUD)
  })
})

describe('SproutPlant — states & a11y', () => {
  it('at-risk wilts the foliage', () => {
    const html = render(10, 'at_risk').html()
    expect(html).toContain('wilt')
  })

  it('active does not wilt', () => {
    const html = render(10, 'active').html()
    expect(html).not.toContain('wilt')
  })

  it('exposes a descriptive aria-label per state', () => {
    expect(render(7, 'active').get('svg').attributes('aria-label')).toContain('7-day streak')
    expect(render(7, 'active').get('svg').attributes('aria-label')).toContain('sapling')
    expect(render(0, 'broken').get('svg').attributes('aria-label')).toContain('dormant')
    expect(render(10, 'at_risk').get('svg').attributes('aria-label')).toContain('at risk')
  })
})

describe('SproutPlant — stage-advance animation', () => {
  it('marks newly-entered parts on a stage advance', async () => {
    // streak 6 → stage 2 (sprout); advancing to 7 → stage 3 (sapling) adds the branch-less leafy stem
    const wrapper = mount(SproutPlant, {
      props: { streak: 6, status: 'active' as StreakStatus, color: '#22c55e', animate: true },
    })
    expect(wrapper.html()).not.toContain('enter')
    await wrapper.setProps({ streak: 7 })
    expect(wrapper.html()).toContain('enter')
  })

  it('does not animate when animation is disabled', async () => {
    const wrapper = mount(SproutPlant, {
      props: { streak: 6, status: 'active' as StreakStatus, color: '#22c55e', animate: false },
    })
    await wrapper.setProps({ streak: 7 })
    expect(wrapper.html()).not.toContain('enter')
  })
})
