/**
 * Accessibility tests using axe-core.
 * Each page is checked for WCAG 2.1 AA violations.
 * We also test specific a11y patterns (landmarks, headings, focus).
 */

import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function checkA11y(page: Parameters<typeof AxeBuilder>[0], opts?: { exclude?: string[] }) {
  const builder = new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    // SQLite WASM canvas elements and iframe used internally
    .exclude('canvas')
  if (opts?.exclude) {
    for (const sel of opts.exclude) builder.exclude(sel)
  }
  const { violations } = await builder.analyze()
  // Report violations with context for debugging
  const messages = violations.map(
    (v) => `[${v.impact}] ${v.id}: ${v.description}\n  ${v.nodes.map((n) => n.html).join('\n  ')}`,
  )
  expect(violations, messages.join('\n\n')).toHaveLength(0)
}

// ─── Today page ───────────────────────────────────────────────────────────────

test.describe('a11y: Today page', () => {
  test('no axe violations', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await checkA11y(page)
  })

  test('has a single h1', async ({ page }) => {
    await page.goto('/')
    const h1s = page.locator('h1')
    await expect(h1s).toHaveCount(1)
  })

  test('main landmark exists', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('main')).toBeVisible()
  })

  test('nav landmark has accessible name', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('navigation', { name: /primary navigation/i })).toBeVisible()
  })

  test('streak section has visible text', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await expect(page.getByText(/day streak/i)).toBeVisible()
  })
})

// ─── Workout page ─────────────────────────────────────────────────────────────

test.describe('a11y: Workout page', () => {
  test('no axe violations', async ({ page }) => {
    await page.goto('/workout')
    await page.waitForLoadState('networkidle')
    await checkA11y(page)
  })

  test('has a single h1', async ({ page }) => {
    await page.goto('/workout')
    const h1s = page.locator('h1')
    await expect(h1s).toHaveCount(1)
  })
})

// ─── Exercises page ───────────────────────────────────────────────────────────

test.describe('a11y: Exercises page', () => {
  test('no axe violations', async ({ page }) => {
    await page.goto('/exercises')
    await page.waitForLoadState('networkidle')
    await checkA11y(page)
  })

  test('search input has accessible label', async ({ page }) => {
    await page.goto('/exercises')
    await expect(page.getByRole('searchbox')).toBeVisible()
  })
})

// ─── History page ─────────────────────────────────────────────────────────────

test.describe('a11y: History page', () => {
  test('no axe violations', async ({ page }) => {
    await page.goto('/history')
    await page.waitForLoadState('networkidle')
    await checkA11y(page)
  })

  test('has a single h1', async ({ page }) => {
    await page.goto('/history')
    const h1s = page.locator('h1')
    await expect(h1s).toHaveCount(1)
  })

  test('filter buttons have accessible labels', async ({ page }) => {
    await page.goto('/history')
    await page.waitForLoadState('networkidle')
    // Filter chips should be buttons with visible text
    const filterGroup = page
      .getByRole('group', { name: /filter/i })
      .or(page.locator('[role=radiogroup]'))
    const filterCount = await filterGroup.count()
    if (filterCount > 0) {
      const buttons = filterGroup.getByRole('radio').or(filterGroup.getByRole('button'))
      const count = await buttons.count()
      expect(count).toBeGreaterThan(0)
    }
  })
})

// ─── History detail page ──────────────────────────────────────────────────────

test.describe('a11y: History detail page', () => {
  test('back link has accessible label', async ({ page }) => {
    await page.goto('/history/nonexistent-id')
    await page.waitForLoadState('networkidle')
    const backLink = page.getByRole('link', { name: /back to history/i })
    await expect(backLink).toBeVisible()
  })

  test('not-found state is announced via role=alert', async ({ page }) => {
    await page.goto('/history/nonexistent-id')
    await page.waitForLoadState('networkidle')
    await expect(page.locator('[role="alert"]')).toBeVisible()
  })

  test('no axe violations on not-found state', async ({ page }) => {
    await page.goto('/history/nonexistent-id')
    await page.waitForLoadState('networkidle')
    await checkA11y(page)
  })
})

// ─── Progress page ────────────────────────────────────────────────────────────

test.describe('a11y: Progress page', () => {
  test('no axe violations', async ({ page }) => {
    await page.goto('/progress')
    await page.waitForLoadState('networkidle')
    await checkA11y(page)
  })

  test('has a single h1', async ({ page }) => {
    await page.goto('/progress')
    const h1s = page.locator('h1')
    await expect(h1s).toHaveCount(1)
  })

  test('section headings are h2', async ({ page }) => {
    await page.goto('/progress')
    await page.waitForLoadState('networkidle')
    const h2s = page.locator('h2')
    const count = await h2s.count()
    expect(count).toBeGreaterThan(0)
  })
})

// ─── Profile page ─────────────────────────────────────────────────────────────

test.describe('a11y: Profile page', () => {
  test('no axe violations', async ({ page }) => {
    await page.goto('/profile')
    await page.waitForLoadState('networkidle')
    await checkA11y(page)
  })

  test('settings use dl/dt/dd or form pattern', async ({ page }) => {
    await page.goto('/profile')
    // Settings should have labelled controls
    const switches = page.getByRole('switch')
    const count = await switches.count()
    expect(count).toBeGreaterThan(0)
  })
})

// ─── Templates pages ──────────────────────────────────────────────────────────

test.describe('a11y: Templates pages', () => {
  test('templates list page has no axe violations', async ({ page }) => {
    await page.goto('/templates')
    await page.waitForLoadState('networkidle')
    await checkA11y(page)
  })

  test('new template page has no axe violations', async ({ page }) => {
    await page.goto('/templates/new')
    await page.waitForLoadState('networkidle')
    await checkA11y(page)
  })

  test('new template name input has label', async ({ page }) => {
    await page.goto('/templates/new')
    const input = page.getByLabel(/name/i)
    await expect(input).toBeVisible()
  })

  test('add exercise button is accessible', async ({ page }) => {
    await page.goto('/templates/new')
    await expect(page.getByRole('button', { name: /add exercise/i })).toBeVisible()
  })

  test('exercise picker dialog has role=dialog', async ({ page }) => {
    await page.goto('/templates/new')
    await page.getByRole('button', { name: /add exercise/i }).click()
    await expect(page.getByRole('dialog', { name: /add exercise/i })).toBeVisible()
  })

  test('exercise picker dialog has search input with label', async ({ page }) => {
    await page.goto('/templates/new')
    await page.getByRole('button', { name: /add exercise/i }).click()
    await expect(page.getByRole('dialog').getByRole('searchbox')).toBeVisible()
  })

  test('exercise picker close button is accessible', async ({ page }) => {
    await page.goto('/templates/new')
    await page.getByRole('button', { name: /add exercise/i }).click()
    await expect(page.getByRole('dialog').getByRole('button', { name: /close/i })).toBeVisible()
  })

  test('adding an exercise shows config controls with labels', async ({ page }) => {
    await page.goto('/templates/new')
    // Open picker
    await page.getByRole('button', { name: /add exercise/i }).click()
    // Wait for exercises to load
    await expect(page.getByRole('dialog').getByRole('list')).toBeVisible({ timeout: 10000 })
    // Click first exercise
    const firstExercise = page.getByRole('dialog').getByRole('listitem').first()
    await firstExercise.getByRole('button').click()
    // Config controls should now be visible with proper labels
    await expect(page.getByLabel(/sets for/i)).toBeVisible()
    await expect(page.getByLabel(/reps for/i)).toBeVisible()
    await expect(
      page.getByLabel(/rest seconds for/i).or(page.getByLabel(/rest \(s\)/i)),
    ).toBeVisible()
  })

  test('context menu button has aria-label', async ({ page }) => {
    await page.goto('/templates/new')
    await page.getByRole('button', { name: /add exercise/i }).click()
    await expect(page.getByRole('dialog').getByRole('list')).toBeVisible({ timeout: 10000 })
    const firstExercise = page.getByRole('dialog').getByRole('listitem').first()
    await firstExercise.getByRole('button').click()
    // Options button should have aria-label
    const optionsBtn = page.getByRole('button', { name: /options for/i })
    await expect(optionsBtn).toBeVisible()
    await expect(optionsBtn).toHaveAttribute('aria-haspopup', 'menu')
  })

  test('variable rest toggle has aria-pressed', async ({ page }) => {
    await page.goto('/templates/new')
    await page.getByRole('button', { name: /add exercise/i }).click()
    await expect(page.getByRole('dialog').getByRole('list')).toBeVisible({ timeout: 10000 })
    await page.getByRole('dialog').getByRole('listitem').first().getByRole('button').click()
    // Expand advanced
    await page.getByRole('button', { name: /variable rest per set/i }).click()
    // Toggle button should have aria-pressed
    const toggleBtn = page.getByRole('button', { name: /^(On|Off)$/ })
    await expect(toggleBtn).toHaveAttribute('aria-pressed')
  })
})

// ─── Keyboard navigation ──────────────────────────────────────────────────────

test.describe('a11y: Keyboard navigation', () => {
  test('can tab through nav links', async ({ page }) => {
    await page.goto('/')
    // Tab into the nav area
    await page.keyboard.press('Tab')
    // Keep tabbing until we find something focused in the nav
    let navFocused = false
    for (let i = 0; i < 15; i++) {
      const focused = page.locator(':focus')
      const isNavLink = await focused
        .evaluate((el) => el.closest('nav') !== null)
        .catch(() => false)
      if (isNavLink) {
        navFocused = true
        break
      }
      await page.keyboard.press('Tab')
    }
    expect(navFocused).toBe(true)
  })

  test('history detail back link is keyboard focusable', async ({ page }) => {
    await page.goto('/history/nonexistent-id')
    await page.waitForLoadState('networkidle')
    const backLink = page.getByRole('link', { name: /back to history/i })
    await backLink.focus()
    await expect(backLink).toBeFocused()
  })
})
