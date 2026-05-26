import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ConfirmDialog from '~/components/ConfirmDialog.vue'

const AppConfirmDialogStub = {
  name: 'AppConfirmDialog',
  props: ['modelValue', 'icon', 'iconColor', 'title', 'message', 'confirmLabel', 'confirmColor', 'cancelLabel'],
  emits: ['update:modelValue', 'confirm', 'cancel'],
  template: `
    <div v-if="modelValue">
      <p>{{ title }}</p>
      <p>{{ message }}</p>
      <button class="cancel-btn" @click="$emit('cancel')">{{ cancelLabel || 'Cancel' }}</button>
      <button class="confirm-btn" @click="$emit('confirm')">{{ confirmLabel || 'Confirm' }}</button>
    </div>
  `,
}

describe('ConfirmDialog', () => {
  const baseProps = {
    open: true,
    icon: 'i-lucide-trash-2',
    title: 'Delete item?',
    message: 'This cannot be undone.',
  }

  const stubs = { AppConfirmDialog: AppConfirmDialogStub, AppIcon: true, UButton: true }

  it('renders nothing when open is false', () => {
    const wrapper = mount(ConfirmDialog, {
      props: { ...baseProps, open: false },
      global: { stubs },
    })
    expect(wrapper.text()).toBe('')
  })

  it('renders title and message when open', () => {
    const wrapper = mount(ConfirmDialog, {
      props: baseProps,
      global: { stubs },
    })
    expect(wrapper.text()).toContain('Delete item?')
    expect(wrapper.text()).toContain('This cannot be undone.')
  })

  it('emits confirm when confirm button clicked', async () => {
    const wrapper = mount(ConfirmDialog, {
      props: baseProps,
      global: { stubs },
    })
    await wrapper.find('.confirm-btn').trigger('click')
    expect(wrapper.emitted('confirm')).toBeTruthy()
  })

  it('emits cancel when cancel button clicked', async () => {
    const wrapper = mount(ConfirmDialog, {
      props: baseProps,
      global: { stubs },
    })
    await wrapper.find('.cancel-btn').trigger('click')
    expect(wrapper.emitted('cancel')).toBeTruthy()
  })

  it('uses custom confirmLabel and cancelLabel when provided', () => {
    const wrapper = mount(ConfirmDialog, {
      props: { ...baseProps, confirmLabel: 'Delete', cancelLabel: 'Keep' },
      global: { stubs },
    })
    expect(wrapper.text()).toContain('Delete')
    expect(wrapper.text()).toContain('Keep')
  })
})
