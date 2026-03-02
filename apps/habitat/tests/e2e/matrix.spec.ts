import { test, expect } from '@playwright/test'

test.describe('Matrix page', () => {
  test('renders without fatal errors', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(err.message))

    await page.goto('/matrix')
    await page.waitForLoadState('networkidle')

    const fatal = errors.filter(
      (e) =>
        !e.includes('OPFS') &&
        !e.includes('SharedArrayBuffer') &&
        !e.includes('crossOriginIsolated'),
    )
    expect(fatal).toHaveLength(0)
  })

  test('shows "Month" heading on desktop viewport', async ({ page }) => {
    // Default Playwright viewport is 1280×720 — above the 640px sm breakpoint
    await page.goto('/matrix')
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('heading', { name: 'Month' })).toBeVisible()
  })

  test('shows "Week" heading on mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/matrix')
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('heading', { name: 'Week' })).toBeVisible()
  })

  test('shows empty state and add-habits link when no habits exist', async ({ page }) => {
    // Fresh context = empty DB = no habits
    await page.goto('/matrix')
    await page.waitForLoadState('networkidle')

    await expect(page.getByText('No habits yet')).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('link', { name: 'Add habits' })).toBeVisible()
  })

  test('add-habits link navigates to /habits', async ({ page }) => {
    await page.goto('/matrix')
    await page.waitForLoadState('networkidle')

    await expect(page.getByRole('link', { name: 'Add habits' })).toBeVisible({ timeout: 10000 })
    await page.getByRole('link', { name: 'Add habits' }).click()
    await expect(page).toHaveURL(/\/habits/)
    await expect(page.getByRole('heading', { name: 'Habits' })).toBeVisible()
  })

  test('nav label is "Month" on desktop', async ({ page }) => {
    await page.goto('/matrix')
    await page.waitForLoadState('networkidle')
    // The nav button linking to /matrix should be labelled "Month" at desktop width
    await expect(page.locator('nav').getByText('Month')).toBeVisible()
  })

  test('nav label is "Week" on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/matrix')
    await page.waitForLoadState('networkidle')
    await expect(page.locator('nav').getByText('Week')).toBeVisible()
  })
})
