import { defineConfig, devices } from "@playwright/test";

/** Port for the Palladium sync backend (separate from the e2e suite's 13742). */
export const API_PORT = 13_743;
/** Port for the Vite dev server. */
export const APP_PORT = 5_191;

const isCI = !!process.env["CI"];

export default defineConfig({
  testDir: "./e2e",
  // Each test manages its own browser contexts — no parallelism between tests
  // since they share a single backend database.
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: isCI ? "dot" : "list",

  use: {
    baseURL: `http://localhost:${APP_PORT}`,
    trace: "on-first-retry",
  },

  globalSetup: "./e2e/globalSetup.ts",

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  webServer: {
    // Use the local binary directly — avoids pnpm workspace resolution errors
    // when Playwright spawns the command from packages/example-react/.
    // PALLADIUM_API is forwarded via env so vite.config.ts can proxy /v1/*.
    command: `node_modules/.bin/vite --port ${APP_PORT}`,
    url: `http://localhost:${APP_PORT}`,
    reuseExistingServer: !isCI,
    timeout: 60_000,
    env: { PALLADIUM_API: `http://localhost:${API_PORT}` },
  },
});
