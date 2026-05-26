<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    /** Icon registry name or raw iconify class */
    icon: string
    /** Required accessible label — enforces a11y at usage site */
    label: string
    /** Visual icon size (touch target is always 44px) */
    size?: 'sm' | 'md'
    /** Color applied to the icon */
    color?: string
    /** Button variant */
    variant?: 'ghost' | 'soft'
    /** Disabled state */
    disabled?: boolean
  }>(),
  {
    size: 'md',
    variant: 'ghost',
    disabled: false,
  },
)

const emit = defineEmits<{
  click: [event: MouseEvent]
}>()

const { selectionChanged } = useHaptics()

const iconSize = computed(() => (props.size === 'sm' ? 'w-4 h-4' : 'w-5 h-5'))

const variantClass = computed(() => {
  if (props.variant === 'soft') {
    return 'hover:bg-(--ui-bg-elevated)'
  }
  return 'hover:bg-(--ui-bg-elevated)/50'
})
</script>

<template>
  <button
    type="button"
    class="icon-btn text-(--ui-text-muted)"
    :class="[variantClass, { 'opacity-50 pointer-events-none': disabled }]"
    :aria-label="label"
    :disabled="disabled"
    @click="selectionChanged(); emit('click', $event)"
  >
    <AppIcon :name="icon" :color="color" :class="iconSize" />
  </button>
</template>
