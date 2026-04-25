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

onMounted(() => {
  if (props.dismissable) {
    dismissed.value = localStorage.getItem(`${STORAGE_PREFIX}${props.id}`) === '1'
  }
})

function dismiss() {
  dismissed.value = true
  localStorage.setItem(`${STORAGE_PREFIX}${props.id}`, '1')
}
</script>

<template>
  <aside v-if="!dismissed" :aria-label="`Help: ${id}`" class="group">
    <details :id="`help-${id}`">
      <summary
        class="inline-flex items-center gap-1.5 text-xs text-(--ui-text-dimmed) hover:text-(--ui-text-muted) transition-colors min-h-[32px] cursor-pointer list-none [&::-webkit-details-marker]:hidden"
      >
        <UIcon name="i-heroicons-question-mark-circle" class="w-3.5 h-3.5 shrink-0" />
        <span class="underline underline-offset-2 decoration-dotted">
          <slot name="label">What's this?</slot>
        </span>
      </summary>
      <div
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
    </details>
  </aside>
</template>
