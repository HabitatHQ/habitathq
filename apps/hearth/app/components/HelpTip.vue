<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    /** Unique key for persisting dismissed state in localStorage */
    id: string
    /** Whether the tip can be permanently dismissed */
    dismissable?: boolean
  }>(),
  { dismissable: true },
)

const STORAGE_PREFIX = 'hearth-help-dismissed:'

const dismissed = ref(false)
const expanded = ref(false)

onMounted(() => {
  if (props.dismissable) {
    dismissed.value = localStorage.getItem(`${STORAGE_PREFIX}${props.id}`) === '1'
  }
})

function dismiss() {
  dismissed.value = true
  expanded.value = false
  localStorage.setItem(`${STORAGE_PREFIX}${props.id}`, '1')
}

function toggle() {
  expanded.value = !expanded.value
}
</script>

<template>
  <div v-if="!dismissed" class="group">
    <button
      type="button"
      class="inline-flex items-center gap-1.5 text-xs text-(--ui-text-dimmed) hover:text-(--ui-text-muted) transition-colors min-h-[32px]"
      :aria-expanded="expanded"
      :aria-controls="`help-${id}`"
      @click="toggle"
    >
      <UIcon
        :name="expanded ? 'i-heroicons-x-mark' : 'i-heroicons-question-mark-circle'"
        class="w-3.5 h-3.5 shrink-0"
      />
      <span v-if="!expanded" class="underline underline-offset-2 decoration-dotted">
        <slot name="label">What's this?</slot>
      </span>
      <span v-else>Close</span>
    </button>
    <div
      v-if="expanded"
      :id="`help-${id}`"
      class="mt-2 px-3 py-2.5 rounded-xl bg-(--ui-bg-elevated) border border-(--ui-border) text-xs text-(--ui-text-muted) leading-relaxed space-y-2"
    >
      <slot />
      <button
        v-if="dismissable"
        type="button"
        class="block text-[10px] text-(--ui-text-dimmed) hover:text-(--ui-text-muted) underline underline-offset-2 mt-1"
        @click="dismiss"
      >
        Don't show again
      </button>
    </div>
  </div>
</template>
