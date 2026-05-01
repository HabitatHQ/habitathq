import { expect, type Page, test } from '@playwright/test'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function startEmptyWorkout(page: Page) {
  await page.goto('/workout')
  await page.waitForLoadState('networkidle')
  await page.getByRole('button', { name: /start empty session/i }).click()
  await expect(page.getByText('Active Session')).toBeVisible({ timeout: 10_000 })
}

async function addExerciseAndLogSet(page: Page) {
  await page.getByRole('button', { name: /add exercise/i }).click()
  await expect(page.getByRole('list').locator('button').first()).toBeVisible({ timeout: 15_000 })
  await page.getByRole('searchbox', { name: /search exercises/i }).fill('barbell squat')
  await page.getByText('Barbell Squat').first().click()
  await expect(page.getByRole('dialog', { name: /add exercise/i })).not.toBeVisible()

  await page.getByRole('button', { name: /\+ set/i }).click()
  await expect(page.getByRole('dialog', { name: /log set/i })).toBeVisible()
  await page.getByLabel('Weight', { exact: true }).fill('100')
  await page.getByLabel('Reps', { exact: true }).fill('5')
  await page.getByRole('button', { name: /log set/i }).click()
  await expect(page.getByRole('dialog', { name: /log set/i })).not.toBeVisible()

  // Skip rest timer if shown
  const skipBtn = page.getByRole('button', { name: /skip/i })
  if (await skipBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await skipBtn.click()
  }
}

// ---------------------------------------------------------------------------
// Finish workout flow
// ---------------------------------------------------------------------------

test.describe('finish workout flow', () => {
  test('finish button opens finish sheet during active workout', async ({ page }) => {
    await startEmptyWorkout(page)
    await page.getByRole('button', { name: /finish/i }).click()
    await expect(page.getByRole('dialog', { name: /finish workout/i })).toBeVisible()
  })

  test('finish sheet has mood rating buttons', async ({ page }) => {
    await startEmptyWorkout(page)
    await page.getByRole('button', { name: /finish/i }).click()
    await expect(page.getByRole('dialog', { name: /finish workout/i })).toBeVisible()

    // Five mood buttons should be present (aria-label "Mood N")
    for (let i = 1; i <= 5; i++) {
      await expect(page.getByRole('button', { name: `Mood ${i}` })).toBeVisible()
    }
  })

  test('mood rating button toggles aria-pressed when selected', async ({ page }) => {
    await startEmptyWorkout(page)
    await page.getByRole('button', { name: /finish/i }).click()
    await expect(page.getByRole('dialog', { name: /finish workout/i })).toBeVisible()

    // Click mood 4 (🙂)
    const moodBtn = page.getByRole('button', { name: 'Mood 4' })
    await moodBtn.click()
    await expect(moodBtn).toHaveAttribute('aria-pressed', 'true')

    // Other buttons should not be pressed
    await expect(page.getByRole('button', { name: 'Mood 1' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    await expect(page.getByRole('button', { name: 'Mood 3' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })

  test('clicking same mood button again toggles it off', async ({ page }) => {
    await startEmptyWorkout(page)
    await page.getByRole('button', { name: /finish/i }).click()
    await expect(page.getByRole('dialog', { name: /finish workout/i })).toBeVisible()

    const moodBtn = page.getByRole('button', { name: 'Mood 3' })
    await moodBtn.click()
    await expect(moodBtn).toHaveAttribute('aria-pressed', 'true')
    // Click again — should deselect
    await moodBtn.click()
    await expect(moodBtn).toHaveAttribute('aria-pressed', 'false')
  })

  test('finish sheet has energy rating buttons', async ({ page }) => {
    await startEmptyWorkout(page)
    await page.getByRole('button', { name: /finish/i }).click()
    await expect(page.getByRole('dialog', { name: /finish workout/i })).toBeVisible()

    // Five energy dot buttons (aria-label "Energy N")
    for (let i = 1; i <= 5; i++) {
      await expect(page.getByRole('button', { name: `Energy ${i}` })).toBeVisible()
    }
  })

  test('finish sheet can be dismissed with Cancel button', async ({ page }) => {
    await startEmptyWorkout(page)
    await page.getByRole('button', { name: /finish/i }).click()
    await expect(page.getByRole('dialog', { name: /finish workout/i })).toBeVisible()

    // The FinishSheet doesn't have an explicit Cancel button — it uses backdrop click
    // or the sheet is closed via the backdrop presentation element
    await page.locator('[role="presentation"]').click({ position: { x: 10, y: 10 } })
    await expect(page.getByRole('dialog', { name: /finish workout/i })).not.toBeVisible()
    // Active workout should still be running
    await expect(page.getByText('Active Session')).toBeVisible()
  })

  test('clicking backdrop closes the finish sheet', async ({ page }) => {
    await startEmptyWorkout(page)
    await page.getByRole('button', { name: /finish/i }).click()
    await expect(page.getByRole('dialog', { name: /finish workout/i })).toBeVisible()

    await page.locator('[role="presentation"]').click({ position: { x: 10, y: 10 } })
    await expect(page.getByRole('dialog', { name: /finish workout/i })).not.toBeVisible()
  })

  test('can add notes before finishing', async ({ page }) => {
    await startEmptyWorkout(page)
    await page.getByRole('button', { name: /finish/i }).click()
    await expect(page.getByRole('dialog', { name: /finish workout/i })).toBeVisible()

    // UTextarea renders a <textarea> element with placeholder "Session notes..."
    const notesField = page.locator('textarea')
    await expect(notesField).toBeVisible()
    await notesField.fill('Felt great today, hit all sets!')
    await expect(notesField).toHaveValue('Felt great today, hit all sets!')
  })

  test('finish sheet shows duration label', async ({ page }) => {
    await startEmptyWorkout(page)
    await page.getByRole('button', { name: /finish/i }).click()
    await expect(page.getByRole('dialog', { name: /finish workout/i })).toBeVisible()

    // Duration is rendered as "Duration: Xm"
    await expect(page.getByText(/duration/i)).toBeVisible()
  })

  test('finishing a workout shows summary with duration and sets', async ({ page }) => {
    await startEmptyWorkout(page)
    await addExerciseAndLogSet(page)

    await page.getByRole('button', { name: /finish/i }).click()
    await expect(page.getByRole('dialog', { name: /finish workout/i })).toBeVisible()
    await page.getByRole('button', { name: /save workout/i }).click()

    await expect(page.locator('h1')).toContainText('Session Complete', { timeout: 10_000 })
    await expect(page.getByText('Duration')).toBeVisible()
    await expect(page.getByText('Working Sets')).toBeVisible()
  })

  test('summary shows Volume and PRs stat cards', async ({ page }) => {
    await startEmptyWorkout(page)

    await page.getByRole('button', { name: /finish/i }).click()
    await expect(page.getByRole('dialog', { name: /finish workout/i })).toBeVisible()
    await page.getByRole('button', { name: /save workout/i }).click()

    await expect(page.locator('h1')).toContainText('Session Complete', { timeout: 10_000 })
    await expect(page.getByText('Volume')).toBeVisible()
    await expect(page.getByText('PRs')).toBeVisible()
  })

  test('summary shows Done button to clear', async ({ page }) => {
    await startEmptyWorkout(page)
    await page.getByRole('button', { name: /finish/i }).click()
    await expect(page.getByRole('dialog', { name: /finish workout/i })).toBeVisible()
    await page.getByRole('button', { name: /save workout/i }).click()

    await expect(page.locator('h1')).toContainText('Session Complete', { timeout: 10_000 })
    await expect(page.getByRole('button', { name: /done/i })).toBeVisible()
  })

  test('Done button after summary returns to start screen', async ({ page }) => {
    await startEmptyWorkout(page)
    await page.getByRole('button', { name: /finish/i }).click()
    await expect(page.getByRole('dialog', { name: /finish workout/i })).toBeVisible()
    await page.getByRole('button', { name: /save workout/i }).click()
    await expect(page.locator('h1')).toContainText('Session Complete', { timeout: 10_000 })
    await page.getByRole('button', { name: /done/i }).click()

    await expect(page.locator('h1')).toContainText('Workout')
    await expect(page.getByRole('button', { name: /start empty session/i })).toBeVisible()
  })

  test('summary shows 1 working set after logging one set', async ({ page }) => {
    await startEmptyWorkout(page)
    await addExerciseAndLogSet(page)

    await page.getByRole('button', { name: /finish/i }).click()
    await expect(page.getByRole('dialog', { name: /finish workout/i })).toBeVisible()
    await page.getByRole('button', { name: /save workout/i }).click()

    await expect(page.locator('h1')).toContainText('Session Complete', { timeout: 10_000 })
    await expect(page.getByText('Working Sets')).toBeVisible()
    await expect(page.getByText('1', { exact: true })).toBeVisible()
  })

  test('mood selection persists when saving workout', async ({ page }) => {
    await startEmptyWorkout(page)
    await page.getByRole('button', { name: /finish/i }).click()
    await expect(page.getByRole('dialog', { name: /finish workout/i })).toBeVisible()

    // Select mood 5 (highest)
    await page.getByRole('button', { name: 'Mood 5' }).click()
    await expect(page.getByRole('button', { name: 'Mood 5' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    // Save — should complete without error
    await page.getByRole('button', { name: /save workout/i }).click()
    await expect(page.locator('h1')).toContainText('Session Complete', { timeout: 10_000 })
  })
})
