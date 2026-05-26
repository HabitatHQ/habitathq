import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import EmptyState from '~/components/EmptyState.vue'

const AppEmptyStateStub = {
  name: 'AppEmptyState',
  props: ['icon', 'title', 'description'],
  template: `
    <section>
      <div><slot name="icon"><span v-if="icon" data-icon :name="icon" /></slot></div>
      <p class="font-semibold">{{ title }}</p>
      <p v-if="description" class="text-sm">{{ description }}</p>
      <slot name="actions" />
    </section>
  `,
}

describe('EmptyState', () => {
  const stubs = { AppEmptyState: AppEmptyStateStub, AppIcon: true }

  it('renders the title', () => {
    const wrapper = mount(EmptyState, {
      props: { icon: 'i-lucide-star', title: 'Nothing here' },
      global: { stubs },
    })
    expect(wrapper.text()).toContain('Nothing here')
  })

  it('renders description when provided', () => {
    const wrapper = mount(EmptyState, {
      props: { icon: 'i-lucide-star', title: 'Nothing here', description: 'Add one to get started.' },
      global: { stubs },
    })
    expect(wrapper.text()).toContain('Add one to get started.')
  })

  it('does not render description element when omitted', () => {
    const wrapper = mount(EmptyState, {
      props: { icon: 'i-lucide-star', title: 'Nothing here' },
      global: { stubs },
    })
    expect(wrapper.find('p.text-sm').exists()).toBe(false)
  })

  it('passes the icon name to AppEmptyState', () => {
    const wrapper = mount(EmptyState, {
      props: { icon: 'i-lucide-flame', title: 'x' },
      global: { stubs },
    })
    const emptyState = wrapper.findComponent({ name: 'AppEmptyState' })
    expect(emptyState.props('icon')).toBe('i-lucide-flame')
  })
})
