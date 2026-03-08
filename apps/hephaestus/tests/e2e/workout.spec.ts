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

test.describe('Rest timer', () => {
  test('rest timer does not show before any set is logged', async ({ page }) => {
    await page.goto('/workout')
    await page.getByRole('button', { name: /start empty session/i }).click()
    await expect(page.getByText('Active Session')).toBeVisible({ timeout: 10_000 })
    // Rest timer should not be visible
    await expect(page.getByRole('button', { name: /skip/i })).not.toBeVisible()
  })
})
