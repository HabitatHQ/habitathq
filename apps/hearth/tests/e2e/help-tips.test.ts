import { expect, test } from '@playwright/test'


test.describe('HelpTip — expand and collapse', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/envelopes')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1500)
  })

  test('clicking summary expands the content', async ({ page }) => {
    const details = page.locator('details#help-envelope-budgeting')
    const summary = details.locator('summary')
    await summary.click()
    await expect(details).toHaveAttribute('open', '')
  })

  test('clicking summary again collapses the content', async ({ page }) => {
    const details = page.locator('details#help-envelope-budgeting')
    const summary = details.locator('summary')
    await summary.click()
    await expect(details).toHaveAttribute('open', '')
    await summary.click()
    await expect(details).not.toHaveAttribute('open', '')
  })
})


test.describe('HelpTip — dismissal persistence', () => {
  test('dismiss button hides the tip and persists across reloads', async ({ page }) => {
    await page.goto('/envelopes')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1500)

    const details = page.locator('details#help-envelope-budgeting')
    await expect(details).toBeVisible()

    // Expand and dismiss
    await details.locator('summary').click()
    await page.getByRole('button', { name: "Don't show again" }).click()

    // Tip should vanish
    await expect(details).not.toBeVisible()

    // Reload and verify it stays dismissed
    await page.reload()
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1500)
    await expect(page.locator('details#help-envelope-budgeting')).not.toBeVisible()
  })

})

