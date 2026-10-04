import { expect, test } from '@playwright/test'

test.describe('Today page', () => {
  test('displays current date', async ({ page }) => {
    await page.goto('/')
    // The date is rendered in a <time> element
    const timeEl = page.locator('time')
    await expect(timeEl).toBeVisible()
    const text = await timeEl.textContent()
    // Should contain a weekday name (Monday–Sunday)
    expect(text).toMatch(/Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday/)
  })

  test('shows recent activity section', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText(/recent activity/i)).toBeVisible()
  })

  test('start workout button links to /workout', async ({ page }) => {
    await page.goto('/')
    const btn = page.getByRole('link', { name: /start workout/i })
    await expect(btn).toHaveAttribute('href', '/workout')
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

  test('nav tab labels are correct', async ({ page }) => {
    await page.goto('/')
    const nav = page.getByRole('navigation', { name: 'Primary navigation' })
    for (const label of ['Today', 'Workout', 'Exercises', 'History', 'Profile']) {
      await expect(nav.getByRole('link', { name: label })).toBeVisible()
    }
  })

  test('navigates to workout page', async ({ page }) => {
    await page.goto('/')
    await page
      .getByRole('navigation', { name: 'Primary navigation' })
      .getByRole('link', { name: 'Workout' })
      .click()
    await expect(page.locator('h1')).toContainText('Workout')
  })

  test('navigates to history page', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('link', { name: 'History' }).click()
    await expect(page.locator('h1')).toContainText('History')
  })

  test('navigates to exercises page', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('link', { name: 'Exercises' }).click()
    await expect(page.locator('h1')).toContainText('Exercises')
  })

  test('navigates to profile page', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('link', { name: 'Profile' }).click()
    await expect(page.locator('h1')).toContainText('Profile')
  })

  test('active nav tab has aria-current="page"', async ({ page }) => {
    await page.goto('/history')
    const nav = page.getByRole('navigation', { name: 'Primary navigation' })
    const historyLink = nav.getByRole('link', { name: 'History' })
    await expect(historyLink).toHaveAttribute('aria-current', 'page')
  })

  test('non-active nav tabs do not have aria-current', async ({ page }) => {
    await page.goto('/history')
    const nav = page.getByRole('navigation', { name: 'Primary navigation' })
    const todayLink = nav.getByRole('link', { name: 'Today' })
    await expect(todayLink).not.toHaveAttribute('aria-current', 'page')
  })

  test('direct URL navigation renders correct page', async ({ page }) => {
    await page.goto('/exercises')
    await expect(page.locator('h1')).toContainText('Exercises')
    await expect(page.url()).toContain('/exercises')
  })
})

test.describe('Profile settings', () => {
  test('can switch theme to Forge', async ({ page }) => {
    await page.goto('/profile')
    const themes = page.locator('article')
    await themes.getByRole('button', { name: /^Forge/ }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'forge')
  })

  test('can switch theme to Daylight', async ({ page }) => {
    await page.goto('/profile')
    await page
      .locator('article')
      .getByRole('button', { name: /^Daylight/ })
      .click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'daylight')
  })

  test('can switch theme back to Hephaestus', async ({ page }) => {
    await page.goto('/profile')
    await page
      .locator('article')
      .getByRole('button', { name: /^Forge/ })
      .click()
    await page
      .locator('article')
      .getByRole('button', { name: /^Hephaestus/ })
      .click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'hephaestus')
  })

  test('selected theme remains selected after navigating away and back', async ({ page }) => {
    await page.goto('/profile')
    const forge = page.locator('article').getByRole('button', { name: /^Forge/ })
    await forge.click()
    await expect(forge).toHaveAttribute('aria-pressed', 'true')
    await page.getByRole('link', { name: 'Today' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'forge')
    await page.getByRole('link', { name: 'Profile' }).click()
    await expect(page.locator('article').getByRole('button', { name: /^Forge/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  test('can change and persist the rest timer preset', async ({ page }) => {
    await page.goto('/profile')
    const defaults = page.getByRole('region', { name: 'Workout Defaults' })
    const restOptions = defaults.getByRole('group', { name: 'Rest timer options' })
    await restOptions.getByRole('button', { name: '120s' }).click()
    const defaultTimer = defaults.getByText('Default rest timer').locator('..')
    await expect(defaultTimer.getByText('120s', { exact: true })).toBeVisible()

    await page.reload()
    const reloadedDefaults = page.getByRole('region', { name: 'Workout Defaults' })
    await expect(
      reloadedDefaults
        .getByText('Default rest timer')
        .locator('..')
        .getByText('120s', { exact: true }),
    ).toBeVisible()
  })

  test('can switch weight unit to lbs', async ({ page }) => {
    await page.goto('/profile')
    await page.getByRole('button', { name: 'lbs' }).click()
    await expect(page.getByRole('button', { name: 'lbs' })).toHaveAttribute('aria-pressed', 'true')
  })

  test('can switch weight unit back to kg', async ({ page }) => {
    await page.goto('/profile')
    await page.getByRole('button', { name: 'lbs' }).click()
    await page.getByRole('button', { name: 'kg' }).click()
    await expect(page.getByRole('button', { name: 'kg' })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('button', { name: 'lbs' })).toHaveAttribute('aria-pressed', 'false')
  })

  test('can switch distance unit to mi', async ({ page }) => {
    await page.goto('/profile')
    await page.getByRole('button', { name: 'mi' }).click()
    await expect(page.getByRole('button', { name: 'mi' })).toHaveAttribute('aria-pressed', 'true')
  })

  for (const label of ['Show RPE field', 'Show RIR field', 'Reduce motion', 'Use 24-hour time']) {
    test(`persists ${label} changes and restoration across reload`, async ({ page }) => {
      await page.goto('/profile')
      const control = page.getByRole('switch', { name: label, exact: true })
      await expect(control).toBeVisible()
      const initial = await control.isChecked()

      await control.setChecked(!initial)
      await page.reload()
      await expect(control).toBeChecked({ checked: !initial })

      await control.setChecked(initial)
      await page.reload()
      await expect(control).toBeChecked({ checked: initial })
    })
  }
})
