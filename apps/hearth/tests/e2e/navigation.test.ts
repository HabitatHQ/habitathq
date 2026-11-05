import { expect, test } from '@playwright/test'

test('primary navigation supports forward navigation and browser history', async ({ page }) => {
  await page.goto('/')
  const navigation = page.getByRole('navigation', { name: 'Main navigation' })
  for (const [name, path] of [
    ['Transactions', '/transactions'],
    ['Envelopes', '/envelopes'],
    ['Reports', '/reports'],
    ['Chores', '/chores'],
  ]) {
    await navigation.getByRole('link', { name, exact: true }).click()
    await expect(page).toHaveURL(path)
  }
  await page.goBack()
  await expect(page).toHaveURL('/reports')
  await navigation.getByRole('link', { name: 'Dashboard', exact: true }).click()
  await expect(page).toHaveURL('/')
  await expect(page.getByRole('region', { name: 'Monthly spending summary' })).toBeVisible()
})

test('dashboard entry reaches detailed entry and saving returns to a persisted transaction', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Add transaction', exact: true }).first().click()
  await page.getByRole('link', { name: 'Detailed form', exact: true }).click()
  await page.getByLabel('Amount', { exact: true }).fill('12.75')
  await page.getByLabel('Merchant', { exact: true }).fill('Navigation expense')
  await page.getByRole('button', { name: 'Save transaction' }).click()
  await expect(page).not.toHaveURL(/\/transactions\/add$/)
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Transactions', exact: true }).click()
  const row = page.getByTestId('transaction-row').filter({ hasText: 'Navigation expense' })
  await expect(row).toContainText('-$12.75')
  await page.reload()
  await expect(row).toContainText('-$12.75')
})
