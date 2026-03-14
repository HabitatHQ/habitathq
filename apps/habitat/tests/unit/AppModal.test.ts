import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import AppModal from '~/components/AppModal.vue'

describe('AppModal', () => {
  it('renders nothing when open is false', () => {
    const wrapper = mount(AppModal, {
      props: { open: false },
      slots: { default: '<p class="content">hello</p>' },
    })
    expect(wrapper.find('.content').exists()).toBe(false)
  })

  it('renders slot content when open is true', () => {
    const wrapper = mount(AppModal, {
      props: { open: true },
      slots: { default: '<p class="content">hello</p>' },
    })
    expect(wrapper.find('.content').exists()).toBe(true)
  })

  it('backdrop has modal-backdrop class', () => {
    const wrapper = mount(AppModal, {
      props: { open: true },
      slots: { default: '<p>content</p>' },
    })
    expect(wrapper.find('.modal-backdrop').exists()).toBe(true)
  })

  it('emits close when backdrop is clicked', async () => {
    const wrapper = mount(AppModal, {
      props: { open: true },
      slots: { default: '<p>content</p>' },
    })
    await wrapper.find('.modal-backdrop').trigger('click')
    expect(wrapper.emitted('close')).toBeTruthy()
  })

  it('includes aria-hidden safe-area spacer for iOS home indicator', () => {
    const wrapper = mount(AppModal, {
      props: { open: true },
      slots: { default: '<p>content</p>' },
    })
    // The spacer is identified by aria-hidden, not an internal CSS class name
    expect(wrapper.find('[aria-hidden="true"]').exists()).toBe(true)
  })
})
