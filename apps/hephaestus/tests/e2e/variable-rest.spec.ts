import { expect, type Locator, type Page, test } from '@playwright/test'

async function startEmptyWorkout(page: Page) {
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
  return page.getByRole('region', { name: 'Barbell Squat' })
}

async function logSet(page: Page, exercise: Locator, failure = false) {
  await exercise.getByRole('button', { name: '+ Set' }).click()
  const dialog = page.getByRole('dialog', { name: /log set/i })
  await expect(dialog).toBeVisible()
  if (failure) {
    await dialog.getByRole('button', { name: 'Toggle failure set' }).click()
    await dialog
      .getByRole('group', { name: /failure type/i })
      .getByRole('button', { name: 'Near failure' })
      .click()
  }
  await dialog.getByLabel('Weight', { exact: true }).fill('100')
  await dialog.getByLabel('Reps', { exact: true }).fill('5')
  await dialog.getByRole('button', { name: /log set/i }).click()
  await expect(dialog).not.toBeVisible()
}

test.describe('rest timer behavior', () => {
  test('logging a working set starts rest and skip ends it', async ({ page }) => {
    const exercise = await startEmptyWorkout(page)
    await expect(page.getByRole('timer')).toHaveCount(0)
    await logSet(page, exercise)

    const timer = page.getByRole('timer')
    await expect(timer).toBeVisible()
    await expect(timer.getByRole('button', { name: 'Skip' })).toBeVisible()
    await expect(timer).toHaveAttribute('aria-label', /^Rest timer: \d+:\d{2} remaining$/)
    await timer.getByRole('button', { name: 'Skip' }).click()
    await expect(timer).toHaveCount(0)
  })

  test('logging another working set starts a new rest period', async ({ page }) => {
    const exercise = await startEmptyWorkout(page)
    await logSet(page, exercise)
    const timer = page.getByRole('timer')
    await expect(timer).toBeVisible()
    await timer.getByRole('button', { name: 'Skip' }).click()
    await expect(timer).toHaveCount(0)

    await logSet(page, exercise)
    await expect(timer).toBeVisible()
    await expect(exercise.getByText(/2 working sets/i)).toBeVisible()
  })

  test('failure rest prompt adds time to an active rest period', async ({ page }) => {
    const exercise = await startEmptyWorkout(page)
    await logSet(page, exercise, true)
    const timer = page.getByRole('timer')
    await expect(timer).toBeVisible()
    const initial = await timer.getAttribute('aria-label')

    await page
      .getByRole('alert')
      .filter({ hasText: /failure logged/i })
      .getByRole('button', { name: '+60s' })
      .click()
    await expect(page.getByRole('alert').filter({ hasText: /failure logged/i })).toHaveCount(0)
    await expect(timer).toBeVisible()
    await expect(timer).not.toHaveAttribute('aria-label', initial ?? '')
  })
})
