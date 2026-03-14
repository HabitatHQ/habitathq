import { ref } from 'vue'

/**
 * Shared tag management logic for any reactive string[] array.
 * Pass the array directly (from a reactive() object) — mutations are in-place.
 */
export function useTagInput(tags: string[]) {
  const tagInput = ref('')

  function addTag() {
    const tag = tagInput.value.replace(/,+$/, '').trim()
    if (tag && !tag.startsWith('habitat-') && !tags.includes(tag)) tags.push(tag)
    tagInput.value = ''
  }

  function removeTag(tag: string) {
    const idx = tags.indexOf(tag)
    if (idx >= 0) tags.splice(idx, 1)
  }

  function onTagKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      addTag()
    }
  }

  return { tagInput, addTag, removeTag, onTagKeydown }
}
