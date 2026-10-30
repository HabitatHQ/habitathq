import { expect, test } from '@playwright/test'
import { authorStrengthTemplate } from './domain-helpers'

test('recovers the same paused interval after reload and saves its performed identity', async ({
  page,
}) => {
  await page.goto('/templates/intervals/new')
  await page.getByLabel('Name', { exact: true }).fill('Reload-safe intervals')
  await page.getByLabel('Rounds', { exact: true }).fill('2')
  await page.getByLabel('Work (s)', { exact: true }).fill('30')
  await page.getByLabel('Rest (s)', { exact: true }).fill('10')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.getByRole('link', { name: 'Start', exact: true }).click()
  await page.getByRole('button', { name: 'Start session', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: /^Work$/ })).toBeVisible()
  await page.getByRole('button', { name: 'Pause timer', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: /^Paused$/ })).toBeVisible()
  const remaining = await page.getByRole('timer').textContent()
  await page.reload()
  await expect(page.getByRole('status').filter({ hasText: /^Paused$/ })).toBeVisible()
  await expect(page.getByRole('timer')).toHaveText(remaining ?? '')
  await expect(page.getByRole('button', { name: 'Start session', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Resume timer', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: /^Work$/ })).toBeVisible()
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'Finish session', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: /Session saved/ })).toBeVisible()
  await page.goto('/history')
  await page.getByRole('link', { name: /Reload-safe intervals/ }).click()
  await expect(
    page.getByRole('heading', { name: 'Reload-safe intervals', exact: true }),
  ).toBeVisible()
})
test('shares one Palladium writer, refreshes stale views, and hands ownership over after tab close', async ({
  page,
}) => {
  const follower = await page.context().newPage()
  const writerLocks = async (tab: typeof page) =>
    tab.evaluate(
      async () =>
        (await navigator.locks.query()).held?.filter(
          (lock) => lock.name === 'palladium-leader:hephaestus',
        ).length ?? 0,
    )

  await page.goto('/templates')
  await follower.goto('/templates')
  await expect.poll(() => writerLocks(page)).toBe(1)
  await expect.poll(() => writerLocks(follower)).toBe(1)

  const firstName = `Owner tab ${Date.now()}`
  await authorStrengthTemplate(follower, { name: firstName })
  await follower.goto('/templates')
  await expect(page.getByRole('link', { name: new RegExp(firstName) })).toBeVisible()
  await follower.goto('/workout')
  await page.getByRole('link', { name: 'Workout', exact: true }).click()
  await page.getByRole('button', { name: 'Start Empty Session', exact: true }).click()
  await expect(follower.getByRole('heading', { name: /unfinished session/i })).toBeVisible()

  await page.close()
  await expect.poll(() => writerLocks(follower)).toBe(1)
  const secondName = `Handoff tab ${Date.now()}`
  await authorStrengthTemplate(follower, { name: secondName })
  await follower.goto('/workout')
  await follower.reload()
  await expect(follower.getByRole('heading', { name: /unfinished session/i })).toBeVisible()
  await follower.getByRole('button', { name: 'Resume', exact: true }).click()
  await expect(follower.getByText('Active Session', { exact: true })).toBeVisible()
  await follower.reload()
  await expect(follower.getByRole('heading', { name: /unfinished session/i })).toBeVisible()
  follower.once('dialog', (dialog) => dialog.accept())
  await follower.getByRole('button', { name: 'Discard', exact: true }).click()
  await expect(
    follower.getByRole('button', { name: 'Start Empty Session', exact: true }),
  ).toBeVisible()
})

test('records a default mobility hold without inventing repetitions', async ({ page }) => {
  await page.goto('/workout')
  await page.getByLabel('Session type', { exact: true }).selectOption('mobility')
  await page.getByRole('button', { name: 'Start Empty Session', exact: true }).click()
  await page.getByRole('button', { name: 'Add Exercise', exact: true }).click()
  const picker = page.getByRole('dialog', { name: 'Add exercise', exact: true })
  await picker.getByRole('searchbox', { name: 'Search exercises', exact: true }).fill('plank')
  await picker.getByRole('button', { name: /^Plank bodyweight · isolation$/i }).click()
  const activity = page.getByRole('region', { name: 'Plank', exact: true })
  await expect(activity.getByLabel('Reps for set 1 for Plank', { exact: true })).toHaveCount(0)
  await activity.getByLabel('Duration (sec) for set 1 for Plank', { exact: true }).fill('45')
  await activity.getByRole('button', { name: 'Complete set 1 for Plank', exact: true }).click()
  await page.getByRole('button', { name: 'Finish', exact: true }).click()
  await page.getByRole('button', { name: 'Save Workout', exact: true }).click()
  await page.goto('/history')
  await page.getByRole('link', { name: /Mobility session/ }).click()
  await expect(page.getByRole('table', { name: /sets for plank/i })).toContainText('45')
})
