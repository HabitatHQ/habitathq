import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "@palladium/e2e",
    environment: "node",
    globalSetup: "./src/setup/server.ts",
    testTimeout: 30_000,
    hookTimeout: 120_000,
    // Sequential: each test mutates a shared live server.
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
  },
});
