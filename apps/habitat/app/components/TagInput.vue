<script setup lang="ts">
import type { RankedTag } from '~/composables/useTagSuggestions'
import { isReservedTag } from '~/utils/tags'

const props = withDefaults(
  defineProps<{
    modelValue: string[]
    suggest?: (input: string, selected: string[]) => RankedTag[]
    placeholder?: string
    maxSuggestions?: number
  }>(),
  { placeholder: 'Search or create tag…', maxSuggestions: 6 },
)

const emit = defineEmits<{
  'update:modelValue': [tags: string[]]
}>()

const input = ref('')
const focused = ref(false)
const dropdownOpen = ref(false)
const inputEl = ref<HTMLInputElement | null>()
const fieldEl = ref<HTMLDivElement | null>()
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
  reservedWarning.value = isReservedTag(v.trim())
  dropdownOpen.value = true
})

function updateDropdownPosition() {
  if (!fieldEl.value) return
  const rect = fieldEl.value.getBoundingClientRect()
  dropdownStyle.value = {
    position: 'fixed',
    top: `${rect.bottom + 4}px`,
    left: `${rect.left}px`,
    width: `${rect.width}px`,
  }
}

function commitTag(raw?: string) {
  const tag = (raw ?? input.value).replace(/,+$/, '').trim()
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
  inputEl.value?.focus()
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' || e.key === ',') {
    e.preventDefault()
    commitTag()
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
        :style="dropdownStyle"
        class="z-[60] bg-(--ui-bg) border border-(--ui-border)
               rounded-lg shadow-lg overflow-hidden"
      >
        <div
          v-if="reservedWarning"
          class="px-3 py-2 text-xs text-amber-500 flex items-center gap-1.5"
        >
          <AppIcon name="exclamation-triangle" class="w-4 h-4 shrink-0" />
          Reserved prefix — cannot use <code class="mx-0.5">habitat-*</code> tags
        </div>
        <button
          v-for="s in suggestions"
          :key="s.tag"
          type="button"
          class="w-full text-left px-3 py-1.5 text-sm transition-colors flex items-center gap-2
                 hover:bg-(--ui-bg-muted) active:bg-(--ui-bg-accented)"
          @mousedown.prevent="selectSuggestion(s)"
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
