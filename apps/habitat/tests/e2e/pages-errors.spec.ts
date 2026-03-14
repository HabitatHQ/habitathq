/**
 * Comprehensive page-load error tests for every route in the app.
 * Each test verifies: no fatal JS errors, key heading/element visible,
 * no blank white-screen (at least one meaningful element present).
 *
 * OPFS / SharedArrayBuffer / crossOriginIsolated errors are filtered
 * as they are expected in the test environment (no COOP/COEP headers).
 */
import { test, expect, type Page } from '@playwright/test'

const MOBILE = { width: 390, height: 844 }

function ignoredError(msg: string) {
  return (
    msg.includes('OPFS') ||
    msg.includes('SharedArrayBuffer') ||
    msg.includes('crossOriginIsolated') ||
    msg.includes('sqlite') ||
    msg.includes('wasm')
  )
}

async function loadPage(page: Page, url: string) {
  const errors: string[] = []
  page.on('pageerror', (err) => {
    if (!ignoredError(err.message)) errors.push(err.message)
  })
  await page.goto(url)
  await page.waitForLoadState('networkidle')
  return errors
}

// ─── Top-level routes ────────────────────────────────────────────────────────

test.describe('Page load — no fatal JS errors', () => {
  const routes = [
    '/',
    '/week',
    '/habits',
    '/health',
    '/todos',
    '/bored',
    '/bored/activities',
    '/checkin',
    '/jots',
    '/stats',
    '/archive',
    '/matrix',
    '/settings',
    '/settings/display',
    '/settings/features',
    '/settings/notifications',
    '/settings/permissions',
    '/settings/data',
    '/settings/more',
  ]

  for (const route of routes) {
    test(`${route} renders without fatal errors`, async ({ page }) => {
      const errors = await loadPage(page, route)
      expect(errors, `Fatal JS errors on ${route}:\n${errors.join('\n')}`).toHaveLength(0)
    })
  }
})

// ─── Key UI elements ──────────────────────────────────────────────────────────

test.describe('Page load — key elements visible', () => {
  test('/ (today) — shows Habitat header', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    // Header logo text
    await expect(page.locator('header').getByText('Habitat')).toBeVisible()
  })

  test('/habits — heading visible', async ({ page }) => {
    await page.goto('/habits')
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('heading', { name: 'Habits' })).toBeVisible()
  })

  test('/todos — heading visible', async ({ page }) => {
    await page.goto('/todos')
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('heading', { name: 'TODOs' })).toBeVisible()
  })

  test('/checkin — heading visible', async ({ page }) => {
    await page.goto('/checkin')
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('heading', { name: 'Check-in' })).toBeVisible()
  })

  test('/jots — heading visible', async ({ page }) => {
    await page.goto('/jots')
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('heading', { name: 'Jots' })).toBeVisible()
  })

  test('/stats — heading visible', async ({ page }) => {
    await page.goto('/stats')
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('heading', { name: /analytics/i })).toBeVisible()
  })

  test('/archive — heading visible', async ({ page }) => {
    await page.goto('/archive')
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('heading', { name: /archive/i })).toBeVisible()
  })

  test('/health — heading visible', async ({ page }) => {
    await page.goto('/health')
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('heading', { name: /health/i })).toBeVisible()
  })

  test('/bored — heading or oracle visible', async ({ page }) => {
    await page.goto('/bored')
    await page.waitForLoadState('networkidle')
    // Bored page shows oracle / activity picker
    const heading = await page.locator('h1, h2').first().isVisible().catch(() => false)
    expect(heading, '/bored should render a heading').toBe(true)
  })

  test('/matrix desktop — "Month" heading', async ({ page }) => {
    await page.goto('/matrix')
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('heading', { name: 'Month' })).toBeVisible()
  })

  test('/matrix mobile — "Week" heading', async ({ page }) => {
    await page.setViewportSize(MOBILE)
    await page.goto('/matrix')
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('heading', { name: 'Week' })).toBeVisible()
  })

  test('/settings — shows navigation list', async ({ page }) => {
    await page.setViewportSize(MOBILE)
    await page.goto('/settings')
    await page.waitForLoadState('networkidle')
    // Settings index shows nav cards on mobile
    await expect(page.getByRole('link', { name: /display/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /data/i })).toBeVisible()
  })
})

// ─── Empty states ─────────────────────────────────────────────────────────────

test.describe('Empty states — no blank screens', () => {
  const pagesWithEmptyStates: Array<{ url: string; emptyText: RegExp | string }> = [
    { url: '/habits', emptyText: /no habits|add your first|get started/i },
    { url: '/todos', emptyText: /no todos|nothing|add/i },
    { url: '/checkin', emptyText: /no check-in|template|create/i },
    { url: '/jots', emptyText: /no jots|nothing|add/i },
    { url: '/archive', emptyText: /no archived|nothing/i },
  ]

  for (const { url, emptyText } of pagesWithEmptyStates) {
    test(`${url} shows content or empty state (no blank screen)`, async ({ page }) => {
      await page.goto(url)
      await page.waitForLoadState('networkidle')
      await page.waitForTimeout(1200) // allow DB init

      // Either data exists OR an empty-state element is visible
      const hasHeading = await page.locator('h1, h2, h3').filter({ hasText: /.+/ }).first().isVisible().catch(() => false)
      const hasEmpty = await page.getByText(emptyText).first().isVisible().catch(() => false)
      const hasButton = await page.getByRole('button').first().isVisible().catch(() => false)
      const hasLink = await page.getByRole('link').first().isVisible().catch(() => false)

      expect(
        hasHeading || hasEmpty || hasButton || hasLink,
        `${url} renders a blank screen — no heading, empty state, button, or link found`,
      ).toBe(true)
    })
  }
})

// ─── Bottom nav ───────────────────────────────────────────────────────────────

test.describe('Bottom navigation', () => {
  test('bottom nav is present on all main pages', async ({ page }) => {
    await page.setViewportSize(MOBILE)
    for (const route of ['/', '/habits', '/checkin', '/jots']) {
      await page.goto(route)
      await page.waitForLoadState('networkidle')
      const nav = page.locator('nav').first()
      await expect(nav, `Bottom nav not found on ${route}`).toBeVisible()
    }
  })

  test('clicking a nav item navigates to correct page', async ({ page }) => {
    await page.setViewportSize(MOBILE)
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // Click habits nav link
    await page.getByRole('link', { name: 'Habits' }).first().click()
    await expect(page).toHaveURL(/\/habits/)
  })
})

// ─── Header ───────────────────────────────────────────────────────────────────

test.describe('Header buttons', () => {
  test('dark/light mode toggle is present', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('button', { name: /switch to (dark|light) mode/i })).toBeVisible()
  })

  test('theme picker button is present', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('button', { name: /change theme/i })).toBeVisible()
  })

  test('search button is present', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('button', { name: /search/i })).toBeVisible()
  })
})
