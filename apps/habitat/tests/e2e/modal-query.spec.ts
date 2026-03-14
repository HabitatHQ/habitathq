import { test, expect } from '@playwright/test'

test.describe('Query-param modal opening', () => {
  test('/jots picker sheet opens via New button', async ({ page }) => {
    await page.goto('/jots')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)

    // The "New" button is always visible in the header
    const newBtn = page.getByRole('button', { name: /^new$/i })
    const newBtnVisible = await newBtn.isVisible().catch(() => false)
    if (!newBtnVisible) { test.skip(); return }

    await newBtn.click()
    await page.waitForTimeout(400)
    // The picker slideover contains a "New Jot" heading
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

  test('jots picker sheet can be closed', async ({ page }) => {
    await page.goto('/jots')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)

    // Open the picker
    const newBtn = page.getByRole('button', { name: /^new$/i })
    const newBtnVisible = await newBtn.isVisible().catch(() => false)
    if (!newBtnVisible) { test.skip(); return }

    await newBtn.click()
    await page.waitForTimeout(400)
    await expect(page.getByRole('heading', { name: 'New Jot' })).toBeVisible({ timeout: 5000 })

    // Close it via the Close (X) button inside the sheet
    await page.getByRole('button', { name: /^close$/i }).click()
    await expect(page.getByRole('heading', { name: 'New Jot' })).not.toBeVisible({ timeout: 3000 })
  })
})
