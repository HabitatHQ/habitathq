/**
 * UX/Padding audit verification tests.
 * These are investigative — they document current state and assert issues we found in source review.
 * Failing tests = confirmed bugs. Passing = either already fixed or not reproducible in browser.
 */
import { test, expect, type Page } from '@playwright/test'

// Helper: minimum touch target height per iOS HIG / WCAG 2.5.5
const MIN_TOUCH_PX = 44

async function getBoundingBox(page: Page, locator: ReturnType<Page['locator']>) {
  return locator.boundingBox()
}

// ────────────────────────────────────────────────────────────────────────────
// Viewport helpers
// ────────────────────────────────────────────────────────────────────────────

const IPHONE_SE_PORTRAIT = { width: 375, height: 667 }
const IPHONE_SE_LANDSCAPE = { width: 667, height: 375 }
const IPHONE_14_PRO = { width: 393, height: 852 }

// ============================================================================
// GROUP 1 — PADDING & OVERFLOW
// ============================================================================

test.describe('Padding & overflow', () => {
  test('stats month-selector buttons have adequate touch height (≥44px)', async ({ page }) => {
    await page.setViewportSize(IPHONE_SE_PORTRAIT)
    await page.goto('/stats')
    await page.waitForLoadState('networkidle')

    // Period selectors: prev / next arrows
    const btns = page.locator('button').filter({ hasText: /^[<>◀▶]/ })
    const count = await btns.count()

    if (count === 0) {
      // Try aria roles
      const navBtns = page.getByRole('button').filter({ hasText: /prev|next/i })
      const c2 = await navBtns.count()
      if (c2 === 0) {
        test.skip() // can't find the button, skip rather than false pass
        return
      }
    }

    // Check all visible buttons on stats page
    const allBtns = page.getByRole('button')
    const total = await allBtns.count()
    const violations: string[] = []

    for (let i = 0; i < total; i++) {
      const btn = allBtns.nth(i)
      const box = await btn.boundingBox()
      if (!box) continue
      if (box.height > 0 && box.height < MIN_TOUCH_PX) {
        const text = (await btn.textContent()) ?? ''
        violations.push(`"${text.trim()}" — height: ${box.height.toFixed(1)}px`)
      }
    }

    // Document violations — test "fails" (expect.soft) but collects all
    for (const v of violations) {
      expect.soft(false, `Touch target too small on /stats: ${v}`).toBe(true)
    }
  })

  test('modal bottom padding — todos add modal has safe-area spacing', async ({ page }) => {
    await page.setViewportSize(IPHONE_14_PRO)
    await page.goto('/todos')
    await page.waitForLoadState('networkidle')

    // Enable todos first if needed (go to settings)
    // Open the add modal via the FAB / add button
    const addBtn = page.getByRole('button', { name: /add|new|create|\+/i }).first()
    const addBtnVisible = await addBtn.isVisible().catch(() => false)
    if (!addBtnVisible) {
      test.skip()
      return
    }
    await addBtn.click()
    await page.waitForTimeout(400)

    // Check the modal card exists
    const modal = page.locator('.rounded-t-3xl, [class*="rounded-t-3xl"]').first()
    const modalVisible = await modal.isVisible().catch(() => false)
    if (!modalVisible) {
      test.skip()
      return
    }

    // Check computed bottom padding — should account for safe-area
    const pb = await modal.evaluate((el) => {
      const style = getComputedStyle(el)
      return style.paddingBottom
    })

    // In a test browser (no real safe-area-inset-bottom) this will be 0px from env() fallback
    // We verify that the CSS property is at least applying something (not just p-5 = 20px flat)
    // The real check is: does the modal contain a safe-area spacer child?
    const safeAreaSpacer = modal.locator('[class*="safe-area"], [style*="safe-area-inset-bottom"]')
    const spacerCount = await safeAreaSpacer.count()

    expect.soft(
      spacerCount,
      'Todos add modal should have a safe-area-inset-bottom spacer for iOS home indicator',
    ).toBeGreaterThan(0)

    console.log(`todos modal paddingBottom: ${pb}, safe-area spacers found: ${spacerCount}`)
  })

  test('checkin index modal has safe-area spacer', async ({ page }) => {
    await page.setViewportSize(IPHONE_14_PRO)
    await page.goto('/checkin')
    await page.waitForLoadState('networkidle')

    const addBtn = page.getByRole('button', { name: /new|add|create|\+/i }).first()
    const visible = await addBtn.isVisible().catch(() => false)
    if (!visible) { test.skip(); return }

    await addBtn.click()
    await page.waitForTimeout(400)

    const modal = page.locator('.rounded-t-3xl').first()
    const modalVisible = await modal.isVisible().catch(() => false)
    if (!modalVisible) { test.skip(); return }

    const spacer = modal.locator('[class*="safe-area"], [style*="safe-area-inset-bottom"]')
    const count = await spacer.count()
    expect.soft(count, 'Checkin create modal missing safe-area-inset-bottom spacer').toBeGreaterThan(0)
  })

  test('checkin scale buttons do not overflow on iPhone landscape', async ({ page }) => {
    await page.setViewportSize(IPHONE_SE_LANDSCAPE)
    await page.goto('/checkin')
    await page.waitForLoadState('networkidle')

    // Navigate into a checkin template — if none exist, skip
    const templateLink = page.getByRole('link').first()
    const count = await page.locator('a[href^="/checkin/"]').count()
    if (count === 0) { test.skip(); return }

    await page.locator('a[href^="/checkin/"]').first().click()
    await page.waitForLoadState('networkidle')

    // Look for a scale question response area (buttons 1–10)
    const scaleButtons = page.locator('button').filter({ hasText: /^([1-9]|10)$/ })
    const scaleCount = await scaleButtons.count()
    if (scaleCount < 5) { test.skip(); return } // not a scale question page

    // Check if any scale button is clipped (right edge beyond viewport)
    const viewport = page.viewportSize()!
    const overflowing: string[] = []
    for (let i = 0; i < scaleCount; i++) {
      const box = await scaleButtons.nth(i).boundingBox()
      if (!box) continue
      if (box.x + box.width > viewport.width + 1) {
        overflowing.push(`Button ${i + 1}: right=${(box.x + box.width).toFixed(0)}px > viewport ${viewport.width}px`)
      }
    }
    expect.soft(overflowing.length, `Scale buttons overflow on landscape: ${overflowing.join(', ')}`).toBe(0)
  })

  test('water glass buttons do not overflow on iPhone landscape', async ({ page }) => {
    await page.setViewportSize(IPHONE_SE_LANDSCAPE)
    await page.goto('/health')
    await page.waitForLoadState('networkidle')

    const viewport = page.viewportSize()!
    // Find glass/cup buttons
    const glassBtns = page.locator('button[aria-label*="glass"], button[title*="glass"], [class*="glass"]')
    const count = await glassBtns.count()
    if (count === 0) { test.skip(); return }

    const overflowing: string[] = []
    for (let i = 0; i < count; i++) {
      const box = await glassBtns.nth(i).boundingBox()
      if (!box) continue
      if (box.x + box.width > viewport.width + 1) {
        overflowing.push(`Glass ${i}: right=${(box.x + box.width).toFixed(0)}px > ${viewport.width}px`)
      }
    }
    expect.soft(overflowing.length, `Health page glasses overflow: ${overflowing.join(', ')}`).toBe(0)
  })

  test('modal padding is consistent (p-5 = 20px) across pages', async ({ page }) => {
    const pages = [
      { url: '/habits', openModal: async () => { await page.getByRole('button', { name: /new|add|\+/i }).first().click() } },
      { url: '/checkin', openModal: async () => { await page.getByRole('button', { name: /new|add|\+/i }).first().click() } },
      { url: '/todos', openModal: async () => { await page.getByRole('button', { name: /new|add|\+/i }).first().click() } },
    ]

    const paddings: Record<string, string> = {}

    for (const { url, openModal } of pages) {
      await page.setViewportSize(IPHONE_SE_PORTRAIT)
      await page.goto(url)
      await page.waitForLoadState('networkidle')

      const btn = page.getByRole('button', { name: /new|add|create|\+/i }).first()
      const btnVisible = await btn.isVisible().catch(() => false)
      if (!btnVisible) continue

      await btn.click()
      await page.waitForTimeout(400)

      const modal = page.locator('.rounded-t-3xl, .rounded-2xl').first()
      const visible = await modal.isVisible().catch(() => false)
      if (!visible) continue

      const padding = await modal.evaluate((el) => {
        const s = getComputedStyle(el)
        return `T:${s.paddingTop} R:${s.paddingRight} B:${s.paddingBottom} L:${s.paddingLeft}`
      })
      paddings[url] = padding

      await page.keyboard.press('Escape')
      await page.waitForTimeout(200)
    }

    // All modal paddings should have same top/right/left (bottom may differ due to safe-area)
    const tops = [...new Set(Object.values(paddings).map((p) => p.match(/T:([\d.]+px)/)?.[1]))]
    console.log('Modal paddings:', JSON.stringify(paddings, null, 2))
    expect.soft(tops.length, `Inconsistent modal top padding across pages: ${JSON.stringify(paddings)}`).toBeLessThanOrEqual(1)
  })
})

// ============================================================================
// GROUP 2 — TOUCH TARGETS
// ============================================================================

test.describe('Touch targets', () => {
  const routesToCheck = ['/stats', '/health', '/habits', '/todos', '/checkin', '/bored']

  for (const route of routesToCheck) {
    test(`${route}: all visible buttons meet 44px minimum height`, async ({ page }) => {
      await page.setViewportSize(IPHONE_SE_PORTRAIT)
      await page.goto(route)
      await page.waitForLoadState('networkidle')
      await page.waitForTimeout(500)

      // Skip if page 404'd (route not accessible in current settings)
      const is404 = await page.locator('h1:has-text("404"), h2:has-text("404")').count()
      if (is404 > 0) { test.skip(); return }

      // Exclude Nuxt DevTools overlay buttons (they exist in dev mode only, not shipped to users)
      const btns = page.getByRole('button').filter({ hasNot: page.locator('[class*="nuxt-devtools"], [id*="nuxt-devtools"]') })
      // Also exclude by title attribute used by devtools
      const count = await btns.count()
      const violations: string[] = []

      for (let i = 0; i < count; i++) {
        const btn = btns.nth(i)
        if (!(await btn.isVisible().catch(() => false))) continue
        // Exclude devtools buttons by their specific aria-labels or titles
        const title = await btn.getAttribute('title') ?? ''
        const ariaLabel = await btn.getAttribute('aria-label') ?? ''
        if (title.includes('DevTools') || ariaLabel.includes('DevTools') || title.includes('Inspector') || ariaLabel.includes('Inspector')) continue

        const box = await btn.boundingBox()
        if (!box || box.height === 0) continue
        if (box.height < MIN_TOUCH_PX) {
          const label = ariaLabel || (await btn.textContent()) || `btn[${i}]`
          violations.push(`"${label.trim().slice(0, 40)}" h=${box.height.toFixed(1)}px`)
        }
      }

      if (violations.length > 0) {
        console.log(`[${route}] Small touch targets:\n` + violations.map((v) => `  - ${v}`).join('\n'))
      }
      expect.soft(
        violations.length,
        `${route} has ${violations.length} buttons below 44px:\n${violations.join('\n')}`,
      ).toBe(0)
    })
  }
})

// ============================================================================
// GROUP 3 — EMPTY STATES
// ============================================================================

test.describe('Empty states', () => {
  test('jots page shows an empty state when no jots exist', async ({ page }) => {
    await page.goto('/jots')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1000) // allow IDB + SQLite to init

    // Should either show jots content OR an empty state message
    const hasContent = await page.locator('[class*="timeline"], [class*="grid"]').count()
    const hasEmpty = await page.getByText(/no jots|nothing yet|get started|add your first/i).count()

    // Fail if we see neither — blank white screen is bad UX
    expect(
      hasContent + hasEmpty,
      'Jots page should show either content or an explicit empty state message',
    ).toBeGreaterThan(0)
  })
})

// ============================================================================
// GROUP 4 — SECTION HEADER CONSISTENCY
// ============================================================================

test.describe('Section header styling', () => {
  test('section headers use uppercase+tracking-wider consistently across pages', async ({ page }) => {
    const routes = ['/todos', '/habits']
    const results: Record<string, { uppercase: boolean; tracking: boolean }[]> = {}

    for (const route of routes) {
      await page.goto(route)
      await page.waitForLoadState('networkidle')

      const headers = page.locator('.text-xs.font-semibold')
      const count = await headers.count()
      const styles: { uppercase: boolean; tracking: boolean }[] = []

      for (let i = 0; i < count; i++) {
        const el = headers.nth(i)
        if (!(await el.isVisible().catch(() => false))) continue
        const style = await el.evaluate((node) => {
          const s = getComputedStyle(node)
          return {
            uppercase: s.textTransform === 'uppercase',
            tracking: parseFloat(s.letterSpacing) > 0,
          }
        })
        styles.push(style)
      }
      results[route] = styles
    }

    console.log('Section header styles:', JSON.stringify(results, null, 2))

    // All headers on the same page should be consistent
    for (const [route, styles] of Object.entries(results)) {
      if (styles.length <= 1) continue
      const uppercaseVals = [...new Set(styles.map((s) => s.uppercase))]
      expect.soft(
        uppercaseVals.length,
        `${route}: mixed uppercase/lowercase section headers (${JSON.stringify(styles)})`,
      ).toBe(1)
    }
  })
})

// ============================================================================
// GROUP 5 — SCREENSHOTS (always pass; capture visual state)
// ============================================================================

test.describe('Visual snapshots for manual review', () => {
  const mobileViewport = { width: 390, height: 844 } // iPhone 14

  for (const route of ['/', '/todos', '/habits', '/stats', '/health', '/checkin', '/jots']) {
    test(`screenshot: ${route} on iPhone 14`, async ({ page }) => {
      await page.setViewportSize(mobileViewport)
      await page.goto(route)
      await page.waitForLoadState('networkidle')
      await page.waitForTimeout(800)
      await page.screenshot({
        path: `test-results/ux-audit${route.replace(/\//g, '-') || '-home'}.png`,
        fullPage: true,
      })
    })
  }
})
