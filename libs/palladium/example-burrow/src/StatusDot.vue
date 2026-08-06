<script setup lang="ts">
import type { PalladiumEngine } from "@palladium/core";
import { useSyncStatus } from "@palladium/vue";
import type { BurrowSchema } from "./schema.js";

const props = defineProps<{ engine: PalladiumEngine<BurrowSchema> }>();
const status = useSyncStatus(props.engine);
</script>

<template>
  <span class="dot" :class="status" :title="`sync: ${status}`"></span>
</template>

<style scoped>
.dot {
  width: 11px;
  height: 11px;
  border-radius: 50%;
  background: #556;
  display: inline-block;
}
.dot.idle {
  background: #35c46a;
}
.dot.syncing {
  background: #f0b429;
  animation: pulse 0.9s infinite;
}
.dot.error {
  background: #e5484d;
}
.dot.offline {
  background: #5b6472;
}
@keyframes pulse {
  50% {
    opacity: 0.35;
  }
}
</style>
