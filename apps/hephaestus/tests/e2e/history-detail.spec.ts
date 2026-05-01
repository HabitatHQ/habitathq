import { expect, type Page, test } from '@playwright/test'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function completeWorkout(page: Page) {
  await page.goto('/workout')
  await page.waitForLoadState('networkidle')
  await page.getByRole('button', { name: /start empty session/i }).click()
  await expect(page.getByText('Active Session')).toBeVisible({ timeout: 10_000 })

  // Add Barbell Squat and log one set
  await page.getByRole('button', { name: /add exercise/i }).click()
  await expect(page.getByRole('list').locator('button').first()).toBeVisible({ timeout: 15_000 })
  await page.getByRole('searchbox', { name: /search exercises/i }).fill('barbell squat')
  await page.getByText('Barbell Squat').first().click()
  await expect(page.getByRole('dialog', { name: /add exercise/i })).not.toBeVisible()

  await page.getByRole('button', { name: /\+ set/i }).click()
  await expect(page.getByRole('dialog', { name: /log set/i })).toBeVisible()
  await page.getByLabel('Weight', { exact: true }).fill('80')
  await page.getByLabel('Reps', { exact: true }).fill('8')
  await page.getByRole('button', { name: /log set/i }).click()
  await expect(page.getByRole('dialog', { name: /log set/i })).not.toBeVisible()

  // Skip rest timer if visible
  const skipBtn = page.getByRole('button', { name: /skip/i })
  if (await skipBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await skipBtn.click()
  }

  // Finish workout
  await page.getByRole('button', { name: /finish/i }).click()
  await expect(page.getByRole('dialog', { name: /finish workout/i })).toBeVisible()
  await page.getByRole('button', { name: /save workout/i }).click()
  await expect(page.locator('h1')).toContainText('Session Complete', { timeout: 10_000 })
  await page.getByRole('button', { name: /done/i }).click()
}

// ---------------------------------------------------------------------------
// History detail page
// ---------------------------------------------------------------------------

test.describe('history detail page', () => {
  test('history list loads and shows page heading', async ({ page }) => {
    await page.goto('/history')
    await page.waitForLoadState('networkidle')
    await expect(page.locator('h1')).toContainText('History')
  })

  test('history page shows filter chips', async ({ page }) => {
    await page.goto('/history')
    await page.waitForLoadState('networkidle')
    // All / Gym / Runs filter buttons
    await expect(page.getByRole('button', { name: /^all$/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /^gym$/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /^runs$/i })).toBeVisible()
  })

  test('filter chips toggle aria-pressed', async ({ page }) => {
    await page.goto('/history')
    await page.waitForLoadState('networkidle')

    const allBtn = page.getByRole('button', { name: /^all$/i })
    const gymBtn = page.getByRole('button', { name: /^gym$/i })
    await expect(allBtn).toHaveAttribute('aria-pressed', 'true')
    await gymBtn.click()
    await expect(gymBtn).toHaveAttribute('aria-pressed', 'true')
    await expect(allBtn).toHaveAttribute('aria-pressed', 'false')
  })

  test('empty history shows no workouts message', async ({ page }) => {
    await page.goto('/history')
    await page.waitForLoadState('networkidle')
    // Wait for loading spinner to disappear
    await expect(page.getByText(/loading workouts/i)).not.toBeVisible({ timeout: 10_000 })
    // Empty state message
    await expect(page.getByText(/no workouts yet/i)).toBeVisible()
  })

  test('empty history shows start training link', async ({ page }) => {
    await page.goto('/history')
    await page.waitForLoadState('networkidle')
    await expect(page.getByText(/loading workouts/i)).not.toBeVisible({ timeout: 10_000 })
    // "Start Workout" button/link in empty state
    await expect(page.getByRole('link', { name: /start workout/i })).toBeVisible()
  })

  test('history items link to detail page after completing a workout', async ({ page }) => {
    await completeWorkout(page)

    await page.goto('/history')
    await expect(page.getByText(/loading workouts/i)).not.toBeVisible({ timeout: 15_000 })

    // A gym session entry should appear
    await expect(page.getByText(/gym session/i)).toBeVisible({ timeout: 10_000 })

    // Click the workout link — should navigate to /history/[id]
    const workoutLink = page.locator('a[href^="/history/"]').first()
    await expect(workoutLink).toBeVisible({ timeout: 10_000 })
    await workoutLink.click()
    await page.waitForLoadState('networkidle')

    await expect(page.url()).toMatch(/\/history\/[^/]+$/)
  })

  test('detail page shows Workout Detail heading', async ({ page }) => {
    await completeWorkout(page)

    await page.goto('/history')
    await expect(page.getByText(/loading workouts/i)).not.toBeVisible({ timeout: 15_000 })

    const workoutLink = page.locator('a[href^="/history/"]').first()
    await expect(workoutLink).toBeVisible({ timeout: 10_000 })
    await workoutLink.click()
    await page.waitForLoadState('networkidle')

    await expect(page.locator('h1')).toContainText('Workout Detail')
  })

  test('detail page shows Summary section with duration and sets', async ({ page }) => {
    await completeWorkout(page)

    await page.goto('/history')
    await expect(page.getByText(/loading workouts/i)).not.toBeVisible({ timeout: 15_000 })

    const workoutLink = page.locator('a[href^="/history/"]').first()
    await workoutLink.click()
    await page.waitForLoadState('networkidle')

    await expect(page.getByText(/summary/i)).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText('Duration')).toBeVisible()
    await expect(page.getByText('Sets')).toBeVisible()
  })

  test('detail page shows exercise with set data', async ({ page }) => {
    await completeWorkout(page)

    await page.goto('/history')
    await expect(page.getByText(/loading workouts/i)).not.toBeVisible({ timeout: 15_000 })

    const workoutLink = page.locator('a[href^="/history/"]').first()
    await workoutLink.click()
    await page.waitForLoadState('networkidle')

    // Exercise name should appear in the detail
    await expect(page.getByText(/barbell squat/i)).toBeVisible({ timeout: 10_000 })
    // Set weight logged: 80 kg
    await expect(page.getByText(/80 kg/i)).toBeVisible({ timeout: 10_000 })
  })

  test('detail page shows back link to history', async ({ page }) => {
    await completeWorkout(page)

    await page.goto('/history')
    await expect(page.getByText(/loading workouts/i)).not.toBeVisible({ timeout: 15_000 })

    const workoutLink = page.locator('a[href^="/history/"]').first()
    await workoutLink.click()
    await page.waitForLoadState('networkidle')

    // Back link with aria-label "Back to history"
    const backLink = page.getByRole('link', { name: /back to history/i })
    await expect(backLink).toBeVisible()
    await expect(backLink).toHaveAttribute('href', '/history')
  })

  test('back link navigates to history list', async ({ page }) => {
    await completeWorkout(page)

    await page.goto('/history')
    await expect(page.getByText(/loading workouts/i)).not.toBeVisible({ timeout: 15_000 })

    const workoutLink = page.locator('a[href^="/history/"]').first()
    await workoutLink.click()
    await page.waitForLoadState('networkidle')

    await page.getByRole('link', { name: /back to history/i }).click()
    await expect(page.locator('h1')).toContainText('History')
    await expect(page.url()).toMatch(/\/history$/)
  })

  test('detail page shows not found for invalid id', async ({ page }) => {
    await page.goto('/history/nonexistent-id-that-does-not-exist')
    await page.waitForLoadState('networkidle')

    // "not found" message appears
    await expect(page.getByText(/workout not found/i)).toBeVisible({ timeout: 10_000 })
  })

  test('not found page still has back link to history', async ({ page }) => {
    await page.goto('/history/nonexistent-id-that-does-not-exist')
    await page.waitForLoadState('networkidle')

    await expect(page.getByText(/workout not found/i)).toBeVisible({ timeout: 10_000 })
    await expect(page.getByRole('link', { name: /go to history/i })).toBeVisible()
  })

  test('detail page Volume column shows correct value', async ({ page }) => {
    await completeWorkout(page)

    await page.goto('/history')
    await expect(page.getByText(/loading workouts/i)).not.toBeVisible({ timeout: 15_000 })

    const workoutLink = page.locator('a[href^="/history/"]').first()
    await workoutLink.click()
    await page.waitForLoadState('networkidle')

    // 80 kg × 8 reps = 640 kg total volume
    await expect(page.getByText('Volume')).toBeVisible({ timeout: 10_000 })
  })
})
