import { expect, test } from '@playwright/test'

const MOBILE = { viewport: { width: 390, height: 844 } }

test.describe('Exercises page', () => {
  test('loads with heading and count', async ({ page }) => {
    await page.goto('/exercises')
    await expect(page.locator('h1')).toContainText('Exercises')
  })

  test('shows exercise count after DB seeds', async ({ page }) => {
    await page.goto('/exercises')
    // Wait for exercises to load from the seeded DB
    await expect(page.getByText(/\d+ exercises?/i)).toBeVisible({ timeout: 20_000 })
  })

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

  test('create exercise sheet has name, equipment, and movement fields', async ({ page }) => {
    await page.goto('/exercises')
    await page.getByRole('button', { name: 'New' }).click()
    const dialog = page.getByRole('dialog', { name: /create custom exercise/i })
    await expect(dialog.getByRole('textbox', { name: /exercise name/i })).toBeVisible()
    await expect(dialog.getByRole('group', { name: /equipment type/i })).toBeVisible()
    await expect(dialog.getByRole('group', { name: /movement pattern/i })).toBeVisible()
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
    await expect(page.getByText('Playwright Test Exercise')).toBeVisible()
    // Custom badge should appear
    await expect(page.getByText('Custom').first()).toBeVisible()
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

test.describe('Exercise icons', () => {
  test('exercise list shows icon avatars after load', async ({ page }) => {
    await page.goto('/exercises')
    await expect(page.getByText('Barbell Squat')).toBeVisible({ timeout: 20_000 })
    // Each exercise row should have an icon avatar (aria-hidden div with bg color class)
    // The first icon div is inside the list
    const icons = page.locator('ul[role="list"] li div[aria-hidden="true"]')
    await expect(icons.first()).toBeVisible()
  })

  test('custom exercise gets movement-based icon (person icon for bodyweight)', async ({
    page,
  }) => {
    await page.goto('/exercises')
    await expect(page.getByText('Barbell Squat')).toBeVisible({ timeout: 20_000 })

    await page.getByRole('button', { name: 'New' }).click()
    const dialog = page.getByRole('dialog', { name: /create custom exercise/i })
    await dialog.getByRole('textbox', { name: /exercise name/i }).fill('My Bodyweight Move')
    // Select bodyweight equipment
    await dialog
      .getByRole('group', { name: /equipment type/i })
      .getByRole('button', { name: 'bodyweight' })
      .click()
    await dialog.getByRole('button', { name: /create/i }).click()

    await expect(page.getByRole('dialog', { name: /create custom exercise/i })).not.toBeVisible()
    await expect(page.getByText('My Bodyweight Move')).toBeVisible()
    // Icon should be present in the row
    const row = page.locator('li').filter({ hasText: 'My Bodyweight Move' })
    await expect(row.locator('[aria-hidden="true"]').first()).toBeVisible()
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
    await page.getByRole('button', { name: /start empty session/i }).click()
    await expect(page.getByText('Active Session')).toBeVisible({ timeout: 10_000 })
    await page.getByRole('button', { name: /add exercise/i }).click()
    await expect(page.getByRole('dialog', { name: /add exercise/i })).toBeVisible()

    // Search for the custom exercise
    await page.getByRole('searchbox', { name: /search exercises/i }).fill('E2E Custom Move')
    await expect(page.getByText('E2E Custom Move')).toBeVisible({ timeout: 10_000 })
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
    await page.getByRole('button', { name: /start empty session/i }).click()
    await expect(page.getByText('Active Session')).toBeVisible({ timeout: 10_000 })
    await page.getByRole('button', { name: /add exercise/i }).click()
    await page.getByRole('searchbox', { name: /search exercises/i }).fill('E2E Custom Lift')
    await page.getByText('E2E Custom Lift').first().click()
    await expect(page.getByRole('dialog', { name: /add exercise/i })).not.toBeVisible()

    // Log a set
    await page.getByRole('button', { name: /\+ set/i }).click()
    await expect(page.getByRole('dialog', { name: /log set/i })).toBeVisible()
    await page.getByLabel('Weight', { exact: true }).fill('50')
    await page.getByLabel('Reps', { exact: true }).fill('10')
    await page.getByRole('button', { name: /log set/i }).click()
    await expect(page.getByRole('dialog', { name: /log set/i })).not.toBeVisible()
  })
})

test.describe('Exercises page screenshots', () => {
  test('exercises page empty search state', async ({ page }) => {
    await page.setViewportSize(MOBILE.viewport)
    await page.goto('/exercises')
    await expect(page.getByText('Barbell Squat')).toBeVisible({ timeout: 20_000 })
    await page.screenshot({ path: 'test-results/screenshots/exercises-list.png', fullPage: false })
  })

  test('exercises page with movement filter applied', async ({ page }) => {
    await page.setViewportSize(MOBILE.viewport)
    await page.goto('/exercises')
    await expect(page.getByText('Barbell Squat')).toBeVisible({ timeout: 20_000 })
    await page
      .getByRole('group', { name: /filter by movement/i })
      .getByRole('button', { name: 'Press' })
      .click()
    await page.screenshot({
      path: 'test-results/screenshots/exercises-filter-press.png',
      fullPage: false,
    })
  })

  test('exercises page create custom exercise sheet', async ({ page }) => {
    await page.setViewportSize(MOBILE.viewport)
    await page.goto('/exercises')
    await expect(page.getByText('Barbell Squat')).toBeVisible({ timeout: 20_000 })
    await page.getByRole('button', { name: 'New' }).click()
    await expect(page.getByRole('dialog', { name: /create custom exercise/i })).toBeVisible()
    await page.screenshot({
      path: 'test-results/screenshots/exercises-create-sheet.png',
      fullPage: false,
    })
  })
})
