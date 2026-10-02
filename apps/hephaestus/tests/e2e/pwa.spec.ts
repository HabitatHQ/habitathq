import { expect, test } from '@playwright/test'

// Exercise the generated service worker, not Nuxt's development shell.
test.use({ viewport: { width: 390, height: 844 } })

test('offline shell opens with local navigation and durable isolated storage', async ({
  page,
  context,
}) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible()
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
    if (navigator.serviceWorker.controller) return
    await new Promise<void>((resolve) => {
      navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true })
    })
  })
  await context.setOffline(true)
  await page.goto('/workout')
  await expect(page.getByRole('heading', { name: 'Workout', exact: true })).toBeVisible()
  await expect(page.getByText('Offline · workouts are saved on this device')).toBeVisible()
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true)
  await page.getByRole('button', { name: /start empty session/i }).click()
  await expect(page.getByText('Active Session', { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: /unfinished session/i })).toBeVisible()
  await page.getByRole('button', { name: 'Resume', exact: true }).click()
  await expect(page.getByText('Active Session', { exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Today', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await context.setOffline(false)
})

test('install manifest icons are usable and scope is local', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible()
  const manifest = await page.evaluate(async () => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]')
    if (!link) throw new Error('No install manifest')
    const response = await fetch(link.href)
    const data = await response.json()
    for (const icon of data.icons) {
      const image = new Image()
      image.src = icon.src
      await image.decode()
      if (image.naturalWidth < 192) throw new Error('Install icon is too small')
    }
    return { display: data.display, scope: data.scope, start: data.start_url }
  })
  expect(manifest).toEqual({ display: 'standalone', scope: '/', start: '/' })
})

test('a clean headerless static-host navigation installs isolation before opening storage', async ({
  page,
}) => {
  let firstDocument = true
  await page.route('**/*', async (route) => {
    if (!route.request().isNavigationRequest() || !firstDocument) {
      await route.continue()
      return
    }
    firstDocument = false
    const response = await route.fetch()
    const headers = response.headers()
    delete headers['cross-origin-opener-policy']
    delete headers['cross-origin-embedder-policy']
    await route.fulfill({ response, headers })
  })
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('initial-isolation')) {
      sessionStorage.setItem('initial-isolation', JSON.stringify(crossOriginIsolated))
    }
  })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible({
    timeout: 20_000,
  })
  expect(await page.evaluate(() => sessionStorage.getItem('initial-isolation'))).toBe('false')
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true)
  await page.getByRole('link', { name: 'Start Workout', exact: true }).click()
  await expect(page.getByRole('button', { name: /start empty session/i })).toBeVisible()
})
