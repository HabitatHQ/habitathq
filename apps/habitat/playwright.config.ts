import { defineConfig, devices } from '@playwright/test'

// Dedicated port for e2e tests — avoids collisions with any running dev server.
const E2E_PORT = 4200

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: 'html',
  use: {
    baseURL: `http://localhost:${E2E_PORT}`,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: `BUILD_TARGET=pwa nuxt generate && npx -y serve .output/public -l ${E2E_PORT} --no-clipboard --single`,
    url: `http://localhost:${E2E_PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
})
