/**
 * E2E tests for Jots (scribbles) CRUD.
 *
 * Covers: create text jot via direct navigation, view in list.
 */
import { test, expect } from './fixtures'

test.describe('Jots CRUD', () => {
  test('creates a text jot and shows it in the list', async ({ page }) => {
    await page.goto('/jots/new')
    await page.waitForLoadState('networkidle')

    await expect(page.getByPlaceholder('Title (optional)')).toBeVisible({ timeout: 8000 })

    await page.getByPlaceholder('Title (optional)').fill('My first jot')
    await page.getByPlaceholder('Start writing…').fill('Some content here')

    await page.getByRole('button', { name: 'Create' }).click()

    // Navigates back to /jots
    await page.waitForLoadState('networkidle')
    await expect(page.getByText('My first jot')).toBeVisible({ timeout: 8000 })
  })

  test('navigates to edit page for existing jot', async ({ page }) => {
    // Create a jot first
    await page.goto('/jots/new')
    await page.waitForLoadState('networkidle')

    await page.getByPlaceholder('Title (optional)').fill('Editable jot')
    await page.getByPlaceholder('Start writing…').fill('Original content')
    await page.getByRole('button', { name: 'Create' }).click()
    await page.waitForLoadState('networkidle')

    // Click on the jot to edit
    await expect(page.getByText('Editable jot')).toBeVisible({ timeout: 8000 })
    await page.getByText('Editable jot').click()
    await page.waitForLoadState('networkidle')

    await expect(page.getByPlaceholder('Title (optional)')).toBeVisible({ timeout: 8000 })
    await expect(page.getByPlaceholder('Title (optional)')).toHaveValue('Editable jot')
  })
})
