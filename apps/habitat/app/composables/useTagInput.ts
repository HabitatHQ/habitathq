import { ref } from 'vue'
import { isReservedTag, normalizeTag } from '~/utils/tags'

/**
 * Shared tag management logic for any reactive string[] array.
 * Pass the array directly (from a reactive() object) — mutations are in-place.
 */
export function useTagInput(tags: string[]) {
  const tagInput = ref('')

  function addTag() {
    // Normalize (trim + lowercase) so tags are case-insensitively unique.
    const tag = normalizeTag(tagInput.value.replace(/,+$/, ''))
    if (tag && !isReservedTag(tag) && !tags.includes(tag)) tags.push(tag)
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
