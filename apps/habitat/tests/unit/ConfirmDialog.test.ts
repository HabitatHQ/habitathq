import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ConfirmDialog from '~/components/ConfirmDialog.vue'

// Stub UModal to render its #content slot inline so we can inspect it
const UModalStub = {
  name: 'UModal',
  props: ['open'],
  template: '<div v-if="open"><slot name="content" /></div>',
}

describe('ConfirmDialog', () => {
  const baseProps = {
    open: true,
    icon: 'i-lucide-trash-2',
    title: 'Delete item?',
    message: 'This cannot be undone.',
  }

  it('renders nothing when open is false', () => {
    const wrapper = mount(ConfirmDialog, {
      props: { ...baseProps, open: false },
      global: { stubs: { UModal: UModalStub, AppIcon: true, UButton: true } },
    })
    expect(wrapper.text()).toBe('')
  })

  it('renders title and message when open', () => {
    const wrapper = mount(ConfirmDialog, {
      props: baseProps,
      global: { stubs: { UModal: UModalStub, AppIcon: true, UButton: true } },
    })
    expect(wrapper.text()).toContain('Delete item?')
    expect(wrapper.text()).toContain('This cannot be undone.')
  })

  it('emits confirm when confirm button clicked', async () => {
    const wrapper = mount(ConfirmDialog, {
      props: baseProps,
      global: {
        stubs: {
          UModal: UModalStub,
          AppIcon: true,
          UButton: {
            name: 'UButton',
            props: ['color'],
            template: '<button :data-color="color" @click="$emit(\'click\')"><slot /></button>',
            emits: ['click'],
          },
        },
      },
    })
    const buttons = wrapper.findAll('button')
    const confirmBtn = buttons.find((b) => b.text().includes('Confirm'))
    expect(confirmBtn).toBeDefined()
    await confirmBtn!.trigger('click')
    expect(wrapper.emitted('confirm')).toBeTruthy()
  })

  it('emits cancel when cancel button clicked', async () => {
    const wrapper = mount(ConfirmDialog, {
      props: baseProps,
      global: {
        stubs: {
          UModal: UModalStub,
          AppIcon: true,
          UButton: {
            name: 'UButton',
            props: ['color'],
            template: '<button :data-color="color" @click="$emit(\'click\')"><slot /></button>',
            emits: ['click'],
          },
        },
      },
    })
    const buttons = wrapper.findAll('button')
    const cancelBtn = buttons.find((b) => b.text().includes('Cancel'))
    expect(cancelBtn).toBeDefined()
    await cancelBtn!.trigger('click')
    expect(wrapper.emitted('cancel')).toBeTruthy()
  })

  it('uses custom confirmLabel and cancelLabel when provided', () => {
    const wrapper = mount(ConfirmDialog, {
      props: { ...baseProps, confirmLabel: 'Delete', cancelLabel: 'Keep' },
      global: {
        stubs: {
          UModal: UModalStub,
          AppIcon: true,
          UButton: {
            name: 'UButton',
            template: '<button @click="$emit(\'click\')"><slot /></button>',
            emits: ['click'],
          },
        },
      },
    })
    expect(wrapper.text()).toContain('Delete')
    expect(wrapper.text()).toContain('Keep')
  })
})
