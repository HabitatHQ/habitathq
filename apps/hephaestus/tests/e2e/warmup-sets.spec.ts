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
  const dialog = page.getByRole('dialog', { name: /log set/i })
  await expect(dialog).toBeVisible()
  return dialog
}

test('warmup sets persist through reload without counting as working sets', async ({ page }) => {
  const dialog = await startWorkoutWithSetSheet(page)
  await dialog
    .getByRole('group', { name: 'Set type' })
    .getByRole('button', { name: 'Warmup' })
    .click()
  await dialog.getByLabel('Weight', { exact: true }).fill('60')
  await dialog.getByLabel('Reps', { exact: true }).fill('10')
  await dialog.getByRole('button', { name: /log set/i }).click()
  await expect(dialog).not.toBeVisible()

  const exercise = page.getByRole('region', { name: 'Barbell Squat' })
  await expect(exercise.getByRole('listitem').getByText('W', { exact: true })).toBeVisible()
  await expect(exercise.getByText(/0 working sets/i)).toBeVisible()

  await page.reload()
  await expect(page.getByRole('heading', { name: /unfinished session/i })).toBeVisible()
  await page.getByRole('button', { name: 'Resume', exact: true }).click()
  const resumedExercise = page.getByRole('region', { name: 'Barbell Squat' })
  await expect(resumedExercise.getByRole('listitem').getByText('W', { exact: true })).toBeVisible()
  await expect(resumedExercise.getByRole('button', { name: 'Edit set 1' })).toContainText('60')
  await expect(resumedExercise.getByText(/0 working sets/i)).toBeVisible()
})
