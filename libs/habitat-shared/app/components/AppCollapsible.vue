<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    label: string
    openLabel?: string
    defaultOpen?: boolean
  }>(),
  {
    defaultOpen: false,
  },
)

const modelValue = defineModel<boolean>()
const internalOpen = ref(props.defaultOpen)

const isOpen = computed({
  get: () => modelValue.value ?? internalOpen.value,
  set: (val: boolean) => {
    if (modelValue.value !== undefined) {
      modelValue.value = val
    }
    internalOpen.value = val
  },
})

const buttonLabel = computed(() =>
  isOpen.value && props.openLabel ? props.openLabel : props.label,
)

function toggle() {
  isOpen.value = !isOpen.value
}
</script>

<template>
  <div>
    <button
      type="button"
      class="min-h-[44px] text-xs text-(--ui-text-dimmed) hover:text-(--ui-text-muted) flex items-center gap-1.5 transition-colors"
      :aria-expanded="isOpen"
      @click="toggle"
    >
      <AppIcon
        :name="isOpen ? 'chevron-down' : 'chevron-right'"
        class="w-3.5 h-3.5 transition-transform"
      />
      {{ buttonLabel }}
    </button>
    <div
      class="collapsible-grid"
      :data-open="isOpen || undefined"
    >
      <div>
        <div class="pt-2">
          <slot />
        </div>
      </div>
    </div>
  </div>
</template>
