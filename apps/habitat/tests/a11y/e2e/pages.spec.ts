/**
 * Accessibility E2E tests — Playwright + axe-core full-page audits.
 * Fails only on critical violations (impact === 'critical').
 * Full axe output is logged on failure for easy diagnosis.
 *
 * Pages covered: all main routes + navigation + key modals.
 * Run with: pnpm test:a11y
 */

import AxeBuilder from '@axe-core/playwright'
import { test, expect } from '@playwright/test'
import type { Result } from 'axe-core'

// ── Helper: run axe and return only critical violations ───────────────────────

async function getAxeCritical(page: import('@playwright/test').Page): Promise<Result[]> {
  const results = await new AxeBuilder({ page })
    .options({ runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } })
    .analyze()
  return results.violations.filter((v) => v.impact === 'critical')
}

function logViolations(violations: Result[]) {
  if (violations.length === 0) return
  console.error(
    `\n[axe] ${violations.length} critical violation(s):\n`,
    JSON.stringify(
      violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        description: v.description,
        help: v.help,
        helpUrl: v.helpUrl,
        nodes: v.nodes.map((n) => ({
          html: n.html,
          failureSummary: n.failureSummary,
        })),
      })),
      null,
      2,
    ),
  )
}

// ── Shared setup: wait for app to load ───────────────────────────────────────

async function waitForApp(page: import('@playwright/test').Page) {
  // Wait for the Nuxt SPA to mount and the layout to render
  await page.waitForSelector('nav', { timeout: 10_000 })
  // Brief pause for any async data loading
  await page.waitForTimeout(500)
}

// ── Main pages ────────────────────────────────────────────────────────────────

test('home page (/) has no critical a11y violations', async ({ page }) => {
  await page.goto('/')
  await waitForApp(page)
  const violations = await getAxeCritical(page)
  logViolations(violations)
  expect(violations, `${violations.length} critical violation(s) on /`).toHaveLength(0)
})

test('habits page (/habits) has no critical a11y violations', async ({ page }) => {
  await page.goto('/habits')
  await waitForApp(page)
  const violations = await getAxeCritical(page)
  logViolations(violations)
  expect(violations, `${violations.length} critical violation(s) on /habits`).toHaveLength(0)
})

test('todos page (/todos) has no critical a11y violations', async ({ page }) => {
  await page.goto('/todos')
  await waitForApp(page)
  const violations = await getAxeCritical(page)
  logViolations(violations)
  expect(violations, `${violations.length} critical violation(s) on /todos`).toHaveLength(0)
})

test('check-in page (/checkin) has no critical a11y violations', async ({ page }) => {
  await page.goto('/checkin')
  await waitForApp(page)
  const violations = await getAxeCritical(page)
  logViolations(violations)
  expect(violations, `${violations.length} critical violation(s) on /checkin`).toHaveLength(0)
})

test('matrix page (/matrix) has no critical a11y violations', async ({ page }) => {
  await page.goto('/matrix')
  await waitForApp(page)
  const violations = await getAxeCritical(page)
  logViolations(violations)
  expect(violations, `${violations.length} critical violation(s) on /matrix`).toHaveLength(0)
})

test('jots page (/jots) has no critical a11y violations', async ({ page }) => {
  await page.goto('/jots')
  await waitForApp(page)
  const violations = await getAxeCritical(page)
  logViolations(violations)
  expect(violations, `${violations.length} critical violation(s) on /jots`).toHaveLength(0)
})

test('settings page (/settings) has no critical a11y violations', async ({ page }) => {
  await page.goto('/settings')
  await waitForApp(page)
  const violations = await getAxeCritical(page)
  logViolations(violations)
  expect(violations, `${violations.length} critical violation(s) on /settings`).toHaveLength(0)
})

// ── Navigation ────────────────────────────────────────────────────────────────

test('bottom navigation has no critical a11y violations', async ({ page }) => {
  await page.goto('/')
  await waitForApp(page)

  // Scope the scan to just the nav element
  const navViolations = await new AxeBuilder({ page })
    .options({ runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } })
    .include('nav')
    .analyze()

  const critical = navViolations.violations.filter((v) => v.impact === 'critical')
  logViolations(critical)
  expect(critical, `${critical.length} critical violation(s) in nav`).toHaveLength(0)
})

// ── Modals ────────────────────────────────────────────────────────────────────

test('add todo modal has no critical a11y violations', async ({ page }) => {
  await page.goto('/todos?modal=add')
  await waitForApp(page)
  // Wait for modal to appear
  await page.waitForSelector('[role="dialog"], .fixed', { timeout: 5_000 }).catch(() => {})
  const violations = await getAxeCritical(page)
  logViolations(violations)
  expect(violations, `${violations.length} critical violation(s) in add-todo modal`).toHaveLength(0)
})

test('add habit modal has no critical a11y violations', async ({ page }) => {
  await page.goto('/habits?modal=create')
  await waitForApp(page)
  await page.waitForSelector('[role="dialog"], .fixed', { timeout: 5_000 }).catch(() => {})
  const violations = await getAxeCritical(page)
  logViolations(violations)
  expect(violations, `${violations.length} critical violation(s) in add-habit modal`).toHaveLength(0)
})

test('check-in create modal has no critical a11y violations', async ({ page }) => {
  await page.goto('/checkin?modal=create')
  await waitForApp(page)
  await page.waitForSelector('[role="dialog"], .fixed', { timeout: 5_000 }).catch(() => {})
  const violations = await getAxeCritical(page)
  logViolations(violations)
  expect(violations, `${violations.length} critical violation(s) in checkin modal`).toHaveLength(0)
})
