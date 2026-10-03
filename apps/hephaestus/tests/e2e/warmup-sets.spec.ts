import { expect, type Page, test } from '@playwright/test'

async function startWorkoutWithSetSheet(page: Page) {
  await page.goto('/workout')
  await page.getByLabel('Session type').selectOption('gym')
  await page.getByRole('button', { name: /start empty session/i }).click()
  await expect(page.getByText('Active Session')).toBeVisible()

  await page.getByRole('button', { name: /add exercise/i }).click()
  const picker = page.getByRole('dialog', { name: /add exercise/i })
  await expect(picker.getByRole('button', { name: /barbell squat/i })).toBeVisible({
    timeout: 15_000,
  })
  await picker.getByRole('searchbox', { name: /search exercises/i }).fill('barbell squat')
  await picker.getByRole('button', { name: /barbell squat/i }).click()
  const exercise = page.getByRole('region', { name: 'Barbell Squat' })
  await expect(exercise).toBeVisible()
  await exercise.getByRole('button', { name: '+ Set' }).click()
  const dialog = page.getByRole('dialog', { name: /edit set 1.*barbell squat/i })
  await expect(dialog).toBeVisible()
  return dialog
}

test('warmup sets persist through reload without counting as working sets', async ({ page }) => {
  const dialog = await startWorkoutWithSetSheet(page)
  await dialog
    .getByRole('group', { name: 'Set type' })
    .getByRole('button', { name: 'Warmup' })
    .click()
  await dialog.getByLabel('Weight', { exact: true }).fill('40')
  await dialog.getByLabel('Reps', { exact: true }).fill('8')
  await dialog.getByRole('button', { name: 'Save Changes', exact: true }).click()
  const exercise = page.getByRole('region', { name: 'Barbell Squat' })
  await exercise
    .getByRole('button', { name: 'Complete set 1 for Barbell Squat', exact: true })
    .click()

  const completedWarmup = exercise.getByRole('button', {
    name: 'Edit set 1 for Barbell Squat',
  })
  await expect(completedWarmup).toContainText('40 kg × 8 reps')
  await completedWarmup.click()
  await expect(
    page
      .getByRole('dialog', { name: /edit set 1.*barbell squat/i })
      .getByRole('group', { name: 'Set type' })
      .getByRole('button', { name: 'Warmup' }),
  ).toHaveAttribute('aria-pressed', 'true')
  await page
    .getByRole('dialog', { name: /edit set 1.*barbell squat/i })
    .getByRole('button', { name: 'Close' })
    .click()
  await expect(exercise.getByText(/0 working sets/i)).toBeVisible()

  await page.reload()
  await expect(page.getByRole('heading', { name: /unfinished session/i })).toBeVisible()
  await page.getByRole('button', { name: 'Resume', exact: true }).click()
  const resumedExercise = page.getByRole('region', { name: 'Barbell Squat' })
  const resumedWarmup = resumedExercise.getByRole('button', {
    name: 'Edit set 1 for Barbell Squat',
  })
  await expect(resumedWarmup).toContainText('40 kg × 8 reps')
  await resumedWarmup.click()
  await expect(
    page
      .getByRole('dialog', { name: /edit set 1.*barbell squat/i })
      .getByRole('group', { name: 'Set type' })
      .getByRole('button', { name: 'Warmup' }),
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(resumedExercise.getByText(/0 working sets/i)).toBeVisible()
})
