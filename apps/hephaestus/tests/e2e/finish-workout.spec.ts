import { expect, type Page, test } from '@playwright/test'

async function startEmptyWorkout(page: Page) {
  await page.goto('/workout')
  await page.getByLabel('Session type').selectOption('gym')
  await page.getByRole('button', { name: /start empty session/i }).click()
  await expect(page.getByText('Active Session')).toBeVisible({ timeout: 10_000 })
}

async function addExerciseAndLogSet(page: Page) {
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
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('Weight', { exact: true }).fill('100')
  await dialog.getByLabel('Reps', { exact: true }).fill('5')
  await dialog.getByRole('button', { name: /log set/i }).click()
}

test.describe('finish workout flow', () => {
  test('selects mood and energy through accessible labels and saves them with the workout', async ({
    page,
  }) => {
    await startEmptyWorkout(page)
    await page.getByRole('button', { name: /^finish$/i }).click()
    const dialog = page.getByRole('dialog', { name: /finish workout/i })
    await expect(dialog).toBeVisible()

    const mood = dialog.getByRole('button', { name: 'Mood rating 4' })
    const energy = dialog.getByRole('button', { name: 'Energy rating 3' })
    await mood.click()
    await energy.click()
    await expect(mood).toHaveAttribute('aria-pressed', 'true')
    await expect(energy).toHaveAttribute('aria-pressed', 'true')

    await dialog.getByRole('button', { name: /save workout/i }).click()
    await expect(page.getByRole('heading', { name: /session complete — strength/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /^done$/i })).toBeVisible()
  })

  test('cancelling finish keeps the active session available', async ({ page }) => {
    await startEmptyWorkout(page)
    await page.getByRole('button', { name: /^finish$/i }).click()
    const dialog = page.getByRole('dialog', { name: /finish workout/i })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: /cancel/i }).click()
    await expect(dialog).not.toBeVisible()
    await expect(page.getByText('Active Session')).toBeVisible()
  })

  test('finishing logged work presents its saved set summary', async ({ page }) => {
    await startEmptyWorkout(page)
    await addExerciseAndLogSet(page)
    await page.getByRole('button', { name: /^finish$/i }).click()
    await page.getByRole('button', { name: /save workout/i }).click()

    await expect(page.getByRole('heading', { name: /session complete — strength/i })).toBeVisible()
    const summary = page.getByRole('region', { name: /workout summary/i })
    await expect(summary.getByText('Working Sets')).toBeVisible()
    await expect(summary.getByText('1', { exact: true })).toBeVisible()
    await expect(summary.getByText('500 kg', { exact: true })).toBeVisible()
  })
})
