/**
 * Regression tests for UX/accessibility issues fixed in issues #6–#12.
 * These use hard assertions — failures mean a regression has been introduced.
 *
 * Issues covered:
 *   #6  — Header icon buttons (dark/light, theme picker) ≥ 44px
 *   #7  — Stats period selector buttons (7d/14d/30d/90d) ≥ 44px
 *   #8  — Todos filter chips and Add button ≥ 44px
 *   #9  — Bored time-filter and category chips ≥ 44px
 *   #10 — "New" buttons on Habits and Check-in pages ≥ 44px
 *   #11 — Custom bottom-sheet modals include safe-area-inset-bottom spacer
 *   #12 — Modal card padding is consistently p-5 (20px) on Habits
 */

import { test, expect, type Page } from '@playwright/test'

const MIN_TOUCH_PX = 44
const MOBILE = { width: 390, height: 844 } // iPhone 14

async function touchHeight(page: Page, locator: ReturnType<Page['locator']>): Promise<number> {
  const box = await locator.boundingBox()
  return box?.height ?? 0
}

// ─── Issue #6: Header icon buttons ───────────────────────────────────────────

test.describe('Issue #6 — header icon buttons ≥ 44px', () => {
  // Check on home page (header is always visible)
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(MOBILE)
    await page.goto('/')
    await page.waitForLoadState('networkidle')
  })

  test('dark/light mode toggle meets 44px minimum', async ({ page }) => {
    const btn = page.getByRole('button', { name: /switch to (dark|light) mode/i })
    await expect(btn).toBeVisible()
    const h = await touchHeight(page, btn)
    expect(h, `Dark/light toggle height ${h}px < ${MIN_TOUCH_PX}px`).toBeGreaterThanOrEqual(MIN_TOUCH_PX)
  })

  test('theme picker button meets 44px minimum', async ({ page }) => {
    const btn = page.getByRole('button', { name: /change theme/i })
    await expect(btn).toBeVisible()
    const h = await touchHeight(page, btn)
    expect(h, `Theme picker height ${h}px < ${MIN_TOUCH_PX}px`).toBeGreaterThanOrEqual(MIN_TOUCH_PX)
  })
})

// ─── Issue #7: Stats period selector ─────────────────────────────────────────

test.describe('Issue #7 — stats period selector buttons ≥ 44px', () => {
  test('7d / 14d / 30d / 90d buttons all meet 44px minimum', async ({ page }) => {
    await page.setViewportSize(MOBILE)
    await page.goto('/stats')
    await page.waitForLoadState('networkidle')

    for (const label of ['7d', '14d', '30d', '90d']) {
      const btn = page.getByRole('button', { name: label, exact: true })
      const count = await btn.count()
      if (count === 0) continue // may not render if no habits
      const h = await touchHeight(page, btn.first())
      expect(h, `Stats "${label}" button height ${h}px < ${MIN_TOUCH_PX}px`).toBeGreaterThanOrEqual(MIN_TOUCH_PX)
    }
  })
})

// ─── Issue #8: Todos filter chips and Add button ──────────────────────────────

test.describe('Issue #8 — todos filter chips and Add button ≥ 44px', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(MOBILE)
    await page.goto('/todos')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)
  })

  test('Add button meets 44px minimum', async ({ page }) => {
    const btn = page.getByRole('button', { name: /^add$/i })
    const count = await btn.count()
    if (count === 0) { test.skip(); return }
    const h = await touchHeight(page, btn.first())
    expect(h, `Todos Add button height ${h}px < ${MIN_TOUCH_PX}px`).toBeGreaterThanOrEqual(MIN_TOUCH_PX)
  })

  test('All / Active / Done filter chips meet 44px minimum', async ({ page }) => {
    for (const label of ['All', 'Active', 'Done']) {
      const btn = page.getByRole('button', { name: label, exact: true })
      const count = await btn.count()
      if (count === 0) continue
      const h = await touchHeight(page, btn.first())
      expect(h, `Todos "${label}" filter height ${h}px < ${MIN_TOUCH_PX}px`).toBeGreaterThanOrEqual(MIN_TOUCH_PX)
    }
  })
})

// ─── Issue #9: Bored time-filter and category chips ──────────────────────────

test.describe('Issue #9 — bored filter chips ≥ 44px', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(MOBILE)
    await page.goto('/bored')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)
  })

  test('time-filter chips (Any, < 15m, < 30m, < 1h) meet 44px minimum', async ({ page }) => {
    for (const label of ['Any', '< 15m', '< 30m', '< 1h']) {
      const btn = page.getByRole('button', { name: label, exact: true })
      const count = await btn.count()
      if (count === 0) continue
      const h = await touchHeight(page, btn.first())
      expect(h, `Bored "${label}" chip height ${h}px < ${MIN_TOUCH_PX}px`).toBeGreaterThanOrEqual(MIN_TOUCH_PX)
    }
  })

  test('category chips meet 44px minimum', async ({ page }) => {
    // Category chips are inside the chip row — find all buttons in that section
    const chips = page.locator('button.rounded-full').filter({ hasNot: page.locator('[aria-label]') })
    const count = await chips.count()
    if (count === 0) { test.skip(); return }

    const violations: string[] = []
    for (let i = 0; i < count; i++) {
      const chip = chips.nth(i)
      if (!(await chip.isVisible().catch(() => false))) continue
      const box = await chip.boundingBox()
      if (!box || box.height === 0) continue
      if (box.height < MIN_TOUCH_PX) {
        const text = (await chip.textContent())?.trim() ?? `chip[${i}]`
        violations.push(`"${text}" h=${box.height.toFixed(1)}px`)
      }
    }
    expect(violations, `Category chips below 44px: ${violations.join(', ')}`).toHaveLength(0)
  })
})

// ─── Issue #10: New buttons on Habits and Check-in ───────────────────────────

test.describe('Issue #10 — "New" buttons ≥ 44px', () => {
  for (const route of ['/habits', '/checkin']) {
    test(`${route} "New" button meets 44px minimum`, async ({ page }) => {
      await page.setViewportSize(MOBILE)
      await page.goto(route)
      await page.waitForLoadState('networkidle')
      await page.waitForTimeout(300)

      const btn = page.getByRole('button', { name: /^new$/i })
      await expect(btn).toBeVisible()
      const h = await touchHeight(page, btn)
      expect(h, `${route} "New" button height ${h}px < ${MIN_TOUCH_PX}px`).toBeGreaterThanOrEqual(MIN_TOUCH_PX)
    })
  }
})

// ─── Issue #11: Safe-area-inset-bottom spacers in custom bottom-sheet modals ─

test.describe('Issue #11 — bottom-sheet modals include safe-area spacer', () => {
  async function openModalAndCheckSpacer(
    page: Page,
    route: string,
    triggerSelector: string | { role: string; name: RegExp },
    description: string,
  ) {
    await page.setViewportSize(MOBILE)
    await page.goto(route)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)

    let btn: ReturnType<Page['locator']>
    if (typeof triggerSelector === 'string') {
      btn = page.locator(triggerSelector)
    } else {
      btn = page.getByRole(triggerSelector.role as Parameters<Page['getByRole']>[0], { name: triggerSelector.name })
    }

    const visible = await btn.isVisible().catch(() => false)
    if (!visible) { test.skip(); return }

    await btn.click()
    await page.waitForTimeout(400)

    // The bottom-sheet card
    const card = page.locator('.rounded-t-3xl').first()
    const cardVisible = await card.isVisible().catch(() => false)
    if (!cardVisible) { test.skip(); return }

    const spacer = card.locator('.safe-area-bottom')
    const count = await spacer.count()
    expect(count, `${description}: missing .safe-area-bottom spacer`).toBeGreaterThan(0)
  }

  test('todos add modal has safe-area-bottom spacer', async ({ page }) => {
    await openModalAndCheckSpacer(
      page, '/todos',
      { role: 'button', name: /^add$/i },
      'Todos add modal',
    )
  })

  test('checkin create modal has safe-area-bottom spacer', async ({ page }) => {
    await openModalAndCheckSpacer(
      page, '/checkin',
      { role: 'button', name: /^new$/i },
      'Check-in create modal',
    )
  })

  test('bored category modal has safe-area-bottom spacer', async ({ page }) => {
    await page.setViewportSize(MOBILE)
    await page.goto('/bored/activities')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)

    const btn = page.getByRole('button', { name: /new category/i })
    const visible = await btn.isVisible().catch(() => false)
    if (!visible) { test.skip(); return }

    await btn.click()
    await page.waitForTimeout(400)

    const card = page.locator('.rounded-t-3xl').first()
    const spacer = card.locator('.safe-area-bottom')
    const count = await spacer.count()
    expect(count, 'Bored category modal: missing .safe-area-bottom spacer').toBeGreaterThan(0)
  })

  test('bored activity modal has safe-area-bottom spacer', async ({ page }) => {
    await page.setViewportSize(MOBILE)
    await page.goto('/bored/activities')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)

    const btn = page.getByRole('button', { name: /new activity/i })
    const visible = await btn.isVisible().catch(() => false)
    if (!visible) { test.skip(); return }

    await btn.click()
    await page.waitForTimeout(400)

    const card = page.locator('.rounded-t-3xl').first()
    const spacer = card.locator('.safe-area-bottom')
    const count = await spacer.count()
    expect(count, 'Bored activity modal: missing .safe-area-bottom spacer').toBeGreaterThan(0)
  })
})

// ─── Issue #12: Modal card padding is consistently p-5 (20px) ────────────────

test.describe('Issue #12 — modal card padding is p-5 (20px) on all pages', () => {
  const EXPECTED_PADDING = '20px'

  async function checkModalPadding(page: Page, route: string, triggerName: RegExp) {
    await page.setViewportSize(MOBILE)
    await page.goto(route)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(300)

    const btn = page.getByRole('button', { name: triggerName }).first()
    const visible = await btn.isVisible().catch(() => false)
    if (!visible) { test.skip(); return }

    await btn.click()
    await page.waitForTimeout(400)

    // Find the modal card — UModal uses [role=dialog] or .rounded-t-3xl / .rounded-2xl
    const card = page.locator('[role="dialog"] > div, .rounded-t-3xl, .rounded-2xl').first()
    const cardVisible = await card.isVisible().catch(() => false)
    if (!cardVisible) { test.skip(); return }

    const { top, right, left } = await card.evaluate((el) => {
      const s = getComputedStyle(el)
      return { top: s.paddingTop, right: s.paddingRight, left: s.paddingLeft }
    })

    expect(top, `${route} modal paddingTop should be ${EXPECTED_PADDING}`).toBe(EXPECTED_PADDING)
    expect(right, `${route} modal paddingRight should be ${EXPECTED_PADDING}`).toBe(EXPECTED_PADDING)
    expect(left, `${route} modal paddingLeft should be ${EXPECTED_PADDING}`).toBe(EXPECTED_PADDING)
  }

  test('habits New modal has p-5 padding', async ({ page }) => {
    await checkModalPadding(page, '/habits', /^new$/i)
  })

  test('checkin New modal has p-5 padding', async ({ page }) => {
    await checkModalPadding(page, '/checkin', /^new$/i)
  })

  test('todos Add modal has p-5 padding', async ({ page }) => {
    await checkModalPadding(page, '/todos', /^add$/i)
  })
})
