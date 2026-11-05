import { localCalendarDate } from '@habitathq/utils'
import { expect, test } from '@playwright/test'
import type { Transaction } from '../../app/types/database'
import { databaseRequest, exportBackup, installDatabaseProbe } from './helpers/database'

test('import preview totals use selected currency, exclude duplicates and unresolved rates, and preserve originals', async ({ page }) => {
  await installDatabaseProbe(page)
  await page.goto('/settings')
  await page.getByLabel('Home currency', { exact: true }).selectOption('EUR')
  const backup = await exportBackup(page)
  const account = backup.accounts[0]
  const user = backup.users.find((candidate) => candidate.is_current === 1) ?? backup.users[0]
  if (!account || !user) throw new Error('Import fixture needs a finance account and current user')

  const date = localCalendarDate()
  const duplicate: Omit<Transaction, 'id' | 'created_at' | 'updated_at'> = {
    date, amount: -5, currency: 'EUR', account_id: account.id,
    user_id: user.id, type: 'expense', category_id: null, description: '', merchant: 'Existing duplicate',
    is_private: 0, is_recurring: 0, transfer_to_account_id: null, split_id: null, source: 'manual',
    home_amount: null, home_currency: null, exchange_rate: null,
  }
  await databaseRequest(page, { type: 'CREATE_TRANSACTION', payload: duplicate })
  await page.route('https://api.frankfurter.app/**', async (route) => {
    const url = new URL(route.request().url())
    if (url.searchParams.get('from') === 'USD') {
      await route.fulfill({ status: 404, body: 'No rate available' })
      return
    }
    await route.fulfill({
      json: { base: 'GBP', date, rates: { EUR: 2 } },
    })
  })

  await page.goto('/import')
  await page.getByRole('button', { name: 'Generic CSV' }).click()
  await page.locator('input[type="file"]').setInputFiles({
    name: 'mixed-currency.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from([
      'Date,Amount,Merchant,Type,Currency',
      `${date},10,Native EUR,expense,EUR`,
      `${date},20,Converted GBP,expense,GBP`,
      `${date},30,Unresolved USD,expense,USD`,
      `${date},7,Converted income,income,GBP`,
      `${date},5,Existing duplicate,expense,EUR`,
    ].join('\n')),
  })
  await page.getByRole('button', { name: 'Next →' }).click()
  await expect(page.getByText('Ready to import 4 transactions')).toBeVisible()
  const preview = page.getByText('Ready to import 4 transactions').locator('..')
  await expect(preview).toContainText('3 expenses (€50.00 total)')
  await expect(preview).toContainText('1 income (€14.00 total)')
  await expect(preview).toContainText('1 duplicates detected (will skip)')
  const notice = page.getByLabel('Currency conversion notice')
  await expect(notice).toBeVisible()
  await expect(notice).toContainText('1 transaction(s) could not be converted to EUR')
  await page.getByRole('button', { name: 'Import 4 →' }).click()
  await expect(page).toHaveURL('/transactions')

  const imported = (await exportBackup(page)).transactions
  expect(imported).toHaveLength(5)
  expect(imported).toEqual(expect.arrayContaining([
    expect.objectContaining({ merchant: 'Native EUR', amount: -10, currency: 'EUR' }),
    expect.objectContaining({
      merchant: 'Converted GBP', amount: -20, currency: 'GBP', home_amount: -40,
      home_currency: 'EUR', exchange_rate: 2,
    }),
    expect.objectContaining({
      merchant: 'Unresolved USD', amount: -30, currency: 'USD',
      home_amount: null, home_currency: null, exchange_rate: null,
    }),
    expect.objectContaining({
      merchant: 'Converted income', amount: 7, currency: 'GBP', home_amount: 14,
      home_currency: 'EUR', exchange_rate: 2,
    }),
    expect.objectContaining({ merchant: 'Existing duplicate', amount: -5, currency: 'EUR' }),
  ]))
})
