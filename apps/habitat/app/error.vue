<script setup lang="ts">
import type { NuxtError } from '#app'

defineProps<{ error: NuxtError }>()

function reload() {
  clearError({ redirect: '/' })
}
</script>

<template>
  <div class="min-h-[100dvh] flex items-center justify-center bg-(--ui-bg) text-(--ui-text) px-6">
    <div class="flex flex-col items-center gap-6 text-center max-w-sm">
      <div class="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center">
        <svg class="w-8 h-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
        </svg>
      </div>
      <div class="space-y-2">
        <h1 class="text-2xl font-bold">Something went wrong</h1>
        <p class="text-sm text-(--ui-text-dimmed)">
          {{ error.statusMessage || 'An unexpected error occurred.' }}
        </p>
      </div>
      <button
        class="px-8 py-3 rounded-2xl bg-primary-500 text-white font-semibold shadow-lg shadow-primary-500/25 hover:bg-primary-600 transition-colors min-h-[44px]"
        @click="reload"
      >
        Reload
      </button>
    </div>
  </div>
</template>
