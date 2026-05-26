import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import AppModal from '~/components/AppModal.vue'

const AppBottomSheetStub = {
  name: 'AppBottomSheet',
  props: ['modelValue', 'title', 'closeable'],
  emits: ['update:modelValue'],
  template: `
    <div v-if="modelValue">
      <div class="modal-backdrop" @click="$emit('update:modelValue', false)" />
      <div>
        <slot name="title"><h2 v-if="title">{{ title }}</h2></slot>
        <slot />
        <slot name="footer" />
        <div aria-hidden="true" />
      </div>
    </div>
  `,
}

describe('AppModal', () => {
  const stubs = { AppBottomSheet: AppBottomSheetStub, AppIcon: true }

  it('renders nothing when modelValue is false', () => {
    const wrapper = mount(AppModal, {
      props: { modelValue: false },
      slots: { default: '<p class="content">hello</p>' },
      global: { stubs },
    })
    expect(wrapper.find('.content').exists()).toBe(false)
  })

  it('renders slot content when modelValue is true', () => {
    const wrapper = mount(AppModal, {
      props: { modelValue: true },
      slots: { default: '<p class="content">hello</p>' },
      global: { stubs },
    })
    expect(wrapper.find('.content').exists()).toBe(true)
  })

  it('backdrop has modal-backdrop class', () => {
    const wrapper = mount(AppModal, {
      props: { modelValue: true },
      slots: { default: '<p>content</p>' },
      global: { stubs },
    })
    expect(wrapper.find('.modal-backdrop').exists()).toBe(true)
  })

  it('emits update:modelValue false when backdrop is clicked', async () => {
    const wrapper = mount(AppModal, {
      props: { modelValue: true },
      slots: { default: '<p>content</p>' },
      global: { stubs },
    })
    await wrapper.find('.modal-backdrop').trigger('click')
    expect(wrapper.emitted('update:modelValue')).toBeTruthy()
    expect(wrapper.emitted('update:modelValue')![0]).toEqual([false])
  })

  it('renders title prop', () => {
    const wrapper = mount(AppModal, {
      props: { modelValue: true, title: 'My Title' },
      slots: { default: '<p>content</p>' },
      global: { stubs },
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
      global: { stubs },
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
      global: { stubs },
    })
    expect(wrapper.find('.save-btn').exists()).toBe(true)
  })

  it('includes aria-hidden safe-area spacer for iOS home indicator', () => {
    const wrapper = mount(AppModal, {
      props: { modelValue: true },
      slots: { default: '<p>content</p>' },
      global: { stubs },
    })
    expect(wrapper.find('[aria-hidden="true"]').exists()).toBe(true)
  })
})
