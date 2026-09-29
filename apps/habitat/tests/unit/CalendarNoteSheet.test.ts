import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { isProxy, reactive } from 'vue'

vi.mock('~/composables/useTagSuggestions', () => ({
  useTagSuggestions: () => ({ loadTags: async () => {}, suggest: () => [] }),
}))

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
  TagInput: {
    props: ['modelValue', 'lockedTags'],
    emits: ['update:modelValue'],
    template: '<button data-testid="tag-input" :data-locked="lockedTags.join(\',\')" @click="$emit(\'update:modelValue\', [\'calendar-note\', \'personal\'])" />',
  },
  UFormField: { template: '<div><slot /></div>' },
  UButton: { template: '<button @click="$emit(\'click\')"><slot /></button>' },
}
const global = {
  stubs,
  mocks: {
    resolveIcon: (name: string) => name,
  },
}

function buttonByText(wrapper: ReturnType<typeof mount>, text: string) {
  return wrapper.findAll('button').find((button) => button.text() === text)!
}

describe('CalendarNoteSheet', () => {
  it('creates a calendar-tagged note for the selected day', async () => {
    const wrapper = mount(CalendarNoteSheet, {
      props: { open: true, note: null, entryDate: '2026-09-28' },
      global,
    })

    await wrapper.findAll('input')[0]!.setValue('Today')
    await wrapper.find('textarea').setValue('Finish the proposal')
    await buttonByText(wrapper, 'Add note').trigger('click')

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

  it('edits ordinary tags while preserving the Calendar-managed tag and date', async () => {
    const note = reactive({
      id: 'note-1', title: 'Review', content: 'Details', entry_date: '2026-09-27',
      tags: [CALENDAR_NOTE_TAG, 'work'], annotations: { source: 'calendar' },
      created_at: '2026-09-27T10:00:00Z', updated_at: '2026-09-27T10:00:00Z',
    })
    const wrapper = mount(CalendarNoteSheet, {
      props: { open: true, note, entryDate: '2026-09-28' },
      global,
    })

    const tagInput = wrapper.get('[data-testid="tag-input"]')
    expect(tagInput.attributes('data-locked')).toBe(CALENDAR_NOTE_TAG)
    await tagInput.trigger('click')

    await buttonByText(wrapper, 'Save changes').trigger('click')
    expect(wrapper.emitted('save')![0]?.[0]).toMatchObject({
      tags: [CALENDAR_NOTE_TAG, 'personal'],
      annotations: { source: 'calendar' },
      entry_date: '2026-09-27',
    })
    expect(isProxy(wrapper.emitted('save')![0]?.[0].annotations)).toBe(false)
  })
})
