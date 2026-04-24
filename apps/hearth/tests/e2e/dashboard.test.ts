import { expect, test } from '@playwright/test'

test.describe('Dashboard — main content', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1500)
  })

  test('monthly spending summary section is visible', async ({ page }) => {
    const summary = page.getByRole('region', { name: 'Monthly spending summary' })
    await expect(summary).toBeVisible()
  })

  test('spending summary contains a dollar amount', async ({ page }) => {
    const summary = page.getByRole('region', { name: 'Monthly spending summary' })
    const text = await summary.textContent()
    expect(text).toMatch(/\$[\d,.]+/)
  })

  test('budget envelopes section is visible', async ({ page }) => {
    const envelopes = page.getByRole('region', { name: 'Budget envelopes' })
    await expect(envelopes).toBeVisible()
  })

  test('recent transactions section is visible', async ({ page }) => {
    const recent = page.getByRole('region', { name: 'Recent transactions' })
    await expect(recent).toBeVisible()
  })

  test('"See all" link in envelopes navigates to /envelopes', async ({ page }) => {
    const envelopesSection = page.getByRole('region', { name: 'Budget envelopes' })
    const seeAllLink = envelopesSection.getByRole('link', { name: /see all/i })
    await expect(seeAllLink).toBeVisible()
    await seeAllLink.click()
    await expect(page).toHaveURL('/envelopes')
  })

  test('"See all" link in recent transactions navigates to /transactions', async ({ page }) => {
    const recentSection = page.getByRole('region', { name: 'Recent transactions' })
    const seeAllLink = recentSection.getByRole('link', { name: /see all/i })
    await expect(seeAllLink).toBeVisible()
    await seeAllLink.click()
    await expect(page).toHaveURL('/transactions')
  })
})

test.describe('Dashboard — savings goals', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1500)
  })

  test('savings goals section is visible when goals exist', async ({ page }) => {
    const goalsSection = page.getByRole('region', { name: 'Savings goals' })
    const isVisible = await goalsSection.isVisible().catch(() => false)
    if (isVisible) {
      // Should contain progress bars
      const progressBars = goalsSection.getByRole('progressbar')
      const count = await progressBars.count()
      expect(count).toBeGreaterThanOrEqual(1)
    }
  })

  test('savings goal progress bars show percentage', async ({ page }) => {
    const goalsSection = page.getByRole('region', { name: 'Savings goals' })
    const isVisible = await goalsSection.isVisible().catch(() => false)
    if (isVisible) {
      const text = await goalsSection.textContent()
      expect(text).toMatch(/\d+%/)
    }
  })
})

test.describe('Dashboard — IOU widget', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1500)
  })

  test('IOU widget links to /household when balances exist', async ({ page }) => {
    const householdLink = page.getByRole('link', { name: /household balances/i })
    const isVisible = await householdLink.isVisible().catch(() => false)
    if (isVisible) {
      await expect(householdLink).toHaveAttribute('href', '/household')
    }
  })
})

test.describe('Dashboard — period navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1000)
  })

  test('previous month button changes the period heading', async ({ page }) => {
    const heading = page.getByRole('heading', { level: 1 })
    const initialText = await heading.textContent()
    await page.getByRole('button', { name: 'Previous month' }).click()
    await page.waitForTimeout(500)
    const newText = await heading.textContent()
    expect(newText).not.toBe(initialText)
  })

  test('next month button is disabled on current month', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Next month' })).toBeDisabled()
  })
})

test.describe('Dashboard — FAB', () => {
  test('Add transaction FAB is visible and links to /transactions/add', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    const fab = page.getByRole('link', { name: 'Add transaction' })
    await expect(fab).toBeVisible()
    await expect(fab).toHaveAttribute('href', '/transactions/add')
  })
})
