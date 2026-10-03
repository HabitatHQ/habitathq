import { expect, type Page, test } from '@playwright/test'
import {
  authorStrengthTemplate,
  configureRoutine,
  fillLabeledDate,
  localDate,
  selectLabeledOption,
  startRoutine,
} from './domain-helpers'

async function populateSet(page: Page, weight: string, reps: string) {
  const exercise = page.getByRole('region', { name: 'Barbell Squat' })
  const set = exercise.getByRole('listitem').filter({ hasText: 'Draft—not performed' }).first()
  const weightInput = set.getByLabel('Weight (kg) for set 1')
  const repsInput = set.getByLabel('Reps for set 1')
  const saveReady = set.getByText('Valid entries save automatically. Completion is separate.', {
    exact: true,
  })
  await weightInput.fill(weight)
  await expect(saveReady).toBeVisible()
  await repsInput.fill(reps)
  await expect(saveReady).toBeVisible()
  await expect(weightInput).toHaveValue(weight)
  await expect(repsInput).toHaveValue(reps)
}

async function finish(page: Page) {
  await page.getByRole('button', { name: 'Finish', exact: true }).click()
  await page.getByRole('button', { name: /^save workout$/i }).click()
  await expect(page.getByRole('heading', { name: /session complete/i })).toBeVisible()
  await page.getByRole('button', { name: 'Done', exact: true }).click()
}

test.describe('prescribed workout identity, completion, and correction', () => {
  test('persists a draft, completes and undoes it, reloads for explicit resume, then finishes', async ({
    page,
  }) => {
    await authorStrengthTemplate(page, {
      name: 'E2E Lifecycle Prescription',
      sets: [{ kind: 'exact', reps: 5, weightKg: 90 }],
    })
    await configureRoutine(page, {
      name: 'E2E Lifecycle Routine',
      templateName: 'E2E Lifecycle Prescription',
      continuation: 'carry_forward',
    })
    await startRoutine(page, 'E2E Lifecycle Routine')
    const set = page.getByRole('listitem').filter({ hasText: 'Draft—not performed' }).first()
    const identity = await page
      .getByRole('region', { name: 'Barbell Squat' })
      .getAttribute('aria-labelledby')
    if (!identity) throw new Error('Started workout exercise has no stable identity')
    await populateSet(page, '92.5', '6')
    await expect(set).toContainText('Draft—not performed')
    await expect(set.getByLabel('Weight (kg) for set 1')).toHaveValue('92.5')
    await expect(set.getByLabel('Reps for set 1')).toHaveValue('6')
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Unfinished session' })).toBeVisible()
    await page.getByRole('button', { name: 'Resume', exact: true }).click()
    const resumed = page.getByRole('listitem').filter({ hasText: 'Draft—not performed' }).first()
    await expect(resumed.getByLabel('Weight (kg) for set 1')).toHaveValue('92.5')
    await expect(resumed.getByLabel('Reps for set 1')).toHaveValue('6')
    await expect(page.getByRole('region', { name: 'Barbell Squat' })).toHaveAttribute(
      'aria-labelledby',
      identity,
    )
    await resumed.getByRole('button', { name: 'Complete set 1 for Barbell Squat' }).click()
    const completed = page.getByRole('button', { name: 'Edit set 1 for Barbell Squat' })
    await expect(completed).toContainText('92.5')
    await expect(completed).toContainText('6')
    await page.getByRole('button', { name: 'Undo set 1 for Barbell Squat' }).click()
    const restoredDraft = page
      .getByRole('listitem')
      .filter({ hasText: 'Draft—not performed' })
      .first()
    await expect(restoredDraft.getByLabel('Weight (kg) for set 1')).toHaveValue('92.5')
    await expect(restoredDraft.getByLabel('Reps for set 1')).toHaveValue('6')
    await restoredDraft.getByRole('button', { name: 'Complete set 1 for Barbell Squat' }).click()
    await finish(page)

    await page.goto('/history')
    const entry = page.getByRole('link', { name: /gym session/i }).first()
    await entry.click()
    await expect(page.getByRole('table', { name: 'Sets for Barbell Squat' })).toContainText(
      '92.5 kg',
    )
    await page.getByRole('button', { name: 'Correct workout' }).click()
    const activity = page.locator('details').filter({ hasText: 'Barbell Squat · included' })
    await activity.getByText('Barbell Squat · included', { exact: true }).click()
    await activity.getByRole('button', { name: 'Add actual result row' }).click()
    const added = activity.locator('details').filter({ hasText: /Set \d+ · added actual/ })
    await added.locator('summary').click()
    await added.getByLabel('Weight kg').fill('70')
    await added.getByLabel('Reps').fill('8')
    await page.getByRole('button', { name: 'Review correction' }).click()
    await expect(page.getByText(/Added activities\/result rows: 0\/1/)).toBeVisible()
    await page.getByRole('button', { name: 'Apply reviewed correction' }).click()
    const results = page.getByRole('table', { name: 'Sets for Barbell Squat' })
    await expect(results).toContainText('92.5 kg')
    await expect(results).toContainText('70 kg')

    await page.getByRole('button', { name: 'Correct workout' }).click()
    const correctActivity = page.locator('details').filter({ hasText: 'Barbell Squat · included' })
    const originalSet = correctActivity.locator('details').filter({ hasText: 'Set 1 · included' })
    await correctActivity.getByText('Barbell Squat · included', { exact: true }).click()
    await originalSet.locator('summary').click()
    await originalSet.getByLabel('Exclude this actual set/result').check()
    await page.getByRole('button', { name: 'Review correction' }).click()
    await expect(page.getByText(/Removed activities\/sets: 0\/1/)).toBeVisible()
    await page.getByRole('button', { name: 'Apply reviewed correction' }).click()
    await expect(page.getByRole('table', { name: 'Sets for Barbell Squat' })).not.toContainText(
      '92.5 kg',
    )
    await expect(page.getByRole('table', { name: 'Sets for Barbell Squat' })).toContainText('70 kg')
  })

  test('discards an explicitly recovered unfinished workout without leaving results in history', async ({
    page,
  }) => {
    await page.goto('/workout')
    await page.getByLabel('Session type').selectOption('gym')
    await page.getByRole('button', { name: /start empty session/i }).click()
    await page.getByRole('button', { name: /add exercise/i }).click()
    const picker = page.getByRole('dialog', { name: /add exercise/i })
    await picker.getByRole('searchbox', { name: 'Search exercises' }).fill('barbell squat')
    await picker.getByRole('button', { name: /barbell squat/i }).click()
    await populateSet(page, '40', '8')
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Unfinished session' })).toBeVisible()
    await page.getByRole('button', { name: 'Discard', exact: true }).click()
    await expect(page.getByRole('button', { name: /start empty session/i })).toBeVisible()
    await page.goto('/history')
    await expect(page.getByText(/no workouts yet/i)).toBeVisible()
  })
})

test.describe('shared routine plan organization', () => {
  test('keeps two plan appointments independent and selects exactly one appointment', async ({
    page,
  }) => {
    await authorStrengthTemplate(page, {
      name: 'E2E Shared Template',
      sets: [{ kind: 'exact', reps: 5, weightKg: 80 }],
    })
    await configureRoutine(page, {
      name: 'E2E Shared Routine',
      templateName: 'E2E Shared Template',
    })
    await page.goto('/plans')
    const today = localDate()
    const planName = page.getByLabel('New plan name')
    await planName.fill('E2E Plan Alpha')
    await page.getByRole('button', { name: 'Create personal plan' }).click()
    await selectLabeledOption(page, 'Select personal plan', 'E2E Plan Alpha')
    const appointmentSection = page.getByRole('region', { name: 'Calendar appointments' })
    await selectLabeledOption(appointmentSection, 'Saved routine', 'E2E Shared Routine')
    await fillLabeledDate(appointmentSection, 'Local date', today)
    await appointmentSection.getByRole('button', { name: 'Add appointment' }).click()
    await page.getByLabel('New plan name').fill('E2E Plan Beta')
    await page.getByRole('button', { name: 'Create personal plan' }).click()
    await selectLabeledOption(page, 'Select personal plan', 'E2E Plan Beta')
    await selectLabeledOption(appointmentSection, 'Saved routine', 'E2E Shared Routine')
    await fillLabeledDate(appointmentSection, 'Local date', today)
    await appointmentSection.getByRole('button', { name: 'Add appointment' }).click()
    await page.goto('/')
    const appointments = page
      .getByRole('region', { name: 'Next up' })
      .getByRole('article')
      .filter({ hasText: 'E2E Shared Routine' })
    await expect(appointments).toHaveCount(2)
    await appointments
      .filter({ hasText: 'E2E Plan Alpha' })
      .getByRole('button', { name: 'Start scheduled workout' })
      .click()
    await expect(page.getByText('Active Session', { exact: true })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Barbell Squat' })).toBeVisible()
    await populateSet(page, '82.5', '5')
    await page
      .getByRole('region', { name: 'Barbell Squat' })
      .getByRole('button', { name: 'Complete set 1 for Barbell Squat' })
      .click()
    await finish(page)
    await page.goto('/plans')
    await selectLabeledOption(page, 'Select personal plan', 'E2E Plan Alpha')
    const fulfilled = page
      .locator('li')
      .filter({ hasText: 'E2E Shared Routine' })
      .filter({ hasText: 'fulfilled' })
    await expect(fulfilled).toHaveCount(1)
    await selectLabeledOption(page, 'Select personal plan', 'E2E Plan Beta')
    await expect(
      page.locator('li').filter({ hasText: 'E2E Shared Routine' }).filter({ hasText: 'open' }),
    ).toHaveCount(1)
  })

  test('saves an ordered two-routine rotation and a weekly goal in a plan', async ({ page }) => {
    await authorStrengthTemplate(page, {
      name: 'E2E Rotation A Template',
      sets: [{ kind: 'exact', reps: 5 }],
    })
    await configureRoutine(page, {
      name: 'E2E Rotation A',
      templateName: 'E2E Rotation A Template',
    })
    await authorStrengthTemplate(page, {
      name: 'E2E Rotation B Template',
      sets: [{ kind: 'exact', reps: 8 }],
    })
    await configureRoutine(page, {
      name: 'E2E Rotation B',
      templateName: 'E2E Rotation B Template',
    })
    await page.goto('/plans')
    await page.getByLabel('New plan name').fill('E2E Rotation Plan')
    await page.getByRole('button', { name: 'Create personal plan' }).click()

    await page.getByLabel('Rotation name').fill('E2E AB Rotation')
    await page
      .getByLabel('Choose routines to add')
      .selectOption([{ label: 'E2E Rotation A' }, { label: 'E2E Rotation B' }])
    await page.getByRole('button', { name: 'Save rotation' }).click()
    await expect(page.getByText('E2E AB Rotation · 2 routines · 0 advances')).toBeVisible()
    await expect(page.getByRole('list', { name: 'Current rotation items' })).toContainText(
      'E2E Rotation A',
    )

    await page.getByLabel('Goal name').fill('E2E Strength Goal')
    await page.getByLabel('Per Monday–Sunday week').fill('2')
    await page.getByLabel('Activity type').selectOption('gym')
    await page.getByRole('button', { name: 'Save weekly goal' }).click()
    await expect(page.getByText('E2E Strength Goal · 2/week · active')).toBeVisible()

    await page.goto('/')
    const rotationCard = page
      .getByRole('region', { name: 'Next up' })
      .getByRole('article')
      .filter({ hasText: 'E2E Rotation A' })
    await rotationCard.getByRole('button', { name: 'Start rotation workout' }).click()
    await expect(page.getByText('Active Session', { exact: true })).toBeVisible()
    await expect(page.getByText('E2E Rotation A · revision 1')).toBeVisible()
    await populateSet(page, '80', '5')
    await page
      .getByRole('region', { name: 'Barbell Squat' })
      .getByRole('button', { name: 'Complete set 1 for Barbell Squat' })
      .click()
    await finish(page)
    await page.goto('/plans')
    await expect(page.getByText('E2E AB Rotation · 2 routines · 1 advances')).toBeVisible()
    await expect(page.getByRole('list', { name: 'Current rotation items' })).toContainText(
      'E2E Rotation B',
    )
  })
})
