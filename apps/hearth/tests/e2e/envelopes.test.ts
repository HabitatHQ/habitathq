import { localCalendarDate } from '@habitathq/utils'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { databaseRequest, exportBackup, installDatabaseProbe } from './helpers/database'

async function createEnvelope(page: Page, name: string) {
  await page.goto('/envelopes')
  await page.waitForLoadState('networkidle')
  await page.getByRole('button', { name: 'Add envelope' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill(name)
  await dialog.getByRole('spinbutton', { name: 'Budget', exact: true }).fill('100')
  await dialog.getByRole('checkbox', { name: /Food › Groceries$/ }).check()
  await dialog.getByRole('button', { name: 'Create Envelope', exact: true }).click()
  await expect(page.getByRole('listitem').filter({ hasText: name })).toBeVisible()
}

test.describe('Envelopes — period navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/envelopes')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1000)
  })

  test('previous month button changes the period heading', async ({ page }) => {
    const heading = page.getByRole('heading', { level: 1 })
    const initialText = await heading.textContent()
    await page.getByRole('button', { name: 'Previous month' }).click()
    const newText = await heading.textContent()
    expect(newText).not.toBe(initialText)
  })

  test('next month button is disabled on current month', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Next month' })).toBeDisabled()
  })

  test('navigating back then forward returns to the same month', async ({ page }) => {
    const heading = page.getByRole('heading', { level: 1 })
    const initialText = await heading.textContent()

    await page.getByRole('button', { name: 'Previous month' }).click()
    await page.getByRole('button', { name: 'Next month' }).click()

    expect(await heading.textContent()).toBe(initialText)
  })
})

test.describe('Envelopes — envelope cards', () => {
  test.beforeEach(async ({ page }) => {
    await createEnvelope(page, 'Card fixture envelope')
  })

  test('a created envelope card is rendered', async ({ page }) => {
    const cards = page.getByRole('region', { name: 'Budget envelopes' }).getByRole('listitem')
    await expect(cards.filter({ hasText: 'Card fixture envelope' })).toHaveCount(1)
  })

  test('budget overview section shows spent and budget amounts', async ({ page }) => {
    const overview = page.getByRole('region', { name: 'Budget overview' })
    await expect(overview.getByText('$100.00', { exact: true })).toHaveCount(2)
    await expect(overview.getByText('$0.00 spent', { exact: true })).toBeVisible()
  })
})

test.describe('Envelopes — edit envelope', () => {
  test.beforeEach(async ({ page }) => {
    await createEnvelope(page, 'Edit fixture envelope')
  })

  test('editing preserves existing values and saves name and budget changes', async ({ page }) => {
    const envList = page.getByRole('region', { name: 'Budget envelopes' })
    const card = envList.getByRole('listitem').filter({ hasText: 'Edit fixture envelope' })
    await card.hover()
    await card.getByRole('button', { name: 'Edit Edit fixture envelope envelope', exact: true }).click()

    const dialog = page.getByRole('dialog')
    const nameInput = dialog.getByRole('textbox', { name: 'Name', exact: true })
    const budgetInput = dialog.getByRole('spinbutton', { name: 'Budget', exact: true })
    await expect(nameInput).toHaveValue('Edit fixture envelope')
    await expect(budgetInput).toHaveValue('100')
    await expect(dialog.getByRole('checkbox', { name: /Food › Groceries$/ })).toBeChecked()

    await nameInput.fill('Updated fixture envelope')
    await budgetInput.fill('150')
    await dialog.getByRole('button', { name: 'Save Changes', exact: true }).click()
    await expect(dialog).toBeHidden()
    await page.reload()

    const updatedCard = envList.getByRole('listitem').filter({ hasText: 'Updated fixture envelope' })
    await expect(updatedCard).toBeVisible()
    await expect(updatedCard.getByText('$150.00 left of $150.00', { exact: true })).toBeVisible()
    await updatedCard.getByRole('button', { name: 'Edit Updated fixture envelope envelope', exact: true }).click()
    await expect(nameInput).toHaveValue('Updated fixture envelope')
    await expect(budgetInput).toHaveValue('150')
    await expect(dialog.getByRole('checkbox', { name: /Food › Groceries$/ })).toBeChecked()
  })
})

test('envelope creation requires at least one usable spending category', async ({ page }) => {
  await page.goto('/envelopes')
  await page.waitForLoadState('networkidle')
  await page.getByRole('button', { name: 'Add envelope' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill('Unlinked envelope')
  await dialog.getByRole('spinbutton', { name: 'Budget', exact: true }).fill('100')
  await dialog.getByRole('button', { name: 'Create Envelope', exact: true }).click()
  await expect(dialog.getByRole('alert')).toHaveText(
    'Select at least one expense category so spending can draw from this envelope.',
  )
  await expect(
    page.getByRole('region', { name: 'Budget envelopes' }).getByText('Unlinked envelope', { exact: true }),
  ).toHaveCount(0)
})

test('envelope category links drive real expense spending and can be edited without losing links', async ({ page }) => {
  await installDatabaseProbe(page)
  await page.goto('/envelopes')
  await page.waitForLoadState('networkidle')
  const backup = await exportBackup(page)
  const account = backup.accounts[0]
  const user = backup.users.find((entry) => entry.is_current === 1) ?? backup.users[0]
  const grocery = backup.categories.find((entry) => entry.id === 'c1a')
  const dining = backup.categories.find((entry) => entry.id === 'c1b')
  const income = backup.categories.find((entry) => entry.id === 'c7')
  if (!account || !user || !grocery || !dining || !income) {
    throw new Error('Default expense fixture data is unavailable')
  }
  backup.categories.push(
    {
      id: 'deep-produce',
      parent_id: grocery.id,
      name: 'Produce',
      icon: '🥬',
      color: '#22c55e',
      sort_order: 100,
    },
    {
      id: 'deep-income',
      parent_id: income.id,
      name: 'Investments',
      icon: '📈',
      color: '#16a34a',
      sort_order: 100,
    },
    {
      id: 'deeper-income',
      parent_id: 'deep-income',
      name: 'Dividends',
      icon: '💸',
      color: '#10b981',
      sort_order: 100,
    },
  )
  await databaseRequest(page, { type: 'IMPORT_JSON', payload: backup })
  await page.reload()

  await page.getByRole('button', { name: 'Add envelope' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill('Linked spending fixture')
  await dialog.getByRole('spinbutton', { name: 'Budget', exact: true }).fill('200')
  await expect(dialog.getByRole('checkbox', { name: /Food › Groceries › Produce/ })).toBeVisible()
  await expect(dialog.getByRole('checkbox', { name: /Investments/ })).toHaveCount(0)
  await expect(dialog.getByRole('checkbox', { name: /Dividends/ })).toHaveCount(0)
  await dialog.getByRole('checkbox', { name: /Food › Groceries › Produce/ }).check()
  await dialog.getByRole('button', { name: 'Create Envelope', exact: true }).click()
  const card = page.getByRole('listitem').filter({ hasText: 'Linked spending fixture' })
  await expect(card).toBeVisible()
  await databaseRequest(page, {
    type: 'CREATE_TRANSACTION',
    payload: {
      date: localCalendarDate(),
      amount: -32,
      currency: 'USD',
      account_id: account.id,
      user_id: user.id,
      type: 'expense',
      category_id: 'deep-produce',
      description: 'Envelope linked spending',
      merchant: 'Envelope test grocery',
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
  await databaseRequest(page, {
    type: 'CREATE_TRANSACTION',
    payload: {
      date: localCalendarDate(),
      amount: -5,
      currency: 'EUR',
      account_id: account.id,
      user_id: user.id,
      type: 'expense',
      category_id: 'deep-produce',
      description: 'Unconverted foreign expense',
      merchant: 'Envelope test foreign',
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
  await page.reload()
  await expect(card.getByText('$32.00 spent')).toBeVisible()
  await expect(page.getByRole('status', { name: 'Currency conversion notice', exact: true })).toBeVisible()

  await card.getByRole('button', { name: 'Edit Linked spending fixture envelope' }).click()
  await expect(dialog.getByRole('checkbox', { name: /Food › Groceries › Produce/ })).toBeChecked()
  await dialog.getByRole('checkbox', { name: /Dining Out/ }).check()
  await dialog.getByRole('button', { name: 'Save Changes', exact: true }).click()
  await expect(dialog).toBeHidden()
  await page.reload()
  await expect(card.getByText('$32.00 spent')).toBeVisible()

  await databaseRequest(page, {
    type: 'CREATE_TRANSACTION',
    payload: {
      date: localCalendarDate(),
      amount: -18,
      currency: 'USD',
      account_id: account.id,
      user_id: user.id,
      type: 'expense',
      category_id: dining.id,
      description: 'Edited envelope link spending',
      merchant: 'Envelope test dining',
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
  await page.reload()
  await expect(card.getByText('$50.00 spent')).toBeVisible()
})
