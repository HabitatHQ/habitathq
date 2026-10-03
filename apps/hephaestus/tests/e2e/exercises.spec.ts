import { expect, test } from '@playwright/test'

test.describe('Exercises page', () => {
  test('exercise list is populated from seed', async ({ page }) => {
    await page.goto('/exercises')
    // Wait for at least one exercise to appear
    await expect(page.getByText('Barbell Squat')).toBeVisible({ timeout: 20_000 })
  })

  test('search filters exercise list', async ({ page }) => {
    await page.goto('/exercises')
    await expect(page.getByText('Barbell Squat')).toBeVisible({ timeout: 20_000 })

    await page.getByRole('searchbox', { name: /search exercises/i }).fill('deadlift')
    await expect(page.getByText('Deadlift', { exact: true })).toBeVisible()
    // Squat should no longer be visible
    await expect(page.getByText('Barbell Squat')).not.toBeVisible()
  })

  test('clearing search restores full list', async ({ page }) => {
    await page.goto('/exercises')
    await expect(page.getByText('Barbell Squat')).toBeVisible({ timeout: 20_000 })
    await page.getByRole('searchbox', { name: /search exercises/i }).fill('deadlift')
    await page.getByRole('searchbox', { name: /search exercises/i }).clear()
    await expect(page.getByText('Barbell Squat')).toBeVisible()
  })

  test('movement filter shows only matching exercises', async ({ page }) => {
    await page.goto('/exercises')
    await expect(page.getByText('Barbell Squat')).toBeVisible({ timeout: 20_000 })

    // Click "Hinge" movement filter
    await page
      .getByRole('group', { name: /filter by movement/i })
      .getByRole('button', { name: 'Hinge' })
      .click()
    await expect(page.getByText('Deadlift', { exact: true })).toBeVisible()
    await expect(page.getByText('Barbell Squat')).not.toBeVisible()
  })

  test('equipment filter shows only matching exercises', async ({ page }) => {
    await page.goto('/exercises')
    await expect(page.getByText('Barbell Squat')).toBeVisible({ timeout: 20_000 })

    // Click "BW" (bodyweight) equipment filter
    await page
      .getByRole('group', { name: /filter by equipment/i })
      .getByRole('button', { name: 'BW' })
      .click()
    await expect(page.getByText('Push-up', { exact: true })).toBeVisible()
    await expect(page.getByText('Barbell Squat')).not.toBeVisible()
  })

  test('movement filter chip shows pressed state', async ({ page }) => {
    await page.goto('/exercises')
    const hingeBtn = page
      .getByRole('group', { name: /filter by movement/i })
      .getByRole('button', { name: 'Hinge' })
    await hingeBtn.click()
    await expect(hingeBtn).toHaveAttribute('aria-pressed', 'true')
  })

  test('selecting All movement resets filter', async ({ page }) => {
    await page.goto('/exercises')
    await expect(page.getByText('Barbell Squat')).toBeVisible({ timeout: 20_000 })
    const movGroup = page.getByRole('group', { name: /filter by movement/i })
    await movGroup.getByRole('button', { name: 'Hinge' }).click()
    await movGroup.getByRole('button', { name: 'All' }).click()
    await expect(page.getByText('Barbell Squat')).toBeVisible()
  })

  test('New button opens create exercise sheet', async ({ page }) => {
    await page.goto('/exercises')
    await page.getByRole('button', { name: 'New' }).click()
    await expect(page.getByRole('dialog', { name: /create custom exercise/i })).toBeVisible()
  })

  test('Create button is disabled when name is empty', async ({ page }) => {
    await page.goto('/exercises')
    await page.getByRole('button', { name: 'New' }).click()
    const dialog = page.getByRole('dialog', { name: /create custom exercise/i })
    await expect(dialog.getByRole('button', { name: /create/i })).toBeDisabled()
  })

  test('Create button is enabled after entering a name', async ({ page }) => {
    await page.goto('/exercises')
    await page.getByRole('button', { name: 'New' }).click()
    const dialog = page.getByRole('dialog', { name: /create custom exercise/i })
    await dialog.getByRole('textbox', { name: /exercise name/i }).fill('My Test Exercise')
    await expect(dialog.getByRole('button', { name: /create/i })).toBeEnabled()
  })

  test('can create a custom exercise and it appears in list', async ({ page }) => {
    await page.goto('/exercises')
    await expect(page.getByText('Barbell Squat')).toBeVisible({ timeout: 20_000 })

    await page.getByRole('button', { name: 'New' }).click()
    const dialog = page.getByRole('dialog', { name: /create custom exercise/i })
    await dialog.getByRole('textbox', { name: /exercise name/i }).fill('Playwright Test Exercise')
    await dialog.getByRole('button', { name: /create/i }).click()

    // Sheet should close
    await expect(page.getByRole('dialog', { name: /create custom exercise/i })).not.toBeVisible()
    // Exercise should appear in list
    const exercise = page
      .locator('article')
      .getByRole('list')
      .getByRole('listitem')
      .filter({ hasText: 'Playwright Test Exercise' })
    await expect(exercise).toBeVisible()
    await expect(exercise.getByText('Custom', { exact: true })).toBeVisible()
  })

  test('can select a different equipment type in create sheet', async ({ page }) => {
    await page.goto('/exercises')
    await page.getByRole('button', { name: 'New' }).click()
    const dialog = page.getByRole('dialog', { name: /create custom exercise/i })
    const cableBtn = dialog
      .getByRole('group', { name: /equipment type/i })
      .getByRole('button', { name: 'cable' })
    await cableBtn.click()
    await expect(cableBtn).toHaveAttribute('aria-pressed', 'true')
  })

  test('Cancel button closes the create sheet', async ({ page }) => {
    await page.goto('/exercises')
    await page.getByRole('button', { name: 'New' }).click()
    await expect(page.getByRole('dialog', { name: /create custom exercise/i })).toBeVisible()
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByRole('dialog', { name: /create custom exercise/i })).not.toBeVisible()
  })

  test('exercises page is accessible via nav', async ({ page }) => {
    await page.goto('/')
    const nav = page.getByRole('navigation', { name: 'Primary navigation' })
    await nav.getByRole('link', { name: 'Exercises' }).click()
    await expect(page.locator('h1')).toContainText('Exercises')
    await expect(nav.getByRole('link', { name: 'Exercises' })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })
})

test.describe('DB persistence — custom exercise flows', () => {
  test('custom exercise persists after navigation and appears in workout picker', async ({
    page,
  }) => {
    // Create custom exercise
    await page.goto('/exercises')
    await expect(page.getByText('Barbell Squat')).toBeVisible({ timeout: 20_000 })
    await page.getByRole('button', { name: 'New' }).click()
    const dialog = page.getByRole('dialog', { name: /create custom exercise/i })
    await dialog.getByRole('textbox', { name: /exercise name/i }).fill('E2E Custom Move')
    await dialog.getByRole('button', { name: /create/i }).click()
    await expect(page.getByText('E2E Custom Move')).toBeVisible()

    // Navigate to workout and open exercise picker
    await page.goto('/workout')
    await page.getByLabel('Session type').selectOption('gym')
    await page.getByRole('button', { name: /start empty session/i }).click()
    await expect(page.getByText('Active Session')).toBeVisible({ timeout: 10_000 })
    await page.getByRole('button', { name: /add exercise/i }).click()
    await expect(page.getByRole('dialog', { name: /add exercise/i })).toBeVisible()

    // Search for the custom exercise
    const picker = page.getByRole('dialog', { name: /add exercise/i })
    await picker.getByRole('searchbox', { name: /search exercises/i }).fill('E2E Custom Move')
    await expect(picker.getByRole('button', { name: /E2E Custom Move/i })).toBeVisible()
  })

  test('custom exercise can be added to a workout and set logged', async ({ page }) => {
    // Create custom exercise
    await page.goto('/exercises')
    await expect(page.getByText('Barbell Squat')).toBeVisible({ timeout: 20_000 })
    await page.getByRole('button', { name: 'New' }).click()
    const dialog = page.getByRole('dialog', { name: /create custom exercise/i })
    await dialog.getByRole('textbox', { name: /exercise name/i }).fill('E2E Custom Lift')
    await dialog.getByRole('button', { name: /create/i }).click()
    await expect(page.getByText('E2E Custom Lift')).toBeVisible()

    // Start a workout and add the custom exercise
    await page.goto('/workout')
    await page.getByLabel('Session type').selectOption('gym')
    await page.getByRole('button', { name: /start empty session/i }).click()
    await expect(page.getByText('Active Session')).toBeVisible({ timeout: 10_000 })
    await page.getByRole('button', { name: /add exercise/i }).click()
    const picker = page.getByRole('dialog', { name: /add exercise/i })
    await picker.getByRole('searchbox', { name: /search exercises/i }).fill('E2E Custom Lift')
    await picker.getByRole('button', { name: /E2E Custom Lift/i }).click()
    const exercise = page.getByRole('region', { name: 'E2E Custom Lift' })
    await exercise.getByRole('button', { name: '+ Set' }).click()
    const setDialog = page.getByRole('dialog', { name: /edit set 1.*e2e custom lift/i })
    await expect(setDialog).toBeVisible()
    await setDialog.getByLabel('Weight', { exact: true }).fill('50')
    await setDialog.getByLabel('Reps', { exact: true }).fill('10')
    await setDialog.getByRole('button', { name: 'Save Changes', exact: true }).click()
    await expect(setDialog).not.toBeVisible()
    await exercise
      .getByRole('button', { name: 'Complete set 1 for E2E Custom Lift', exact: true })
      .click()
    await expect(
      exercise.getByRole('button', { name: 'Edit set 1 for E2E Custom Lift' }),
    ).toContainText('50')
  })
})
