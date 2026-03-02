import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/a11y/e2e',
  fullyParallel: false, // run pages sequentially to avoid overwhelming the dev server
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['html', { outputFolder: 'playwright-report-a11y' }]],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'pnpm dev:pwa',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
