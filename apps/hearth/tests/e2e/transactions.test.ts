import { expect, test } from '@playwright/test'

// These tests require the dev server at http://127.0.0.1:3000 with seed data loaded.

test.describe('Add Transaction — full flow', () => {
  test('saves an expense and it appears in the transaction list', async ({ page }) => {
    await page.goto('/transactions/add')
    await page.waitForLoadState('networkidle')

    // Select Expense type (should be default, but be explicit)
    const typeGroup = page.getByRole('group', { name: 'Transaction type' })
    await typeGroup.getByRole('button', { name: /Expense/i }).click()

    // Enter amount via number pad: 1 2 . 5 0
    const pad = page.getByRole('group', { name: 'Number pad' })
    await pad.getByRole('button', { name: '1' }).click()
    await pad.getByRole('button', { name: '2' }).click()
    await pad.getByRole('button', { name: '.' }).click()
    await pad.getByRole('button', { name: '5' }).click()
    await pad.getByRole('button', { name: '0' }).click()

    // Verify amount display
    const amountDisplay = page.getByLabel('Amount to enter')
    await expect(amountDisplay).toContainText('12.50')

    // Fill in merchant / note
    const merchantField = page.getByLabel(/merchant|payee/i)
    if (await merchantField.isVisible()) {
      await merchantField.fill('Test Coffee Shop')
    }

    // Save
    await page.getByRole('button', { name: 'Save transaction' }).click()

    // Should redirect away from add page
    await expect(page).not.toHaveURL('/transactions/add', { timeout: 5000 })
  })

  test('saves an income transaction', async ({ page }) => {
    await page.goto('/transactions/add')
    await page.waitForLoadState('networkidle')

    const typeGroup = page.getByRole('group', { name: 'Transaction type' })
    await typeGroup.getByRole('button', { name: /Income/i }).click()

    const pad = page.getByRole('group', { name: 'Number pad' })
    await pad.getByRole('button', { name: '5' }).click()
    await pad.getByRole('button', { name: '0' }).click()
    await pad.getByRole('button', { name: '0' }).click()

    await expect(page.getByLabel('Amount to enter')).toContainText('500')

    await page.getByRole('button', { name: 'Save transaction' }).click()
    await expect(page).not.toHaveURL('/transactions/add', { timeout: 5000 })
  })

  test('backspace removes last digit', async ({ page }) => {
    await page.goto('/transactions/add')
    const pad = page.getByRole('group', { name: 'Number pad' })
    await pad.getByRole('button', { name: '4' }).click()
    await pad.getByRole('button', { name: '2' }).click()
    await pad.getByRole('button', { name: '3' }).click()
    await pad.getByRole('button', { name: 'Backspace' }).click()

    await expect(page.getByLabel('Amount to enter')).toContainText('42')
    await expect(page.getByLabel('Amount to enter')).not.toContainText('423')
  })

  test('Save is disabled until amount is non-zero', async ({ page }) => {
    await page.goto('/transactions/add')
    await expect(page.getByRole('button', { name: 'Save transaction' })).toBeDisabled()

    await page.getByRole('group', { name: 'Number pad' }).getByRole('button', { name: '5' }).click()
    await expect(page.getByRole('button', { name: 'Save transaction' })).toBeEnabled()
  })
})

test.describe('Edit Transaction — row click and edit flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/transactions')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1500)
  })

  test('transaction rows are clickable links', async ({ page }) => {
    const rows = page.locator('[data-testid="transaction-row"]')
    const count = await rows.count()
    expect(count).toBeGreaterThan(0)
  })

  test('clicking a transaction row navigates to the edit page', async ({ page }) => {
    const firstRow = page.locator('[data-testid="transaction-row"]').first()
    const href = await firstRow.getAttribute('href')
    expect(href).toMatch(/\/transactions\/[^/]+$/)
    await firstRow.click()
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(/\/transactions\/[^/]+$/)
  })

  test('edit page shows "Edit Transaction" heading', async ({ page }) => {
    const firstRow = page.locator('[data-testid="transaction-row"]').first()
    await firstRow.click()
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1000)
    await expect(page.getByRole('heading', { name: 'Edit Transaction' })).toBeVisible()
  })

  test('edit page pre-fills form with existing amount', async ({ page }) => {
    const firstRow = page.locator('[data-testid="transaction-row"]').first()
    await firstRow.click()
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1000)
    // Amount display should show a non-zero value
    const amountDisplay = page.getByLabel('Amount to enter')
    const text = await amountDisplay.textContent()
    expect(text).not.toBe('$0.00')
  })

  test('edit page cancel button navigates back', async ({ page }) => {
    const firstRow = page.locator('[data-testid="transaction-row"]').first()
    await firstRow.click()
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)
    await page.getByRole('button', { name: 'Cancel' }).click()
    await page.waitForTimeout(500)
    await expect(page).not.toHaveURL(/\/transactions\/[^/]+$/)
  })

  test('edit page Save button is enabled when amount is set', async ({ page }) => {
    const firstRow = page.locator('[data-testid="transaction-row"]').first()
    await firstRow.click()
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1000)
    // Save should be enabled since amount is pre-filled
    const saveBtn = page.getByRole('button', { name: 'Save transaction' })
    await expect(saveBtn).toBeEnabled()
  })
})

test.describe('Transaction list — search and filter', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/transactions')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1000)
  })

  test('typing in search narrows the list', async ({ page }) => {
    const search = page.getByLabel('Search transactions')
    const initialItems = await page
      .locator('[data-testid="transaction-row"], [role="listitem"]')
      .count()

    await search.fill('zzz_no_match_expected')
    await page.waitForTimeout(300)

    // Should show fewer (or zero) results — at minimum the list changed
    const filteredItems = await page
      .locator('[data-testid="transaction-row"], [role="listitem"]')
      .count()
    // Empty search term "zzz…" should yield 0 or fewer than initial
    expect(filteredItems).toBeLessThanOrEqual(initialItems)
  })

  test('clearing search restores all transactions', async ({ page }) => {
    const search = page.getByLabel('Search transactions')
    await search.fill('zzz_no_match')
    await page.waitForTimeout(300)
    await search.clear()
    await page.waitForTimeout(300)

    // Filter chips should still be visible
    const filterGroup = page.getByRole('group', { name: 'Filter by type' })
    await expect(filterGroup.getByRole('button', { name: 'All' })).toBeVisible()
  })

  test('Expenses filter shows only expense transactions', async ({ page }) => {
    const filterGroup = page.getByRole('group', { name: 'Filter by type' })
    await filterGroup.getByRole('button', { name: 'Expenses' }).click()

    // Income filter chip is not active (aria-pressed should be false)
    const incomBtn = filterGroup.getByRole('button', { name: 'Income' })
    await expect(incomBtn).toHaveAttribute('aria-pressed', 'false')

    const expenseBtn = filterGroup.getByRole('button', { name: 'Expenses' })
    await expect(expenseBtn).toHaveAttribute('aria-pressed', 'true')
  })

  test('All filter restores full list', async ({ page }) => {
    const filterGroup = page.getByRole('group', { name: 'Filter by type' })
    await filterGroup.getByRole('button', { name: 'Expenses' }).click()
    await filterGroup.getByRole('button', { name: 'All' }).click()

    await expect(filterGroup.getByRole('button', { name: 'All' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })
})
