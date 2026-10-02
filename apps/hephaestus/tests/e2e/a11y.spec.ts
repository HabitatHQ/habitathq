import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

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

test('profile switch state changes through an accessible control', async ({ page }) => {
  await page.goto('/profile')
  const control = page.getByRole('switch', { name: 'Show RPE field' })
  const initial = await control.getAttribute('aria-checked')
  expect(['true', 'false']).toContain(initial)
  if (initial !== 'true' && initial !== 'false') throw new Error('Missing accessible switch state')

  await control.click()
  await expect(control).toHaveAttribute('aria-checked', initial === 'true' ? 'false' : 'true')
  await control.click()
  await expect(control).toHaveAttribute('aria-checked', initial)
})
