import { localCalendarDate } from '@habitathq/utils'
import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import type { Transaction } from '../../app/types/database'
import { databaseRequest, exportBackup, installDatabaseProbe } from './helpers/database'

async function seedCurrencyTransactions(page: Page) {
  await installDatabaseProbe(page)
  await page.goto('/')
  const backup = await exportBackup(page)
  const account = backup.accounts[0]
  const user = backup.users[0]
  const category = backup.categories[0]
  if (!account || !user || !category) throw new Error('Fresh Hearth has no usable finance defaults')
  const date = localCalendarDate()
  const timestamp = new Date().toISOString()
  backup.accounts = [
    { ...account, id: 'usd-account', currency: 'USD' },
    { ...account, id: 'gbp-account', name: 'Sterling', currency: 'GBP' },
    { ...account, id: 'eur-account', name: 'Euros', currency: 'EUR' },
  ]
  const base: Transaction = {
    id: 'usd-expense', date, amount: -10, currency: 'USD', account_id: 'usd-account', user_id: user.id,
    type: 'expense', category_id: category.id, description: '', merchant: 'Dollar expense',
    is_private: 0, is_recurring: 0, transfer_to_account_id: null, split_id: null, source: 'manual',
    home_amount: null, home_currency: null, exchange_rate: null, created_at: timestamp, updated_at: timestamp,
  }
  backup.transactions = [
    base,
    { ...base, id: 'gbp-expense', amount: -20, currency: 'GBP', account_id: 'gbp-account', merchant: 'Sterling expense', home_amount: -25, home_currency: 'USD', exchange_rate: 1.25 },
    { ...base, id: 'eur-expense', amount: -100, currency: 'EUR', account_id: 'eur-account', merchant: 'Euro expense' },
  ]
  backup.envelopes = [{
    id: 'currency-budget', name: 'Currency budget', icon: '📦', color: '#f59e0b', budget_amount: 100,
    period: 'monthly', scope: 'household', category_ids: JSON.stringify([category.id]), rollover: 0,
    created_at: timestamp,
  }]
  await databaseRequest(page, { type: 'IMPORT_JSON', payload: backup })
  await page.reload()
  return { date, period: date.slice(0, 7) }
}

test('unknown conversions are excluded consistently and marked incomplete on every budget surface', async ({ page }) => {
  const { period } = await seedCurrencyTransactions(page)
  await expect(page.getByLabel('Currency conversion notice')).toBeVisible()
  expect(await databaseRequest(page, {
    type: 'GET_DASHBOARD_SUMMARY', payload: { period, home_currency: 'USD' },
  })).toMatchObject({ spent_this_month: 35, income_this_month: 0, budget_remaining: 65, missing_conversion_count: 1 })
  expect(await databaseRequest(page, {
    type: 'GET_ENVELOPES_WITH_SPENDING', payload: { period, home_currency: 'USD' },
  })).toEqual([expect.objectContaining({ spent: 35, remaining: 65, missing_conversion_count: 1 })])
  await page.goto('/reports')
  await expect(page.getByLabel('Total expenses')).toContainText('$35.00')
  await expect(page.getByLabel('Net savings')).toContainText('-$35.00')
  await expect(page.getByLabel('Currency conversion notice')).toBeVisible()
  await page.goto('/envelopes')
  await expect(page.getByLabel('Currency conversion notice')).toBeVisible()
  await expect(page.getByRole('region', { name: 'Budget overview' })).toContainText('$35.00 spent')
})

test('a known rate completes totals without changing original account or currency amounts', async ({ page }) => {
  const { date } = await seedCurrencyTransactions(page)
  await databaseRequest(page, {
    type: 'UPSERT_EXCHANGE_RATE', payload: { base: 'EUR', target: 'USD', date, rate: 1.25 },
  })
  await page.goto('/reports')
  await expect(page.getByLabel('Total expenses')).toContainText('$160.00')
  await expect(page.getByLabel('Net savings')).toContainText('-$160.00')
  await expect(page.getByLabel('Currency conversion notice')).toHaveCount(0)
  expect(await databaseRequest(page, {
    type: 'GET_CURRENCY_BREAKDOWN', payload: { period: date.slice(0, 7) },
  })).toEqual(expect.arrayContaining([
    expect.objectContaining({ currency: 'USD', expenses: 10 }),
    expect.objectContaining({ currency: 'GBP', expenses: 20 }),
    expect.objectContaining({ currency: 'EUR', expenses: 100 }),
  ]))
  expect(await databaseRequest(page, { type: 'GET_ACCOUNTS' })).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: 'usd-account', currency: 'USD', balance: -10 }),
    expect.objectContaining({ id: 'gbp-account', currency: 'GBP', balance: -20 }),
    expect.objectContaining({ id: 'eur-account', currency: 'EUR', balance: -100 }),
  ]))
})

test('changing home currency does not relabel a saved conversion for a different target', async ({ page }) => {
  await seedCurrencyTransactions(page)
  await page.goto('/settings')
  await page.getByLabel('Home currency', { exact: true }).selectOption('EUR')
  await page.goto('/reports')
  await expect(page.getByLabel('Total expenses')).toContainText('€100.00')
  await expect(page.getByLabel('Currency conversion notice')).toBeVisible()
  await page.reload()
  await expect(page.getByLabel('Total expenses')).toContainText('€100.00')
  expect((await exportBackup(page)).transactions.find((row) => row.id === 'gbp-expense')).toMatchObject({
    currency: 'GBP', amount: -20, home_currency: 'USD', home_amount: -25,
  })
})

test('stored category and person names remain text when chart tooltips are opened', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('hearth-settings', JSON.stringify({ reduceMotion: true })))
  await seedCurrencyTransactions(page)
  const backup = await exportBackup(page)
  const category = backup.categories[0]
  const user = backup.users[0]
  if (!category || !user) throw new Error('Missing tooltip fixture identities')
  const attack = '<img data-hearth-tooltip-attack src=x onerror="document.documentElement.dataset.hearthTooltipAttack=1">'
  category.name = attack
  user.name = attack
  await databaseRequest(page, { type: 'IMPORT_JSON', payload: backup })
  await page.goto('/reports')
  await expect(page.getByRole('region', { name: 'Spending by category', exact: true })).toContainText(attack)
  for (const mode of ['categories', 'people']) {
    await page.getByRole('button', { name: mode, exact: true }).click()
    const canvas = page.locator('figure canvas').first()
    await expect(canvas).toBeVisible()
    const box = await canvas.boundingBox()
    if (!box) throw new Error('Report donut has no rendered surface')
    await page.mouse.move(box.x + box.width / 2 + Math.min(box.width, box.height) * 0.29, box.y + box.height / 2)
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    await expect(page.locator('img[data-hearth-tooltip-attack]')).toHaveCount(0)
    expect(await page.locator('html').getAttribute('data-hearth-tooltip-attack')).toBeNull()
  }
})
