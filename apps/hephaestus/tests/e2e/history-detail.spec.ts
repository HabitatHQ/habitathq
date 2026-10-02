import { expect, type Page, test } from '@playwright/test'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function completeWorkout(page: Page) {
  await page.goto('/workout')
  await page.getByLabel('Session type').selectOption('gym')
  await page.getByRole('button', { name: /start empty session/i }).click()
  await expect(page.getByText('Active Session')).toBeVisible({ timeout: 10_000 })

  await page.getByRole('button', { name: /add exercise/i }).click()
  const picker = page.getByRole('dialog', { name: /add exercise/i })
  await expect(picker.getByRole('button', { name: /barbell squat/i })).toBeVisible({
    timeout: 15_000,
  })
  await picker.getByRole('searchbox', { name: /search exercises/i }).fill('barbell squat')
  await picker.getByRole('button', { name: /barbell squat/i }).click()
  const exercise = page.getByRole('region', { name: 'Barbell Squat' })
  await exercise.getByRole('button', { name: '+ Set' }).click()
  const dialog = page.getByRole('dialog', { name: /log set/i })
  await dialog.getByLabel('Weight', { exact: true }).fill('80')
  await dialog.getByLabel('Reps', { exact: true }).fill('8')
  await dialog.getByRole('button', { name: /log set/i }).click()

  const timer = page.getByRole('timer')
  if (await timer.isVisible().catch(() => false))
    await timer.getByRole('button', { name: 'Skip' }).click()

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
  test('filter chips toggle aria-pressed', async ({ page }) => {
    await page.goto('/history')

    const allBtn = page.getByRole('button', { name: /^all$/i })
    const gymBtn = page.getByRole('button', { name: /^gym$/i })
    await expect(allBtn).toHaveAttribute('aria-pressed', 'true')
    await gymBtn.click()
    await expect(gymBtn).toHaveAttribute('aria-pressed', 'true')
    await expect(allBtn).toHaveAttribute('aria-pressed', 'false')
  })

  test('history items link to detail page after completing a workout', async ({ page }) => {
    await completeWorkout(page)

    await page.goto('/history')
    await expect(page.getByText(/loading workouts/i)).not.toBeVisible({ timeout: 15_000 })

    // A gym session entry should appear
    await expect(page.getByText(/gym session/i)).toBeVisible({ timeout: 10_000 })

    const workoutLink = page.getByRole('link', { name: /gym session/i })
    await expect(workoutLink).toBeVisible({ timeout: 10_000 })
    await workoutLink.click()

    await expect(page).toHaveURL(/\/history\/[^/]+$/)
  })

  test('detail page shows Summary section with duration and sets', async ({ page }) => {
    await completeWorkout(page)

    await page.goto('/history')
    await expect(page.getByText(/loading workouts/i)).not.toBeVisible({ timeout: 15_000 })

    const workoutLink = page.getByRole('link', { name: /gym session/i })
    await workoutLink.click()

    const summary = page.getByRole('region', { name: 'Summary' })
    await expect(summary.getByRole('heading', { name: 'Summary', exact: true })).toBeVisible()
    await expect(summary.getByText('Duration', { exact: true })).toBeVisible()
    await expect(summary.getByText('Sets', { exact: true })).toBeVisible()
  })

  test('detail page shows exercise with set data', async ({ page }) => {
    await completeWorkout(page)

    await page.goto('/history')
    await expect(page.getByText(/loading workouts/i)).not.toBeVisible({ timeout: 15_000 })

    const workoutLink = page.getByRole('link', { name: /gym session/i })
    await workoutLink.click()

    // Exercise name should appear in the detail
    await expect(page.getByText(/barbell squat/i)).toBeVisible({ timeout: 10_000 })
    // Set weight logged: 80 kg
    await expect(page.getByText(/80 kg/i)).toBeVisible({ timeout: 10_000 })
  })

  test('back link navigates to history list', async ({ page }) => {
    await completeWorkout(page)

    await page.goto('/history')
    await expect(page.getByText(/loading workouts/i)).not.toBeVisible({ timeout: 15_000 })

    const workoutLink = page.getByRole('link', { name: /gym session/i })
    await workoutLink.click()

    await page.getByRole('link', { name: /back to history/i }).click()
    await expect(page.locator('h1')).toContainText('History')
    await expect(page.url()).toMatch(/\/history$/)
  })

  test('detail page shows not found for invalid id', async ({ page }) => {
    await page.goto('/history/nonexistent-id-that-does-not-exist')

    // "not found" message appears
    await expect(page.getByText(/workout not found/i)).toBeVisible({ timeout: 10_000 })
  })

  test('not found page still has back link to history', async ({ page }) => {
    await page.goto('/history/nonexistent-id-that-does-not-exist')

    await expect(page.getByText(/workout not found/i)).toBeVisible({ timeout: 10_000 })
    await expect(page.getByRole('link', { name: /go to history/i })).toBeVisible()
  })

  test('detail page shows the workout volume summary', async ({ page }) => {
    await completeWorkout(page)

    await page.goto('/history')
    await expect(page.getByText(/loading workouts/i)).not.toBeVisible({ timeout: 15_000 })
    const workoutLink = page.getByRole('link', { name: /gym session/i })
    await workoutLink.click()

    const summary = page.getByRole('region', { name: 'Summary' })
    await expect(summary.getByText('Volume', { exact: true })).toBeVisible({ timeout: 10_000 })
    await expect(summary.getByText('0.6t', { exact: true })).toBeVisible()
  })
})
