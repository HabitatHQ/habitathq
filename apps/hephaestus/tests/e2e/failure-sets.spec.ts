import { expect, type Page, test } from '@playwright/test'

async function openSetSheet(page: Page) {
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
  await expect(page.getByRole('dialog', { name: /log set/i })).toBeVisible()
}

test.describe('failure sets', () => {
  test('logs a selected failure type and partial reps on a working set', async ({ page }) => {
    await openSetSheet(page)
    const dialog = page.getByRole('dialog', { name: /log set/i })
    await expect(dialog.getByRole('button', { name: 'Working' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await dialog.getByRole('button', { name: 'Toggle failure set' }).click()
    const failureTypes = dialog.getByRole('group', { name: /failure type/i })
    await failureTypes.getByRole('button', { name: 'Near failure' }).click()
    await dialog.getByLabel('Partial reps').fill('2')
    await dialog.getByLabel('Weight', { exact: true }).fill('120')
    await dialog.getByLabel('Reps', { exact: true }).fill('3')
    await dialog.getByRole('button', { name: /log set/i }).click()

    const setRow = page.getByRole('button', { name: 'Edit set 1' })
    await expect(setRow).toContainText('120')
    await expect(setRow).toContainText('3')
    await expect(setRow).toContainText('F')
    await expect(setRow).toContainText('+2p')
  })
})
