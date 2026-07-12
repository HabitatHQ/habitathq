import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import AppCard from '~/components/AppCard.vue'

describe('AppCard', () => {
  it('renders a div with the canonical surface classes by default', () => {
    const wrapper = mount(AppCard, { slots: { default: 'hi' } })
    expect(wrapper.element.tagName).toBe('DIV')
    const cls = wrapper.classes()
    expect(cls).toEqual(expect.arrayContaining(['rounded-xl', 'p-3', 'gap-3', 'items-center']))
    expect(wrapper.text()).toBe('hi')
  })

  it('aligns to the top when align="start" (multi-line items)', () => {
    const wrapper = mount(AppCard, { props: { align: 'start' } })
    expect(wrapper.classes()).toContain('items-start')
    expect(wrapper.classes()).not.toContain('items-center')
  })

  it('applies the completed tint', () => {
    const wrapper = mount(AppCard, { props: { completed: true } })
    expect(wrapper.classes()).toContain('border-primary-500/40')
  })

  it('dims when dimmed', () => {
    const wrapper = mount(AppCard, { props: { dimmed: true } })
    expect(wrapper.classes()).toContain('opacity-40')
  })

  it('becomes navigable when `to` is set', () => {
    const wrapper = mount(AppCard, {
      props: { to: '/somewhere' },
      global: { stubs: { NuxtLink: true } },
    })
    expect(wrapper.classes()).toContain('cursor-pointer')
  })

  it('honors a custom tag', () => {
    const wrapper = mount(AppCard, { props: { tag: 'li' } })
    expect(wrapper.element.tagName).toBe('LI')
  })

  it('wraps a navigable card in an <li> when tag="li" and `to` are both set', () => {
    // `to` renders a NuxtLink (<a>); an <a> cannot also be the list item, so the
    // link must be wrapped in a real <li> to keep <ul> markup valid.
    const wrapper = mount(AppCard, {
      props: { tag: 'li', to: '/somewhere' },
      global: { stubs: { NuxtLink: { template: '<a><slot /></a>', props: ['to'] } } },
    })
    expect(wrapper.element.tagName).toBe('LI')
    const link = wrapper.find('a')
    expect(link.exists()).toBe(true)
    // The card surface + navigable classes live on the link, not the <li>.
    expect(link.classes()).toEqual(expect.arrayContaining(['rounded-xl', 'cursor-pointer']))
    expect(wrapper.classes()).not.toContain('rounded-xl')
  })
})
