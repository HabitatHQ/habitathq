import { expect, type Locator, type Page, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const stored = JSON.parse(localStorage.getItem('hephaestus-app-settings') || '{}')
    localStorage.setItem(
      'hephaestus-app-settings',
      JSON.stringify({ ...stored, showSupersets: true }),
    )
  })
})

async function addTemplateExercise(page: Page, name: string) {
  await page.getByRole('button', { name: /add exercise/i }).click()
  const picker = page.getByRole('dialog', { name: /add exercise to template/i })
  await expect(
    picker.getByRole('button').filter({ has: page.getByText(name, { exact: true }) }),
  ).toBeVisible({
    timeout: 20_000,
  })
  await picker.getByRole('searchbox', { name: /search exercises/i }).fill(name)
  await picker
    .getByRole('button')
    .filter({ has: page.getByText(name, { exact: true }) })
    .click()
  await expect(picker).not.toBeVisible()
}

async function createGroupedTemplate(page: Page, name: string, type = 'superset') {
  await page.goto('/templates/new')
  await page.getByRole('textbox', { name: /^name$/i }).fill(name)
  await addTemplateExercise(page, 'Bench Press')
  await addTemplateExercise(page, 'Barbell Row')

  const benchPress = page
    .getByRole('region', { name: 'Exercises' })
    .getByRole('listitem')
    .filter({ hasText: 'Bench Press' })
  await benchPress.getByRole('button', { name: 'Options for Bench Press' }).click()
  await page.getByRole('menuitem', { name: /new group a/i }).click()
  const barbellRow = page
    .getByRole('region', { name: 'Exercises' })
    .getByRole('listitem')
    .filter({ hasText: 'Barbell Row' })
  await barbellRow.getByRole('button', { name: 'Options for Barbell Row' }).click()
  await page.getByRole('menuitem', { name: /^A Group A$/i }).click()

  if (type !== 'superset') await page.getByLabel('Type').selectOption(type)
  await page.getByRole('button', { name: /^save$/i }).click()
  await expect(page).toHaveURL(/\/templates\/[^/]+$/)
}

async function startGroupedTemplate(page: Page, name: string, groupType = 'Superset') {
  await page.goto('/workout')
  await page.getByLabel('Session type').selectOption('gym')
  await page.getByRole('button', { name: new RegExp(name) }).click()
  await expect(page.getByText('Active Session')).toBeVisible()
  const group = page.getByRole('region', { name: groupType })
  await expect(group).toBeVisible()
  return group
}

async function logGroupedSet(page: Page, group: Locator, exercise: string, weight: string) {
  await group.getByRole('button', { name: `Log set for ${exercise}` }).click()
  const dialog = page.getByRole('dialog', { name: /log set/i })
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('Weight', { exact: true }).fill(weight)
  await dialog.getByLabel('Reps', { exact: true }).fill('8')
  await dialog.getByRole('button', { name: /log set/i }).click()
  await expect(dialog).not.toBeVisible()
}

test.describe('template superset groups', () => {
  test('assigns exercises, changes group type, and starts a grouped workout', async ({ page }) => {
    await createGroupedTemplate(page, 'E2E Circuit', 'circuit')
    const group = await startGroupedTemplate(page, 'E2E Circuit', 'Circuit')
    await expect(group.getByText('Bench Press')).toBeVisible()
    await expect(group.getByText('Barbell Row')).toBeVisible()
    await expect(group.getByRole('button', { name: 'Log set for Bench Press' })).toBeVisible()
    await expect(group.getByRole('button', { name: 'Log set for Barbell Row' })).toBeVisible()
  })

  test('counts a round only after both grouped exercises have working sets', async ({ page }) => {
    await createGroupedTemplate(page, 'E2E Round')
    const group = await startGroupedTemplate(page, 'E2E Round')

    await logGroupedSet(page, group, 'Bench Press', '80')
    await expect(
      group.getByRole('list', { name: 'Completed sets for Bench Press' }).getByRole('listitem'),
    ).toHaveCount(1)
    await expect(group.getByText('1× done', { exact: true })).toHaveCount(0)

    await logGroupedSet(page, group, 'Barbell Row', '70')
    await expect(group.getByLabel('1 round completed')).toContainText('1× done')
    await expect(
      group.getByRole('list', { name: 'Completed sets for Bench Press' }).getByRole('listitem'),
    ).toContainText('80')
    await expect(
      group.getByRole('list', { name: 'Completed sets for Barbell Row' }).getByRole('listitem'),
    ).toContainText('70')
  })

  test('edits one grouped set and preserves both exercises across recovery', async ({ page }) => {
    await createGroupedTemplate(page, 'E2E Grouped Edit')
    const group = await startGroupedTemplate(page, 'E2E Grouped Edit')
    await logGroupedSet(page, group, 'Bench Press', '80')
    await logGroupedSet(page, group, 'Barbell Row', '70')

    await group.getByLabel('Edit set 1 for Bench Press').click()
    const dialog = page.getByRole('dialog', { name: /edit set/i })
    await dialog.getByLabel('Weight', { exact: true }).fill('82.5')
    await dialog.getByLabel('Reps', { exact: true }).fill('6')
    await dialog.getByRole('button', { name: /save changes/i }).click()

    const benchSets = group.getByRole('list', { name: 'Completed sets for Bench Press' })
    const rowSets = group.getByRole('list', { name: 'Completed sets for Barbell Row' })
    await expect(benchSets.getByRole('listitem')).toHaveCount(1)
    await expect(benchSets).toContainText('82.5')
    await expect(benchSets).toContainText('6')
    await expect(rowSets.getByRole('listitem')).toHaveCount(1)
    await expect(rowSets).toContainText('70')

    await page.reload()
    await page.getByRole('button', { name: /^resume$/i }).click()
    await expect(benchSets).toContainText('82.5')
    await expect(benchSets).toContainText('6')
    await expect(rowSets).toContainText('70')
    await expect(group.getByLabel('1 round completed')).toBeVisible()
  })
})
