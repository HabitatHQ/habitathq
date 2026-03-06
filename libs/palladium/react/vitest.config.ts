import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "@palladium/react",
    environment: "happy-dom",
    coverage: {
      provider: "v8",
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
