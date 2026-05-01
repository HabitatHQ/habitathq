import { expect, type Page, test } from '@playwright/test'

// ---------------------------------------------------------------------------
// Context
// The failure-set UI (failure toggle, failure type selector, partial reps input)
// is defined in the database schema (failure_flag, failure_type, partial_reps)
// but has not yet been added to the AddSetSheet component.
// Tests for unimplemented UI are marked test.skip.
// Tests that verify the working tab (from which failure sets would be logged)
// are implemented.
// ---------------------------------------------------------------------------

async function openSetSheet(page: Page) {
  await page.goto('/workout')
  await page.waitForLoadState('networkidle')
  await page.getByRole('button', { name: /start empty session/i }).click()
  await expect(page.getByText('Active Session')).toBeVisible({ timeout: 10_000 })

  await page.getByRole('button', { name: /add exercise/i }).click()
  await expect(page.getByRole('list').locator('button').first()).toBeVisible({ timeout: 15_000 })
  await page.getByRole('searchbox', { name: /search exercises/i }).fill('barbell squat')
  await page.getByText('Barbell Squat').first().click()
  await expect(page.getByRole('dialog', { name: /add exercise/i })).not.toBeVisible()
  await expect(page.getByRole('region', { name: 'Barbell Squat' })).toBeVisible({ timeout: 5_000 })

  await page.getByRole('button', { name: /\+ set/i }).click()
  await expect(page.getByRole('dialog', { name: /log set/i })).toBeVisible()
}

test.describe('failure sets', () => {
  // -------------------------------------------------------------------------
  // Working tab context (implemented)
  // -------------------------------------------------------------------------

  test('log set sheet opens on working tab by default', async ({ page }) => {
    await openSetSheet(page)

    // "Working" button has aria-pressed=true by default
    const setTypeGroup = page.getByRole('group', { name: /set type/i })
    await expect(setTypeGroup.getByRole('button', { name: /working/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  test('working tab shows weight and reps inputs', async ({ page }) => {
    await openSetSheet(page)

    await expect(page.getByLabel('Weight', { exact: true })).toBeVisible()
    await expect(page.getByLabel('Reps', { exact: true })).toBeVisible()
  })

  test('working tab shows optional RPE input', async ({ page }) => {
    await openSetSheet(page)

    await expect(page.getByLabel('RPE', { exact: true })).toBeVisible()
  })

  test('working tab shows optional RIR input', async ({ page }) => {
    await openSetSheet(page)

    await expect(page.getByLabel('Reps in reserve', { exact: true })).toBeVisible()
  })

  test('can log a working set with weight and reps', async ({ page }) => {
    await openSetSheet(page)

    await page.getByLabel('Weight', { exact: true }).fill('120')
    await page.getByLabel('Reps', { exact: true }).fill('3')
    await page.getByRole('button', { name: /log set/i }).click()

    await expect(page.getByRole('dialog', { name: /log set/i })).not.toBeVisible()

    const skipBtn = page.getByRole('button', { name: /skip/i })
    if (await skipBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await skipBtn.click()
    }

    // Working set appears in exercise block — numbered 1
    const exerciseBlock = page.getByRole('region', { name: 'Barbell Squat' })
    await expect(exerciseBlock.getByText('1')).toBeVisible({ timeout: 5_000 })
  })

  test('working set increments working set count in exercise block', async ({ page }) => {
    await openSetSheet(page)

    await page.getByLabel('Weight', { exact: true }).fill('120')
    await page.getByLabel('Reps', { exact: true }).fill('3')
    await page.getByRole('button', { name: /log set/i }).click()
    await expect(page.getByRole('dialog', { name: /log set/i })).not.toBeVisible()

    const skipBtn = page.getByRole('button', { name: /skip/i })
    if (await skipBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await skipBtn.click()
    }

    const exerciseBlock = page.getByRole('region', { name: 'Barbell Squat' })
    await expect(exerciseBlock.getByText(/1 working set/i)).toBeVisible({ timeout: 5_000 })
  })

  // -------------------------------------------------------------------------
  // Failure UI — skipped until implemented in AddSetSheet
  // -------------------------------------------------------------------------

  test.skip('log set sheet has failure toggle when on working tab', async ({ page }) => {
    // This feature is in the DB schema (failure_flag, failure_type) but not
    // yet exposed in AddSetSheet.vue.
    await openSetSheet(page)

    // Expect a "Failure" or "Train to failure" toggle to exist in the dialog
    const dialog = page.getByRole('dialog', { name: /log set/i })
    await expect(dialog.getByRole('switch', { name: /failure/i })).toBeVisible()
  })

  test.skip('failure toggle shows type selector when enabled', async ({ page }) => {
    await openSetSheet(page)

    const dialog = page.getByRole('dialog', { name: /log set/i })
    await dialog.getByRole('switch', { name: /failure/i }).click()
    // Failure type options should appear
    await expect(dialog.getByText(/muscular/i)).toBeVisible()
  })

  test.skip('failure type options are visible (Muscular, Technical, Near failure)', async ({
    page,
  }) => {
    await openSetSheet(page)

    const dialog = page.getByRole('dialog', { name: /log set/i })
    await dialog.getByRole('switch', { name: /failure/i }).click()

    await expect(dialog.getByText(/muscular/i)).toBeVisible()
    await expect(dialog.getByText(/technical/i)).toBeVisible()
    await expect(dialog.getByText(/near failure/i)).toBeVisible()
  })

  test.skip('partial reps input appears when failure is toggled', async ({ page }) => {
    await openSetSheet(page)

    const dialog = page.getByRole('dialog', { name: /log set/i })
    await dialog.getByRole('switch', { name: /failure/i }).click()
    await expect(dialog.getByLabel(/partial reps/i)).toBeVisible()
  })

  test.skip('failure badge F appears on logged set row after logging failure set', async ({
    page,
  }) => {
    await openSetSheet(page)

    const dialog = page.getByRole('dialog', { name: /log set/i })
    // Enable failure flag
    await dialog.getByRole('switch', { name: /failure/i }).click()

    // Fill in required fields
    await page.getByLabel('Weight', { exact: true }).fill('140')
    await page.getByLabel('Reps', { exact: true }).fill('5')
    await page.getByRole('button', { name: /log set/i }).click()
    await expect(page.getByRole('dialog', { name: /log set/i })).not.toBeVisible()

    const skipBtn = page.getByRole('button', { name: /skip/i })
    if (await skipBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await skipBtn.click()
    }

    // The set row should show an "F" badge to indicate failure
    const exerciseBlock = page.getByRole('region', { name: 'Barbell Squat' })
    await expect(exerciseBlock.getByText('F')).toBeVisible({ timeout: 5_000 })
  })
})
