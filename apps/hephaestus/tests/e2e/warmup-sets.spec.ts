import { expect, type Page, test } from '@playwright/test'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function openSetSheet(page: Page) {
  await page.goto('/workout')
  await page.waitForLoadState('networkidle')
  await page.getByRole('button', { name: /start empty session/i }).click()
  await expect(page.getByText('Active Session')).toBeVisible({ timeout: 10_000 })

  // Add Barbell Squat
  await page.getByRole('button', { name: /add exercise/i }).click()
  await expect(page.getByRole('list').locator('button').first()).toBeVisible({ timeout: 15_000 })
  await page.getByRole('searchbox', { name: /search exercises/i }).fill('barbell squat')
  await page.getByText('Barbell Squat').first().click()
  await expect(page.getByRole('dialog', { name: /add exercise/i })).not.toBeVisible()
  await expect(page.getByRole('region', { name: 'Barbell Squat' })).toBeVisible({ timeout: 5_000 })

  // Open the log set sheet
  await page.getByRole('button', { name: /\+ set/i }).click()
  await expect(page.getByRole('dialog', { name: /log set/i })).toBeVisible()
}

// ---------------------------------------------------------------------------
// Warmup sets
// ---------------------------------------------------------------------------

test.describe('warmup sets', () => {
  test('log set sheet has warmup/working segmented control', async ({ page }) => {
    await openSetSheet(page)

    // The segmented control has role="group" with aria-label="Set type"
    await expect(page.getByRole('group', { name: /set type/i })).toBeVisible()
  })

  test('warmup button is present in the set type control', async ({ page }) => {
    await openSetSheet(page)

    const setTypeGroup = page.getByRole('group', { name: /set type/i })
    await expect(setTypeGroup.getByRole('button', { name: /warmup/i })).toBeVisible()
  })

  test('working button is present in the set type control', async ({ page }) => {
    await openSetSheet(page)

    const setTypeGroup = page.getByRole('group', { name: /set type/i })
    await expect(setTypeGroup.getByRole('button', { name: /working/i })).toBeVisible()
  })

  test('warmup tab is not selected by default — working is selected', async ({ page }) => {
    await openSetSheet(page)

    const setTypeGroup = page.getByRole('group', { name: /set type/i })
    // "Working" starts as the active button (aria-pressed=true), warmup=false
    await expect(setTypeGroup.getByRole('button', { name: /warmup/i })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    await expect(setTypeGroup.getByRole('button', { name: /working/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  test('selecting warmup changes the toggle to aria-pressed=true', async ({ page }) => {
    await openSetSheet(page)

    const setTypeGroup = page.getByRole('group', { name: /set type/i })
    await setTypeGroup.getByRole('button', { name: /warmup/i }).click()

    await expect(setTypeGroup.getByRole('button', { name: /warmup/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(setTypeGroup.getByRole('button', { name: /working/i })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })

  test('switching back to working resets toggle', async ({ page }) => {
    await openSetSheet(page)

    const setTypeGroup = page.getByRole('group', { name: /set type/i })
    await setTypeGroup.getByRole('button', { name: /warmup/i }).click()
    await expect(setTypeGroup.getByRole('button', { name: /warmup/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    await setTypeGroup.getByRole('button', { name: /working/i }).click()
    await expect(setTypeGroup.getByRole('button', { name: /working/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(setTypeGroup.getByRole('button', { name: /warmup/i })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })

  test('warmup sets show W label in exercise block after logging', async ({ page }) => {
    await openSetSheet(page)

    // Switch to warmup
    const setTypeGroup = page.getByRole('group', { name: /set type/i })
    await setTypeGroup.getByRole('button', { name: /warmup/i }).click()

    // Fill in weight and reps, then log
    await page.getByLabel('Weight', { exact: true }).fill('60')
    await page.getByLabel('Reps', { exact: true }).fill('10')
    await page.getByRole('button', { name: /log set/i }).click()

    // Sheet should close
    await expect(page.getByRole('dialog', { name: /log set/i })).not.toBeVisible()

    // Skip rest timer if shown
    const skipBtn = page.getByRole('button', { name: /skip/i })
    if (await skipBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await skipBtn.click()
    }

    // The SetRow component renders warmup sets with "W" label
    const exerciseBlock = page.getByRole('region', { name: 'Barbell Squat' })
    await expect(exerciseBlock).toBeVisible()
    // "W" appears in the set row label column
    await expect(exerciseBlock.getByText('W')).toBeVisible({ timeout: 5_000 })
  })

  test('warmup set is shown with reduced opacity in exercise block', async ({ page }) => {
    await openSetSheet(page)

    const setTypeGroup = page.getByRole('group', { name: /set type/i })
    await setTypeGroup.getByRole('button', { name: /warmup/i }).click()
    await page.getByLabel('Weight', { exact: true }).fill('60')
    await page.getByLabel('Reps', { exact: true }).fill('10')
    await page.getByRole('button', { name: /log set/i }).click()
    await expect(page.getByRole('dialog', { name: /log set/i })).not.toBeVisible()

    const skipBtn = page.getByRole('button', { name: /skip/i })
    if (await skipBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await skipBtn.click()
    }

    // Warmup set list item has opacity-60 class (reduced opacity)
    const exerciseBlock = page.getByRole('region', { name: 'Barbell Squat' })
    const setRow = exerciseBlock.locator('li.opacity-60')
    await expect(setRow).toBeVisible({ timeout: 5_000 })
  })

  test('warmup set does not count toward working sets total', async ({ page }) => {
    await openSetSheet(page)

    // Log a warmup set
    const setTypeGroup = page.getByRole('group', { name: /set type/i })
    await setTypeGroup.getByRole('button', { name: /warmup/i }).click()
    await page.getByLabel('Weight', { exact: true }).fill('60')
    await page.getByLabel('Reps', { exact: true }).fill('10')
    await page.getByRole('button', { name: /log set/i }).click()
    await expect(page.getByRole('dialog', { name: /log set/i })).not.toBeVisible()

    const skipBtn = page.getByRole('button', { name: /skip/i })
    if (await skipBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await skipBtn.click()
    }

    // Exercise block subtitle shows "0 working sets" (warmup doesn't count)
    const exerciseBlock = page.getByRole('region', { name: 'Barbell Squat' })
    await expect(exerciseBlock.getByText(/0 working sets/i)).toBeVisible({ timeout: 5_000 })
  })

  test('log set dialog shows exercise name in title', async ({ page }) => {
    await openSetSheet(page)

    // The dialog aria-label is "Log Set N · ExerciseName"
    const dialog = page.getByRole('dialog', { name: /log set/i })
    await expect(dialog).toBeVisible()
    // Header should contain exercise name
    await expect(dialog.getByText(/barbell squat/i)).toBeVisible()
  })

  test('log set dialog shows set number', async ({ page }) => {
    await openSetSheet(page)

    const dialog = page.getByRole('dialog', { name: /log set/i })
    // Header shows "Set 1 · ExerciseName"
    await expect(dialog.getByText(/set 1/i)).toBeVisible()
  })

  test('can log a warmup set with weight and reps', async ({ page }) => {
    await openSetSheet(page)

    const setTypeGroup = page.getByRole('group', { name: /set type/i })
    await setTypeGroup.getByRole('button', { name: /warmup/i }).click()
    await page.getByLabel('Weight', { exact: true }).fill('40')
    await page.getByLabel('Reps', { exact: true }).fill('15')

    // Log Set button should be enabled
    await expect(page.getByRole('button', { name: /log set/i })).toBeEnabled()
    await page.getByRole('button', { name: /log set/i }).click()

    // Sheet closes after logging
    await expect(page.getByRole('dialog', { name: /log set/i })).not.toBeVisible()
  })
})
