import { defineConfig } from "vitest/config";

// biome-ignore lint/style/noDefaultExport: required by vitest config
export default defineConfig({
  test: {
    name: "@palladium/notifications-core",
    environment: "happy-dom",
    exclude: ["src/__tests__/integration/**"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/__tests__/**", "src/index.ts"],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
});
