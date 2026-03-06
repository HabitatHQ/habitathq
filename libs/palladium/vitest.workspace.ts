import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  "./packages/core/vitest.config.ts",
  "./packages/react/vitest.config.ts",
  "./packages/vue/vitest.config.ts",
  "./packages/svelte/vitest.config.ts",
  "./packages/kysely/vitest.config.ts",
  "./packages/vite-plugin/vitest.config.ts",
]);
