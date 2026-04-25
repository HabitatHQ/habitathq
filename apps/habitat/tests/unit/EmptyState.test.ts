import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import EmptyState from '~/components/EmptyState.vue'

describe('EmptyState', () => {
  it('renders the title', () => {
    const wrapper = mount(EmptyState, {
      props: { icon: 'i-heroicons-star', title: 'Nothing here' },
      global: { stubs: { AppIcon: true } },
    })
    expect(wrapper.text()).toContain('Nothing here')
  })

  it('renders description when provided', () => {
    const wrapper = mount(EmptyState, {
      props: { icon: 'i-heroicons-star', title: 'Nothing here', description: 'Add one to get started.' },
      global: { stubs: { AppIcon: true } },
    })
    expect(wrapper.text()).toContain('Add one to get started.')
  })

  it('does not render description element when omitted', () => {
    const wrapper = mount(EmptyState, {
      props: { icon: 'i-heroicons-star', title: 'Nothing here' },
      global: { stubs: { AppIcon: true } },
    })
    // The description paragraph is uniquely identified by text-sm; the title
    // paragraph uses font-semibold. Checking the specific element is more
    // resilient than counting all <p> tags in the component.
    expect(wrapper.find('p.text-sm').exists()).toBe(false)
  })

  it('passes the icon name to AppIcon', () => {
    const wrapper = mount(EmptyState, {
      props: { icon: 'i-heroicons-fire', title: 'x' },
      global: { stubs: { AppIcon: true } },
    })
    const icon = wrapper.findComponent({ name: 'AppIcon' })
    expect(icon.attributes('name')).toBe('i-heroicons-fire')
  })
})
