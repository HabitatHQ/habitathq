import { expect, test } from '@playwright/test'

// These tests assume the dev server is running at http://127.0.0.1:3000
// The DB initialises with seed data on first load.

test.describe('Navigation', () => {
  test('loads the dashboard', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('main')).toBeVisible()
  })

  test('has bottom navigation with 4 tabs', async ({ page }) => {
    await page.goto('/')
    const nav = page.getByRole('navigation', { name: 'Main navigation' })
    await expect(nav).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Dashboard' })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Transactions' })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Envelopes' })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Reports' })).toBeVisible()
  })

  test('navigates to Transactions tab', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('link', { name: 'Transactions' }).click()
    await expect(page).toHaveURL('/transactions')
    await expect(page.getByLabel('Search transactions')).toBeVisible()
  })

  test('navigates to Envelopes tab', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('link', { name: 'Envelopes' }).click()
    await expect(page).toHaveURL('/envelopes')
  })

  test('navigates to Reports tab', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('link', { name: 'Reports' }).click()
    await expect(page).toHaveURL('/reports')
  })

  test('FAB navigates to Add Transaction', async ({ page }) => {
    await page.goto('/')
    // Wait for page to be ready
    await page.waitForLoadState('networkidle')
    await page.getByRole('link', { name: 'Add transaction' }).first().click()
    await expect(page).toHaveURL('/transactions/add')
    await expect(page.getByRole('heading', { name: 'New Transaction' })).toBeVisible()
  })

  test('cancel on Add Transaction goes back', async ({ page }) => {
    await page.goto('/transactions/add')
    await page.getByRole('button', { name: 'Cancel' }).click()
    // Should navigate back — most likely to dashboard or transactions
    await expect(page).not.toHaveURL('/transactions/add')
  })
})

test.describe('Dashboard', () => {
  test('shows monthly spending summary', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    const summary = page.getByRole('region', { name: 'Monthly spending summary' })
    await expect(summary).toBeVisible({ timeout: 10_000 })
  })

  test('shows envelope section', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    const envelopes = page.getByRole('region', { name: 'Budget envelopes' })
    await expect(envelopes).toBeVisible({ timeout: 10_000 })
  })

  test('period navigation changes month label', async ({ page }) => {
    await page.goto('/')
    const heading = page.getByRole('heading', { level: 1 })
    const initialText = await heading.textContent()
    await page.getByRole('button', { name: 'Previous month' }).click()
    const newText = await heading.textContent()
    expect(newText).not.toBe(initialText)
  })

  test('next month button is disabled on current month', async ({ page }) => {
    await page.goto('/')
    const nextBtn = page.getByRole('button', { name: 'Next month' })
    await expect(nextBtn).toBeDisabled()
  })
})

test.describe('Transactions', () => {
  test('shows search input', async ({ page }) => {
    await page.goto('/transactions')
    await expect(page.getByLabel('Search transactions')).toBeVisible()
  })

  test('filter chips are visible', async ({ page }) => {
    await page.goto('/transactions')
    const filterGroup = page.getByRole('group', { name: 'Filter by type' })
    await expect(filterGroup.getByRole('button', { name: 'All' })).toBeVisible()
    await expect(filterGroup.getByRole('button', { name: 'Expenses' })).toBeVisible()
    await expect(filterGroup.getByRole('button', { name: 'Income' })).toBeVisible()
  })
})

test.describe('Add Transaction', () => {
  test('shows type toggle buttons', async ({ page }) => {
    await page.goto('/transactions/add')
    const typeGroup = page.getByRole('group', { name: 'Transaction type' })
    await expect(typeGroup.getByRole('button', { name: /Expense/i })).toBeVisible()
    await expect(typeGroup.getByRole('button', { name: /Income/i })).toBeVisible()
    await expect(typeGroup.getByRole('button', { name: /Transfer/i })).toBeVisible()
  })

  test('number pad is visible', async ({ page }) => {
    await page.goto('/transactions/add')
    const numPad = page.getByRole('group', { name: 'Number pad' })
    await expect(numPad).toBeVisible()
    await expect(numPad.getByRole('button', { name: '1' })).toBeVisible()
    await expect(numPad.getByRole('button', { name: 'Backspace' })).toBeVisible()
  })

  test('amount updates when number pad pressed', async ({ page }) => {
    await page.goto('/transactions/add')
    const amountDisplay = page.getByLabel('Amount to enter')
    await page.getByRole('button', { name: '4' }).click()
    await page.getByRole('button', { name: '2' }).click()
    await expect(amountDisplay).toContainText('42')
  })

  test('Save button is disabled when no amount', async ({ page }) => {
    await page.goto('/transactions/add')
    await expect(page.getByRole('button', { name: 'Save transaction' })).toBeDisabled()
  })
})

test.describe('Envelopes', () => {
  test('shows overall budget summary', async ({ page }) => {
    await page.goto('/envelopes')
    await page.waitForLoadState('networkidle')
    const summary = page.getByRole('region', { name: 'Budget overview' })
    await expect(summary).toBeVisible({ timeout: 10_000 })
  })

  test('envelope list is visible', async ({ page }) => {
    await page.goto('/envelopes')
    await page.waitForLoadState('networkidle')
    const envList = page.getByRole('region', { name: 'Budget envelopes' })
    await expect(envList).toBeVisible({ timeout: 10_000 })
  })
})

test.describe('Household', () => {
  test('shows members section', async ({ page }) => {
    await page.goto('/household')
    await page.waitForLoadState('networkidle')
    const members = page.getByRole('region', { name: 'Household members' })
    await expect(members).toBeVisible({ timeout: 10_000 })
  })

  test('shows balances section', async ({ page }) => {
    await page.goto('/household')
    await page.waitForLoadState('networkidle')
    const balances = page.getByRole('region', { name: 'IOU balances' })
    await expect(balances).toBeVisible({ timeout: 10_000 })
  })
})
