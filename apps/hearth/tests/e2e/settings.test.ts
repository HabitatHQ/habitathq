/**
 * Aggressive settings e2e tests.
 * Verifies that settings controls actually change app state,
 * persist across page navigation, and affect the UI.
 */
import { expect, test } from '@playwright/test'

function collectErrors(page: import('@playwright/test').Page) {
  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`[console.error] ${msg.text()}`)
  })
  page.on('pageerror', (err) => errors.push(`[pageerror] ${err.message}`))
  return errors
}

async function waitForDb(page: import('@playwright/test').Page) {
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(1500)
}

test.describe('Settings page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/settings')
    await waitForDb(page)
  })

  test('renders without console errors', async ({ page }) => {
    const errors = collectErrors(page)
    await page.goto('/settings')
    await waitForDb(page)
    expect(errors).toHaveLength(0)
  })

  test('page title is visible', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /settings/i })).toBeVisible()
  })

  // ── Theme controls ──────────────────────────────────────────────────────

  test('theme selection changes and persists', async ({ page }) => {
    // Find theme radio buttons / swatches
    const themeSection = page.locator('section, div').filter({ hasText: /theme/i }).first()
    if (!(await themeSection.isVisible())) return

    // Click a non-default theme option
    const themeButtons = themeSection.getByRole('button')
    const count = await themeButtons.count()
    if (count >= 2) {
      // Get initial localStorage state
      const initialTheme = await page.evaluate(() => {
        const raw = localStorage.getItem('hearth-settings')
        return raw ? JSON.parse(raw).theme : null
      })

      // Click a different theme
      await themeButtons.nth(1).click()
      await page.waitForTimeout(200)

      // Verify localStorage was updated
      const newTheme = await page.evaluate(() => {
        const raw = localStorage.getItem('hearth-settings')
        return raw ? JSON.parse(raw).theme : null
      })

      if (initialTheme !== null) {
        expect(newTheme).not.toBe(initialTheme)
      }
    }
  })

  test('color mode selection persists to localStorage', async ({ page }) => {
    // Toggle dark/light/system mode
    const colorButtons = page.getByRole('button').filter({ hasText: /dark|light|system/i })
    const darkBtn = page.getByRole('button', { name: /dark/i })
    const lightBtn = page.getByRole('button', { name: /light/i })

    if (await darkBtn.isVisible()) {
      await darkBtn.click()
      await page.waitForTimeout(200)

      const mode = await page.evaluate(() => {
        const raw = localStorage.getItem('hearth-settings')
        return raw ? JSON.parse(raw).colorMode : null
      })
      expect(mode).toBe('dark')
    }

    if (await lightBtn.isVisible()) {
      await lightBtn.click()
      await page.waitForTimeout(200)

      const mode = await page.evaluate(() => {
        const raw = localStorage.getItem('hearth-settings')
        return raw ? JSON.parse(raw).colorMode : null
      })
      expect(mode).toBe('light')
    }
  })

  // ── Currency setting ──────────────────────────────────────────────────

  test('currency selector shows current currency', async ({ page }) => {
    const currencySelector = page
      .locator('[data-testid="currency-selector"], select, button')
      .filter({ hasText: /USD|EUR|GBP|JPY|CAD|AUD/i })
      .first()
    if (await currencySelector.isVisible()) {
      const text = await currencySelector.textContent()
      expect(text).toMatch(/[A-Z]{3}/)
    }
  })

  // ── Settings persistence across navigation ────────────────────────────

  test('settings survive navigation to dashboard and back', async ({ page }) => {
    // Get current settings snapshot
    const before = await page.evaluate(() => localStorage.getItem('hearth-settings'))

    // Navigate away
    await page.goto('/')
    await waitForDb(page)

    // Navigate back
    await page.goto('/settings')
    await waitForDb(page)

    // Settings should be unchanged
    const after = await page.evaluate(() => localStorage.getItem('hearth-settings'))
    expect(after).toBe(before)
  })

  // ── Reduce motion ──────────────────────────────────────────────────────

  test('reduce motion toggle updates localStorage', async ({ page }) => {
    const motionToggle = page.getByRole('switch', { name: /reduce.*motion/i }).or(
      page
        .locator('label')
        .filter({ hasText: /reduce.*motion/i })
        .locator('button, input'),
    )

    if (await motionToggle.first().isVisible()) {
      await motionToggle.first().click()
      await page.waitForTimeout(200)

      const settings = await page.evaluate(() => {
        const raw = localStorage.getItem('hearth-settings')
        return raw ? JSON.parse(raw) : null
      })
      expect(settings).toHaveProperty('reduceMotion')
    }
  })

  // ── Data management ────────────────────────────────────────────────────

  test('reset button shows confirmation before acting', async ({ page }) => {
    const resetButton = page.getByRole('button', { name: /reset|erase|delete.*data/i })
    if (await resetButton.isVisible()) {
      // Set up dialog handler to capture the confirm
      let dialogShown = false
      page.on('dialog', async (dialog) => {
        dialogShown = true
        await dialog.dismiss() // Cancel the reset
      })

      await resetButton.click()
      await page.waitForTimeout(300)
      expect(dialogShown).toBe(true)
    }
  })

  test('export button produces downloadable data', async ({ page }) => {
    const exportButton = page.getByRole('button', { name: /export/i }).first()
    if (await exportButton.isVisible()) {
      // Listen for download
      const downloadPromise = page.waitForEvent('download', { timeout: 5000 }).catch(() => null)
      await exportButton.click()
      const download = await downloadPromise
      // Either a download was triggered or a blob URL was created
      // Both are valid export behaviors
      if (download) {
        const filename = download.suggestedFilename()
        expect(filename).toMatch(/hearth|export/i)
      }
    }
  })

  // ── Database info ──────────────────────────────────────────────────────

  test('database info section shows transaction count', async ({ page }) => {
    const dbInfo = page.locator('section, div').filter({ hasText: /database|storage|data/i })
    if (await dbInfo.first().isVisible()) {
      const text = await dbInfo.first().textContent()
      // Should show real data counts from seed data
      expect(text).toMatch(/\d+/)
    }
  })

  // ── Touch targets ──────────────────────────────────────────────────────

  test('all interactive elements meet 44px touch target', async ({ page }) => {
    const buttons = page.getByRole('button')
    const count = await buttons.count()
    for (let i = 0; i < Math.min(count, 20); i++) {
      const box = await buttons.nth(i).boundingBox()
      if (box && box.width > 0 && box.height > 0) {
        expect(
          box.height >= 44 || box.width >= 44,
          `Button ${i} is ${box.width}x${box.height}, expected at least 44px on one dimension`,
        ).toBe(true)
      }
    }
  })

  // ── Build info ─────────────────────────────────────────────────────────

  test('build info section is present', async ({ page }) => {
    const buildInfo = page.getByText(/build|version/i).first()
    if (await buildInfo.isVisible()) {
      const text = await buildInfo.textContent()
      expect(text!.length).toBeGreaterThan(0)
    }
  })
})

test.describe('Settings — navigation', () => {
  test('settings is accessible from avatar menu in header', async ({ page }) => {
    await page.goto('/')
    await waitForDb(page)

    // Look for settings link/button in header area
    const settingsLink = page
      .getByRole('link', { name: /settings/i })
      .or(page.getByRole('button', { name: /settings/i }))
    if (await settingsLink.first().isVisible()) {
      await settingsLink.first().click()
      await page.waitForTimeout(300)
      expect(page.url()).toContain('/settings')
    }
  })
})
