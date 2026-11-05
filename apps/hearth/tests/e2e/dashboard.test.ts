import { localCalendarDate } from '@habitathq/utils'
import { expect, test } from '@playwright/test'
import type { Transaction } from '../../app/types/database'
import { databaseRequest, exportBackup, installDatabaseProbe } from './helpers/database'

test('dashboard period navigation changes persisted financial data and returns to the current period', async ({ page }) => {
  await installDatabaseProbe(page)
  await page.goto('/')
  const backup = await exportBackup(page)
  const user = backup.users[0]
  const account = backup.accounts[0]
  if (!user || !account) throw new Error('Fresh Hearth has no finance identity')
  const today = localCalendarDate()
  const year = Number(today.slice(0, 4))
  const month = Number(today.slice(5, 7))
  const previousPeriod = month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`
  const timestamp = new Date().toISOString()
  const expense: Transaction = {
    id: 'current-expense', date: today, amount: -22.5, currency: 'USD', account_id: account.id,
    user_id: user.id, type: 'expense', category_id: null, description: '', merchant: 'Current expense',
    is_private: 0, is_recurring: 0, transfer_to_account_id: null, split_id: null, source: 'manual',
    home_amount: null, home_currency: null, exchange_rate: null, created_at: timestamp, updated_at: timestamp,
  }
  backup.transactions = [
    expense,
    { ...expense, id: 'previous-expense', date: `${previousPeriod}-15`, amount: -11.5, merchant: 'Previous expense' },
  ]
  await databaseRequest(page, { type: 'IMPORT_JSON', payload: backup })
  await page.reload()
  await expect(page.getByLabel('Amount spent: $22.50', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Next month' })).toBeDisabled()
  await page.getByRole('button', { name: 'Previous month' }).click()
  await expect(page.getByLabel('Amount spent: $11.50', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Next month' }).click()
  await expect(page.getByLabel('Amount spent: $22.50', { exact: true })).toBeVisible()
})
