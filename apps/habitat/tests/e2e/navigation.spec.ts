import { test, expect } from './fixtures'

test.describe('Navigation smoke tests', () => {
  test('home page loads', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(err.message))

    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // Page should render without crashing
    await expect(page.locator('body')).toBeVisible()
    // Filter out known OPFS-related errors that are harmless in test env
    const fatal = errors.filter(
      (e) =>
        !e.includes('OPFS') &&
        !e.includes('SharedArrayBuffer') &&
        !e.includes('crossOriginIsolated'),
    )
    expect(fatal).toHaveLength(0)
  })

  test('/jots route renders jots heading', async ({ page }) => {
    await page.goto('/jots')
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('heading', { name: 'Jots' })).toBeVisible()
  })

  test('/habits route renders habits heading', async ({ page }) => {
    await page.goto('/habits')
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('heading', { name: 'Habits' })).toBeVisible()
  })

  test('/todos route renders todos heading', async ({ page }) => {
    await page.goto('/todos')
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('heading', { name: 'TODOs' })).toBeVisible()
  })

  test('/checkin route renders check-in heading', async ({ page }) => {
    await page.goto('/checkin')
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('heading', { name: 'Check-in' })).toBeVisible()
  })

  test('/matrix route renders month heading on desktop', async ({ page }) => {
    await page.goto('/matrix')
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('heading', { name: 'Habit Grid' })).toBeVisible()
  })

  test('/insights route renders insights heading', async ({ page }) => {
    await page.goto('/insights')
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('heading', { name: /insights/i })).toBeVisible()
  })

  test('/calendar route renders the day planner by default', async ({ page }) => {
    await page.goto('/calendar')
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('heading', { name: 'Calendar' })).toBeVisible()
    const view = page.getByRole('group', { name: 'Calendar view' })
    const calendarContent = page.locator('main > div > div')
    await expect(view.getByRole('button', { name: 'day', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect
      .poll(() => calendarContent.evaluate((el) => Math.round(el.getBoundingClientRect().width)))
      .toBe(768)
    await view.getByRole('button', { name: 'week', exact: true }).click()
    await expect(view.getByRole('button', { name: 'week', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect
      .poll(() => calendarContent.evaluate((el) => Math.round(el.getBoundingClientRect().width)))
      .toBe(1152)
    await view.getByRole('button', { name: 'month', exact: true }).click()
    await expect(view.getByRole('button', { name: 'month', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect
      .poll(() => calendarContent.evaluate((el) => Math.round(el.getBoundingClientRect().width)))
      .toBe(1152)
    await view.getByRole('button', { name: 'day', exact: true }).click()
    await expect(view.getByRole('button', { name: 'day', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect
      .poll(() => calendarContent.evaluate((el) => Math.round(el.getBoundingClientRect().width)))
      .toBe(768)
  })

  test('centers routine desktop content while preserving wide planner and matrix views', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 })

    await page.goto('/habits')
    await expect(page.getByRole('heading', { name: 'Habits' })).toBeVisible()
    const content = page.locator('main > div')
    await expect
      .poll(() => content.evaluate((el) => Math.round(el.getBoundingClientRect().width)))
      .toBe(768)

    await page.goto('/matrix')
    await expect(page.getByRole('heading', { name: 'Habit Grid' })).toBeVisible()
    await expect
      .poll(() => content.evaluate((el) => Math.round(el.getBoundingClientRect().width)))
      .toBe(1152)
  })

  test('groups desktop tabs and preserves the mobile bottom-navigation layout', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/habits')

    const navigation = page.locator('nav')
    await expect(navigation.getByRole('link', { name: 'Today' })).toBeVisible()
    await expect(navigation.getByRole('link', { name: 'Habits' })).toBeVisible()
    const desktopGaps = await navigation.locator('a').evaluateAll((links) =>
      links.slice(1).map((link, index) => {
        const previous = links[index]
        return previous
          ? Math.round(link.getBoundingClientRect().left - previous.getBoundingClientRect().right)
          : 0
      }),
    )
    expect(desktopGaps.every((gap) => gap <= 10)).toBe(true)
    await navigation.getByRole('link', { name: 'Today' }).focus()
    await page.keyboard.press('Tab')
    await expect(navigation.getByRole('link', { name: 'Habits' })).toBeFocused()

    await page.setViewportSize({ width: 390, height: 844 })
    await expect
      .poll(() =>
        page.locator('main > div').evaluate((el) => Math.round(el.getBoundingClientRect().width)),
      )
      .toBe(358)
    const mobile = await navigation.locator('a').evaluateAll((links) =>
      links.map((link) => {
        const rect = link.getBoundingClientRect()
        return { x: rect.x, y: rect.y, right: rect.right, width: rect.width, height: rect.height }
      }),
    )
    expect(mobile).toHaveLength(5)
    expect(
      mobile.every(
        ({ x, right, width, height }) => x >= 0 && right <= 390 && width >= 44 && height >= 44,
      ),
    ).toBe(true)
    expect(mobile.every(({ y }) => y === mobile[0]?.y)).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)
  })

  test('drag-reorders tabs with the grouped desktop navigation container', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/habits')

    const source = await page.locator('nav a[href="/habits"]').boundingBox()
    const target = await page.locator('nav a[href="/todos"]').boundingBox()
    if (!source || !target) throw new Error('Navigation tabs were not rendered')

    await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2)
    await page.mouse.down()
    await page.waitForTimeout(600)
    await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 4 })
    await page.mouse.up()

    await expect
      .poll(() =>
        page.evaluate(() => {
          const settings: unknown = JSON.parse(localStorage.getItem('habitat-app-settings') ?? '{}')
          if (typeof settings !== 'object' || settings === null || !('tabOrder' in settings))
            return false
          const savedOrder = settings['tabOrder']
          if (!Array.isArray(savedOrder)) return false
          const order = savedOrder.filter((item): item is string => typeof item === 'string')
          return order.indexOf('/habits') > order.indexOf('/todos')
        }),
      )
      .toBe(true)
  })

  test('/time route renders time heading', async ({ page }) => {
    await page.goto('/time')
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('heading', { name: 'Time' })).toBeVisible()
  })

  test('/archive route renders archive heading', async ({ page }) => {
    await page.goto('/archive')
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('heading', { name: /archive/i })).toBeVisible()
  })

  test('/settings route renders settings heading', async ({ page }) => {
    await page.goto('/settings')
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('heading', { name: /settings/i })).toBeVisible()
  })
})
