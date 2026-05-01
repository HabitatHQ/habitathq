import { defineWorkspace } from "vitest/config";

// biome-ignore lint/style/noDefaultExport: required by vitest workspace config
export default defineWorkspace([
  "./core/vitest.config.ts",
  "./sqlite-node/vitest.config.ts",
  "./react/vitest.config.ts",
  "./vue/vitest.config.ts",
  "./svelte/vitest.config.ts",
  "./kysely/vitest.config.ts",
  "./vite-plugin/vitest.config.ts",
]);
