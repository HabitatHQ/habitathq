import { describe, it, expect, vi } from 'vitest'
import { reactive } from 'vue'
import { useTagInput } from '~/composables/useTagInput'

describe('useTagInput', () => {
  it('adds a trimmed tag and clears the input', () => {
    const tags = reactive<string[]>([])
    const { tagInput, addTag } = useTagInput(tags)
    tagInput.value = '  hello  '
    addTag()
    expect(tags).toEqual(['hello'])
    expect(tagInput.value).toBe('')
  })

  it('strips trailing comma before adding', () => {
    const tags = reactive<string[]>([])
    const { tagInput, addTag } = useTagInput(tags)
    tagInput.value = 'world,'
    addTag()
    expect(tags).toEqual(['world'])
  })

  it('strips multiple trailing commas', () => {
    const tags = reactive<string[]>([])
    const { tagInput, addTag } = useTagInput(tags)
    tagInput.value = 'foo,,'
    addTag()
    expect(tags).toEqual(['foo'])
  })

  it('does not add empty tag', () => {
    const tags = reactive<string[]>([])
    const { tagInput, addTag } = useTagInput(tags)
    tagInput.value = '   '
    addTag()
    expect(tags).toHaveLength(0)
  })

  it('does not add duplicate tags', () => {
    const tags = reactive<string[]>(['existing'])
    const { tagInput, addTag } = useTagInput(tags)
    tagInput.value = 'existing'
    addTag()
    expect(tags).toEqual(['existing'])
  })

  it('does not add habitat-* prefixed tags', () => {
    const tags = reactive<string[]>([])
    const { tagInput, addTag } = useTagInput(tags)
    tagInput.value = 'habitat-internal'
    addTag()
    expect(tags).toHaveLength(0)
  })

  it('removeTag removes an existing tag', () => {
    const tags = reactive<string[]>(['a', 'b', 'c'])
    const { removeTag } = useTagInput(tags)
    removeTag('b')
    expect(tags).toEqual(['a', 'c'])
  })

  it('removeTag is a no-op for missing tag', () => {
    const tags = reactive<string[]>(['a', 'b'])
    const { removeTag } = useTagInput(tags)
    removeTag('z')
    expect(tags).toEqual(['a', 'b'])
  })

  it('onTagKeydown Enter calls addTag and prevents default', () => {
    const tags = reactive<string[]>([])
    const { tagInput, onTagKeydown } = useTagInput(tags)
    tagInput.value = 'enter-tag'
    const e = { key: 'Enter', preventDefault: vi.fn() } as unknown as KeyboardEvent
    onTagKeydown(e)
    expect(e.preventDefault).toHaveBeenCalled()
    expect(tags).toEqual(['enter-tag'])
  })

  it('onTagKeydown comma calls addTag and prevents default', () => {
    const tags = reactive<string[]>([])
    const { tagInput, onTagKeydown } = useTagInput(tags)
    tagInput.value = 'comma-tag'
    const e = { key: ',', preventDefault: vi.fn() } as unknown as KeyboardEvent
    onTagKeydown(e)
    expect(e.preventDefault).toHaveBeenCalled()
    expect(tags).toEqual(['comma-tag'])
  })

  it('onTagKeydown other keys do nothing', () => {
    const tags = reactive<string[]>([])
    const { tagInput, onTagKeydown } = useTagInput(tags)
    tagInput.value = 'typed'
    const e = { key: 'a', preventDefault: vi.fn() } as unknown as KeyboardEvent
    onTagKeydown(e)
    expect(e.preventDefault).not.toHaveBeenCalled()
    expect(tags).toHaveLength(0)
  })
})
