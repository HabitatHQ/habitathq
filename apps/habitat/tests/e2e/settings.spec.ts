import { test, expect } from './fixtures'

test.describe('Settings page', () => {
  test('loads without fatal errors', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(err.message))

    await page.goto('/settings')
    await page.waitForLoadState('networkidle')

    const fatal = errors.filter(
      (e) =>
        !e.includes('OPFS') &&
        !e.includes('SharedArrayBuffer') &&
        !e.includes('crossOriginIsolated'),
    )
    expect(fatal).toHaveLength(0)
  })

  test('sticky nav is fixed at the bottom by default', async ({ page }) => {
    // Fresh context = no localStorage = stickyNav defaults to true
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    const nav = page.locator('nav').first()
    await expect(nav).toHaveClass(/fixed/)
    await expect(nav).toHaveClass(/bottom-0/)
  })

  test('sticky bottom bar switch is ON by default', async ({ page }) => {
    await page.goto('/settings')
    await page.waitForLoadState('networkidle')

    const stickySwitch = page
      .getByText('Sticky bottom bar', { exact: true })
      .locator('xpath=../..')
      .getByRole('switch')

    await expect(stickySwitch).toHaveAttribute('aria-checked', 'true')
  })

  test('sticky nav setting persists after page reload', async ({ page }) => {
    await page.goto('/settings')
    await page.waitForLoadState('networkidle')

    const stickySwitch = page
      .getByText('Sticky bottom bar', { exact: true })
      .locator('xpath=../..')
      .getByRole('switch')

    // Default is ON — turn it off
    await expect(stickySwitch).toHaveAttribute('aria-checked', 'true')
    await stickySwitch.click()
    await expect(stickySwitch).toHaveAttribute('aria-checked', 'false')

    // Reload and check localStorage persisted the change
    await page.reload()
    await page.waitForLoadState('networkidle')

    const stickySwitchAfter = page
      .getByText('Sticky bottom bar', { exact: true })
      .locator('xpath=../..')
      .getByRole('switch')
    await expect(stickySwitchAfter).toHaveAttribute('aria-checked', 'false')
  })

  test('nav is no longer fixed after disabling sticky nav', async ({ page }) => {
    await page.goto('/settings')
    await page.waitForLoadState('networkidle')

    // Disable sticky nav
    const stickySwitch = page
      .getByText('Sticky bottom bar', { exact: true })
      .locator('xpath=../..')
      .getByRole('switch')
    await stickySwitch.click()
    await expect(stickySwitch).toHaveAttribute('aria-checked', 'false')

    // Navigate to home — nav should no longer be fixed
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    const nav = page.locator('nav').first()
    await expect(nav).not.toHaveClass(/fixed/)
  })

  test('diagnostics section is collapsed by default', async ({ page }) => {
    // Diagnostics lives on /settings/more (the "More" sub-page)
    await page.goto('/settings/more')
    await page.waitForLoadState('networkidle')

    await expect(page.getByText('Diagnostics')).toBeVisible()
    // Content only visible after expanding
    await expect(page.getByText('Notification log')).not.toBeVisible()
    await expect(page.getByText('Remote debugging (APK)')).not.toBeVisible()
  })

  test('diagnostics expands and shows notification log and OPFS files', async ({ page }) => {
    await page.goto('/settings/more')
    await page.waitForLoadState('networkidle')

    await page.getByRole('button', { name: /diagnostics/i }).click()

    await expect(page.getByText('Notification log')).toBeVisible()
    // OPFS files is always visible (not platform-gated)
    await expect(page.getByText('OPFS files')).toBeVisible()
  })

  test('OPFS files subsection is visible inside diagnostics', async ({ page }) => {
    await page.goto('/settings/more')
    await page.waitForLoadState('networkidle')

    await page.getByRole('button', { name: /diagnostics/i }).click()
    await page.waitForLoadState('networkidle')

    await expect(page.getByText('OPFS files')).toBeVisible()
  })

  test('notification log toggle is functional inside diagnostics', async ({ page }) => {
    await page.goto('/settings/more')
    await page.waitForLoadState('networkidle')

    await page.getByRole('button', { name: /diagnostics/i }).click()

    // The notification log toggle should be present and interactive
    const notifSwitch = page
      .getByText('Notification log', { exact: true })
      .locator('xpath=../..')
      .getByRole('switch')

    await expect(notifSwitch).toBeVisible()

    // Toggle it on (if not already on)
    const initialChecked = await notifSwitch.getAttribute('aria-checked')
    if (initialChecked !== 'true') {
      await notifSwitch.click()
    }
    await expect(notifSwitch).toHaveAttribute('aria-checked', 'true')
  })
})
