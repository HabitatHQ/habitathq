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
  await expect(page.getByRole('dialog', { name: /edit set 1.*barbell squat/i })).toBeVisible()
  return exercise
}

test.describe('failure sets', () => {
  test('logs a selected failure type and partial reps on a working set', async ({ page }) => {
    const exercise = await openSetSheet(page)
    const dialog = page.getByRole('dialog', { name: /edit set 1.*barbell squat/i })
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
    await dialog.getByRole('button', { name: 'Save Changes', exact: true }).click()
    await exercise
      .getByRole('button', { name: 'Complete set 1 for Barbell Squat', exact: true })
      .click()

    const setRow = page.getByRole('button', { name: 'Edit set 1 for Barbell Squat' })
    await expect(setRow).toContainText('120')
    await expect(setRow).toContainText('3')
    await setRow.click()
    const savedDetails = page.getByRole('dialog', { name: /edit set 1.*barbell squat/i })
    const savedFailureTypes = savedDetails.getByRole('group', { name: /failure type/i })
    await expect(savedFailureTypes.getByRole('button', { name: 'Near failure' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(savedDetails.getByLabel('Partial reps')).toHaveValue('2')
    await savedDetails.getByRole('button', { name: 'Close' }).click()

    await page.reload()
    await expect(page.getByRole('heading', { name: /unfinished session/i })).toBeVisible()
    await page.getByRole('button', { name: /^resume$/i }).click()
    const resumedSet = page.getByRole('button', { name: 'Edit set 1 for Barbell Squat' })
    await expect(resumedSet).toContainText('120')
    await expect(resumedSet).toContainText('3')
    await resumedSet.click()
    const resumedDetails = page.getByRole('dialog', { name: /edit set 1.*barbell squat/i })
    const resumedFailureTypes = resumedDetails.getByRole('group', { name: /failure type/i })
    await expect(resumedFailureTypes.getByRole('button', { name: 'Near failure' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(resumedDetails.getByLabel('Partial reps')).toHaveValue('2')
  })
})
