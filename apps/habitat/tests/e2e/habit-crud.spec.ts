/**
 * E2E tests for habit CRUD operations (BOOLEAN type).
 *
 * Covers: create habit, verify on home page, toggle completion.
 */
import { test, expect } from './fixtures'

async function createBooleanHabit(
  page: import('@playwright/test').Page,
  name: string,
) {
  await page.goto('/habits')
  await page.waitForLoadState('networkidle')

  await page.getByRole('button', { name: 'New' }).click()
  await expect(page.getByRole('heading', { name: 'New Habit' })).toBeVisible({ timeout: 8000 })

  await page.getByPlaceholder('e.g. Morning run').fill(name)
  await page.getByRole('button', { name: 'Create' }).click()

  await expect(page.getByRole('heading', { name: 'New Habit' })).not.toBeVisible()
  await expect(page.getByText(name)).toBeVisible({ timeout: 8000 })
}

test.describe('Habit CRUD', () => {
  test('creates a boolean habit and shows it in the habits list', async ({ page }) => {
    await createBooleanHabit(page, 'Morning meditation')
    await expect(page.getByText('Morning meditation')).toBeVisible()
  })

  test('newly created habit appears on home page', async ({ page }) => {
    await createBooleanHabit(page, 'Evening walk')

    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await expect(page.getByText('Evening walk')).toBeVisible({ timeout: 8000 })
  })

  test('toggle completion on home page marks habit done', async ({ page }) => {
    await createBooleanHabit(page, 'Read 10 pages')

    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await expect(page.getByText('Read 10 pages')).toBeVisible({ timeout: 8000 })

    const toggleBtn = page.locator('button.rounded-full.border-2').first()
    await toggleBtn.click()

    // After toggle, the button should be filled (bg-primary-500)
    await expect(toggleBtn).toHaveClass(/bg-primary/, { timeout: 5000 })
  })

  test('navigates to habit detail page from habits list', async ({ page }) => {
    await createBooleanHabit(page, 'Daily journaling')

    await page.getByText('Daily journaling').click()
    await page.waitForLoadState('networkidle')

    await expect(page.getByText('Daily journaling')).toBeVisible({ timeout: 8000 })
    await expect(page.getByText('Current streak')).toBeVisible()
  })
})
