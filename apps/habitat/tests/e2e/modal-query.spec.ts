import { test, expect } from '@playwright/test'

test.describe('Query-param modal opening', () => {
  test('/jots?modal=picker opens type-picker sheet', async ({ page }) => {
    await page.goto('/jots?modal=picker')
    await page.waitForLoadState('networkidle')
    // The picker modal contains a "New Jot" heading
    await expect(page.getByRole('heading', { name: 'New Jot' })).toBeVisible({ timeout: 5000 })
  })

  test('/jots?modal=text opens text editor', async ({ page }) => {
    await page.goto('/jots?modal=text')
    await page.waitForLoadState('networkidle')
    // The text modal contains a "New Jot" or "Edit Jot" heading
    await expect(page.getByRole('heading', { name: /Jot/ })).toBeVisible({ timeout: 5000 })
  })

  test('/todos?modal=add opens the add-todo sheet', async ({ page }) => {
    await page.goto('/todos?modal=add')
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('heading', { name: 'New TODO' })).toBeVisible({ timeout: 5000 })
  })

  test('closing the todo modal removes query param', async ({ page }) => {
    await page.goto('/todos?modal=add')
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('heading', { name: 'New TODO' })).toBeVisible({ timeout: 5000 })

    // Click backdrop / cancel button to close
    await page.getByRole('button', { name: 'Cancel' }).click()

    // URL should no longer have ?modal=add
    await expect(page).not.toHaveURL(/modal=add/)
  })

  test('/habits?modal=create opens the create-habit modal', async ({ page }) => {
    await page.goto('/habits?modal=create')
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('heading', { name: 'New Habit' })).toBeVisible({ timeout: 5000 })
  })

  test('/checkin?modal=create opens the create-template modal', async ({ page }) => {
    await page.goto('/checkin?modal=create')
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('heading', { name: 'New Check-in' })).toBeVisible({ timeout: 5000 })
  })

  test('closing the habit modal removes query param', async ({ page }) => {
    await page.goto('/habits?modal=create')
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('heading', { name: 'New Habit' })).toBeVisible({ timeout: 5000 })

    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(page).not.toHaveURL(/modal=create/)
  })

  test('closing the checkin modal removes query param', async ({ page }) => {
    await page.goto('/checkin?modal=create')
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('heading', { name: 'New Check-in' })).toBeVisible({ timeout: 5000 })

    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(page).not.toHaveURL(/modal=create/)
  })

  test('backdrop click on the jots picker closes modal and clears param', async ({ page }) => {
    await page.goto('/jots?modal=picker')
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('heading', { name: 'New Jot' })).toBeVisible({ timeout: 5000 })

    // Click the semi-transparent backdrop (outside the modal card)
    await page.locator('.fixed.inset-0').first().click({ position: { x: 10, y: 10 } })
    await expect(page).not.toHaveURL(/modal=picker/)
  })
})
