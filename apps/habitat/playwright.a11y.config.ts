import { defineConfig, devices } from '@playwright/test'

// Dedicated port for e2e tests — avoids collisions with any running dev server.
const E2E_PORT = 4200

export default defineConfig({
  testDir: './tests/a11y/e2e',
  fullyParallel: false, // run pages sequentially to avoid overwhelming the server
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['html', { outputFolder: 'playwright-report-a11y' }]],
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
