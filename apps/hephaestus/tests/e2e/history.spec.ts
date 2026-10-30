import { expect, test } from '@playwright/test'

test.describe('History page', () => {
  test('selecting a session filter updates its accessible state', async ({ page }) => {
    await page.goto('/history')
    const group = page.getByRole('group', { name: /filter by session type/i })
    const strength = group.getByRole('button', { name: 'Strength', exact: true })
    const all = group.getByRole('button', { name: 'All', exact: true })
    await expect(all).toHaveAttribute('aria-pressed', 'true')
    await strength.click()
    await expect(strength).toHaveAttribute('aria-pressed', 'true')
    await expect(all).toHaveAttribute('aria-pressed', 'false')
    await all.click()
    await expect(all).toHaveAttribute('aria-pressed', 'true')
    await expect(strength).toHaveAttribute('aria-pressed', 'false')
  })

  test('empty history offers a working route to start a workout', async ({ page }) => {
    await page.goto('/history')
    await expect(page.getByText(/loading workouts/i)).not.toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('main').getByRole('listitem')).toHaveCount(0)
    await page.getByRole('link', { name: /start workout/i }).click()
    await expect(page).toHaveURL('/workout')
    await expect(page.getByRole('button', { name: /start empty session/i })).toBeEnabled()
  })
})
