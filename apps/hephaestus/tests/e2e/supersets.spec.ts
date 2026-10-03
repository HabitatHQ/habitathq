import { expect, type Locator, type Page, test } from '@playwright/test'
import { authorGroupedTemplate } from './domain-helpers'

async function startGrouped(page: Page, name: string, type: 'Circuit' | 'Superset' = 'Superset') {
  await page.goto('/workout')
  await page.getByRole('button', { name: new RegExp(name) }).click()
  await expect(page.getByRole('heading', { name: 'Start once' })).toBeVisible()
  await page.getByRole('button', { name: 'Start workout', exact: true }).click()
  const group = page.getByRole('region', { name: type })
  await expect(group).toBeVisible()
  return group
}

async function populateDraft(group: Locator, exerciseName: string, weight: string) {
  const sets = group.getByRole('list', { name: `Sets for ${exerciseName}` })
  const set = sets.getByRole('listitem').filter({ hasText: 'Draft—not performed' }).first()
  const weightInput = set.getByLabel(`Weight (kg) for set 1 for ${exerciseName}`)
  const repsInput = set.getByLabel(`Reps for set 1 for ${exerciseName}`)
  const saveReady = set.getByText('Valid entries save automatically. Completion is separate.', {
    exact: true,
  })
  await weightInput.fill(weight)
  await expect(saveReady).toBeVisible()
  await repsInput.fill('8')
  await expect(saveReady).toBeVisible()
  await expect(weightInput).toHaveValue(weight)
  await expect(repsInput).toHaveValue('8')
}

async function complete(group: Locator, exerciseName: string, weight: string) {
  await populateDraft(group, exerciseName, weight)
  const sets = group.getByRole('list', { name: `Sets for ${exerciseName}` })
  await sets
    .getByRole('listitem')
    .filter({ hasText: 'Draft—not performed' })
    .first()
    .getByRole('button', { name: new RegExp(`Complete set 1 for ${exerciseName}`) })
    .click()
}

test.describe('ordered execution groups', () => {
  test('authors a circuit and only advances its round after both activities are completed', async ({
    page,
  }) => {
    await authorGroupedTemplate(page, { name: 'E2E Circuit', groupType: 'circuit' })
    const group = await startGrouped(page, 'E2E Circuit', 'Circuit')
    await expect(group.getByText('Bench Press', { exact: true })).toBeVisible()
    await expect(group.getByText('Barbell Row', { exact: true })).toBeVisible()
    await complete(group, 'Bench Press', '80')
    await expect(group.getByText('1× done', { exact: true })).toHaveCount(0)
    await complete(group, 'Barbell Row', '70')
    await expect(group.getByLabel('1 round completed')).toContainText('1× done')
    await expect(group.getByRole('list', { name: 'Sets for Bench Press' })).toContainText('80')
    await expect(group.getByRole('list', { name: 'Sets for Barbell Row' })).toContainText('70')
  })

  test('retains both grouped activity drafts through reload and explicit resume', async ({
    page,
  }) => {
    await authorGroupedTemplate(page, { name: 'E2E Grouped Recovery', groupType: 'superset' })
    const group = await startGrouped(page, 'E2E Grouped Recovery')
    await populateDraft(group, 'Bench Press', '82.5')
    await populateDraft(group, 'Barbell Row', '72.5')
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Unfinished session' })).toBeVisible()
    await page.getByRole('button', { name: 'Resume', exact: true }).click()
    const resumed = page.getByRole('region', { name: 'Superset' })
    const benchDraft = resumed
      .getByRole('list', { name: 'Sets for Bench Press' })
      .getByRole('listitem')
      .filter({ hasText: 'Draft—not performed' })
      .first()
    const rowDraft = resumed
      .getByRole('list', { name: 'Sets for Barbell Row' })
      .getByRole('listitem')
      .filter({ hasText: 'Draft—not performed' })
      .first()
    await expect(benchDraft.getByLabel('Weight (kg) for set 1 for Bench Press')).toHaveValue('82.5')
    await expect(rowDraft.getByLabel('Weight (kg) for set 1 for Barbell Row')).toHaveValue('72.5')
    await expect(benchDraft.getByLabel('Reps for set 1 for Bench Press')).toHaveValue('8')
    await expect(rowDraft.getByLabel('Reps for set 1 for Barbell Row')).toHaveValue('8')
    await expect(resumed.getByText('1× done', { exact: true })).toHaveCount(0)
  })
})
