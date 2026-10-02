import { expect, test } from '@playwright/test'

test.describe('DB persistence — PR tracking', () => {
  /** Helper: start a workout, add Barbell Squat, log a set, finish. */
  async function completeWorkoutWithSet(
    page: import('@playwright/test').Page,
    weight: string,
    reps: string,
  ) {
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
    await dialog.getByLabel('Weight', { exact: true }).fill(weight)
    await dialog.getByLabel('Reps', { exact: true }).fill(reps)
    await dialog.getByRole('button', { name: /log set/i }).click()

    await page.getByRole('button', { name: /finish/i }).click()
    await expect(page.getByRole('dialog', { name: /finish workout/i })).toBeVisible()
    await page.getByRole('button', { name: /save workout/i }).click()
    await expect(page.locator('h1')).toContainText('Session Complete')
    await page.getByRole('button', { name: /done/i }).click()
  }

  test('summary announces the new weight record after the first logged set', async ({ page }) => {
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
    await dialog.getByLabel('Weight', { exact: true }).fill('140')
    await dialog.getByLabel('Reps', { exact: true }).fill('5')
    await dialog.getByRole('button', { name: /log set/i }).click()
    await page.getByRole('button', { name: /finish/i }).click()
    await page.getByRole('button', { name: /save workout/i }).click()
    await expect(page.locator('h1')).toContainText('Session Complete')

    await expect(page.getByText(/new weight pr/i)).toBeVisible()
  })

  test('progress page shows non-zero PRs after completing workout with sets', async ({ page }) => {
    await completeWorkoutWithSet(page, '150', '3')
    await page.goto('/progress')
    await expect(page.getByText(/loading analytics/i)).not.toBeVisible({ timeout: 15_000 })
    // PRs section should exist
    const records = page.getByRole('region', { name: 'Recent Personal Records' })
    await expect(records).toBeVisible()
    await expect(records.getByText(/weight pr/i)).toBeVisible()
    await expect(records.getByText('150 kg', { exact: true })).toBeVisible()
  })

  test('history detail retains the completed lift and its logged load', async ({ page }) => {
    await completeWorkoutWithSet(page, '80', '8')
    await page.goto('/history')
    await expect(page.getByText(/loading workouts/i)).not.toBeVisible({ timeout: 15_000 })
    await page.getByRole('link', { name: /gym session/i }).click()
    await expect(page.getByRole('table', { name: /sets for barbell squat/i })).toContainText(
      '80 kg',
    )
    await expect(page.getByRole('table', { name: /sets for barbell squat/i })).toContainText('8')
  })

  test('training load section updates after logging workout', async ({ page }) => {
    await completeWorkoutWithSet(page, '100', '5')
    await page.goto('/progress')
    await expect(page.getByText(/loading analytics/i)).not.toBeVisible({ timeout: 15_000 })
    // Training load stats should be visible
    const load = page.getByRole('region', { name: 'Training Load' })
    await expect(load.getByText('500 kg', { exact: true })).toBeVisible()
  })
})
