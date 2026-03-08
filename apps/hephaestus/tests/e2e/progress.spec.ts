import { expect, test } from '@playwright/test'

test.describe('Progress page', () => {
  test('loads with heading', async ({ page }) => {
    await page.goto('/progress')
    await expect(page.locator('h1')).toContainText('Progress')
  })

  test('shows training load section with stats', async ({ page }) => {
    await page.goto('/progress')
    // Wait for loading to finish
    await expect(page.getByText(/loading analytics/i)).not.toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('Training Load')).toBeVisible()
    await expect(page.getByText('Acute')).toBeVisible()
    await expect(page.getByText('Chronic')).toBeVisible()
    await expect(page.getByText('ACWR')).toBeVisible()
  })

  test('shows personal records section', async ({ page }) => {
    await page.goto('/progress')
    await expect(page.getByText(/loading analytics/i)).not.toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/recent personal records/i)).toBeVisible()
  })

  test('shows empty state for PRs when no workouts logged', async ({ page }) => {
    await page.goto('/progress')
    await expect(page.getByText(/loading analytics/i)).not.toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/complete workouts to track prs/i)).toBeVisible()
  })
})
