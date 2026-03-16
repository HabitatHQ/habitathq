import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import AppModal from '~/components/AppModal.vue'

describe('AppModal', () => {
  it('renders nothing when modelValue is false', () => {
    const wrapper = mount(AppModal, {
      props: { modelValue: false },
      slots: { default: '<p class="content">hello</p>' },
    })
    expect(wrapper.find('.content').exists()).toBe(false)
  })

  it('renders slot content when modelValue is true', () => {
    const wrapper = mount(AppModal, {
      props: { modelValue: true },
      slots: { default: '<p class="content">hello</p>' },
    })
    expect(wrapper.find('.content').exists()).toBe(true)
  })

  it('backdrop has modal-backdrop class', () => {
    const wrapper = mount(AppModal, {
      props: { modelValue: true },
      slots: { default: '<p>content</p>' },
    })
    expect(wrapper.find('.modal-backdrop').exists()).toBe(true)
  })

  it('emits update:modelValue false when backdrop is clicked', async () => {
    const wrapper = mount(AppModal, {
      props: { modelValue: true },
      slots: { default: '<p>content</p>' },
    })
    await wrapper.find('.modal-backdrop').trigger('click')
    expect(wrapper.emitted('update:modelValue')).toBeTruthy()
    expect(wrapper.emitted('update:modelValue')![0]).toEqual([false])
  })

  it('renders title prop', () => {
    const wrapper = mount(AppModal, {
      props: { modelValue: true, title: 'My Title' },
      slots: { default: '<p>content</p>' },
    })
    expect(wrapper.text()).toContain('My Title')
  })

  it('#title slot overrides title prop', () => {
    const wrapper = mount(AppModal, {
      props: { modelValue: true, title: 'Prop Title' },
      slots: {
        default: '<p>content</p>',
        title: '<span class="custom-title">Slot Title</span>',
      },
    })
    expect(wrapper.find('.custom-title').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('Prop Title')
  })

  it('#footer slot content is rendered', () => {
    const wrapper = mount(AppModal, {
      props: { modelValue: true },
      slots: {
        default: '<p>content</p>',
        footer: '<button class="save-btn">Save</button>',
      },
    })
    expect(wrapper.find('.save-btn').exists()).toBe(true)
  })

  it('includes aria-hidden safe-area spacer for iOS home indicator', () => {
    const wrapper = mount(AppModal, {
      props: { modelValue: true },
      slots: { default: '<p>content</p>' },
    })
    expect(wrapper.find('[aria-hidden="true"]').exists()).toBe(true)
  })
})
