import { expect, test } from '@playwright/test'

test.describe('Today page', () => {
  test('loads with heading', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('h1')).toContainText('Today')
  })

  test('shows start workout button', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('link', { name: /start workout/i })).toBeVisible()
  })
})

test.describe('Navigation', () => {
  test('bottom nav has 5 tabs', async ({ page }) => {
    await page.goto('/')
    const nav = page.getByRole('navigation', { name: 'Primary navigation' })
    await expect(nav).toBeVisible()
    const links = nav.getByRole('link')
    await expect(links).toHaveCount(5)
  })

  test('navigates to workout page', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('link', { name: 'Workout' }).nth(1).click()
    await expect(page.locator('h1')).toContainText('Workout')
  })

  test('navigates to history page', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('link', { name: 'History' }).click()
    await expect(page.locator('h1')).toContainText('History')
  })

  test('navigates to progress page', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('link', { name: 'Progress' }).click()
    await expect(page.locator('h1')).toContainText('Progress')
  })

  test('navigates to profile page', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('link', { name: 'Profile' }).click()
    await expect(page.locator('h1')).toContainText('Profile')
  })
})

test.describe('Profile settings', () => {
  test('can switch theme', async ({ page }) => {
    await page.goto('/profile')
    await page.getByRole('button', { name: 'Forge' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'forge')
  })

  test('can switch weight unit to lbs', async ({ page }) => {
    await page.goto('/profile')
    await page.getByRole('button', { name: 'lbs' }).click()
    await expect(page.getByRole('button', { name: 'lbs' })).toHaveAttribute('aria-pressed', 'true')
  })
})
