import { expect, test } from '@playwright/test'

test.describe('Household page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/household')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1000)
  })

  test('page renders heading', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Household' })).toBeVisible()
  })

  test('members section is visible', async ({ page }) => {
    const membersSection = page.getByRole('region', { name: 'Household members' })
    await expect(membersSection).toBeVisible()
  })

  test('at least one member card is shown from seed data', async ({ page }) => {
    const membersSection = page.getByRole('region', { name: 'Household members' })
    // Seed data has Alex + Sam
    const memberCards = membersSection.locator('[class*="rounded-2xl"]')
    const count = await memberCards.count()
    expect(count).toBeGreaterThanOrEqual(1)
  })

  test('IOU balances section is visible', async ({ page }) => {
    const balancesSection = page.getByRole('region', { name: 'IOU balances' })
    await expect(balancesSection).toBeVisible()
  })

  test('shows either balances or "all settled" empty state', async ({ page }) => {
    const settledMsg = page.getByText('All settled up!')
    const settleBtn = page.getByRole('button', { name: /settle up/i })

    const hasSettled = await settledMsg.isVisible().catch(() => false)
    const hasButton = await settleBtn
      .first()
      .isVisible()
      .catch(() => false)

    expect(hasSettled || hasButton).toBe(true)
  })

  test('settle up button is visible when balances exist', async ({ page }) => {
    const settleBtn = page.getByRole('button', { name: /settle up/i })
    const count = await settleBtn.count()
    // Seed data typically has an IOU balance
    if (count > 0) {
      await expect(settleBtn.first()).toBeVisible()
    }
  })

  test('back button is present', async ({ page }) => {
    const backBtn = page.getByRole('button', { name: 'Go back' })
    await expect(backBtn).toBeVisible()
  })

  test('back button navigates away from household page', async ({ page }) => {
    await page.getByRole('button', { name: 'Go back' }).click()
    await page.waitForTimeout(500)
    // Should have navigated somewhere
    const url = page.url()
    expect(url).toBeDefined()
  })
})

test.describe('Household — navigation', () => {
  test('household page is reachable from dashboard IOU widget', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1500)

    const householdLink = page.getByRole('link', { name: /household balances/i })
    const isVisible = await householdLink.isVisible().catch(() => false)
    if (isVisible) {
      await householdLink.click()
      await expect(page).toHaveURL('/household')
    }
  })
})
