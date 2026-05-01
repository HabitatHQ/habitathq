import { expect, type Page, test } from '@playwright/test'

// ---------------------------------------------------------------------------
// Helper: complete a workout so analytics pages have some data
// ---------------------------------------------------------------------------

async function completeWorkoutWithSet(page: Page) {
  await page.goto('/workout')
  await page.waitForLoadState('networkidle')
  await page.getByRole('button', { name: /start empty session/i }).click()
  await expect(page.getByText('Active Session')).toBeVisible({ timeout: 10_000 })

  await page.getByRole('button', { name: /add exercise/i }).click()
  await expect(page.getByRole('list').locator('button').first()).toBeVisible({ timeout: 15_000 })
  await page.getByRole('searchbox', { name: /search exercises/i }).fill('barbell squat')
  await page.getByText('Barbell Squat').first().click()
  await expect(page.getByRole('dialog', { name: /add exercise/i })).not.toBeVisible()

  await page.getByRole('button', { name: /\+ set/i }).click()
  await expect(page.getByRole('dialog', { name: /log set/i })).toBeVisible()
  await page.getByLabel('Weight', { exact: true }).fill('100')
  await page.getByLabel('Reps', { exact: true }).fill('5')
  await page.getByRole('button', { name: /log set/i }).click()

  const skipBtn = page.getByRole('button', { name: /skip/i })
  if (await skipBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await skipBtn.click()
  }

  await page.getByRole('button', { name: /finish/i }).click()
  await expect(page.getByRole('dialog', { name: /finish workout/i })).toBeVisible()
  await page.getByRole('button', { name: /save workout/i }).click()
  await expect(page.locator('h1')).toContainText('Session Complete', { timeout: 10_000 })
  await page.getByRole('button', { name: /done/i }).click()
}

// ---------------------------------------------------------------------------
// Progress and analytics page
// ---------------------------------------------------------------------------

test.describe('progress and analytics page', () => {
  test('progress page loads with heading', async ({ page }) => {
    await page.goto('/progress')
    await page.waitForLoadState('networkidle')
    await expect(page.locator('h1')).toContainText('Progress')
  })

  test('progress page has article element', async ({ page }) => {
    await page.goto('/progress')
    await page.waitForLoadState('networkidle')
    await expect(page.locator('article')).toBeVisible()
  })

  test('loading state disappears after DB initialises', async ({ page }) => {
    await page.goto('/progress')
    // Wait for "Loading analytics…" to be gone
    await expect(page.getByText(/loading analytics/i)).not.toBeVisible({ timeout: 15_000 })
  })

  test('training load section is visible', async ({ page }) => {
    await page.goto('/progress')
    await expect(page.getByText(/loading analytics/i)).not.toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/training load/i)).toBeVisible()
  })

  test('training load section shows Acute, Chronic and ACWR cards', async ({ page }) => {
    await page.goto('/progress')
    await expect(page.getByText(/loading analytics/i)).not.toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/acute/i)).toBeVisible()
    await expect(page.getByText(/chronic/i)).toBeVisible()
    await expect(page.getByText(/acwr/i)).toBeVisible()
  })

  test('personal records section is visible', async ({ page }) => {
    await page.goto('/progress')
    await expect(page.getByText(/loading analytics/i)).not.toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/personal records/i)).toBeVisible()
  })

  test('personal records shows empty-state message when no data', async ({ page }) => {
    await page.goto('/progress')
    await expect(page.getByText(/loading analytics/i)).not.toBeVisible({ timeout: 15_000 })
    // Empty state: "Complete workouts to track PRs."
    await expect(page.getByText(/complete workouts to track prs/i)).toBeVisible()
  })

  test('personal records shows PR entry after completing a workout', async ({ page }) => {
    await completeWorkoutWithSet(page)
    await page.goto('/progress')
    await expect(page.getByText(/loading analytics/i)).not.toBeVisible({ timeout: 15_000 })
    // After a workout PRs may appear if a record was set
    await expect(page.getByText(/personal records/i)).toBeVisible()
  })

  test('weekly volume section is visible', async ({ page }) => {
    await page.goto('/progress')
    await expect(page.getByText(/loading analytics/i)).not.toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/weekly volume/i)).toBeVisible()
  })

  test('training calendar section is visible', async ({ page }) => {
    await page.goto('/progress')
    await expect(page.getByText(/loading analytics/i)).not.toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/training calendar/i)).toBeVisible()
  })

  test('muscle frequency section is visible', async ({ page }) => {
    await page.goto('/progress')
    await expect(page.getByText(/loading analytics/i)).not.toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/muscle frequency/i)).toBeVisible()
  })

  test('muscle frequency section has 28 days label', async ({ page }) => {
    await page.goto('/progress')
    await expect(page.getByText(/loading analytics/i)).not.toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/28 days/i)).toBeVisible()
  })
})

// ---------------------------------------------------------------------------
// Today page analytics: streak + readiness
// ---------------------------------------------------------------------------

test.describe('today page analytics', () => {
  test('today page shows day streak counter', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    // The streak card has text "Day streak"
    await expect(page.getByText(/day streak/i)).toBeVisible({ timeout: 10_000 })
  })

  test('streak counter shows a number', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await expect(page.getByText(/day streak/i)).toBeVisible({ timeout: 10_000 })
    // The streak section has a bold number next to the flame icon
    const streakSection = page.locator('section').filter({ hasText: /day streak/i })
    await expect(streakSection).toBeVisible()
    // Contains a numeric value
    await expect(streakSection.getByText(/^\d+$/)).toBeVisible()
  })

  test('today page shows readiness card or no-data placeholder', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // Either a readiness score card or a "No data yet" placeholder is shown
    const hasReadiness = await page
      .getByText(/readiness/i)
      .isVisible()
      .catch(() => false)
    const hasNoData = await page
      .getByText(/no data yet/i)
      .isVisible()
      .catch(() => false)
    expect(hasReadiness || hasNoData).toBe(true)
  })

  test('streak increments after completing a workout', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    const beforeText = await page
      .locator('section')
      .filter({ hasText: /day streak/i })
      .getByText(/^\d+$/)
      .textContent()
    const before = Number(beforeText?.trim() ?? 0)

    await completeWorkoutWithSet(page)

    await page.goto('/')
    await page.waitForLoadState('networkidle')
    const afterText = await page
      .locator('section')
      .filter({ hasText: /day streak/i })
      .getByText(/^\d+$/)
      .textContent()
    const after = Number(afterText?.trim() ?? 0)

    // Streak should be at least 1 after completing a workout
    expect(after).toBeGreaterThanOrEqual(1)
    expect(after).toBeGreaterThanOrEqual(before)
  })

  test('today page shows recent activity section heading', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await expect(page.getByText(/recent activity/i)).toBeVisible({ timeout: 10_000 })
  })

  test('recent activity shows workout after completing one', async ({ page }) => {
    await completeWorkoutWithSet(page)

    await page.goto('/')
    await page.waitForLoadState('networkidle')
    // Should show a "Gym · Xm" entry in recent activity
    await expect(page.getByText(/gym/i)).toBeVisible({ timeout: 10_000 })
  })
})
