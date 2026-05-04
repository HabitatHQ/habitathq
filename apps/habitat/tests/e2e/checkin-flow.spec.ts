/**
 * E2E tests for the check-in flow.
 *
 * Covers: default templates exist, create template.
 */
import { test, expect } from './fixtures'

test.describe('Check-in flow', () => {
  test('default templates exist on first load', async ({ page }) => {
    await page.goto('/checkin')
    await page.waitForLoadState('networkidle')

    await expect(page.getByText('Morning Check-in')).toBeVisible({ timeout: 8000 })
    await expect(page.getByText('Evening Reflection')).toBeVisible()
    await expect(page.getByText('Weekly Review')).toBeVisible()
  })

  test('creates a check-in template', async ({ page }) => {
    await page.goto('/checkin')
    await page.waitForLoadState('networkidle')

    await page.getByRole('button', { name: 'New' }).click()
    await expect(page.getByRole('heading', { name: 'New Check-in' })).toBeVisible({ timeout: 8000 })

    await page.getByPlaceholder('Name (e.g. Morning Check-in)').fill('Custom Template')
    await page.getByRole('button', { name: 'Create' }).click()

    await expect(page.getByRole('heading', { name: 'New Check-in' })).not.toBeVisible()
    await expect(page.getByText('Custom Template')).toBeVisible({ timeout: 8000 })
  })
})
