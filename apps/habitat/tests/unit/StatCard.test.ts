import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import StatCard from '~/components/StatCard.vue'

// Stub UCard to render its default slot
const UCardStub = {
  name: 'UCard',
  template: '<div class="u-card"><slot /></div>',
}

describe('StatCard', () => {
  it('renders the label', () => {
    const wrapper = mount(StatCard, {
      props: { label: 'Current streak', value: '7' },
      global: { stubs: { UCard: UCardStub } },
    })
    expect(wrapper.text()).toContain('Current streak')
  })

  it('renders a numeric value', () => {
    const wrapper = mount(StatCard, {
      props: { label: 'Total', value: 42 },
      global: { stubs: { UCard: UCardStub } },
    })
    expect(wrapper.text()).toContain('42')
  })

  it('renders a string value', () => {
    const wrapper = mount(StatCard, {
      props: { label: 'Rate', value: '87%' },
      global: { stubs: { UCard: UCardStub } },
    })
    expect(wrapper.text()).toContain('87%')
  })
})
