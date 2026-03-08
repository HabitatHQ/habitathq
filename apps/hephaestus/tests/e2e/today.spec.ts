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

  test('shows empty state message when no workouts logged', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText(/no recent workouts/i)).toBeVisible()
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
    for (const label of ['Today', 'Workout', 'History', 'Progress', 'Profile']) {
      await expect(nav.getByText(label)).toBeVisible()
    }
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
    await page.goto('/progress')
    await expect(page.locator('h1')).toContainText('Progress')
    await expect(page.url()).toContain('/progress')
  })
})

test.describe('Profile settings', () => {
  test('can switch theme to Forge', async ({ page }) => {
    await page.goto('/profile')
    await page.getByRole('button', { name: 'Forge' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'forge')
  })

  test('can switch theme to Daylight', async ({ page }) => {
    await page.goto('/profile')
    await page.getByRole('button', { name: 'Daylight' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'daylight')
  })

  test('can switch theme back to Hephaestus', async ({ page }) => {
    await page.goto('/profile')
    await page.getByRole('button', { name: 'Forge' }).click()
    await page.getByRole('button', { name: 'Hephaestus' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'hephaestus')
  })

  test('selected theme button shows aria-pressed=true', async ({ page }) => {
    await page.goto('/profile')
    await page.getByRole('button', { name: 'Forge' }).click()
    await expect(page.getByRole('button', { name: 'Forge' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(page.getByRole('button', { name: 'Daylight' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
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

  test('can toggle RPE field switch', async ({ page }) => {
    await page.goto('/profile')
    const rpeSwitch = page.getByRole('switch', { name: /show rpe/i })
    const initialState = await rpeSwitch.getAttribute('aria-checked')
    await rpeSwitch.click()
    const newState = initialState === 'true' ? 'false' : 'true'
    await expect(rpeSwitch).toHaveAttribute('aria-checked', newState)
  })

  test('can toggle RIR field switch', async ({ page }) => {
    await page.goto('/profile')
    const rirSwitch = page.getByRole('switch', { name: /show rir/i })
    await rirSwitch.click()
    await expect(rirSwitch).toHaveAttribute('aria-checked', 'true')
  })

  test('can toggle reduce motion switch', async ({ page }) => {
    await page.goto('/profile')
    const motionSwitch = page.getByRole('switch', { name: /reduce motion/i })
    await motionSwitch.click()
    await expect(motionSwitch).toHaveAttribute('aria-checked', 'true')
  })

  test('can toggle 24-hour time switch', async ({ page }) => {
    await page.goto('/profile')
    const timeSwitch = page.getByRole('switch', { name: /24.hour time/i })
    await timeSwitch.click()
    await expect(timeSwitch).toHaveAttribute('aria-checked', 'true')
  })

  test('rest timer preset buttons are visible', async ({ page }) => {
    await page.goto('/profile')
    const group = page.getByRole('group', { name: /rest timer/i })
    await expect(group).toBeVisible()
    await expect(group.getByRole('button', { name: '60s' })).toBeVisible()
    await expect(group.getByRole('button', { name: '120s' })).toBeVisible()
    await expect(group.getByRole('button', { name: '300s' })).toBeVisible()
  })

  test('can change rest timer preset', async ({ page }) => {
    await page.goto('/profile')
    const group = page.getByRole('group', { name: /rest timer/i })
    await group.getByRole('button', { name: '90s' }).click()
    await expect(group.getByRole('button', { name: '90s' })).toHaveAttribute('aria-pressed', 'true')
    await expect(group.getByRole('button', { name: '120s' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })

  test('theme persists after navigating away and back', async ({ page }) => {
    await page.goto('/profile')
    await page.getByRole('button', { name: 'Forge' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'forge')
    await page.getByRole('link', { name: 'Today' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'forge')
    await page.getByRole('link', { name: 'Profile' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'forge')
  })
})
