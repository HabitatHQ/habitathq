/**
 * Shared Playwright fixtures for all e2e tests.
 *
 * Bypasses the onboarding middleware by setting `hasCompletedOnboarding: true`
 * in localStorage before any page navigation.
 */
import { test as base } from '@playwright/test'

const SETTINGS_KEY = 'habitat-app-settings'
const ONBOARDED_SETTINGS = JSON.stringify({ hasCompletedOnboarding: true })

export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript(
      ({ key, value }: { key: string; value: string }) => {
        const existing = localStorage.getItem(key)
        if (existing) {
          try {
            const parsed = JSON.parse(existing)
            if (!parsed.hasCompletedOnboarding) {
              parsed.hasCompletedOnboarding = true
              localStorage.setItem(key, JSON.stringify(parsed))
            }
          } catch {
            localStorage.setItem(key, value)
          }
        } else {
          localStorage.setItem(key, value)
        }
      },
      { key: SETTINGS_KEY, value: ONBOARDED_SETTINGS },
    )
    await use(page)
  },
})

export { expect, type Page } from '@playwright/test'
