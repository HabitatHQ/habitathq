import { expect, test } from '@playwright/test'

test.describe('Progress page', () => {
  test('loads with heading', async ({ page }) => {
    await page.goto('/progress')
    await expect(page.locator('h1')).toContainText('Progress')
  })

  test('shows training load section with stats', async ({ page }) => {
    await page.goto('/progress')
    // Wait for loading to finish
    await expect(page.getByText(/loading analytics/i)).not.toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('Training Load')).toBeVisible()
    await expect(page.getByText('Acute')).toBeVisible()
    await expect(page.getByText('Chronic')).toBeVisible()
    await expect(page.getByText('ACWR')).toBeVisible()
  })

  test('shows personal records section', async ({ page }) => {
    await page.goto('/progress')
    await expect(page.getByText(/loading analytics/i)).not.toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/recent personal records/i)).toBeVisible()
  })

  test('shows empty state for PRs when no workouts logged', async ({ page }) => {
    await page.goto('/progress')
    await expect(page.getByText(/loading analytics/i)).not.toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/complete workouts to track prs/i)).toBeVisible()
  })
})

test.describe('DB persistence — PR tracking', () => {
  /** Helper: start a workout, add Barbell Squat, log a set, finish. */
  async function completeWorkoutWithSet(
    page: import('@playwright/test').Page,
    weight: string,
    reps: string,
  ) {
    await page.goto('/workout')
    await page.getByRole('button', { name: /start empty session/i }).click()
    await expect(page.getByText('Active Session')).toBeVisible({ timeout: 10_000 })

    await page.getByRole('button', { name: /add exercise/i }).click()
    await expect(page.getByRole('list').locator('button').first()).toBeVisible({ timeout: 15_000 })
    await page.getByRole('searchbox', { name: /search exercises/i }).fill('barbell squat')
    await page.getByText('Barbell Squat').first().click()
    await expect(page.getByRole('dialog', { name: /add exercise/i })).not.toBeVisible()

    await page.getByRole('button', { name: /\+ set/i }).click()
    await expect(page.getByRole('dialog', { name: /log set/i })).toBeVisible()
    await page.getByLabel('Weight', { exact: true }).fill(weight)
    await page.getByLabel('Reps', { exact: true }).fill(reps)
    await page.getByRole('button', { name: /log set/i }).click()

    await page.getByRole('button', { name: /finish/i }).click()
    await expect(page.getByRole('dialog', { name: /finish workout/i })).toBeVisible()
    await page.getByRole('button', { name: /save workout/i }).click()
    await expect(page.locator('h1')).toContainText('Session Complete')
    await page.getByRole('button', { name: /done/i }).click()
  }

  test('workout summary shows PRs count after logging a heavy set', async ({ page }) => {
    await page.goto('/workout')
    await page.getByRole('button', { name: /start empty session/i }).click()
    await expect(page.getByText('Active Session')).toBeVisible({ timeout: 10_000 })

    await page.getByRole('button', { name: /add exercise/i }).click()
    await expect(page.getByRole('list').locator('button').first()).toBeVisible({ timeout: 15_000 })
    await page.getByRole('searchbox', { name: /search exercises/i }).fill('barbell squat')
    await page.getByText('Barbell Squat').first().click()
    await page.getByRole('button', { name: /\+ set/i }).click()
    await page.getByLabel('Weight', { exact: true }).fill('140')
    await page.getByLabel('Reps', { exact: true }).fill('5')
    await page.getByRole('button', { name: /log set/i }).click()
    await page.getByRole('button', { name: /finish/i }).click()
    await page.getByRole('button', { name: /save workout/i }).click()
    await expect(page.locator('h1')).toContainText('Session Complete')

    // The PRs stat card should be visible (may show 0 or more)
    await expect(page.getByText('PRs')).toBeVisible()
  })

  test('progress page shows non-zero PRs after completing workout with sets', async ({ page }) => {
    await completeWorkoutWithSet(page, '150', '3')
    await page.goto('/progress')
    await expect(page.getByText(/loading analytics/i)).not.toBeVisible({ timeout: 15_000 })
    // PRs section should exist
    await expect(page.getByText(/recent personal records/i)).toBeVisible()
    // Should not show the empty state (because we logged a set which creates a PR)
    await expect(page.getByText(/complete workouts to track prs/i)).not.toBeVisible()
  })

  test('history shows completed workout after finishing', async ({ page }) => {
    await completeWorkoutWithSet(page, '80', '8')
    await page.goto('/history')
    await expect(page.getByText(/loading workouts/i)).not.toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/gym session/i)).toBeVisible()
  })

  test('training load section updates after logging workout', async ({ page }) => {
    await completeWorkoutWithSet(page, '100', '5')
    await page.goto('/progress')
    await expect(page.getByText(/loading analytics/i)).not.toBeVisible({ timeout: 15_000 })
    // Training load stats should be visible
    await expect(page.getByText('Training Load')).toBeVisible()
    await expect(page.getByText('Acute')).toBeVisible()
  })
})
