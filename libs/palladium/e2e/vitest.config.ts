import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "@palladium/e2e",
    // Quint replay is opt-in via test:model, not part of the CI E2E suite.
    exclude: [...configDefaults.exclude, "src/__tests__/quint-delivery.test.ts"],
    environment: "node",
    globalSetup: "./src/setup/server.ts",
    testTimeout: 30_000,
    hookTimeout: 120_000,
    // Sequential: each test mutates a shared live server.
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
  },
});
