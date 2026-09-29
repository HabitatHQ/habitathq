import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import CalendarNoteSheet from '~/components/CalendarNoteSheet.vue'
import { CALENDAR_NOTE_TAG } from '~/utils/jots-helpers'

const AppBottomSheetStub = {
  props: ['modelValue'],
  template: '<div v-if="modelValue"><slot name="title" /><slot /><slot name="footer" /></div>',
}
const AppTextFieldStub = {
  props: ['modelValue'],
  emits: ['update:modelValue'],
  template: '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
}
const AppTextAreaStub = {
  props: ['modelValue'],
  emits: ['update:modelValue'],
  template: '<textarea :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
}
const stubs = {
  AppBottomSheet: AppBottomSheetStub,
  AppTextField: AppTextFieldStub,
  AppTextArea: AppTextAreaStub,
  UFormField: { template: '<div><slot /></div>' },
  UButton: { template: '<button @click="$emit(\'click\')"><slot /></button>' },
}
const global = { stubs, mocks: { resolveIcon: (name: string) => name } }

describe('CalendarNoteSheet', () => {
  it('creates a calendar-tagged note for the selected day', async () => {
    const wrapper = mount(CalendarNoteSheet, {
      props: { open: true, note: null, entryDate: '2026-09-28' },
      global,
    })

    await wrapper.findAll('input')[0]!.setValue('Today')
    await wrapper.find('textarea').setValue('Finish the proposal')
    await wrapper.findAll('button')[1]!.trigger('click')

    expect(wrapper.emitted('save')![0]).toEqual([
      {
        title: 'Today',
        content: 'Finish the proposal',
        entry_date: '2026-09-28',
        tags: [CALENDAR_NOTE_TAG],
        annotations: {},
      },
    ])
  })

  it('preserves an existing note’s metadata and offers full editing in Jots', async () => {
    const note = {
      id: 'note-1', title: 'Review', content: 'Details', entry_date: '2026-09-27',
      tags: ['work'], annotations: { source: 'calendar' },
      created_at: '2026-09-27T10:00:00Z', updated_at: '2026-09-27T10:00:00Z',
    }
    const wrapper = mount(CalendarNoteSheet, {
      props: { open: true, note, entryDate: '2026-09-28' },
      global,
    })

    await wrapper.findAll('button')[2]!.trigger('click')
    expect(wrapper.emitted('save')![0]?.[0]).toMatchObject({
      tags: ['work'],
      annotations: { source: 'calendar' },
      entry_date: '2026-09-27',
    })

    await wrapper.findAll('button')[0]!.trigger('click')
    expect(wrapper.emitted('openInJots')![0]).toEqual([note])
  })
})
