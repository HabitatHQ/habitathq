import { expect, test } from '@playwright/test'

// ── Help tips are present on key pages ────────────────────────────────────

const PAGES_WITH_HELP = [
  { name: 'Dashboard', path: '/', helpId: 'help-dashboard-summary' },
  { name: 'Add Transaction', path: '/transactions/add', helpId: 'help-tx-types' },
  { name: 'Envelopes', path: '/envelopes', helpId: 'help-envelope-budgeting' },
  { name: 'Household', path: '/household', helpId: 'help-iou-balances' },
  { name: 'Reports', path: '/reports', helpId: 'help-reports-overview' },
  { name: 'Settings', path: '/settings', helpId: 'help-quick-add-settings' },
]

for (const { name, path, helpId } of PAGES_WITH_HELP) {
  test(`${name} — help tip is rendered as <details> inside <aside>`, async ({ page }) => {
    await page.goto(path)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1500)

    const details = page.locator(`details#${helpId}`)
    await expect(details).toBeVisible()

    // Wrapped in <aside>
    const aside = details.locator('..')
    await expect(aside).toHaveAttribute('aria-label', /Help:/)
    const tag = await aside.evaluate((el) => el.tagName.toLowerCase())
    expect(tag).toBe('aside')
  })
}

// ── Expand / collapse via <details> ──────────────────────────────────────

test.describe('HelpTip — expand and collapse', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/envelopes')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1500)
  })

  test('content is hidden by default', async ({ page }) => {
    const details = page.locator('details#help-envelope-budgeting')
    await expect(details).not.toHaveAttribute('open', '')
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

// ── Semantic HTML inside help tips ───────────────────────────────────────

test.describe('HelpTip — semantic content', () => {
  test('transaction types use <dl> for definitions', async ({ page }) => {
    await page.goto('/transactions/add')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1500)

    const details = page.locator('details#help-tx-types')
    await details.locator('summary').click()

    const dl = details.locator('dl')
    await expect(dl).toBeVisible()

    const dtCount = await details.locator('dt').count()
    expect(dtCount).toBe(3) // Expense, Income, Transfer

    const ddCount = await details.locator('dd').count()
    expect(ddCount).toBe(3)
  })

  test('envelope colors use <dl> for definitions', async ({ page }) => {
    await page.goto('/envelopes')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1500)

    const details = page.locator('details#help-envelope-budgeting')
    await details.locator('summary').click()

    const dl = details.locator('dl')
    await expect(dl).toBeVisible()

    const dtCount = await details.locator('dt').count()
    expect(dtCount).toBe(3) // Green, Amber, Red
  })

  test('reports metrics use <dl> for definitions', async ({ page }) => {
    await page.goto('/reports')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1500)

    const details = page.locator('details#help-reports-overview')
    await details.locator('summary').click()

    const dl = details.locator('dl')
    await expect(dl).toBeVisible()

    const dtCount = await details.locator('dt').count()
    expect(dtCount).toBe(2) // Spent, Saved
  })

  test('household IOU has <abbr> for acronym', async ({ page }) => {
    await page.goto('/household')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1500)

    const abbr = page.locator('details#help-iou-balances summary abbr')
    await expect(abbr).toBeVisible()
    await expect(abbr).toHaveAttribute('title', 'I Owe You')
  })
})

// ── "Don't show again" dismissal ─────────────────────────────────────────

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

    // Verify localStorage was set
    const stored = await page.evaluate(() =>
      localStorage.getItem('hearth-help-dismissed:envelope-budgeting'),
    )
    expect(stored).toBe('1')

    // Reload and verify it stays dismissed
    await page.reload()
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1500)
    await expect(page.locator('details#help-envelope-budgeting')).not.toBeVisible()
  })

  test('non-dismissable tips have no dismiss button', async ({ page }) => {
    await page.goto('/import')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1000)

    const details = page.locator('details#help-csv-import')
    await expect(details).toBeVisible()

    await details.locator('summary').click()

    // Should not have a dismiss button
    const dismissBtn = details.getByRole('button', { name: "Don't show again" })
    await expect(dismissBtn).toHaveCount(0)
  })
})

// ── Inline sub-text on add transaction form ─────────────────────────────

test.describe('Add Transaction — inline help text', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/transactions/add')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1000)
  })

  test('private transaction toggle has explanatory sub-text', async ({ page }) => {
    await expect(
      page.getByText('Hidden from other household members on the dashboard'),
    ).toBeVisible()
  })

  test('split toggle has explanatory sub-text', async ({ page }) => {
    await expect(page.getByText('Track how much they owe you for this expense')).toBeVisible()
  })
})
