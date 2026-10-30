import { expect, type Page, test } from '@playwright/test'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function completeWorkout(page: Page) {
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
  const dialog = page.getByRole('dialog', { name: /edit set 1.*barbell squat/i })
  await dialog.getByLabel('Weight', { exact: true }).fill('80')
  await dialog.getByLabel('Reps', { exact: true }).fill('8')
  await dialog.getByRole('button', { name: 'Save Changes', exact: true }).click()
  await exercise
    .getByRole('button', { name: 'Complete set 1 for Barbell Squat', exact: true })
    .click()

  const timer = page.getByRole('timer')
  if (await timer.isVisible().catch(() => false))
    await timer.getByRole('button', { name: 'Skip' }).click()

  // Finish workout
  await page.getByRole('button', { name: /finish/i }).click()
  await expect(page.getByRole('dialog', { name: /finish workout/i })).toBeVisible()
  await page.getByRole('button', { name: /save workout/i }).click()
  await expect(page.locator('h1')).toContainText('Session Complete', { timeout: 10_000 })
  await page.getByRole('button', { name: /done/i }).click()
}

// ---------------------------------------------------------------------------
// History detail page
// ---------------------------------------------------------------------------

test.describe('history detail page', () => {
  test('filters completed sessions and opens their detail page', async ({ page }) => {
    await completeWorkout(page)
    await page.goto('/history')
    const filters = page.getByRole('group', { name: 'Filter by session type' })
    const workoutLink = page.getByRole('link', { name: /^strength session\b/i })
    await expect(workoutLink).toBeVisible({ timeout: 10_000 })
    const href = await workoutLink.getAttribute('href')
    expect(href).toMatch(/^\/history\/[^/]+$/)
    await filters.getByRole('button', { name: 'Strength', exact: true }).click()
    await expect(workoutLink).toBeVisible()
    await filters.getByRole('button', { name: 'Run', exact: true }).click()
    await expect(workoutLink).toHaveCount(0)
    await filters.getByRole('button', { name: 'All', exact: true }).click()
    await expect(workoutLink).toHaveAttribute('href', href as string)
    await workoutLink.click()
    await expect(page).toHaveURL(href as string)
  })

  test('reviews and persists numeric factual corrections without duplicating completed work', async ({
    page,
  }) => {
    await completeWorkout(page)
    await page.goto('/history')
    await page.getByRole('link', { name: /^strength session\b/i }).click()
    const sets = page.getByRole('table', { name: 'Sets for Barbell Squat' })
    await expect(sets.getByRole('row')).toHaveCount(2)
    await expect(sets.getByRole('cell', { name: '80 kg', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Correct workout', exact: true }).click()
    await page.locator('summary').filter({ hasText: 'Barbell Squat · included' }).click()
    await page.locator('summary').filter({ hasText: 'Set 1 · included' }).click()
    const panel = page.getByRole('region', { name: 'Correct workout facts' })
    const correctedTitle = 'Corrected squat session'
    await panel.getByLabel('Title', { exact: true }).fill(correctedTitle)
    await panel.getByLabel('Weight kg', { exact: true }).fill('85')
    await panel.getByLabel('Reps', { exact: true }).fill('6')
    await panel.getByRole('button', { name: 'Review correction', exact: true }).click()
    await expect(sets.getByRole('cell', { name: '80 kg', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Apply reviewed correction', exact: true }).click()
    await expect(panel).not.toBeVisible()
    await expect(sets.getByRole('row')).toHaveCount(2)
    await expect(sets.getByRole('cell', { name: '85 kg', exact: true })).toBeVisible()
    await expect(sets.getByRole('cell', { name: '6', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { level: 1, name: correctedTitle })).toBeVisible()
    await page.reload()
    await expect(sets.getByRole('row')).toHaveCount(2)
    await expect(sets.getByRole('cell', { name: '85 kg', exact: true })).toBeVisible()
    await expect(sets.getByRole('cell', { name: '6', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { level: 1, name: correctedTitle })).toBeVisible()
    const detailPath = new URL(page.url()).pathname
    await page.goto('/history')
    const historyLink = page.getByRole('link', { name: new RegExp(`^${correctedTitle}\\b`) })
    await expect(historyLink).toHaveAttribute('href', detailPath)
    await page.goto('/')
    const recentActivity = page.getByRole('region', { name: 'Recent Activity' })
    await expect(
      recentActivity.getByRole('link', { name: new RegExp(`^${correctedTitle}\\b`) }),
    ).toHaveAttribute('href', detailPath)
  })

  test('detail page shows exercise with set data', async ({ page }) => {
    await completeWorkout(page)

    await page.goto('/history')
    await expect(page.getByText(/loading workouts/i)).not.toBeVisible({ timeout: 15_000 })

    const workoutLink = page.getByRole('link', { name: /^strength session\b/i })
    await workoutLink.click()

    const exercise = page.getByRole('region', { name: 'Barbell Squat', exact: true })
    const sets = exercise.getByRole('table', { name: 'Sets for Barbell Squat' })
    await expect(sets.getByRole('row')).toHaveCount(2)
    await expect(sets.getByRole('cell', { name: '80 kg', exact: true })).toBeVisible()
    await expect(sets.getByRole('cell', { name: '8', exact: true })).toBeVisible()
  })

  test('back link navigates to history list', async ({ page }) => {
    await completeWorkout(page)

    await page.goto('/history')
    await expect(page.getByText(/loading workouts/i)).not.toBeVisible({ timeout: 15_000 })

    const workoutLink = page.getByRole('link', { name: /^strength session\b/i })
    await workoutLink.click()

    await page.getByRole('link', { name: /back to history/i }).click()
    await expect(page.locator('h1')).toContainText('History')
    await expect(page.url()).toMatch(/\/history$/)
  })

  test('invalid workout IDs offer a working route back to history', async ({ page }) => {
    await page.goto('/history/nonexistent-id-that-does-not-exist')
    await expect(page.getByRole('alert')).toContainText(/workout not found/i)
    await page.getByRole('link', { name: /go to history/i }).click()
    await expect(page).toHaveURL('/history')
    await expect(page.getByRole('heading', { name: 'History', exact: true })).toBeVisible()
  })
})
