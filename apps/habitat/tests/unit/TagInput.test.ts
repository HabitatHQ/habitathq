import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import TagInput from '~/components/TagInput.vue'

describe('TagInput', () => {
  it('keeps explicitly locked tags while allowing other tags to be removed', async () => {
    const wrapper = mount(TagInput, {
      props: {
        modelValue: ['calendar-note', 'work'],
        lockedTags: ['calendar-note'],
      },
      global: {
        stubs: { AppIcon: true, Teleport: true },
      },
    })

    expect(wrapper.find('[aria-label="Calendar note tag is managed by Calendar"]').exists()).toBe(true)
    expect(wrapper.find('[aria-label="Remove calendar-note tag"]').exists()).toBe(false)

    await wrapper.get('[aria-label="Remove work tag"]').trigger('click')
    expect(wrapper.emitted('update:modelValue')).toEqual([[['calendar-note']]])
  })
})
