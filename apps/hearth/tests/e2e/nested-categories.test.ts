import { expect, test } from '@playwright/test'
import type { HearthExport } from '../../app/types/database'
import { databaseRequest, exportBackup, installDatabaseProbe } from './helpers/database'

test('Detailed New and Edit preserve selectable four-level categories through reload', async ({ page }) => {
  await installDatabaseProbe(page)
  await page.goto('/transactions')
  const backup: HearthExport = await exportBackup(page)
  const rootExpense = backup.categories.find((category) => category.id === 'c1')
  const groceries = backup.categories.find((category) => category.id === 'c1a')
  const rootIncome = backup.categories.find((category) => category.id === 'c7')
  if (!rootExpense || !groceries || !rootIncome) {
    throw new Error('Nested category fixture needs default expense and income roots')
  }

  const firstLeaf = 'nested-leaf-first'
  const secondLeaf = 'nested-leaf-second'
  const incomeLeaf = 'nested-income-leaf'
  backup.categories.push(
    { id: 'nested-level-three', parent_id: groceries.id, name: 'Nested Produce', icon: '🥕', color: '#16a34a', sort_order: 100 },
    { id: firstLeaf, parent_id: 'nested-level-three', name: 'First Deep Leaf', icon: '🥬', color: '#16a34a', sort_order: 101 },
    { id: secondLeaf, parent_id: 'nested-level-three', name: 'Second Deep Leaf', icon: '🍎', color: '#16a34a', sort_order: 102 },
    { id: 'nested-income-level-three', parent_id: rootIncome.id, name: 'Nested Income', icon: '📈', color: '#16a34a', sort_order: 100 },
    { id: 'nested-income-level-four', parent_id: 'nested-income-level-three', name: 'Nested Income Detail', icon: '💰', color: '#16a34a', sort_order: 100 },
    { id: incomeLeaf, parent_id: 'nested-income-level-four', name: 'Deep Income Leaf', icon: '💸', color: '#16a34a', sort_order: 100 },
  )
  await databaseRequest(page, { type: 'IMPORT_JSON', payload: backup })
  await page.goto('/transactions/add')

  const category = page.locator('#tx-category')
  await expect(category.locator(`option[value="${firstLeaf}"]`)).toHaveCount(1)
  await expect(category.locator(`option[value="${secondLeaf}"]`)).toHaveCount(1)
  await expect(category.locator(`option[value="${rootIncome.id}"]`)).toHaveCount(0)
  await expect(category.locator('option[value="nested-income-level-three"]')).toHaveCount(0)
  await expect(category.locator('option[value="nested-income-level-four"]')).toHaveCount(0)
  await expect(category.locator(`option[value="${incomeLeaf}"]`)).toHaveCount(0)
  await category.selectOption(firstLeaf)
  await page.locator('input[aria-label="Amount"]').fill('41.25')
  await page.getByLabel('Merchant', { exact: true }).fill('Nested category entry')
  await page.getByRole('button', { name: 'Save transaction' }).click()
  await expect(page).not.toHaveURL(/transactions\/add$/)

  let saved = (await exportBackup(page)).transactions.find(
    (transaction) => transaction.merchant === 'Nested category entry',
  )
  expect(saved).toMatchObject({ category_id: firstLeaf, amount: -41.25, type: 'expense' })
  if (!saved) throw new Error('Detailed New did not persist the nested category transaction')

  await page.goto(`/transactions/${saved.id}`)
  await expect(page.locator('#tx-category')).toHaveValue(firstLeaf)
  await expect(page.locator('#tx-category option').filter({ hasText: 'First Deep Leaf' })).toHaveCount(1)
  await expect(page.locator(`#tx-category option[value="${incomeLeaf}"]`)).toHaveCount(0)
  await page.locator('#tx-category').selectOption(secondLeaf)
  await page.getByRole('button', { name: 'Save transaction' }).click()
  await expect(page).not.toHaveURL(/\/transactions\/[^/]+$/)
  await page.reload()
  saved = (await exportBackup(page)).transactions.find((transaction) => transaction.id === saved?.id)
  expect(saved).toMatchObject({ category_id: secondLeaf, amount: -41.25, type: 'expense' })

  await page.goto('/transactions/add')
  await page.getByRole('group', { name: 'Transaction type' }).getByRole('button', { name: 'Income' }).click()
  await expect(category.locator(`option[value="${rootIncome.id}"]`)).toHaveCount(1)
  await expect(category.locator('option[value="nested-income-level-three"]')).toHaveCount(1)
  await expect(category.locator('option[value="nested-income-level-four"]')).toHaveCount(1)
  await expect(category.locator(`option[value="${incomeLeaf}"]`)).toHaveCount(1)
  await expect(category.locator(`option[value="${rootExpense.id}"]`)).toHaveCount(0)
  await expect(category.locator(`option[value="${groceries.id}"]`)).toHaveCount(0)
  await expect(category.locator(`option[value="${firstLeaf}"]`)).toHaveCount(0)
})
