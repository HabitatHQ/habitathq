<script setup lang="ts">
const props = defineProps<{
  label: string
  openLabel?: string
  defaultOpen?: boolean
}>()

const open = ref(props.defaultOpen ?? false)

const buttonLabel = computed(() => (open.value && props.openLabel ? props.openLabel : props.label))
</script>

<template>
  <div>
    <button
      type="button"
      class="text-xs text-(--ui-text-dimmed) hover:text-(--ui-text-muted) flex items-center gap-1.5 transition-colors"
      @click="open = !open"
    >
      <UIcon
        :name="open ? 'i-heroicons-chevron-down' : 'i-heroicons-chevron-right'"
        class="w-3.5 h-3.5"
      />
      {{ buttonLabel }}
    </button>
    <div v-if="open" class="mt-2">
      <slot />
    </div>
  </div>
</template>
