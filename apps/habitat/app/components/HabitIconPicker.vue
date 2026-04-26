<script setup lang="ts">
import { HABIT_PICKER_CATEGORIES, iconsByCategory } from '~/utils/icons'

const model = defineModel<string>({ required: true })
const props = defineProps<{
  color: string
}>()

const expanded = ref(false)

const grouped = computed(() => {
  const all = iconsByCategory()
  const result: {
    key: string
    label: string
    icons: Array<{ name: string; outline: string; label: string }>
  }[] = []
  for (const cat of HABIT_PICKER_CATEGORIES) {
    const icons = all[cat.key]
    if (icons?.length) {
      result.push({ key: cat.key, label: cat.label, icons })
    }
  }
  return result
})
</script>

<template>
  <div>
    <!-- Preview + toggle button -->
    <button
      type="button"
      class="flex items-center gap-3 w-full rounded-lg px-3 py-2 bg-(--ui-bg-elevated) border border-(--ui-border) hover:border-(--ui-border-accented) transition-colors"
      @click="expanded = !expanded"
    >
      <div
        class="w-9 h-9 rounded-full flex-shrink-0 flex items-center justify-center"
        :style="{ backgroundColor: props.color + '33' }"
      >
        <AppIcon :name="model" :color="props.color" class="w-5 h-5" />
      </div>
      <span class="text-sm text-(--ui-text-muted) flex-1 text-left">Choose icon</span>
      <AppIcon
        name="chevron-down"
        class="w-4 h-4 text-(--ui-text-dimmed) transition-transform"
        :class="expanded ? 'rotate-180' : ''"
      />
    </button>

    <!-- Expandable icon grid -->
    <div
      v-if="expanded"
      class="mt-2 rounded-lg border border-(--ui-border) bg-(--ui-bg-elevated) p-3 max-h-64 overflow-y-auto space-y-3"
    >
      <div v-for="cat in grouped" :key="cat.key">
        <p class="text-[10px] font-semibold uppercase tracking-wider text-(--ui-text-dimmed) mb-1.5">
          {{ cat.label }}
        </p>
        <div class="grid grid-cols-7 gap-1.5">
          <button
            v-for="icon in cat.icons"
            :key="icon.name"
            type="button"
            class="w-9 h-9 rounded-full flex items-center justify-center transition-all"
            :class="model === icon.name
              ? 'ring-1 ring-offset-1 ring-offset-(--ui-bg-elevated)'
              : 'hover:bg-(--ui-bg-accented)'"
            :style="model === icon.name
              ? { backgroundColor: props.color + '33', '--tw-ring-color': props.color }
              : undefined"
            :aria-label="icon.label"
            :aria-pressed="model === icon.name"
            @click="model = icon.name"
          >
            <AppIcon
              v-if="model === icon.name"
              :name="icon.name"
              class="w-5 h-5"
              :color="props.color"
            />
            <AppIcon
              v-else
              :name="icon.name"
              class="w-5 h-5"
            />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
