import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import CollapsibleSection from '~/components/CollapsibleSection.vue'

describe('CollapsibleSection', () => {
  it('renders the toggle button with the closed label', () => {
    const wrapper = mount(CollapsibleSection, {
      props: { label: 'Add annotations' },
      global: { stubs: { AppIcon: true } },
    })
    expect(wrapper.find('button').text()).toContain('Add annotations')
  })

  it('slot content is hidden by default', () => {
    const wrapper = mount(CollapsibleSection, {
      props: { label: 'Add annotations' },
      slots: { default: '<p class="slot-content">inner</p>' },
      global: { stubs: { AppIcon: true } },
    })
    expect(wrapper.find('.slot-content').exists()).toBe(false)
  })

  it('slot content is visible when defaultOpen is true', () => {
    const wrapper = mount(CollapsibleSection, {
      props: { label: 'Hide annotations', defaultOpen: true },
      slots: { default: '<p class="slot-content">inner</p>' },
      global: { stubs: { AppIcon: true } },
    })
    expect(wrapper.find('.slot-content').exists()).toBe(true)
  })

  it('clicking toggle shows slot content', async () => {
    const wrapper = mount(CollapsibleSection, {
      props: { label: 'Add annotations' },
      slots: { default: '<p class="slot-content">inner</p>' },
      global: { stubs: { AppIcon: true } },
    })
    await wrapper.find('button').trigger('click')
    expect(wrapper.find('.slot-content').exists()).toBe(true)
  })

  it('clicking toggle twice hides slot content again', async () => {
    const wrapper = mount(CollapsibleSection, {
      props: { label: 'Add annotations' },
      slots: { default: '<p class="slot-content">inner</p>' },
      global: { stubs: { AppIcon: true } },
    })
    await wrapper.find('button').trigger('click')
    await wrapper.find('button').trigger('click')
    expect(wrapper.find('.slot-content').exists()).toBe(false)
  })

  it('shows openLabel when provided and expanded', async () => {
    const wrapper = mount(CollapsibleSection, {
      props: { label: 'Add annotations', openLabel: 'Hide annotations' },
      global: { stubs: { AppIcon: true } },
    })
    await wrapper.find('button').trigger('click')
    expect(wrapper.find('button').text()).toContain('Hide annotations')
  })
})
