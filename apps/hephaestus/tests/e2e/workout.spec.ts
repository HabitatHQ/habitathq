import { expect, test } from '@playwright/test'

test.describe('Workout flow', () => {
  test('can start an empty workout session', async ({ page }) => {
    await page.goto('/workout')
    await expect(page.locator('h1')).toContainText('Workout')
    await expect(page.getByRole('button', { name: /start empty session/i })).toBeVisible()
    await page.getByRole('button', { name: /start empty session/i }).click()
    // After starting, the header should show "Active Session"
    await expect(page.getByText('Active Session')).toBeVisible({ timeout: 10_000 })
  })

  test('active workout shows elapsed timer and Finish button', async ({ page }) => {
    await page.goto('/workout')
    await page.getByRole('button', { name: /start empty session/i }).click()
    await expect(page.getByText('Active Session')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByRole('button', { name: /finish/i })).toBeVisible()
    // Timer should show 0:00 initially
    await expect(page.getByText('⏱')).toBeVisible()
  })

  test('can add an exercise to workout', async ({ page }) => {
    await page.goto('/workout')
    await page.getByRole('button', { name: /start empty session/i }).click()
    await expect(page.getByText('Active Session')).toBeVisible({ timeout: 10_000 })

    // Click Add Exercise
    await page.getByRole('button', { name: /add exercise/i }).click()

    // Exercise picker dialog should appear
    await expect(page.getByRole('dialog', { name: /add exercise/i })).toBeVisible()

    // Wait for exercises to load (seeded from DB)
    await expect(page.getByRole('list').locator('button').first()).toBeVisible({ timeout: 15_000 })
  })

  test('can search for an exercise in the picker', async ({ page }) => {
    await page.goto('/workout')
    await page.getByRole('button', { name: /start empty session/i }).click()
    await expect(page.getByText('Active Session')).toBeVisible({ timeout: 10_000 })
    await page.getByRole('button', { name: /add exercise/i }).click()
    await expect(page.getByRole('dialog', { name: /add exercise/i })).toBeVisible()

    // Wait for exercise list
    await expect(page.getByRole('list').locator('button').first()).toBeVisible({ timeout: 15_000 })

    // Search for squat
    await page.getByRole('searchbox', { name: /search exercises/i }).fill('squat')
    await expect(page.getByText(/squat/i).first()).toBeVisible()
  })

  test('can add exercise and log a set', async ({ page }) => {
    await page.goto('/workout')
    await page.getByRole('button', { name: /start empty session/i }).click()
    await expect(page.getByText('Active Session')).toBeVisible({ timeout: 10_000 })

    await page.getByRole('button', { name: /add exercise/i }).click()
    await expect(page.getByRole('dialog', { name: /add exercise/i })).toBeVisible()
    await expect(page.getByRole('list').locator('button').first()).toBeVisible({ timeout: 15_000 })

    // Search and select Barbell Squat
    await page.getByRole('searchbox', { name: /search exercises/i }).fill('barbell squat')
    await page.getByText('Barbell Squat').first().click()

    // Exercise block should appear
    await expect(page.getByText('Barbell Squat')).toBeVisible()

    // Click + Set button
    await page.getByRole('button', { name: /\+ set/i }).click()

    // Log set dialog should appear
    await expect(page.getByRole('dialog', { name: /log set/i })).toBeVisible()

    // Fill weight and reps
    await page.getByLabel('Weight').fill('100')
    await page.getByLabel('Reps').fill('5')

    // Log the set
    await page.getByRole('button', { name: /log set/i }).click()

    // Dialog should close and set should appear
    await expect(page.getByRole('dialog', { name: /log set/i })).not.toBeVisible()
  })

  test('can finish workout and see summary', async ({ page }) => {
    await page.goto('/workout')
    await page.getByRole('button', { name: /start empty session/i }).click()
    await expect(page.getByText('Active Session')).toBeVisible({ timeout: 10_000 })

    // Click Finish without any sets
    await page.getByRole('button', { name: /finish/i }).click()

    // Finish sheet should appear
    await expect(page.getByRole('dialog', { name: /finish workout/i })).toBeVisible()

    // Save the workout
    await page.getByRole('button', { name: /save workout/i }).click()

    // Summary should appear
    await expect(page.locator('h1')).toContainText('Session Complete')
    await expect(page.getByText('Duration')).toBeVisible()
    await expect(page.getByRole('button', { name: /done/i })).toBeVisible()
  })

  test('Done button after summary returns to start screen', async ({ page }) => {
    await page.goto('/workout')
    await page.getByRole('button', { name: /start empty session/i }).click()
    await expect(page.getByText('Active Session')).toBeVisible({ timeout: 10_000 })
    await page.getByRole('button', { name: /finish/i }).click()
    await expect(page.getByRole('dialog', { name: /finish workout/i })).toBeVisible()
    await page.getByRole('button', { name: /save workout/i }).click()
    await expect(page.locator('h1')).toContainText('Session Complete')
    await page.getByRole('button', { name: /done/i }).click()
    await expect(page.locator('h1')).toContainText('Workout')
    await expect(page.getByRole('button', { name: /start empty session/i })).toBeVisible()
  })
})

test.describe('Exercise picker', () => {
  test('picker can be closed with X button', async ({ page }) => {
    await page.goto('/workout')
    await page.getByRole('button', { name: /start empty session/i }).click()
    await expect(page.getByText('Active Session')).toBeVisible({ timeout: 10_000 })
    await page.getByRole('button', { name: /add exercise/i }).click()
    await expect(page.getByRole('dialog', { name: /add exercise/i })).toBeVisible()
    await page.getByRole('button', { name: /close exercise picker/i }).click()
    await expect(page.getByRole('dialog', { name: /add exercise/i })).not.toBeVisible()
  })

  test('search is cleared when picker closes and reopens', async ({ page }) => {
    await page.goto('/workout')
    await page.getByRole('button', { name: /start empty session/i }).click()
    await expect(page.getByText('Active Session')).toBeVisible({ timeout: 10_000 })
    await page.getByRole('button', { name: /add exercise/i }).click()
    await page.getByRole('searchbox', { name: /search exercises/i }).fill('squat')
    await page.getByRole('button', { name: /close exercise picker/i }).click()
    // Reopen — search should be empty
    await page.getByRole('button', { name: /add exercise/i }).click()
    await expect(page.getByRole('searchbox', { name: /search exercises/i })).toHaveValue('')
  })
})

test.describe('Log set sheet', () => {
  async function openSetSheet(page: import('@playwright/test').Page) {
    await page.goto('/workout')
    await page.getByRole('button', { name: /start empty session/i }).click()
    await expect(page.getByText('Active Session')).toBeVisible({ timeout: 10_000 })
    await page.getByRole('button', { name: /add exercise/i }).click()
    await expect(page.getByRole('list').locator('button').first()).toBeVisible({ timeout: 15_000 })
    await page.getByRole('searchbox', { name: /search exercises/i }).fill('barbell squat')
    await page.getByText('Barbell Squat').first().click()
    await page.getByRole('button', { name: /\+ set/i }).click()
    await expect(page.getByRole('dialog', { name: /log set/i })).toBeVisible()
  }

  test('Log Set button is disabled when weight or reps are empty', async ({ page }) => {
    await openSetSheet(page)
    // Clear any pre-filled values
    await page.getByLabel('Weight').fill('')
    await page.getByLabel('Reps').fill('')
    await expect(page.getByRole('button', { name: /log set/i })).toBeDisabled()
  })

  test('Log Set button is enabled when weight and reps are filled', async ({ page }) => {
    await openSetSheet(page)
    await page.getByLabel('Weight').fill('80')
    await page.getByLabel('Reps').fill('8')
    await expect(page.getByRole('button', { name: /log set/i })).toBeEnabled()
  })

  test('close button dismisses the sheet without logging', async ({ page }) => {
    await openSetSheet(page)
    await page.getByRole('button', { name: /^close$/i }).click()
    await expect(page.getByRole('dialog', { name: /log set/i })).not.toBeVisible()
  })

  test('weight +/- buttons nudge the value', async ({ page }) => {
    await openSetSheet(page)
    await page.getByLabel('Weight').fill('100')
    await page.getByRole('button', { name: /increase weight/i }).click()
    await expect(page.getByLabel('Weight')).toHaveValue('102.5')
    await page.getByRole('button', { name: /decrease weight/i }).click()
    await expect(page.getByLabel('Weight')).toHaveValue('100')
  })

  test('reps +/- buttons nudge the value', async ({ page }) => {
    await openSetSheet(page)
    await page.getByLabel('Reps').fill('5')
    await page.getByRole('button', { name: /increase reps/i }).click()
    await expect(page.getByLabel('Reps')).toHaveValue('6')
    await page.getByRole('button', { name: /decrease reps/i }).click()
    await expect(page.getByLabel('Reps')).toHaveValue('5')
  })
})

test.describe('Finish workout sheet', () => {
  async function startWorkout(page: import('@playwright/test').Page) {
    await page.goto('/workout')
    await page.getByRole('button', { name: /start empty session/i }).click()
    await expect(page.getByText('Active Session')).toBeVisible({ timeout: 10_000 })
  }

  test('Cancel button closes the finish sheet', async ({ page }) => {
    await startWorkout(page)
    await page.getByRole('button', { name: /finish/i }).click()
    await expect(page.getByRole('dialog', { name: /finish workout/i })).toBeVisible()
    await page.getByRole('button', { name: /cancel/i }).click()
    await expect(page.getByRole('dialog', { name: /finish workout/i })).not.toBeVisible()
    // Still in active workout
    await expect(page.getByText('Active Session')).toBeVisible()
  })

  test('clicking backdrop closes the finish sheet', async ({ page }) => {
    await startWorkout(page)
    await page.getByRole('button', { name: /finish/i }).click()
    await expect(page.getByRole('dialog', { name: /finish workout/i })).toBeVisible()
    // Click the semi-transparent backdrop (role=presentation)
    await page.locator('[role=presentation]').click({ position: { x: 10, y: 10 } })
    await expect(page.getByRole('dialog', { name: /finish workout/i })).not.toBeVisible()
  })

  test('mood rating buttons are selectable', async ({ page }) => {
    await startWorkout(page)
    await page.getByRole('button', { name: /finish/i }).click()
    await page.getByRole('button', { name: /mood rating 3/i }).click()
    await expect(page.getByRole('button', { name: /mood rating 3/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  test('summary shows Working Sets and Volume stat cards', async ({ page }) => {
    await startWorkout(page)
    await page.getByRole('button', { name: /finish/i }).click()
    await page.getByRole('button', { name: /save workout/i }).click()
    await expect(page.locator('h1')).toContainText('Session Complete')
    await expect(page.getByText('Working Sets')).toBeVisible()
    await expect(page.getByText('Volume')).toBeVisible()
    await expect(page.getByText('PRs')).toBeVisible()
  })
})

test.describe('Rest timer', () => {
  test('rest timer does not show before any set is logged', async ({ page }) => {
    await page.goto('/workout')
    await page.getByRole('button', { name: /start empty session/i }).click()
    await expect(page.getByText('Active Session')).toBeVisible({ timeout: 10_000 })
    // Rest timer should not be visible
    await expect(page.getByRole('button', { name: /skip/i })).not.toBeVisible()
  })
})
