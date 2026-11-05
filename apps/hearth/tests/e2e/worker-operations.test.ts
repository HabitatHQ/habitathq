import { expect, test } from '@playwright/test'
import type { WorkerRequestBody } from '../../app/types/database'
import { databaseRequest, exportBackup, installDatabaseProbe } from './helpers/database'

test('worker writes and edits persist exact amounts across navigation and reload', async ({ page }) => {
  await installDatabaseProbe(page)
  await page.goto('/transactions/add')
  await page.getByLabel('Amount', { exact: true }).fill('11.25')
  await page.getByLabel('Merchant', { exact: true }).fill('Worker persisted expense')
  await page.getByRole('button', { name: 'Save transaction' }).click()
  await expect(page).not.toHaveURL(/\/transactions\/add$/)
  await page.goto('/transactions')
  const row = page.getByTestId('transaction-row').filter({ hasText: 'Worker persisted expense' })
  await expect(row).toContainText('-$11.25')
  await row.click()
  await expect(page.getByLabel('Amount', { exact: true })).toHaveValue('11.25')
  await page.getByLabel('Amount', { exact: true }).fill('13.37')
  await page.getByRole('button', { name: 'Save transaction' }).click()
  await expect(page).toHaveURL('/transactions')
  await page.reload()
  await expect(row).toContainText('-$13.37')
  const backup = await exportBackup(page)
  expect(backup.transactions).toEqual([expect.objectContaining({ merchant: 'Worker persisted expense', amount: -13.37 })])
  expect(await databaseRequest(page, { type: 'GET_ACCOUNTS' })).toEqual([
    expect.objectContaining({ balance: -13.37, currency: 'USD' }),
  ])
})

test('a rejected split leaves no expense and does not poison later database operations', async ({ page }) => {
  await installDatabaseProbe(page)
  await page.goto('/')
  const backup = await exportBackup(page)
  const user = backup.users[0]
  const account = backup.accounts[0]
  if (!user || !account) throw new Error('Missing initialized finance identity')
  await expect(databaseRequest(page, {
    type: 'CREATE_TRANSACTION',
    payload: {
      date: '2026-01-15', amount: -50, currency: 'USD', account_id: account.id, user_id: user.id,
      type: 'expense', category_id: null, description: '', merchant: 'Rejected worker split',
      is_private: 0, is_recurring: 0, transfer_to_account_id: null, split_id: null, source: 'manual',
      home_amount: null, home_currency: null, exchange_rate: null,
      iou_split: { to_user_id: 'missing-partner', amount: 25 },
    },
  })).rejects.toThrow()
  expect((await exportBackup(page)).transactions).toEqual([])
  await page.goto('/transactions/add')
  await page.getByLabel('Amount', { exact: true }).fill('50')
  await page.getByLabel('Merchant', { exact: true }).fill('Recovered worker expense')
  await page.getByRole('button', { name: 'Save transaction' }).click()
  await expect(page).not.toHaveURL(/\/transactions\/add$/)
  expect((await exportBackup(page)).transactions).toEqual([
    expect.objectContaining({ merchant: 'Recovered worker expense', amount: -50 }),
  ])
})

test('concurrent snapshot export cannot observe half of an expense and IOU commit', async ({ page }) => {
  await installDatabaseProbe(page)
  await page.goto('/')
  const backup = await exportBackup(page)
  const user = backup.users[0]
  const account = backup.accounts[0]
  if (!user || !account) throw new Error('Missing initialized finance identity')
  backup.users.push({ ...user, id: 'snapshot-partner', name: 'Snapshot partner', role: 'partner', is_current: 0 })
  await databaseRequest(page, { type: 'IMPORT_JSON', payload: backup })
  const request: WorkerRequestBody = {
    type: 'CREATE_TRANSACTION',
    payload: {
      date: '2026-01-15', amount: -40, currency: 'USD', account_id: account.id, user_id: user.id,
      type: 'expense', category_id: null, description: '', merchant: 'Atomic worker expense',
      is_private: 0, is_recurring: 0, transfer_to_account_id: null, split_id: null, source: 'manual',
      home_amount: null, home_currency: null, exchange_rate: null,
      iou_split: { to_user_id: 'snapshot-partner', amount: 20 },
    },
  }
  const [, snapshot] = await Promise.all([databaseRequest(page, request), exportBackup(page)])
  for (const transaction of snapshot.transactions) {
    expect(snapshot.iou_splits.find((split) => split.transaction_id === transaction.id)).toMatchObject({ amount: 20 })
  }
  const complete = await exportBackup(page)
  expect(complete.transactions).toEqual([expect.objectContaining({ merchant: 'Atomic worker expense', amount: -40 })])
  expect(complete.iou_splits).toEqual([expect.objectContaining({ transaction_id: complete.transactions[0]?.id, amount: 20 })])
})

test('reset cancellation preserves persisted data and confirmed reset removes it', async ({ page }) => {
  await installDatabaseProbe(page)
  await page.goto('/transactions/add')
  await page.getByLabel('Amount', { exact: true }).fill('9.99')
  await page.getByLabel('Merchant', { exact: true }).fill('Reset marker')
  await page.getByRole('button', { name: 'Save transaction' }).click()
  await expect(page).not.toHaveURL(/\/transactions\/add$/)
  await page.goto('/settings')
  await page.getByRole('button', { name: /Here be dragons/i }).click()
  await page.getByRole('button', { name: /Reset database/ }).click()
  const dialog = page.getByRole('alertdialog', { name: 'Reset all data?', exact: true })
  await dialog.getByRole('button', { name: 'Keep my data', exact: true }).click()
  await expect(dialog).toBeHidden()
  expect((await exportBackup(page)).transactions).toEqual([expect.objectContaining({ merchant: 'Reset marker', amount: -9.99 })])
  await page.getByRole('button', { name: /Reset database/ }).click()
  const confirmReset = dialog.getByRole('button', { name: 'Reset Everything', exact: true })
  await Promise.all([
    page.waitForEvent('load'),
    confirmReset.click(),
  ])
  await expect(page.getByRole('button', { name: /Here be dragons/i })).toBeVisible()
  await expect.poll(async () => (await exportBackup(page)).transactions).toEqual([])
  await page.reload()
  expect((await exportBackup(page)).transactions).toEqual([])
})

test('a chore load failure is not presented as an empty household and can recover', async ({ page }) => {
  await installDatabaseProbe(page)
  await page.addInitScript(() => {
    const NativeWorker = window.Worker
    let failChoreRead = true
    window.Worker = class extends NativeWorker {
      postMessage(message: unknown, options?: StructuredSerializeOptions | Transferable[]) {
        let request = message
        if (
          failChoreRead && typeof message === 'object' && message !== null &&
          'type' in message && message.type === 'GET_CHORES_WITH_STATUS'
        ) {
          failChoreRead = false
          request = { ...message, type: 'INJECTED_CHORE_READ_FAILURE' }
        }
        if (Array.isArray(options)) super.postMessage(request, options)
        else super.postMessage(request, options)
      }
    }
  })
  await page.goto('/chores')
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Add your first chore' })).toBeHidden()
  const navigation = page.getByRole('navigation', { name: 'Main navigation' })
  await navigation.getByRole('link', { name: 'Dashboard', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Monthly spending summary' })).toBeVisible()
  await navigation.getByRole('link', { name: 'Chores', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Add your first chore' })).toBeVisible()
  await expect(page.getByRole('alert')).toBeHidden()
})
