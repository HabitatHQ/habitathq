/**
 * E2E tests for Todo lifecycle.
 *
 * Covers: create a todo, verify it appears.
 */
import { test, expect } from './fixtures'

test.describe('Todo lifecycle', () => {
  test('creates a todo and shows it in the list', async ({ page }) => {
    await page.goto('/todos')
    await page.waitForLoadState('networkidle')

    await page.getByRole('button', { name: 'Add' }).click()

    const titleInput = page.getByPlaceholder('What needs doing?')
    await expect(titleInput).toBeVisible({ timeout: 8000 })

    await titleInput.fill('Buy groceries')

    await page.getByRole('button', { name: 'Save' }).click()

    await expect(titleInput).not.toBeVisible({ timeout: 5000 })
    await expect(page.getByText('Buy groceries')).toBeVisible({ timeout: 8000 })
  })
})
