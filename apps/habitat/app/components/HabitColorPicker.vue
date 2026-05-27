<script setup lang="ts">
const model = defineModel<string>({ required: true })
</script>

<template>
  <div class="flex flex-wrap gap-2">
    <button
      v-for="color in HABIT_COLORS"
      :key="color.value"
      type="button"
      class="w-7 h-7 rounded-full flex items-center justify-center transition-all"
      :class="model === color.value ? 'ring-2 ring-offset-2 ring-offset-(--ui-bg) scale-110' : 'hover:scale-110'"
      :style="{ backgroundColor: color.value, '--tw-ring-color': color.value }"
      :aria-label="color.label"
      :aria-pressed="model === color.value"
      @click="model = color.value"
    >
      <AppIcon
        v-if="model === color.value"
        name="check"
        class="w-4 h-4 text-white drop-shadow-sm"
      />
    </button>
  </div>
</template>
