import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { databaseRequest, exportBackup, installDatabaseProbe } from './helpers/database'

async function seedHousehold(page: Page) {
  await installDatabaseProbe(page)
  await page.goto('/household')
  const backup = await exportBackup(page)
  const user = backup.users[0]
  const account = backup.accounts[0]
  if (!user || !account) throw new Error('Fresh Hearth did not initialize its user and account')
  backup.users = [
    { ...user, id: 'z-payer', name: 'Primary', is_current: 1 },
    { ...user, id: 'a-partner', name: 'Partner', role: 'partner', is_current: 0 },
  ]
  backup.accounts = [
    { ...account, id: 'primary-usd', user_id: 'z-payer', name: 'Primary cash' },
    { ...account, id: 'partner-eur', user_id: 'a-partner', name: 'Partner euros', currency: 'EUR' },
  ]
  await databaseRequest(page, { type: 'IMPORT_JSON', payload: backup })
  await page.reload()
}

async function addSplitExpense(page: Page) {
  await page.goto('/transactions/add')
  await page.getByLabel('Amount', { exact: true }).fill('40')
  await page.getByLabel('Account', { exact: true }).selectOption('primary-usd')
  await page.getByLabel('Merchant', { exact: true }).fill('Shared groceries')
  await page.getByRole('switch', { name: 'Split with household member' }).click()
  await page.getByLabel('Split with', { exact: true }).selectOption('a-partner')
  await page.getByLabel('They owe', { exact: true }).fill('20')
  await page.getByRole('button', { name: 'Save transaction' }).click()
  await expect(page).not.toHaveURL(/\/transactions\/add$/)
  await page.goto('/household')
}

test('a split retains the correct debtor when payer IDs sort after partner IDs', async ({ page }) => {
  await seedHousehold(page)
  await addSplitExpense(page)
  const balances = page.getByRole('region', { name: 'IOU balances' })
  await expect(balances).toContainText('Partner owes Primary $20.00')
  await page.reload()
  await expect(balances).toContainText('Partner owes Primary $20.00')
  const backup = await exportBackup(page)
  const expense = backup.transactions.find((transaction) => transaction.merchant === 'Shared groceries')
  const split = backup.iou_splits.find((row) => row.transaction_id === expense?.id)
  expect(split).toMatchObject({ from_user_id: 'z-payer', to_user_id: 'a-partner', amount: 20 })
})

test('settlement cancellation preserves the debt and confirmation persists settlement', async ({ page }) => {
  await seedHousehold(page)
  await addSplitExpense(page)
  const balances = page.getByRole('region', { name: 'IOU balances' })
  const unsettledSplits = (await exportBackup(page)).iou_splits
  await page.getByRole('button', { name: /Settle up with/ }).click()
  const dialog = page.getByRole('dialog', { name: 'Settle up?', exact: true })
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await expect(balances).toContainText('Partner owes Primary $20.00')
  await page.reload()
  await expect(balances).toContainText('Partner owes Primary $20.00')
  expect((await exportBackup(page)).iou_splits).toEqual(unsettledSplits)
  await page.getByRole('button', { name: /Settle up with/ }).click()
  await dialog.getByRole('button', { name: 'Settle', exact: true }).click()
  await expect(balances.getByRole('button', { name: /Settle up with/ })).toHaveCount(0)
  await page.reload()
  await expect(balances.getByRole('button', { name: /Settle up with/ })).toHaveCount(0)
  expect((await exportBackup(page)).iou_splits).toEqual([
    expect.objectContaining({ from_user_id: 'z-payer', to_user_id: 'a-partner', is_settled: 1 }),
  ])
})

test('opposing debts in different currencies remain separate through settlement', async ({ page }) => {
  await seedHousehold(page)
  await addSplitExpense(page)
  await databaseRequest(page, {
    type: 'CREATE_TRANSACTION',
    payload: {
      date: '2026-01-15', amount: -30, currency: 'EUR', account_id: 'partner-eur', user_id: 'a-partner',
      type: 'expense', category_id: null, description: '', merchant: 'Partner shared meal',
      is_private: 0, is_recurring: 0, transfer_to_account_id: null, split_id: null,
      source: 'manual', home_amount: null, exchange_rate: null,
      iou_split: { to_user_id: 'z-payer', amount: 15 },
    },
  })
  await page.reload()
  const balances = page.getByRole('region', { name: 'IOU balances' })
  await expect(balances).toContainText('Partner owes Primary $20.00')
  await expect(balances).toContainText('Primary owes Partner €15.00')
  const dollarDebt = balances.locator('li').filter({ hasText: 'Partner owes Primary $20.00' })
  await dollarDebt.getByRole('button', { name: /Settle up with/ }).click()
  await page.getByRole('dialog', { name: 'Settle up?', exact: true })
    .getByRole('button', { name: 'Settle', exact: true }).click()
  await expect(balances).not.toContainText('Partner owes Primary $20.00')
  await expect(balances).toContainText('Primary owes Partner €15.00')
  await page.reload()
  await expect(balances).not.toContainText('Partner owes Primary $20.00')
  await expect(balances).toContainText('Primary owes Partner €15.00')
  expect((await exportBackup(page)).iou_splits).toEqual(expect.arrayContaining([
    expect.objectContaining({
      from_user_id: 'z-payer', to_user_id: 'a-partner', amount: 20, currency: 'USD', is_settled: 1,
    }),
    expect.objectContaining({
      from_user_id: 'a-partner', to_user_id: 'z-payer', amount: 15, currency: 'EUR', is_settled: 0,
    }),
  ]))
})
