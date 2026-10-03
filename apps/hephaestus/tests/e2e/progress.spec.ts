import { expect, test } from '@playwright/test'

test.describe('DB persistence — PR tracking', () => {
  /** Helper: start a workout, add Barbell Squat, complete a set, then finish. */
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
    const dialog = page.getByRole('dialog', { name: /edit set 1.*barbell squat/i })
    await dialog.getByLabel('Weight', { exact: true }).fill(weight)
    await dialog.getByLabel('Reps', { exact: true }).fill(reps)
    await dialog.getByRole('button', { name: 'Save Changes', exact: true }).click()
    await exercise
      .getByRole('button', { name: 'Complete set 1 for Barbell Squat', exact: true })
      .click()

    await page.getByRole('button', { name: /finish/i }).click()
    await expect(page.getByRole('dialog', { name: /finish workout/i })).toBeVisible()
    await page.getByRole('button', { name: /save workout/i }).click()
    await expect(page.locator('h1')).toContainText('Session Complete')
    await page.getByRole('button', { name: /done/i }).click()
  }

  test('summary announces the new weight record after completing the first set', async ({
    page,
  }) => {
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
    const dialog = page.getByRole('dialog', { name: /edit set 1.*barbell squat/i })
    await dialog.getByLabel('Weight', { exact: true }).fill('140')
    await dialog.getByLabel('Reps', { exact: true }).fill('5')
    await dialog.getByRole('button', { name: 'Save Changes', exact: true }).click()
    await exercise
      .getByRole('button', { name: 'Complete set 1 for Barbell Squat', exact: true })
      .click()
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
    await expect(records.getByText(/barbell squat · weight pr/i)).toBeVisible()
    await expect(records.getByText('150 kg', { exact: true })).toBeVisible()
    await expect(records.getByText('3 reps', { exact: true })).toBeVisible()
  })

  test('progress PR loads use the selected pounds unit while reps remain counts', async ({
    page,
  }) => {
    await completeWorkoutWithSet(page, '100', '5')
    await page.goto('/profile')
    await page
      .getByRole('group', { name: 'Weight units' })
      .getByRole('button', { name: 'lbs', exact: true })
      .click()
    await page.goto('/progress')
    await expect(page.getByText(/loading analytics/i)).not.toBeVisible({ timeout: 15_000 })

    const records = page.getByRole('region', { name: 'Recent Personal Records' })
    await expect(records.getByText(/barbell squat · weight pr/i)).toBeVisible()
    await expect(records.getByText('220.5 lbs', { exact: true })).toBeVisible()
    await expect(records.getByText('5 reps', { exact: true })).toBeVisible()
    await expect(records.getByText(/barbell squat · reps pr/i)).toBeVisible()
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

  test('training organization reports performed sets and per-exercise tonnage', async ({
    page,
  }) => {
    await completeWorkoutWithSet(page, '100', '5')
    await page.goto('/progress')
    await expect(page.getByText(/loading analytics/i)).not.toBeVisible({ timeout: 15_000 })
    const organization = page.getByRole('region', {
      name: /Training organization & volume/,
    })
    await expect(organization.getByText('Strength working sets: 1', { exact: true })).toBeVisible()
    const tonnage = organization
      .getByRole('heading', { name: 'Comparable per-exercise external-load tonnage' })
      .locator('..')
      .getByRole('listitem')
      .filter({ hasText: 'Barbell Squat' })
    await expect(tonnage).toContainText('500 kg × reps')
    await expect(tonnage).toContainText(/1 sets/)
  })
})
