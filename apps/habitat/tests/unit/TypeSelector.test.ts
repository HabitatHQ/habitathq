import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import TypeSelector from '~/components/TypeSelector.vue'

const OPTIONS = [
  { value: 'BOOLEAN', label: 'Yes/No' },
  { value: 'NUMERIC', label: 'Metric' },
  { value: 'LIMIT', label: 'Limit' },
]

describe('TypeSelector', () => {
  it('renders a button for each option', () => {
    const wrapper = mount(TypeSelector, {
      props: { modelValue: 'BOOLEAN', options: OPTIONS },
    })
    const buttons = wrapper.findAll('button')
    expect(buttons).toHaveLength(3)
    expect(buttons.map((b) => b.text())).toEqual(['Yes/No', 'Metric', 'Limit'])
  })

  it('marks the selected option with aria-pressed=true', () => {
    const wrapper = mount(TypeSelector, {
      props: { modelValue: 'NUMERIC', options: OPTIONS },
    })
    const buttons = wrapper.findAll('button')
    expect(buttons[1].attributes('aria-pressed')).toBe('true')
    expect(buttons[0].attributes('aria-pressed')).toBe('false')
  })

  it('emits update:modelValue when an option is clicked', async () => {
    const wrapper = mount(TypeSelector, {
      props: { modelValue: 'BOOLEAN', options: OPTIONS },
    })
    await wrapper.findAll('button')[2].trigger('click')
    const emitted = wrapper.emitted('update:modelValue')!
    expect(emitted[0][0]).toBe('LIMIT')
  })

  it('emits update:modelValue even when the already-selected option is clicked', async () => {
    const wrapper = mount(TypeSelector, {
      props: { modelValue: 'BOOLEAN', options: OPTIONS },
    })
    await wrapper.findAll('button')[0].trigger('click')
    // No de-duplication guard; parent can ignore same-value updates
    const emitted = wrapper.emitted('update:modelValue')!
    expect(emitted[0][0]).toBe('BOOLEAN')
  })

  it('does not allow the selection to change when disabled', async () => {
    const wrapper = mount(TypeSelector, {
      props: { modelValue: 'BOOLEAN', options: OPTIONS, disabled: true },
    })

    const buttons = wrapper.findAll('button')
    expect(buttons.every((button) => button.attributes('disabled') !== undefined)).toBe(true)

    await buttons[2].trigger('click')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })
})
