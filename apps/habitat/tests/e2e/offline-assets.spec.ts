import { test, expect } from './fixtures'

test('serves a warmed deep route and static asset while offline', async ({ page, context }) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.reload()
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null)

  await page.goto('/habits')
  await expect(page.getByRole('heading', { name: 'Habits' })).toBeVisible()

  const onlineAsset = await page.evaluate(async () => {
    const scope = (await navigator.serviceWorker.ready).scope
    if (!navigator.serviceWorker.controller) throw new Error('Service worker did not control the page')

    const url = new URL('favicon.svg', scope).href
    const cacheNames = await caches.keys()
    const cached = await Promise.all(
      cacheNames.map(async (name) =>
        (await caches.open(name)).match(url, { ignoreSearch: true }),
      ),
    )
    const response = await fetch(url)

    return {
      cacheNames,
      cached: cached.some((entry) => entry !== undefined),
      ok: response.ok,
      status: response.status,
    }
  })

  expect(onlineAsset.cacheNames).not.toHaveLength(0)
  expect(onlineAsset.cached).toBe(true)
  expect(onlineAsset.ok).toBe(true)
  expect(onlineAsset.status).toBe(200)

  await context.setOffline(true)
  try {
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading', { name: 'Habits' })).toBeVisible()

    const offlineAsset = await page.evaluate(async () => {
      const scope = (await navigator.serviceWorker.ready).scope
      if (!navigator.serviceWorker.controller) {
        throw new Error('Service worker did not control the page')
      }

      const response = await fetch(new URL('favicon.svg', scope))
      return { ok: response.ok, status: response.status }
    })

    expect(offlineAsset.ok).toBe(true)
    expect(offlineAsset.status).toBe(200)
  } finally {
    await context.setOffline(false)
  }
})
