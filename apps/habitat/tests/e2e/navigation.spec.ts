import { test, expect } from '@playwright/test'

test.describe('Navigation smoke tests', () => {
  test('home page loads', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(err.message))

    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // Page should render without crashing
    await expect(page.locator('body')).toBeVisible()
    // Filter out known OPFS-related errors that are harmless in test env
    const fatal = errors.filter(
      (e) => !e.includes('OPFS') && !e.includes('SharedArrayBuffer') && !e.includes('crossOriginIsolated'),
    )
    expect(fatal).toHaveLength(0)
  })

  test('/jots route renders jots heading', async ({ page }) => {
    await page.goto('/jots')
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('heading', { name: 'Jots' })).toBeVisible()
  })

  test('/habits route renders habits heading', async ({ page }) => {
    await page.goto('/habits')
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('heading', { name: 'Habits' })).toBeVisible()
  })

  test('/todos route renders todos heading', async ({ page }) => {
    await page.goto('/todos')
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('heading', { name: 'TODOs' })).toBeVisible()
  })

  test('/checkin route renders check-in heading', async ({ page }) => {
    await page.goto('/checkin')
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('heading', { name: 'Check-in' })).toBeVisible()
  })

  test('/week route renders week heading', async ({ page }) => {
    await page.goto('/week')
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('heading', { name: 'Week' })).toBeVisible()
  })

  test('/stats route renders stats heading', async ({ page }) => {
    await page.goto('/stats')
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('heading', { name: /stats/i })).toBeVisible()
  })

  test('/archive route renders archive heading', async ({ page }) => {
    await page.goto('/archive')
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('heading', { name: /archive/i })).toBeVisible()
  })

  test('/settings route renders settings heading', async ({ page }) => {
    await page.goto('/settings')
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('heading', { name: /settings/i })).toBeVisible()
  })
})
