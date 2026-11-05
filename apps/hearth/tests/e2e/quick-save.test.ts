import { localCalendarDate } from '@habitathq/utils'
import { expect, test } from '@playwright/test'
import type { HearthExport } from '../../app/types/database'
import { databaseRequest, exportBackup, installDatabaseProbe } from './helpers/database'

declare global {
  interface Window {
    __releaseHearthQuickCreate: (() => void) | undefined
  }
}

for (const currency of ['USD', 'EUR']) {
  test(`Quick Add reconciles edits during a real ${currency} create exactly once`, async ({ page }) => {
    await installDatabaseProbe(page)
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
            'type' in message && message.type === 'CREATE_TRANSACTION'
          ) {
            window.__releaseHearthQuickCreate = () => {
              window.__releaseHearthQuickCreate = undefined
              send()
            }
            return
          }
          send()
        }
      }
    })
    let rateRequests = 0
    await page.route('https://api.frankfurter.app/**', async (route) => {
      rateRequests += 1
      if (rateRequests > 1) {
        await route.abort()
        return
      }
      await route.fulfill({
        json: { base: 'EUR', date: localCalendarDate(), rates: { USD: 1.25 } },
      })
    })

    await page.goto('/settings')
    await page.getByLabel('Home currency', { exact: true }).selectOption('USD')
    await page.getByRole('group', { name: 'Select NLP tier' })
      .getByRole('button', { name: /Lite/ }).click()
    const initial: HearthExport = await exportBackup(page)
    const user = initial.users.find((candidate) => candidate.is_current === 1)
    const originalAccount = initial.accounts[0]
    const grocery = initial.categories.find((candidate) => candidate.id === 'c1a')
    const income = initial.categories.find((candidate) => candidate.id === 'c7')
    if (!user || !originalAccount || !grocery || !income) {
      throw new Error('Quick Add fixture needs a current user, account, and root categories')
    }
    const accountName = `Quick save ${currency} corrections`
    await databaseRequest(page, {
      type: 'CREATE_ACCOUNT',
      payload: {
        user_id: user.id,
        name: accountName,
        type: 'checking',
        balance: 0,
        currency: 'USD',
        color: '#6366f1',
        icon: '🏦',
        is_active: 1,
      },
    })
    const withAccounts: HearthExport = await exportBackup(page)
    const correctedAccount = withAccounts.accounts.find((account) => account.name === accountName)
    if (!correctedAccount) throw new Error('Quick Add correction account was not persisted')
    const deepCategoryId = 'quick-deep-category'
    withAccounts.categories.push(
      { id: 'quick-level-three', parent_id: grocery.id, name: 'Quick Level Three', icon: '🥕', color: '#16a34a', sort_order: 100 },
      { id: deepCategoryId, parent_id: 'quick-level-three', name: 'Quick Leaf', icon: '🥬', color: '#16a34a', sort_order: 100 },
      { id: 'quick-income-level-two', parent_id: income.id, name: 'Quick Income Two', icon: '📈', color: '#16a34a', sort_order: 100 },
      { id: 'quick-income-level-three', parent_id: 'quick-income-level-two', name: 'Quick Income Three', icon: '💰', color: '#16a34a', sort_order: 100 },
      { id: 'quick-income-leaf', parent_id: 'quick-income-level-three', name: 'Quick Income Leaf', icon: '💸', color: '#16a34a', sort_order: 100 },
    )
    await databaseRequest(page, { type: 'IMPORT_JSON', payload: withAccounts })
    await page.reload()
    const before: HearthExport = await exportBackup(page)
    expect(before.accounts.map((account) => account.id)).toEqual(
      expect.arrayContaining([originalAccount.id, correctedAccount.id]),
    )

    await page.goto('/transactions/quick')
    await expect(page.getByRole('heading', { name: 'Quick Add', exact: true })).toBeVisible()
    await page.getByPlaceholder('$6 coffee at Blue Bottle yesterday...')
      .fill(`${currency === 'EUR' ? '€' : '$'}12.34 at Original merchant`)
    await page.getByRole('button', { name: 'Parse and save' }).click()
    await page.waitForFunction(() => typeof window.__releaseHearthQuickCreate === 'function')
    await expect(page.getByLabel('Merchant name', { exact: true })).toHaveValue('Original merchant')
    await expect(page.getByLabel('Account for Original merchant', { exact: true }))
      .toHaveValue(originalAccount.id)

    await page.getByLabel('Merchant name', { exact: true }).fill('Latest merchant')
    await page.getByLabel('Merchant name', { exact: true }).blur()
    await page.getByLabel('Account for Latest merchant', { exact: true })
      .selectOption(correctedAccount.id)
    await page.getByLabel('Category for Latest merchant', { exact: true }).selectOption(deepCategoryId)
    await expect(page.getByLabel('Merchant name', { exact: true })).toHaveValue('Latest merchant')
    await expect(page.getByLabel('Account for Latest merchant', { exact: true }))
      .toHaveValue(correctedAccount.id)
    expect((await exportBackup(page)).transactions).toEqual(before.transactions)

    await page.evaluate(() => window.__releaseHearthQuickCreate?.())
    await expect.poll(async () => {
      const saved = (await exportBackup(page)).transactions.filter(
        (transaction) => !before.transactions.some((previous) => previous.id === transaction.id),
      )
      return saved.map((transaction) => ({
        merchant: transaction.merchant,
        account_id: transaction.account_id,
        category_id: transaction.category_id,
        amount: transaction.amount,
        currency: transaction.currency,
        type: transaction.type,
        home_amount: transaction.home_amount,
        home_currency: transaction.home_currency,
        exchange_rate: transaction.exchange_rate,
      }))
    }).toEqual([{
      merchant: 'Latest merchant',
      account_id: correctedAccount.id,
      category_id: deepCategoryId,
      amount: -12.34,
      currency,
      type: 'expense',
      home_amount: currency === 'EUR' ? -15.43 : null,
      home_currency: currency === 'EUR' ? 'USD' : null,
      exchange_rate: currency === 'EUR' ? 1.25 : null,
    }])
    await expect(page.getByText('Saved', { exact: true })).toBeVisible()
  })
}
