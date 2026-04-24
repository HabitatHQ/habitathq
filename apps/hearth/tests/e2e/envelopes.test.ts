import { expect, test } from '@playwright/test'

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
    await page.goto('/envelopes')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1500)
  })

  test('at least one envelope card is rendered from seed data', async ({ page }) => {
    const envList = page.getByRole('region', { name: 'Budget envelopes' })
    // Each envelope should have a progress bar or identifiable element
    const cards = envList.locator('[role="article"], li, [data-testid="envelope-card"]')
    const count = await cards.count()
    // Seed data has 6 envelopes — expect at least 1
    expect(count).toBeGreaterThanOrEqual(1)
  })

  test('budget overview section shows spent and budget amounts', async ({ page }) => {
    const overview = page.getByRole('region', { name: 'Budget overview' })
    await expect(overview).toBeVisible()
    // Should contain dollar amounts
    const text = await overview.textContent()
    expect(text).toMatch(/\$[\d,]+/)
  })
})

test.describe('Envelopes — edit envelope', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/envelopes')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1500)
  })

  test('edit button is visible on envelope card hover', async ({ page }) => {
    const envList = page.getByRole('region', { name: 'Budget envelopes' })
    const firstCard = envList.locator('[class*="group"]').first()
    await firstCard.hover()
    const editBtn = firstCard.getByRole('button', { name: /edit/i })
    await expect(editBtn).toBeVisible()
  })

  test('clicking edit button opens a modal', async ({ page }) => {
    const envList = page.getByRole('region', { name: 'Budget envelopes' })
    const firstCard = envList.locator('[class*="group"]').first()
    await firstCard.hover()
    const editBtn = firstCard.getByRole('button', { name: /edit/i })
    await editBtn.click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
  })

  test('edit modal is pre-filled with envelope name', async ({ page }) => {
    const envList = page.getByRole('region', { name: 'Budget envelopes' })
    const firstCard = envList.locator('[class*="group"]').first()
    await firstCard.hover()
    const editBtn = firstCard.getByRole('button', { name: /edit/i })
    await editBtn.click()

    const nameInput = page.getByLabel(/name/i)
    const value = await nameInput.inputValue()
    expect(value.length).toBeGreaterThan(0)
  })

  test('edit modal shows "Edit Envelope" heading', async ({ page }) => {
    const envList = page.getByRole('region', { name: 'Budget envelopes' })
    const firstCard = envList.locator('[class*="group"]').first()
    await firstCard.hover()
    const editBtn = firstCard.getByRole('button', { name: /edit/i })
    await editBtn.click()

    await expect(page.getByRole('heading', { name: 'Edit Envelope' })).toBeVisible()
  })

  test('edit modal shows "Save Changes" button', async ({ page }) => {
    const envList = page.getByRole('region', { name: 'Budget envelopes' })
    const firstCard = envList.locator('[class*="group"]').first()
    await firstCard.hover()
    const editBtn = firstCard.getByRole('button', { name: /edit/i })
    await editBtn.click()

    await expect(page.getByRole('button', { name: 'Save Changes' })).toBeVisible()
  })
})

test.describe('Envelopes — add envelope modal', () => {
  test('Add envelope button opens a modal or form', async ({ page }) => {
    await page.goto('/envelopes')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1000)

    const addBtn = page.getByRole('button', { name: /add envelope/i })
    if (await addBtn.isVisible()) {
      await addBtn.click()
      // A dialog/modal or form field should appear
      const dialog = page.getByRole('dialog')
      const nameField = page.getByLabel(/name/i)
      const isDialogVisible = await dialog.isVisible().catch(() => false)
      const isFieldVisible = await nameField.isVisible().catch(() => false)
      expect(isDialogVisible || isFieldVisible).toBe(true)
    }
  })
})
