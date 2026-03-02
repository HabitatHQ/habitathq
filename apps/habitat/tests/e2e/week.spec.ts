import { test, expect } from '@playwright/test'

test.describe('Week page', () => {
  test('renders without fatal errors', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(err.message))

    await page.goto('/week')
    await page.waitForLoadState('networkidle')

    const fatal = errors.filter(
      (e) =>
        !e.includes('OPFS') &&
        !e.includes('SharedArrayBuffer') &&
        !e.includes('crossOriginIsolated'),
    )
    expect(fatal).toHaveLength(0)
  })

  test('shows empty state and add-habits link when no habits exist', async ({ page }) => {
    // Fresh context = empty DB = no habits
    await page.goto('/week')
    await page.waitForLoadState('networkidle')

    await expect(page.getByText('No habits yet')).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('link', { name: 'Add habits' })).toBeVisible()
  })

  test('add-habits link navigates to /habits', async ({ page }) => {
    await page.goto('/week')
    await page.waitForLoadState('networkidle')

    await expect(page.getByRole('link', { name: 'Add habits' })).toBeVisible({ timeout: 10000 })
    await page.getByRole('link', { name: 'Add habits' }).click()
    await expect(page).toHaveURL(/\/habits/)
    await expect(page.getByRole('heading', { name: 'Habits' })).toBeVisible()
  })
})
