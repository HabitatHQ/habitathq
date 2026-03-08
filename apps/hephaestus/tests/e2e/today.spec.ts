import { expect, test } from '@playwright/test'

test('today page loads with heading', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('h1')).toContainText('Today')
})

test('bottom nav has 5 tabs', async ({ page }) => {
  await page.goto('/')
  const nav = page.locator('nav')
  await expect(nav).toBeVisible()
  const links = nav.locator('a')
  await expect(links).toHaveCount(5)
})

test('navigating to workout page works', async ({ page }) => {
  await page.goto('/')
  await page.locator('nav a[href="/workout"]').click()
  await expect(page.locator('h1')).toContainText('Workout')
})

test('navigating to history page works', async ({ page }) => {
  await page.goto('/')
  await page.locator('nav a[href="/history"]').click()
  await expect(page.locator('h1')).toContainText('History')
})
