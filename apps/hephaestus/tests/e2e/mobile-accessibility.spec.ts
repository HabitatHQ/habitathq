import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

test.use({ viewport: { width: 390, height: 844 } })

const mobileRoutes = [
  '/',
  '/workout',
  '/exercises',
  '/history',
  '/progress',
  '/profile',
  '/templates',
  '/templates/new',
  '/templates/programs',
  '/templates/intervals',
  '/routines',
  '/routines/new',
  '/plans',
]

for (const route of mobileRoutes) {
  test(`mobile surface is accessible without horizontal overflow: ${route}`, async ({ page }) => {
    await page.goto(route)
    await expect(page.locator('h1').first()).toBeVisible()

    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze()
    expect(violations, JSON.stringify(violations)).toEqual([])
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)

    const navigation = page.getByRole('navigation', { name: 'Primary navigation' })
    await expect(navigation).toBeVisible()
    await expect(navigation.getByRole('link', { name: 'Today' })).toBeVisible()
    await expect(navigation.getByRole('link', { name: 'Workout' })).toBeVisible()
    await expect(navigation.getByRole('link', { name: 'Exercises' })).toBeVisible()
    await expect(navigation.getByRole('link', { name: 'History' })).toBeVisible()
    await expect(navigation.getByRole('link', { name: 'Profile' })).toBeVisible()
    const targetSizes = await navigation.getByRole('link').evaluateAll((links) =>
      links.map((link) => {
        const { width, height } = link.getBoundingClientRect()
        return { width, height }
      }),
    )
    expect(targetSizes.every(({ width, height }) => width >= 44 && height >= 44)).toBe(true)
  })
}

test('skip link moves focus to the primary content on mobile', async ({ page }) => {
  await page.goto('/')
  const skipLink = page.getByRole('link', { name: 'Skip to training content' })
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible()
  await page.waitForFunction(() => window.crossOriginIsolated)

  await page.keyboard.press('Tab')
  await expect(skipLink).toBeFocused()
  await page.keyboard.press('Enter')

  await expect(page.getByRole('main')).toBeFocused()
})

test('custom exercise dialog traps focus and restores its opener', async ({ page }) => {
  await page.goto('/exercises')
  const opener = page.getByRole('button', { name: 'New', exact: true })
  await opener.click()
  const dialog = page.getByRole('dialog', { name: 'Create custom exercise' })
  await expect(dialog).toBeVisible()
  await page.getByRole('textbox', { name: 'Exercise name' }).fill('Recovery stretch')
  await page.getByLabel('Logging fields').selectOption('cardio')

  await page.keyboard.press('Shift+Tab')
  expect(
    await page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null),
  ).toBe(true)
  await page.keyboard.press('Escape')

  await expect(dialog).toBeHidden()
  await expect(opener).toBeFocused()
})
