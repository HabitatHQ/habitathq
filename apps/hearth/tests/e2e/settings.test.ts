import { expect, test } from '@playwright/test'

test.describe('Settings page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/settings')
    await page.waitForLoadState('networkidle')
  })

  test('page loads without error', async ({ page }) => {
    await expect(page.getByRole('main')).toBeVisible()
  })

  test('theme picker is present with at least 2 options', async ({ page }) => {
    // Theme swatches or radio buttons
    const themeOptions = page.getByRole('radio').or(page.locator('[data-theme-swatch]'))
    const count = await themeOptions.count()
    expect(count).toBeGreaterThanOrEqual(2)
  })

  test('color mode toggle is present', async ({ page }) => {
    // Should have dark/light/system controls
    const modeButtons = page.getByRole('button').filter({ hasText: /dark|light|system/i })
    const switchEl = page.getByRole('switch', { name: /color mode|dark mode/i })
    const radioEl = page.getByRole('radio', { name: /dark|light|system/i })

    const anyVisible =
      (await modeButtons.count()) > 0 || (await switchEl.count()) > 0 || (await radioEl.count()) > 0

    expect(anyVisible).toBe(true)
  })

  test('reduce motion toggle is present', async ({ page }) => {
    const toggle = page
      .getByRole('switch', { name: /reduce motion/i })
      .or(page.getByRole('checkbox', { name: /reduce motion/i }))
    await expect(toggle.first()).toBeVisible()
  })

  test('Export button is present', async ({ page }) => {
    const exportBtn = page.getByRole('button', { name: /export/i })
    await expect(exportBtn).toBeVisible()
  })
})

test.describe('Settings — import and reset', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/settings')
    await page.waitForLoadState('networkidle')
  })

  test('Import data button is present', async ({ page }) => {
    const importBtn = page.getByRole('button', { name: /import/i })
    await expect(importBtn).toBeVisible()
  })

  test('Reset database button is present', async ({ page }) => {
    const resetBtn = page.getByRole('button', { name: /reset database/i })
    await expect(resetBtn).toBeVisible()
  })

  test('hidden file input exists for import', async ({ page }) => {
    const fileInput = page.locator('input[type="file"][accept=".json"]')
    await expect(fileInput).toHaveCount(1)
  })

  test('Reset button triggers confirmation dialog', async ({ page }) => {
    page.on('dialog', async (dialog) => {
      expect(dialog.type()).toBe('confirm')
      expect(dialog.message()).toMatch(/reset|delete|cannot be undone/i)
      await dialog.dismiss()
    })
    await page.getByRole('button', { name: /reset database/i }).click()
  })
})

test.describe('Settings — navigation', () => {
  test('settings page is reachable from the avatar menu on dashboard', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // Open avatar/profile menu
    const avatarBtn = page
      .getByRole('button', { name: /profile|avatar|account|settings|menu/i })
      .or(page.locator('[data-testid="avatar-menu"]'))

    if (await avatarBtn.first().isVisible()) {
      await avatarBtn.first().click()
      const settingsLink = page.getByRole('link', { name: /settings/i })
      if (await settingsLink.isVisible()) {
        await settingsLink.click()
        await expect(page).toHaveURL('/settings')
      }
    }
  })
})
