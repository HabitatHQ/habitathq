import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { createRouter, createMemoryHistory, RouterLink } from 'vue-router'

import BackNav from '~/components/BackNav.vue'

const mockResolveIcon = (name: string) => `i-lucide-${name}`

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:pathMatch(.*)*', component: { template: '<div />' } }],
  })
}

const NuxtLinkStub = RouterLink

describe('BackNav', () => {
  const baseGlobal = {
    plugins: [makeRouter()],
    mocks: { resolveIcon: mockResolveIcon },
    stubs: {
      NuxtLink: NuxtLinkStub,
      UButton: { template: '<span :data-icon="icon" />', props: ['icon', 'as'] },
    },
  }

  it('renders the label', () => {
    const wrapper = mount(BackNav, {
      props: { to: '/habits', label: 'Habits' },
      global: baseGlobal,
    })
    expect(wrapper.text()).toContain('Habits')
  })

  it('wrapping link receives the correct to prop', () => {
    const wrapper = mount(BackNav, {
      props: { to: '/checkin', label: 'Check-ins' },
      global: baseGlobal,
    })
    expect(wrapper.find('a').attributes('href')).toBe('/checkin')
  })

  it('UButton receives the arrow-left icon', () => {
    const wrapper = mount(BackNav, {
      props: { to: '/habits', label: 'Habits' },
      global: baseGlobal,
    })
    expect(wrapper.find('[data-icon]').attributes('data-icon')).toBe('i-lucide-arrow-left')
  })

  it('renders dimmed label in breadcrumb mode (default)', () => {
    const wrapper = mount(BackNav, {
      props: { to: '/habits', label: 'Habits' },
      global: baseGlobal,
    })
    const label = wrapper.find('span.text-sm')
    expect(label.exists()).toBe(true)
    expect(label.text()).toBe('Habits')
  })

  it('renders bold title in title mode', () => {
    const wrapper = mount(BackNav, {
      props: { to: '/jots', label: 'New Jot', title: true },
      global: baseGlobal,
    })
    const label = wrapper.find('span.font-bold')
    expect(label.exists()).toBe(true)
    expect(label.text()).toBe('New Jot')
  })

  it('renders slot content', () => {
    const wrapper = mount(BackNav, {
      props: { to: '/jots', label: 'Jot', title: true },
      slots: { default: '<button>Save</button>' },
      global: baseGlobal,
    })
    expect(wrapper.find('button').text()).toBe('Save')
  })
})
