import { expect, type Page, test } from '@playwright/test'

async function completeWorkoutWithSet(page: Page, weight = '100', reps = '5') {
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
  await page.getByRole('button', { name: /^finish$/i }).click()
  await page.getByRole('button', { name: /save workout/i }).click()
  await expect(page.getByRole('heading', { name: /session complete — strength/i })).toBeVisible()
  await page.getByRole('button', { name: /^done$/i }).click()
}

test.describe('training analytics from completed sessions', () => {
  test('records the completed lift as a personal record on Progress', async ({ page }) => {
    await completeWorkoutWithSet(page, '150', '3')
    await page.goto('/progress')
    const records = page.getByRole('region', { name: 'Recent Personal Records' })
    await expect(records.getByText(/weight pr/i)).toBeVisible()
    await expect(records.getByText('150 kg', { exact: true })).toBeVisible()
  })

  test('completed workout increases today streak and appears as a navigable recent activity', async ({
    page,
  }) => {
    await completeWorkoutWithSet(page)
    await page.goto('/')

    const streak = page
      .locator('section')
      .filter({ hasText: /day streak/i })
      .getByText(/^\d+$/)
    await expect(streak).toBeVisible()
    expect(Number((await streak.textContent())?.trim())).toBeGreaterThanOrEqual(1)

    const recentWorkout = page.getByRole('link', { name: /strength ·/i })
    await expect(recentWorkout).toBeVisible()
    await recentWorkout.click()
    await expect(page).toHaveURL(/\/history\/[^/]+$/)
    await expect(page.getByRole('heading', { name: 'Workout Detail' })).toBeVisible()
  })
})
