import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'

import BackNav from '~/components/BackNav.vue'

const mockResolveIcon = (name: string) => `i-lucide-${name}`

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:pathMatch(.*)*', component: { template: '<div />' } }],
  })
}

describe('BackNav', () => {
  it('renders the label', () => {
    const wrapper = mount(BackNav, {
      props: { to: '/habits', label: 'Habits' },
      global: {
        plugins: [makeRouter()],
        mocks: { resolveIcon: mockResolveIcon },
        stubs: { UButton: { template: '<a :href="to"><slot /></a>', props: ['to', 'icon'] } },
      },
    })
    expect(wrapper.text()).toContain('Habits')
  })

  it('UButton receives the correct to prop', () => {
    const wrapper = mount(BackNav, {
      props: { to: '/checkin', label: 'Check-ins' },
      global: {
        plugins: [makeRouter()],
        mocks: { resolveIcon: mockResolveIcon },
        stubs: { UButton: { template: '<a :href="to"><slot /></a>', props: ['to', 'icon'] } },
      },
    })
    expect(wrapper.find('a').attributes('href')).toBe('/checkin')
  })

  it('UButton receives the arrow-left icon', () => {
    const wrapper = mount(BackNav, {
      props: { to: '/habits', label: 'Habits' },
      global: {
        plugins: [makeRouter()],
        mocks: { resolveIcon: mockResolveIcon },
        stubs: {
          UButton: {
            name: 'UButton',
            props: ['to', 'icon'],
            template: '<a :data-icon="icon" :href="to" />',
          },
        },
      },
    })
    expect(wrapper.find('a').attributes('data-icon')).toBe('i-lucide-arrow-left')
  })
})
