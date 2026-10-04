<script setup lang="ts">
withDefaults(
  defineProps<{
    busy?: boolean
    error?: Error | string | null
    success?: boolean
    busyLabel?: string
    successLabel?: string
    errorLabel?: string
  }>(),
  {
    busy: false,
    error: null,
    success: false,
    busyLabel: 'Working…',
    successLabel: 'Complete',
    errorLabel: 'Operation failed',
  },
)
</script>

<template>
  <div aria-live="polite" aria-atomic="true" :aria-busy="busy || undefined">
    <slot v-if="busy" name="busy">{{ busyLabel }}</slot>
    <p v-else-if="error" role="alert">
      <slot name="error" :error="error">
        {{ errorLabel }}<template v-if="typeof error !== 'string' || error">: {{ typeof error === 'string' ? error : error.message }}</template>
      </slot>
    </p>
    <slot v-else-if="success" name="success">{{ successLabel }}</slot>
  </div>
</template>
