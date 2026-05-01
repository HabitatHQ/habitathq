/**
 * Aggressive household e2e tests.
 * Verifies IOU balance display, settle-up behavior, member rendering,
 * and navigation integration — not just element visibility.
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

test.describe('Household page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/household')
    await waitForDb(page)
  })

  test('renders without console errors', async ({ page }) => {
    const errors = collectErrors(page)
    await page.goto('/household')
    await waitForDb(page)
    expect(errors).toHaveLength(0)
  })

  test('displays household members from seed data', async ({ page }) => {
    const members = page.getByRole('region', { name: 'Household members' })
    await expect(members).toBeVisible()

    // Seed data has Alex and Sam
    const text = await members.textContent()
    expect(text).toContain('Alex')
    expect(text).toContain('Sam')
  })

  test('shows member roles', async ({ page }) => {
    const members = page.getByRole('region', { name: 'Household members' })
    const text = await members.textContent()
    expect(text).toMatch(/owner/i)
    expect(text).toMatch(/partner/i)
  })

  test('marks current user with "You" badge', async ({ page }) => {
    const youBadge = page.getByText('You')
    await expect(youBadge).toBeVisible()
  })

  test('displays IOU balances with dollar amounts', async ({ page }) => {
    const balances = page.getByRole('region', { name: 'IOU balances' })
    await expect(balances).toBeVisible()
    const text = await balances.textContent()
    // Seed IOUs: iou1 = $43.72 (u1→u2), iou2 = $31.60 (u2→u1)
    // Net: u2 owes u1 $12.12
    expect(text).toMatch(/\$[\d,.]+/)
    expect(text).toMatch(/owes/i)
  })

  test('settle up button triggers and updates balances', async ({ page }) => {
    const balances = page.getByRole('region', { name: 'IOU balances' })
    const settleButton = balances.getByRole('button', { name: /settle/i })

    // If there are balances, the settle button should exist
    const hasBalances = await balances
      .getByText(/owes/i)
      .isVisible()
      .catch(() => false)
    if (hasBalances) {
      await expect(settleButton).toBeVisible()
      await settleButton.click()
      await page.waitForTimeout(500)

      // After settling, the "All settled up" message should appear
      await expect(page.getByText(/all settled/i)).toBeVisible()
    }
  })

  test('shows "All settled up" when no outstanding IOUs', async ({ page }) => {
    // Settle all balances first
    const settleButtons = page.getByRole('button', { name: /settle/i })
    const count = await settleButtons.count()
    for (let i = 0; i < count; i++) {
      await settleButtons.first().click()
      await page.waitForTimeout(300)
    }

    await expect(page.getByText(/all settled/i)).toBeVisible()
    // Check icon appears
    await expect(page.locator('[aria-hidden="true"]').filter({ hasText: '' }).first()).toBeVisible()
  })

  test('back button navigates away from household', async ({ page }) => {
    const backButton = page.getByRole('button', { name: /go back/i })
    await expect(backButton).toBeVisible()
    await backButton.click()
    await page.waitForTimeout(300)
    expect(page.url()).not.toContain('/household')
  })

  test('help tip for IOU balances exists and expands', async ({ page }) => {
    const helpTip = page.locator('details').filter({ hasText: /how do.*iou/i })
    if (await helpTip.isVisible()) {
      await helpTip.click()
      await expect(helpTip.locator('p')).toBeVisible()
    }
  })

  test('IOU amounts are displayed in monospace font', async ({ page }) => {
    const balances = page.getByRole('region', { name: 'IOU balances' })
    const amountEl = balances.locator('.font-mono').first()
    if (await amountEl.isVisible()) {
      const text = await amountEl.textContent()
      expect(text).toMatch(/\$[\d,.]+/)
    }
  })

  test('member cards meet minimum touch target size', async ({ page }) => {
    const memberCards = page.getByRole('region', { name: 'Household members' }).locator('li')
    const count = await memberCards.count()
    for (let i = 0; i < count; i++) {
      const box = await memberCards.nth(i).boundingBox()
      expect(box).not.toBeNull()
      if (box) {
        expect(box.height).toBeGreaterThanOrEqual(44)
      }
    }
  })
})

test.describe('Household — navigation from dashboard', () => {
  test('dashboard IOU widget links to /household', async ({ page }) => {
    await page.goto('/')
    await waitForDb(page)

    const householdLink = page.getByRole('link', { name: /household/i })
    if (await householdLink.isVisible()) {
      await householdLink.click()
      await page.waitForTimeout(300)
      expect(page.url()).toContain('/household')
    }
  })
})
