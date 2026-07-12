<script setup lang="ts">
import type { RankedTag } from '~/composables/useTagSuggestions'
import { isReservedTag, normalizeTag } from '~/utils/tags'

const props = withDefaults(
  defineProps<{
    modelValue: string[]
    suggest?: (input: string, selected: string[]) => RankedTag[]
    placeholder?: string
    maxSuggestions?: number
  }>(),
  // Render a generous list; the dropdown scrolls (overflow-y: auto + computed
  // maxHeight) so more tags are reachable without crowding the viewport.
  { placeholder: 'Search or create tag…', maxSuggestions: 50 },
)

const emit = defineEmits<{
  'update:modelValue': [tags: string[]]
}>()

const input = ref('')
const focused = ref(false)
const dropdownOpen = ref(false)
const activeIndex = ref(-1)
const inputEl = ref<HTMLInputElement | null>()
const fieldEl = ref<HTMLDivElement | null>()
const panelEl = ref<HTMLDivElement | null>()
const reservedWarning = ref(false)

const dropdownStyle = ref<Record<string, string>>({})

const suggestions = computed(() => {
  if (!props.suggest) return []
  return props.suggest(input.value.trim(), props.modelValue).slice(0, props.maxSuggestions)
})

const showDropdown = computed(
  () => dropdownOpen.value && (suggestions.value.length > 0 || reservedWarning.value),
)

watch(input, (v) => {
  reservedWarning.value = isReservedTag(normalizeTag(v))
  dropdownOpen.value = true
  // Reset highlight when the candidate list changes under the cursor.
  activeIndex.value = -1
})

// Keep the highlighted index in bounds as suggestions shrink, and reposition
// the panel — its height changes with the list, which matters when it's placed
// above the field (top is derived from panel height, so it would otherwise drift).
watch(suggestions, (list) => {
  if (activeIndex.value >= list.length) activeIndex.value = list.length - 1
  if (showDropdown.value) nextTick(updateDropdownPosition)
})

// Reposition the teleported dropdown whenever it's open and the field moves
// (e.g. scrolling inside a modal, or the iOS keyboard showing/hiding) so it
// never detaches from the field or hides behind the soft keyboard.
watch(showDropdown, (open) => {
  if (open) {
    nextTick(updateDropdownPosition)
    window.addEventListener('scroll', updateDropdownPosition, true)
    window.addEventListener('resize', updateDropdownPosition)
    // visualViewport fires resize/scroll when the iOS keyboard appears.
    window.visualViewport?.addEventListener('resize', updateDropdownPosition)
    window.visualViewport?.addEventListener('scroll', updateDropdownPosition)
  } else {
    teardownPositionListeners()
  }
})

function teardownPositionListeners() {
  window.removeEventListener('scroll', updateDropdownPosition, true)
  window.removeEventListener('resize', updateDropdownPosition)
  window.visualViewport?.removeEventListener('resize', updateDropdownPosition)
  window.visualViewport?.removeEventListener('scroll', updateDropdownPosition)
}

onBeforeUnmount(teardownPositionListeners)

const GAP = 4 // px between field and panel
const VIEWPORT_MARGIN = 8 // px breathing room from the viewport edge

function updateDropdownPosition() {
  if (!fieldEl.value) return
  const rect = fieldEl.value.getBoundingClientRect()

  // Use the visual viewport (the area NOT covered by the iOS keyboard) so the
  // panel is always placed within the visible region. getBoundingClientRect and
  // `position: fixed` top share this coordinate space, so we only ever set top.
  const vv = window.visualViewport
  const viewTop = vv?.offsetTop ?? 0
  const viewBottom = viewTop + (vv?.height ?? window.innerHeight)

  const spaceBelow = viewBottom - rect.bottom - GAP - VIEWPORT_MARGIN
  const spaceAbove = rect.top - viewTop - GAP - VIEWPORT_MARGIN

  // Flip above the field when below is cramped (e.g. keyboard up) but above isn't.
  const placeAbove = spaceBelow < 160 && spaceAbove > spaceBelow
  // Fit the available space on the chosen side (never force a taller panel that
  // would extend behind the keyboard or off-screen); the panel scrolls instead.
  const maxHeight = Math.max(0, Math.floor(placeAbove ? spaceAbove : spaceBelow))

  let top: number
  if (placeAbove) {
    const panelH = Math.min(panelEl.value?.offsetHeight ?? maxHeight, maxHeight)
    top = rect.top - GAP - panelH
  } else {
    top = rect.bottom + GAP
  }

  dropdownStyle.value = {
    position: 'fixed',
    left: `${rect.left}px`,
    top: `${top}px`,
    width: `${rect.width}px`,
    maxHeight: `${maxHeight}px`,
    overflowY: 'auto',
  }
}

function commitTag(raw?: string) {
  // Normalize (trim + lowercase) so tags are case-insensitively unique.
  const tag = normalizeTag((raw ?? input.value).replace(/,+$/, ''))
  if (!tag || isReservedTag(tag)) return
  if (props.modelValue.includes(tag)) {
    input.value = ''
    return
  }
  emit('update:modelValue', [...props.modelValue, tag])
  input.value = ''
}

function removeTag(tag: string) {
  emit(
    'update:modelValue',
    props.modelValue.filter((t) => t !== tag),
  )
}

function selectSuggestion(ranked: RankedTag) {
  commitTag(ranked.tag)
  activeIndex.value = -1
  inputEl.value?.focus()
}

function onKeydown(e: KeyboardEvent) {
  const list = suggestions.value
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    dropdownOpen.value = true
    if (list.length) activeIndex.value = (activeIndex.value + 1) % list.length
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    dropdownOpen.value = true
    // From no selection (-1) or the first item, wrap to the last suggestion.
    if (list.length) {
      activeIndex.value = activeIndex.value <= 0 ? list.length - 1 : activeIndex.value - 1
    }
  } else if (e.key === 'Enter' || e.key === ',') {
    e.preventDefault()
    const active = activeIndex.value >= 0 ? list[activeIndex.value] : undefined
    if (active) selectSuggestion(active)
    else commitTag()
  } else if (e.key === 'Escape') {
    if (dropdownOpen.value) {
      e.preventDefault()
      // Stop the enclosing modal/bottom-sheet from also closing on Escape.
      e.stopPropagation()
      dropdownOpen.value = false
      activeIndex.value = -1
    }
  } else if (e.key === 'Backspace' && !input.value && props.modelValue.length > 0) {
    const last = props.modelValue[props.modelValue.length - 1]
    if (last) removeTag(last)
  }
}

function onFocus() {
  focused.value = true
  dropdownOpen.value = true
  updateDropdownPosition()
}

function onBlur() {
  if (input.value.trim()) commitTag()
  setTimeout(() => {
    focused.value = false
    dropdownOpen.value = false
    activeIndex.value = -1
  }, 150)
}

function toggleDropdown() {
  if (dropdownOpen.value) {
    dropdownOpen.value = false
  } else {
    inputEl.value?.focus()
    dropdownOpen.value = true
    updateDropdownPosition()
  }
}

function focusInput() {
  inputEl.value?.focus()
}
</script>

<template>
  <div>
    <!-- Field -->
    <div
      ref="fieldEl"
      class="flex items-center gap-1 min-h-[44px] rounded-lg cursor-text
             bg-(--ui-bg-elevated) border transition-colors"
      :class="focused
        ? 'border-(--ui-border-accented)'
        : 'border-(--ui-border) hover:border-(--ui-border-accented)'"
      @click="focusInput"
    >
      <div class="flex flex-wrap items-center gap-1.5 flex-1 min-w-0 px-2.5 py-1.5">
        <span
          v-for="tag in modelValue"
          :key="tag"
          class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs
                 bg-primary-600/15 text-primary-400 group"
        >
          {{ tag }}
          <button
            type="button"
            class="opacity-50 group-hover:opacity-100 hover:text-primary-300 transition-opacity leading-none"
            @click.stop="removeTag(tag)"
          >&times;</button>
        </span>
        <input
          ref="inputEl"
          v-model="input"
          :placeholder="modelValue.length > 0 ? '+' : placeholder"
          class="flex-1 min-w-[80px] bg-transparent text-sm text-(--ui-text)
                 placeholder:text-(--ui-text-dimmed) outline-none border-0"
          @keydown="onKeydown"
          @blur="onBlur"
          @focus="onFocus"
        />
      </div>
      <button
        type="button"
        tabindex="-1"
        class="shrink-0 w-8 h-8 flex items-center justify-center text-(--ui-text-dimmed)
               hover:text-(--ui-text-muted) transition-colors"
        @mousedown.prevent="toggleDropdown"
      >
        <AppIcon
          :name="dropdownOpen ? 'chevron-up' : 'chevron-down'"
          class="w-4 h-4"
        />
      </button>
    </div>

    <!-- Dropdown — teleported to body so it overlays modals without causing scroll -->
    <Teleport to="body">
      <div
        v-if="showDropdown"
        ref="panelEl"
        :style="dropdownStyle"
        class="z-[60] bg-(--ui-bg) border border-(--ui-border)
               rounded-lg shadow-lg overscroll-contain"
      >
        <div
          v-if="reservedWarning"
          class="px-3 py-2 text-xs text-amber-500 flex items-center gap-1.5"
        >
          <AppIcon name="exclamation-triangle" class="w-4 h-4 shrink-0" />
          Reserved prefix — cannot use <code class="mx-0.5">habitat-*</code> tags
        </div>
        <button
          v-for="(s, i) in suggestions"
          :key="s.tag"
          type="button"
          class="w-full text-left px-3 py-1.5 text-sm transition-colors flex items-center gap-2
                 active:bg-(--ui-bg-accented)"
          :class="i === activeIndex ? 'bg-(--ui-bg-accented)' : 'hover:bg-(--ui-bg-muted)'"
          @mousedown.prevent="selectSuggestion(s)"
          @mousemove="activeIndex = i"
        >
          <span class="text-primary-400/60 text-xs">#</span>
          <span class="text-(--ui-text-toned) flex-1">{{ s.tag }}</span>
          <span
            v-if="s.score >= 1"
            class="text-[10px] text-(--ui-text-dimmed) type-numeric"
          >{{ Math.round(s.score) }}x</span>
        </button>
      </div>
    </Teleport>
  </div>
</template>
