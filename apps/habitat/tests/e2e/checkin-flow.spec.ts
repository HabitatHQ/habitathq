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

    // "New" creates a blank check-in and lands directly on its inline edit page.
    await page.getByRole('button', { name: 'New' }).click()
    await expect(page.getByRole('heading', { name: 'Edit check-in' })).toBeVisible({ timeout: 8000 })

    // Rename via the auto-saving title field, then wait for the "Saved" flash.
    await page.getByPlaceholder('Check-in name').fill('Custom Template')
    await expect(page.getByText('Saved')).toBeVisible({ timeout: 5000 })

    // Back on the list, the new check-in shows the chosen name.
    await page.goto('/checkin')
    await expect(page.getByText('Custom Template')).toBeVisible({ timeout: 8000 })
  })
})
