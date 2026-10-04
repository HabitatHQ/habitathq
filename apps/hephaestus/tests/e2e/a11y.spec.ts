import AxeBuilder from '@axe-core/playwright'
import { expect, type Page, test } from '@playwright/test'
import { authorStrengthTemplate, selectLabeledOption } from './domain-helpers'

const routes = [
  '/',
  '/workout',
  '/exercises',
  '/history',
  '/history/nonexistent-id',
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

const themes = ['hephaestus', 'forge', 'daylight'] as const

test.describe('WCAG 2.1 AA', () => {
  for (const theme of themes) {
    test(`all primary routes have no axe violations in ${theme}`, async ({ page }) => {
      await page.addInitScript((selectedTheme) => {
        localStorage.setItem('hephaestus-app-settings', JSON.stringify({ theme: selectedTheme }))
      }, theme)

      for (const route of routes) {
        await page.goto(route)
        await expect(page.locator('h1').first()).toBeVisible()
        const { violations } = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
          .analyze()
        expect(
          violations.map(({ id, impact, nodes }) => ({
            id,
            impact,
            elements: nodes.map(({ html }) => html),
          })),
          `${theme} theme, ${route}`,
        ).toEqual([])
      }
    })
  }
})

for (const theme of themes) {
  test(`populated routine authoring and editing remain accessible with manual deferral in ${theme}`, async ({
    page,
  }) => {
    await page.addInitScript((selectedTheme) => {
      localStorage.setItem('hephaestus-app-settings', JSON.stringify({ theme: selectedTheme }))
    }, theme)
    const templateName = 'E2E Accessible Carry-forward Template'
    const routineName = 'E2E Accessible Manual Routine'
    await authorStrengthTemplate(page, {
      name: templateName,
      sets: [{ kind: 'exact', reps: 5, weightKg: 80 }],
    })

    await page.goto('/routines/new')
    await page.getByLabel('Routine name').fill(routineName)
    await page.getByLabel('Template').selectOption({ label: templateName })
    await expect(
      page.getByRole('heading', { name: new RegExp(`${templateName} · revision`) }),
    ).toBeVisible()
    await selectLabeledOption(page, 'Continuation policy', 'Carry forward')
    await expect(page.getByLabel('Deferral mode')).toBeVisible()
    await selectLabeledOption(page, 'Deferral mode', 'Manual deferral')

    const analyzePopulatedForm = async (formPage: Page) => {
      await formPage.getByRole('button', { name: /^Save(?: revision)?$/ }).hover()
      const { violations } = await new AxeBuilder({ page: formPage })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze()
      expect(violations, JSON.stringify(violations)).toEqual([])
      expect(
        await formPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      ).toBe(true)
    }

    await analyzePopulatedForm(page)
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page).toHaveURL('/routines')
    await page.getByRole('link', { name: routineName, exact: true }).click()
    await expect(page.getByRole('heading', { name: routineName, exact: true })).toBeVisible()
    await page.getByRole('link', { name: 'Edit configuration', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Edit routine configuration' })).toBeVisible()
    await expect(page.getByLabel('Continuation policy')).toHaveValue('carry_forward')
    await expect(page.getByLabel('Deferral mode')).toHaveValue('manual')
    await expect(page.getByRole('heading', { name: 'Barbell Squat' })).toBeVisible()
    await analyzePopulatedForm(page)
  })
}

test('skip link moves keyboard focus to the primary content', async ({ page }) => {
  await page.goto('/')
  const skipLink = page.getByRole('link', { name: 'Skip to training content' })
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible()
  await page.waitForFunction(() => window.crossOriginIsolated)

  await page.keyboard.press('Tab')
  await expect(skipLink).toBeFocused()
  await page.keyboard.press('Enter')

  await expect(page.getByRole('main')).toBeFocused()
  await expect(page.locator('#main-content')).toHaveAttribute('tabindex', '-1')
})

test('primary navigation exposes the current page', async ({ page }) => {
  await page.goto('/')

  const navigation = page.getByRole('navigation', { name: 'Primary navigation' })
  await expect(navigation.getByRole('link', { name: 'Today' })).toHaveAttribute(
    'aria-current',
    'page',
  )
})

test('profile switch supports keyboard state changes', async ({ page }) => {
  await page.goto('/profile')
  const control = page.getByRole('switch', { name: 'Show RPE field' })
  await expect(control).toBeVisible()
  const initial = await control.isChecked()

  await control.focus()
  await page.keyboard.press('Space')
  await expect(control).toBeChecked({ checked: !initial })
  await page.keyboard.press('Space')
  await expect(control).toBeChecked({ checked: initial })
})
