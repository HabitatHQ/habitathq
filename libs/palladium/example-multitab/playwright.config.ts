import { defineConfig, devices } from "@playwright/test";

export const APP_PORT = 5_291;
const isCI = !!process.env["CI"];

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  forbidOnly: isCI,
  use: {
    baseURL: `http://localhost:${APP_PORT}`,
    trace: "on-first-retry",
    ...(process.env["PLAYWRIGHT_EXECUTABLE_PATH"]
      ? { launchOptions: { executablePath: process.env["PLAYWRIGHT_EXECUTABLE_PATH"] } }
      : {}),
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm exec vite --port ${APP_PORT}`,
    url: `http://localhost:${APP_PORT}`,
    reuseExistingServer: !isCI,
    timeout: 60_000,
  },
});
