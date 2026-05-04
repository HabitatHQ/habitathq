/**
 * E2E tests for the global search feature.
 *
 * Covers: search with results, no results, close on Escape.
 */
import { test, expect } from './fixtures'

test.describe('Global search', () => {
  test('finds a habit by name', async ({ page }) => {
    // Create a habit to search for
    await page.goto('/habits')
    await page.waitForLoadState('networkidle')

    await page.getByRole('button', { name: 'New' }).click()
    await expect(page.getByRole('heading', { name: 'New Habit' })).toBeVisible({ timeout: 8000 })

    await page.getByPlaceholder('e.g. Morning run').fill('Unique searchable habit')
    await page.getByRole('button', { name: 'Create' }).click()
    await expect(page.getByRole('heading', { name: 'New Habit' })).not.toBeVisible()

    // Now search from home page
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // Open search modal via the search button
    const searchBtn = page.getByRole('button', { name: /search/i })
    await searchBtn.click()

    // Search input placeholder has an ellipsis character
    const searchInput = page.locator('input[placeholder*="Search"]')
    await expect(searchInput).toBeVisible({ timeout: 5000 })
    await searchInput.fill('Unique searchable')

    // Should show the habit in results
    await expect(page.getByText('Unique searchable habit')).toBeVisible({ timeout: 8000 })
  })

  test('shows no results for nonexistent query', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    const searchBtn = page.getByRole('button', { name: /search/i })
    await searchBtn.click()

    const searchInput = page.locator('input[placeholder*="Search"]')
    await expect(searchInput).toBeVisible({ timeout: 5000 })
    await searchInput.fill('zzz_nonexistent_zzz')

    await expect(page.getByText('No results')).toBeVisible({ timeout: 5000 })
  })

  test('closes search modal on Escape', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    const searchBtn = page.getByRole('button', { name: /search/i })
    await searchBtn.click()

    const searchInput = page.locator('input[placeholder*="Search"]')
    await expect(searchInput).toBeVisible({ timeout: 5000 })

    // Escape on the input should close the modal
    await searchInput.press('Escape')
    await expect(searchInput).not.toBeVisible({ timeout: 3000 })
  })
})
