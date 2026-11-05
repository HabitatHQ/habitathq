import { localCalendarDate } from '@habitathq/utils'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { databaseRequest, exportBackup, installDatabaseProbe } from './helpers/database'


declare global {
  interface Window {
    __releaseHearthEditorLoad: (() => void) | undefined
  }
}
async function addSplitPartner(page: Page) {
  await installDatabaseProbe(page)
  await page.goto('/')
  const users = await databaseRequest(page, { type: 'GET_USERS' }) as Array<{ id: string; is_current: number }>
  const currentUser = users.find((user) => user.is_current === 1)
  if (!currentUser) throw new Error('Split fixture needs a current household member')
  if (!users.some((user) => user.is_current === 0)) {
    await databaseRequest(page, {
      type: 'CREATE_USER',
      payload: {
        name: 'Split fixture partner', email: null, role: 'partner', avatar_emoji: 'S',
        color: '#6366f1', is_current: 0,
      },
    })
  }
  const refreshedUsers = await databaseRequest(page, { type: 'GET_USERS' }) as Array<{ id: string; is_current: number }>
  const partner = refreshedUsers.find((user) => user.is_current === 0)
  if (!partner) throw new Error('Split fixture needs a household partner')
  return { payerId: currentUser.id, partnerId: partner.id }
}

test('enabled expense split persists with the transaction using an explicit half share', async ({ page }) => {
  const { payerId, partnerId } = await addSplitPartner(page)
  await page.goto('/transactions/add')
  await page.locator('input[aria-label="Amount"]').fill('24')
  await page.getByRole('switch', { name: 'Split with household member' }).click()
  await expect(page.locator('#split-amount')).toHaveValue('12.00')
  await expect(page.locator('#split-user')).toHaveValue(partnerId)
  await page.getByLabel('Merchant').fill('Atomic split fixture')
  await page.getByRole('button', { name: 'Save transaction' }).click()
  await expect(page).not.toHaveURL(/transactions\/add$/)
  const backup = await exportBackup(page)
  const transaction = backup.transactions.find((row) => row.merchant === 'Atomic split fixture')
  expect(transaction).toBeDefined()
  expect(backup.iou_splits).toEqual(expect.arrayContaining([
    expect.objectContaining({
      transaction_id: transaction?.id,
      from_user_id: payerId,
      to_user_id: partnerId,
      amount: 12,
    }),
  ]))
})

test('invalid split is rejected, and switching to income clears split state', async ({ page }) => {
  await addSplitPartner(page)
  const before = await exportBackup(page)
  await page.goto('/transactions/add')
  await page.locator('input[aria-label="Amount"]').fill('10')
  await page.getByRole('switch', { name: 'Split with household member' }).click()
  await page.locator('#split-amount').fill('10.01')
  await page.getByLabel('Merchant').fill('Rejected oversized split')
  await page.getByRole('button', { name: 'Save transaction' }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  expect((await exportBackup(page)).transactions).toEqual(before.transactions)

  await page.getByRole('group', { name: 'Transaction type' }).getByRole('button', { name: 'Income' }).click()
  await page.locator('input[aria-label="Amount"]').fill('10')
  await page.getByLabel('Merchant').fill('Income after split toggle')
  await page.getByRole('button', { name: 'Save transaction' }).click()
  await expect(page).not.toHaveURL(/transactions\/add$/)
  const backup = await exportBackup(page)
  expect(backup.transactions).toEqual(expect.arrayContaining([
    expect.objectContaining({ merchant: 'Income after split toggle', type: 'income' }),
  ]))
  expect(backup.iou_splits).toEqual(before.iou_splits)
})

test('reactive chore form and CSV batch persist through the real database worker', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await installDatabaseProbe(page)
  await page.goto('/chores')
  await page.getByRole('button', { name: 'Add chore' }).click()
  await page.getByRole('textbox', { name: 'Chore name' }).fill('Worker boundary fixture')
  await page.getByRole('button', { name: 'Add Chore', exact: true }).click()
  await expect(page.getByText('Worker boundary fixture')).toBeVisible()

  const fixture = await exportBackup(page)
  const categoryName = fixture.categories[0]?.name
  if (!categoryName) throw new Error('CSV worker fixture needs a category')
  const merchant = 'Worker CSV fixture'
  const csvFile = {
    name: 'worker-import.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(`Date,Amount,Merchant,Category,Currency\n2026-11-01,-18.25,${merchant},${categoryName},USD\n`),
  }
  await page.goto('/import')
  await page.getByRole('button', { name: 'Generic CSV' }).click()
  await page.locator('input[type="file"]').setInputFiles(csvFile)
  await page.getByRole('button', { name: 'Next →' }).click()
  await page.getByRole('button', { name: 'Next →' }).click()
  await page.getByRole('button', { name: 'Import 1 →' }).click()

  const chores = await databaseRequest(page, {
    type: 'GET_CHORES_WITH_STATUS',
    payload: { date: localCalendarDate() },
  })
  expect(chores).toEqual(expect.arrayContaining([
    expect.objectContaining({ name: 'Worker boundary fixture' }),
  ]))
  const backup = await exportBackup(page)
  expect(backup.transactions).toEqual(expect.arrayContaining([
    expect.objectContaining({ merchant, amount: -18.25, currency: 'USD' }),
  ]))
  expect(pageErrors.join('\n')).not.toMatch(/DataCloneError|could not be cloned/i)
})

test('restore validates first, cancellation preserves data, and confirmation replaces it', async ({ page }) => {
  await installDatabaseProbe(page)
  await page.goto('/')
  const backupBeforeMutation = await exportBackup(page)
  await databaseRequest(page, {
    type: 'CREATE_CHORE',
    payload: {
      name: 'Must survive cancel only', icon: '🧪', frequency: 'weekly',
      scope: 'household', color: '#f59e0b', assigned_to: null,
    },
  })
  const restoreFile = {
    name: 'validated-backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(backupBeforeMutation)),
  }

  await page.goto('/settings')
  await page.locator('input[type="file"][accept=".json"]').setInputFiles({
    name: 'invalid-backup.json', mimeType: 'application/json', buffer: Buffer.from('{}'),
  })
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.getByRole('alertdialog')).toHaveCount(0)
  const invalidRestoreChores = await databaseRequest(page, {
    type: 'GET_CHORES_WITH_STATUS', payload: { date: localCalendarDate() },
  })
  expect(invalidRestoreChores).toEqual(expect.arrayContaining([
    expect.objectContaining({ name: 'Must survive cancel only' }),
  ]))
  await page.locator('input[type="file"][accept=".json"]').setInputFiles(restoreFile)
  const dialog = page.getByRole('alertdialog', { name: 'Replace all existing data?' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Keep current data' }).click()
  await expect(dialog).toBeHidden()
  let chores = await databaseRequest(page, {
    type: 'GET_CHORES_WITH_STATUS', payload: { date: localCalendarDate() },
  })
  expect(chores).toEqual(expect.arrayContaining([
    expect.objectContaining({ name: 'Must survive cancel only' }),
  ]))

  await page.locator('input[type="file"][accept=".json"]').setInputFiles(restoreFile)
  const confirmDialog = page.getByRole('alertdialog', { name: 'Replace all existing data?' })
  await confirmDialog.getByRole('button', { name: 'Replace Data' }).click()
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
  chores = await databaseRequest(page, {
    type: 'GET_CHORES_WITH_STATUS', payload: { date: localCalendarDate() },
  })
  expect(chores).not.toEqual(expect.arrayContaining([
    expect.objectContaining({ name: 'Must survive cancel only' }),
  ]))
})

test('late foreign-exchange response cannot overwrite the latest transaction type conversion', async ({ page }) => {
  await installDatabaseProbe(page)
  await page.goto('/settings')
  await page.getByLabel('Home currency', { exact: true }).selectOption('USD')

  let releaseFirst: (() => void) | undefined
  const firstResponse = new Promise<void>((resolve) => {
    releaseFirst = resolve
  })
  let responseCount = 0
  await page.route('https://api.frankfurter.app/**', async (route) => {
    responseCount += 1
    const requestNumber = responseCount
    if (requestNumber === 1) await firstResponse
    await route.fulfill({
      json: {
        base: 'EUR',
        date: localCalendarDate(),
        rates: { USD: requestNumber === 1 ? 1 : 2 },
      },
    })
  })

  await page.goto('/transactions/add')
  await page.locator('select#tx-currency').last().selectOption('EUR')
  await page.locator('input[aria-label="Amount"]').fill('10')
  await expect.poll(() => responseCount).toBe(1)
  await page.getByRole('group', { name: 'Transaction type' }).getByRole('button', { name: 'Income' }).click()
  await expect.poll(() => responseCount).toBe(2)
  await expect(page.getByText('1 EUR = 2.0000 USD')).toBeVisible()
  releaseFirst?.()
  await expect(page.getByText('1 EUR = 2.0000 USD')).toBeVisible()
  await expect(page.locator('body')).toContainText('$20.00')
  await page.getByLabel('Merchant').fill('Stale FX response fixture')
  await page.getByRole('button', { name: 'Save transaction' }).click()
  await expect(page).not.toHaveURL(/transactions\/add$/)
  const saved = (await exportBackup(page)).transactions.find(
    (transaction) => transaction.merchant === 'Stale FX response fixture',
  )
  expect(saved).toMatchObject({
    type: 'income', amount: 10, currency: 'EUR', home_amount: 20,
    home_currency: 'USD', exchange_rate: 2,
  })
})

test('editing after a delayed load offline preserves the saved signed home conversion', async ({ page }) => {
  await installDatabaseProbe(page)
  await page.goto('/settings')
  await page.getByLabel('Home currency', { exact: true }).selectOption('USD')
  await page.goto('/')
  const backup = await exportBackup(page)
  const account = backup.accounts[0]
  const user = backup.users.find((candidate) => candidate.is_current === 1) ?? backup.users[0]
  if (!account || !user) throw new Error('Offline conversion fixture needs an account and user')
  await databaseRequest(page, {
    type: 'CREATE_TRANSACTION',
    payload: {
      date: localCalendarDate(),
      amount: -5,
      currency: 'GBP',
      account_id: account.id,
      user_id: user.id,
      type: 'expense',
      category_id: null,
      description: '',
      merchant: 'Offline conversion fixture',
      is_private: 0,
      is_recurring: 0,
      transfer_to_account_id: null,
      split_id: null,
      source: 'manual',
      home_amount: -6.25,
      home_currency: 'USD',
      exchange_rate: 1.25,
    },
  })
  const seeded = (await exportBackup(page)).transactions.find(
    (transaction) => transaction.merchant === 'Offline conversion fixture',
  )
  if (!seeded) throw new Error('Offline conversion fixture was not persisted')
  let attemptedRates = 0
  await page.route('https://api.frankfurter.app/**', async (route) => {
    attemptedRates += 1
    await route.abort()
  })
  await page.addInitScript(() => {
    const NativeWorker = window.Worker
    window.Worker = class extends NativeWorker {
      postMessage(message: unknown, options?: StructuredSerializeOptions | Transferable[]) {
        const send = () => {
          if (Array.isArray(options)) super.postMessage(message, options)
          else super.postMessage(message, options)
        }
        if (
          typeof message === 'object' && message !== null &&
          'type' in message && message.type === 'GET_TRANSACTION'
        ) {
          window.__releaseHearthEditorLoad = send
          return
        }
        send()
      }
    }
  })
  await page.goto(`/transactions/${seeded.id}`)
  await page.waitForFunction(() => typeof window.__releaseHearthEditorLoad === 'function')
  await expect(page.getByRole('status', { name: 'Loading transaction' })).toBeVisible()
  await expect(page.getByLabel('Merchant')).toBeHidden()
  await expect(page.getByRole('button', { name: 'Save transaction' })).toBeDisabled()
  await page.evaluate(() => window.__releaseHearthEditorLoad?.())
  await expect(page.getByLabel('Merchant')).toHaveValue('Offline conversion fixture')
  await page.getByLabel('Merchant').fill('Offline conversion edited')
  await page.getByRole('button', { name: 'Save transaction' }).click()
  await expect(page).not.toHaveURL(/transactions\/[^/]+$/)
  expect(attemptedRates).toBe(0)
  const saved = (await exportBackup(page)).transactions.find(
    (transaction) => transaction.id === seeded.id,
  )
  expect(saved).toMatchObject({
    amount: -5, currency: 'GBP', merchant: 'Offline conversion edited',
    home_amount: -6.25, home_currency: 'USD', exchange_rate: 1.25,
  })
})

test('Settings marks unconverted balances incomplete and blocks unsafe reconciliation', async ({ page }) => {
  await installDatabaseProbe(page)
  await page.goto('/')
  const backup = await exportBackup(page)
  const account = backup.accounts[0]
  const user = backup.users.find((candidate) => candidate.is_current === 1) ?? backup.users[0]
  if (!account || !user) throw new Error('Account warning fixture needs an account and user')
  await databaseRequest(page, {
    type: 'CREATE_TRANSACTION',
    payload: {
      date: '1900-01-01',
      amount: -3,
      currency: account.currency === 'EUR' ? 'USD' : 'EUR',
      account_id: account.id,
      user_id: user.id,
      type: 'expense',
      category_id: null,
      description: '',
      merchant: 'Unconverted account balance fixture',
      is_private: 0,
      is_recurring: 0,
      transfer_to_account_id: null,
      split_id: null,
      source: 'manual',
      home_amount: null,
      home_currency: null,
      exchange_rate: null,
    },
  })
  await page.goto('/settings')
  const accountRegion = page.getByRole('region', { name: 'Account balances' })
  await expect(accountRegion.getByRole('status')).toBeVisible()
  await page.getByRole('button', { name: `Reconcile ${account.name}` }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('status')).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Reconcile', exact: true })).toBeDisabled()
})

test('saving while a new rate is pending never relabels the previously resolved conversion', async ({ page }) => {
  await installDatabaseProbe(page)
  await page.goto('/')
  await exportBackup(page)
  const pendingRate = Promise.withResolvers<void>()
  await page.route('https://api.frankfurter.app/**', async (route) => {
    const base = new URL(route.request().url()).searchParams.get('from')
    if (base === 'GBP') await pendingRate.promise
    await route.fulfill({ json: { base, date: localCalendarDate(), rates: { USD: 2 } } })
  })
  try {
    await page.goto('/transactions/add')
    await page.locator('input[aria-label="Amount"]').fill('10')
    await page.locator('select#tx-currency').last().selectOption('EUR')
    await expect(page.getByText('1 EUR = 2.0000 USD')).toBeVisible()
    await Promise.all([
      page.waitForRequest((request) => request.url().includes('from=GBP')),
      page.locator('select#tx-currency').last().selectOption('GBP'),
    ])
    await page.getByLabel('Merchant').fill('Pending conversion expense')
    await page.getByRole('button', { name: 'Save transaction' }).click()
    await expect(page).not.toHaveURL(/transactions\/add$/)
    expect((await exportBackup(page)).transactions).toEqual([
      expect.objectContaining({
        merchant: 'Pending conversion expense', amount: -10, currency: 'GBP',
        home_amount: null, home_currency: null, exchange_rate: null,
      }),
    ])
  } finally {
    pendingRate.resolve()
  }
})

test('an unrelated edit preserves a conversion for a different home setting even without its rate', async ({ page }) => {
  await installDatabaseProbe(page)
  await page.goto('/')
  const backup = await exportBackup(page)
  const user = backup.users[0]
  const account = backup.accounts[0]
  if (!user || !account) throw new Error('Missing finance identity')
  await databaseRequest(page, {
    type: 'CREATE_TRANSACTION',
    payload: {
      date: localCalendarDate(), amount: -10, currency: 'EUR', account_id: account.id, user_id: user.id,
      type: 'expense', category_id: null, description: '', merchant: 'Preserved original conversion',
      is_private: 0, is_recurring: 0, transfer_to_account_id: null, split_id: null, source: 'import',
      home_amount: -12.5, home_currency: 'USD', exchange_rate: null,
    },
  })
  const original = (await exportBackup(page)).transactions[0]
  if (!original) throw new Error('Conversion fixture was not saved')
  await page.goto('/settings')
  await page.getByLabel('Home currency', { exact: true }).selectOption('EUR')
  await page.route('https://api.frankfurter.app/**', (route) => route.abort())
  await page.goto(`/transactions/${original.id}`)
  await page.getByLabel('Merchant').fill('Renamed without losing conversion')
  await page.getByRole('button', { name: 'Save transaction' }).click()
  await expect(page).not.toHaveURL(/transactions\/[^/]+$/)
  expect((await exportBackup(page)).transactions[0]).toMatchObject({
    amount: -10, currency: 'EUR', merchant: 'Renamed without losing conversion',
    home_amount: -12.5, home_currency: 'USD', exchange_rate: null,
  })
})

test('rebuilding a CSV preview cannot import the previous mapping while a rate is pending', async ({ page }) => {
  await installDatabaseProbe(page)
  let releaseRate: (() => void) | undefined
  let rateRequested: (() => void) | undefined
  const pendingRate = new Promise<void>((resolve) => { releaseRate = resolve })
  const requestedRate = new Promise<void>((resolve) => { rateRequested = resolve })
  await page.route('https://api.frankfurter.app/**', async (route) => {
    rateRequested?.()
    await pendingRate
    await route.fulfill({ json: {
      base: 'EUR', date: '2026-11-01', rates: { USD: 2 },
    } })
  })
  try {
    await page.goto('/import')
    await page.getByRole('button', { name: 'Generic CSV' }).click()
    await page.locator('input[type="file"]').setInputFiles({
      name: 'remapped-currency.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('Date,Amount,Merchant,Category,Currency\n2026-11-01,-10,Remapped CSV,Groceries,EUR\n'),
    })
    const currencyMapping = page.getByText('"Currency"', { exact: true }).locator('..').getByRole('combobox')
    await currencyMapping.selectOption('skip')
    await page.getByRole('button', { name: 'Next →' }).click()
    await page.getByRole('button', { name: 'Next →' }).click()
    await expect(page.getByRole('button', { name: 'Import 1 →' })).toBeEnabled()
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    await currencyMapping.selectOption('currency')
    await page.getByRole('button', { name: 'Next →' }).click()
    await page.getByRole('button', { name: 'Next →' }).click()
    await requestedRate
    await expect(page.getByRole('button', { name: /^Import \d+ →$/ })).toBeDisabled()
    expect((await exportBackup(page)).transactions).toEqual([])
    releaseRate?.()
    await page.getByRole('button', { name: 'Import 1 →' }).click()
    await expect(page).not.toHaveURL(/\/import$/)
    expect((await exportBackup(page)).transactions).toEqual([
      expect.objectContaining({
        merchant: 'Remapped CSV', amount: -10, currency: 'EUR',
        home_amount: -20, home_currency: 'USD', source: 'import',
      }),
    ])
  } finally {
    releaseRate?.()
  }
})
