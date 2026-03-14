import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import DayPicker from '~/components/DayPicker.vue'

const LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

describe('DayPicker', () => {
  it('renders a button for each label', () => {
    const wrapper = mount(DayPicker, {
      props: { modelValue: [], labels: LABELS },
    })
    const buttons = wrapper.findAll('button')
    expect(buttons).toHaveLength(7)
    expect(buttons.map((b) => b.text())).toEqual(LABELS)
  })

  it('marks selected days with aria-pressed=true', () => {
    const wrapper = mount(DayPicker, {
      props: { modelValue: [1, 3], labels: LABELS },
    })
    const buttons = wrapper.findAll('button')
    expect(buttons[1].attributes('aria-pressed')).toBe('true')
    expect(buttons[3].attributes('aria-pressed')).toBe('true')
    expect(buttons[0].attributes('aria-pressed')).toBe('false')
  })

  it('emits update:modelValue with day added when unselected day clicked', async () => {
    const wrapper = mount(DayPicker, {
      props: { modelValue: [1], labels: LABELS },
    })
    await wrapper.findAll('button')[3].trigger('click')
    const emitted = wrapper.emitted('update:modelValue')!
    expect(emitted).toBeTruthy()
    expect(emitted[0][0]).toEqual([1, 3])
  })

  it('emits update:modelValue with day removed when selected day clicked', async () => {
    const wrapper = mount(DayPicker, {
      props: { modelValue: [1, 3], labels: LABELS },
    })
    await wrapper.findAll('button')[1].trigger('click')
    const emitted = wrapper.emitted('update:modelValue')!
    expect(emitted[0][0]).toEqual([3])
  })

  it('emitted array is sorted ascending', async () => {
    const wrapper = mount(DayPicker, {
      props: { modelValue: [5], labels: LABELS },
    })
    await wrapper.findAll('button')[2].trigger('click')
    const emitted = wrapper.emitted('update:modelValue')!
    expect(emitted[0][0]).toEqual([2, 5])
  })
})
