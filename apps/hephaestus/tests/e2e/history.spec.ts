import { expect, test } from '@playwright/test'

test.describe('History page', () => {
  test('loads with heading', async ({ page }) => {
    await page.goto('/history')
    await expect(page.locator('h1')).toContainText('History')
  })

  test('shows filter chips for all session types', async ({ page }) => {
    await page.goto('/history')
    const group = page.getByRole('group', { name: /filter by session type/i })
    await expect(group).toBeVisible()
    await expect(group.getByRole('button', { name: 'All' })).toBeVisible()
    await expect(group.getByRole('button', { name: 'Gym' })).toBeVisible()
    await expect(group.getByRole('button', { name: 'Runs' })).toBeVisible()
  })

  test('All filter chip is active by default', async ({ page }) => {
    await page.goto('/history')
    const allBtn = page
      .getByRole('group', { name: /filter by session type/i })
      .getByRole('button', { name: 'All' })
    await expect(allBtn).toHaveAttribute('aria-pressed', 'true')
  })

  test('can switch to Gym filter', async ({ page }) => {
    await page.goto('/history')
    const group = page.getByRole('group', { name: /filter by session type/i })
    await group.getByRole('button', { name: 'Gym' }).click()
    await expect(group.getByRole('button', { name: 'Gym' })).toHaveAttribute('aria-pressed', 'true')
    await expect(group.getByRole('button', { name: 'All' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })

  test('shows empty state when no workouts exist', async ({ page }) => {
    await page.goto('/history')
    // Wait for loading to complete
    await expect(page.getByText(/loading workouts/i)).not.toBeVisible({ timeout: 15_000 })
    // With a fresh DB, there should be no workouts
    await expect(page.getByText(/no workouts yet/i)).toBeVisible()
  })

  test('empty state has link to start workout', async ({ page }) => {
    await page.goto('/history')
    await expect(page.getByText(/loading workouts/i)).not.toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('link', { name: /start workout/i })).toBeVisible()
  })
})
