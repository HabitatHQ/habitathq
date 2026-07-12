import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import AppListSection from '~/components/AppListSection.vue'

describe('AppListSection', () => {
  it('renders the title in the canonical section header', () => {
    const wrapper = mount(AppListSection, { props: { title: 'Today' } })
    const h3 = wrapper.find('h3')
    expect(h3.exists()).toBe(true)
    expect(h3.text()).toBe('Today')
    expect(h3.classes()).toEqual(
      expect.arrayContaining(['uppercase', 'tracking-wider', 'text-xs']),
    )
  })

  it('renders default slot content (the list body)', () => {
    const wrapper = mount(AppListSection, {
      props: { title: 'Notes' },
      slots: { default: '<ul><li>one</li></ul>' },
    })
    expect(wrapper.find('li').text()).toBe('one')
  })

  it('renders the actions slot when provided', () => {
    const wrapper = mount(AppListSection, {
      props: { title: 'Notes' },
      slots: { actions: '<button>clear</button>' },
    })
    expect(wrapper.find('button').text()).toBe('clear')
  })
})
