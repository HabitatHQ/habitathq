import { defineWorkspace } from "vitest/config";

// biome-ignore lint/style/noDefaultExport: required by vitest workspace config
export default defineWorkspace([
  "./packages/core/vitest.config.ts",
  "./packages/sqlite-node/vitest.config.ts",
  "./packages/react/vitest.config.ts",
  "./packages/vue/vitest.config.ts",
  "./packages/svelte/vitest.config.ts",
  "./packages/kysely/vitest.config.ts",
  "./packages/vite-plugin/vitest.config.ts",
]);
