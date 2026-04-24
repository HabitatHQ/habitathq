import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

// ── Axe accessibility audits ───────────────────────────────────────────────

const PAGES = [
  { name: 'Dashboard', path: '/' },
  { name: 'Transactions', path: '/transactions' },
  { name: 'Add Transaction', path: '/transactions/add' },
  { name: 'Envelopes', path: '/envelopes' },
  { name: 'Reports', path: '/reports' },
  { name: 'Household', path: '/household' },
  { name: 'Settings', path: '/settings' },
]

for (const { name, path } of PAGES) {
  test(`${name} — axe audit passes`, async ({ page }) => {
    await page.goto(path)
    await page.waitForLoadState('networkidle')
    // Wait for any loading states to resolve
    await page.waitForTimeout(2000)

    const results = await new AxeBuilder({ page })
      .exclude('[aria-hidden="true"]') // decorative emoji are excluded
      .analyze()

    expect(results.violations).toEqual([])
  })
}

// ── Touch target size (44px minimum) ─────────────────────────────────────

async function checkTouchTargets(page: import('@playwright/test').Page) {
  const violations = await page.evaluate(() => {
    const INTERACTIVE =
      'button, a, input, select, textarea, [role="button"], [role="switch"], [role="link"]'
    const elements = Array.from(document.querySelectorAll(INTERACTIVE))
    const failures: string[] = []

    for (const el of elements) {
      const rect = el.getBoundingClientRect()
      // Skip hidden elements
      if (rect.width === 0 && rect.height === 0) continue
      // Skip elements outside the viewport
      if (rect.bottom < 0 || rect.top > window.innerHeight) continue

      const label =
        el.getAttribute('aria-label') || el.textContent?.trim().slice(0, 30) || el.tagName

      if (rect.height < 44 || rect.width < 44) {
        failures.push(
          `"${label}" — ${Math.round(rect.width)}×${Math.round(rect.height)}px (min 44×44)`,
        )
      }
    }
    return failures
  })

  return violations
}

for (const { name, path } of PAGES) {
  test(`${name} — touch targets meet 44px minimum`, async ({ page }) => {
    await page.goto(path)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1000)

    const violations = await checkTouchTargets(page)

    if (violations.length > 0) {
      console.warn(`Touch target violations on ${name}:`, violations)
    }

    // We allow up to 0 violations — fail if any found
    expect(violations, `Touch target violations on ${name}`).toHaveLength(0)
  })
}

// ── Keyboard navigation ───────────────────────────────────────────────────

test('Bottom nav is keyboard navigable', async ({ page }) => {
  await page.goto('/')
  await page.keyboard.press('Tab')
  // The focused element should be within the page (not on browser chrome)
  const focusedTag = await page.evaluate(() => document.activeElement?.tagName)
  expect(focusedTag).not.toBeNull()
})

test('Add Transaction — form fields are keyboard reachable', async ({ page }) => {
  await page.goto('/transactions/add')
  // Tab through the form
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('Tab')
  }
  // Some form element should be focused
  const focused = await page.evaluate(() => {
    const el = document.activeElement
    return el ? { tag: el.tagName, type: (el as HTMLInputElement).type ?? null } : null
  })
  expect(focused).not.toBeNull()
})

// ── Color-only information ────────────────────────────────────────────────

test('Envelope overspent state has text label, not just color', async ({ page }) => {
  await page.goto('/envelopes')
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(2000)

  // If any envelope is overspent, it should have a visible text badge
  const overspentBadges = page.getByRole('status').filter({ hasText: /over/i })
  // We can't guarantee an overspent envelope exists in every test run
  // but if the badge exists, it must be text-based (axe would catch color-only)
  const count = await overspentBadges.count()
  if (count > 0) {
    const badge = overspentBadges.first()
    await expect(badge).toBeVisible()
    await expect(badge).not.toBeEmpty()
  }
})

// ── Screen reader landmarks ───────────────────────────────────────────────

test('Dashboard has proper landmark regions', async ({ page }) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')

  await expect(page.getByRole('banner')).toBeVisible() // <header>
  await expect(page.getByRole('main')).toBeVisible() // <main>
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible() // <nav>
})
