import { expect, type Page, test } from '@playwright/test'
import { authorStrengthTemplate } from './domain-helpers'

async function waitForExerciseLibrary(page: Page) {
  const picker = page.getByRole('dialog', { name: /add exercise/i })
  await expect(picker.getByRole('button', { name: /barbell squat/i })).toBeVisible({
    timeout: 15_000,
  })
}

async function addBarbellSquat(page: Page) {
  await page.getByRole('button', { name: /add exercise/i }).click()
  await waitForExerciseLibrary(page)
  await page.getByRole('searchbox', { name: /search exercises/i }).fill('barbell squat')
  await page
    .getByRole('dialog', { name: /add exercise/i })
    .getByRole('button', { name: /barbell squat/i })
    .click()
  await expect(page.getByRole('region', { name: 'Barbell Squat' })).toBeVisible()
}

async function createPopulatedTemplate(page: Page, name: string) {
  await authorStrengthTemplate(page, {
    name,
    sets: [{ kind: 'exact', reps: 6, weightKg: 100 }],
  })
}

async function startTemplateAsStrength(page: Page, templateName: string) {
  await page.goto('/workout')
  await page.getByLabel('Session type').selectOption('gym')
  await page.getByRole('button', { name: new RegExp(templateName) }).click()
  await expect(page.getByRole('heading', { name: 'Start once', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Start workout', exact: true }).click()
  await expect(page.getByText('Active Session')).toBeVisible({ timeout: 10_000 })
}

test.describe('workout controls', () => {
  test('requires complete set input and keeps arbitrary manual values', async ({ page }) => {
    await page.goto('/workout')
    await page.getByLabel('Session type').selectOption('gym')
    await page.getByRole('button', { name: /start empty session/i }).click()
    await addBarbellSquat(page)
    const exercise = page.getByRole('region', { name: 'Barbell Squat' })
    await exercise.getByRole('button', { name: '+ Set' }).click()
    const dialog = page.getByRole('dialog', { name: /edit set 1.*barbell squat/i })
    const weight = dialog.getByLabel('Weight', { exact: true })
    const reps = dialog.getByLabel('Reps', { exact: true })
    const save = dialog.getByRole('button', { name: 'Save Changes', exact: true })
    await weight.fill('103.7')
    await expect(save).toBeDisabled()
    await reps.fill('7')
    await expect(save).toBeEnabled()
    await save.click()
    await exercise
      .getByRole('button', { name: 'Complete set 1 for Barbell Squat', exact: true })
      .click()

    const loggedSet = page.getByRole('button', { name: 'Edit set 1 for Barbell Squat' })
    await expect(loggedSet).toContainText('103.7')
    await expect(loggedSet).toContainText('7')
  })

  test('keeps a new set as a draft after skipping and resuming', async ({ page }) => {
    await page.goto('/workout')
    await page.getByLabel('Session type').selectOption('gym')
    await page.getByRole('button', { name: /start empty session/i }).click()
    await addBarbellSquat(page)
    const exercise = page.getByRole('region', { name: 'Barbell Squat' })
    await exercise
      .getByRole('button', { name: 'Skip set 1 for Barbell Squat', exact: true })
      .click()

    await page.reload()
    await expect(page.getByRole('heading', { name: /unfinished session/i })).toBeVisible()
    await page.getByRole('button', { name: /^resume$/i }).click()
    await exercise.getByRole('button', { name: '+ Set' }).click()
    const draftSet = 1
    const dialog = page.getByRole('dialog', {
      name: new RegExp(`edit set ${draftSet}.*barbell squat`, 'i'),
    })
    await expect(dialog).toBeVisible()
    await dialog.getByLabel('Weight', { exact: true }).fill('80')
    await dialog.getByLabel('Reps', { exact: true }).fill('8')
    await dialog.getByRole('button', { name: 'Save Changes', exact: true }).click()
    await expect(dialog).toBeHidden()

    const draft = exercise.getByRole('listitem').filter({ hasText: 'Draft—not performed' })
    await expect(draft.getByLabel(`Weight (kg) for set ${draftSet} for Barbell Squat`)).toHaveValue(
      '80',
    )
    await expect(draft.getByLabel(`Reps for set ${draftSet} for Barbell Squat`)).toHaveValue('8')
    await expect(
      exercise.getByRole('button', { name: /Undo set \d+ for Barbell Squat/ }),
    ).toHaveCount(0)

    await draft
      .getByRole('button', { name: `Complete set ${draftSet} for Barbell Squat`, exact: true })
      .click()
    const completed = exercise.getByRole('button', {
      name: `Edit set ${draftSet} for Barbell Squat`,
      exact: true,
    })
    await expect(completed).toContainText('80')
    await expect(completed).toContainText('8')
    await expect(completed).toHaveCount(1)
    await expect(
      exercise.getByRole('button', { name: `Undo set ${draftSet} for Barbell Squat`, exact: true }),
    ).toBeVisible()
    await expect(
      exercise.getByRole('button', { name: /Undo set \d+ for Barbell Squat/ }),
    ).toHaveCount(1)
  })

  test('completes a saved draft, resumes it, and corrects the performed set without duplicating it', async ({
    page,
  }) => {
    await page.goto('/workout')
    await page.getByLabel('Session type').selectOption('gym')
    await page.getByRole('button', { name: /start empty session/i }).click()
    await addBarbellSquat(page)
    const exercise = page.getByRole('region', { name: 'Barbell Squat' })
    await page.getByRole('button', { name: 'Edit set 1 for Barbell Squat' }).click()
    const dialog = page.getByRole('dialog', { name: /edit set 1.*barbell squat/i })
    await expect(dialog).toBeVisible()
    await dialog.getByLabel('Weight', { exact: true }).fill('97.5')
    await dialog.getByLabel('Reps', { exact: true }).fill('6')
    await dialog.getByRole('button', { name: 'Save Changes', exact: true }).click()
    await exercise
      .getByRole('button', { name: 'Complete set 1 for Barbell Squat', exact: true })
      .click()

    const loggedSet = page.getByRole('button', { name: 'Edit set 1 for Barbell Squat' })
    await expect(loggedSet).toContainText('97.5')
    await expect(loggedSet).toContainText('6')
    await expect(page.getByRole('button', { name: 'Edit set 2 for Barbell Squat' })).toBeVisible()
    await expect(page.getByText(/set is not part of the active session/i)).toHaveCount(0)

    await page.reload()
    await expect(page.getByRole('heading', { name: /unfinished session/i })).toBeVisible()
    await page.getByRole('button', { name: /^resume$/i }).click()
    const resumedSet = page.getByRole('button', { name: 'Edit set 1 for Barbell Squat' })
    await expect(resumedSet).toContainText('97.5')
    await expect(resumedSet).toContainText('6')
    await expect(resumedSet).toHaveCount(1)

    await resumedSet.click()
    const editDialog = page.getByRole('dialog', { name: /edit set 1.*barbell squat/i })
    await editDialog.getByLabel('Weight', { exact: true }).fill('100')
    await editDialog.getByLabel('Reps', { exact: true }).fill('5')
    await editDialog.getByRole('button', { name: 'Save Changes', exact: true }).click()
    await expect(resumedSet).toContainText('100')
    await expect(resumedSet).toContainText('5')
    await expect(resumedSet).toHaveCount(1)
  })
})

test.describe('populated local-first acceptance journey', () => {
  test('creates, resumes, corrects, completes, backs up, resets, and restores training data', async ({
    page,
  }) => {
    const templateName = 'E2E Complete Journey'
    await createPopulatedTemplate(page, templateName)
    await startTemplateAsStrength(page, templateName)

    const exercise = page.getByRole('region', { name: 'Barbell Squat' })
    await exercise.getByLabel('Weight (kg) for set 1').fill('100')
    await exercise.getByLabel('Reps for set 1').fill('5')
    await exercise
      .getByRole('button', { name: 'Complete set 1 for Barbell Squat', exact: true })
      .click()
    await page.reload()
    await expect(page.getByRole('heading', { name: /unfinished session/i })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Barbell Squat' })).toHaveCount(0)
    await page.getByRole('button', { name: /^resume$/i }).click()

    const loggedSet = page.getByRole('button', { name: 'Edit set 1 for Barbell Squat' })
    await expect(loggedSet).toContainText('100')
    await expect(loggedSet).toContainText('5')
    await loggedSet.click()
    const editDialog = page.getByRole('dialog', { name: /edit set 1.*barbell squat/i })
    await editDialog.getByLabel('Weight', { exact: true }).fill('105')
    await editDialog.getByLabel('Reps', { exact: true }).fill('4')
    await editDialog.getByRole('button', { name: 'Save Changes', exact: true }).click()
    await expect(loggedSet).toContainText('105')
    await expect(loggedSet).toContainText('4')

    await page.getByRole('button', { name: /^finish$/i }).click()
    await page.getByRole('button', { name: 'Mood rating 4' }).click()
    await page.getByRole('button', { name: 'Energy rating 3' }).click()
    await page.getByLabel('Session notes').fill('Restored journey marker')
    await page.getByRole('button', { name: /save workout/i }).click()

    await expect(page.getByRole('heading', { name: /session complete — strength/i })).toBeVisible()
    const summary = page.getByRole('region', { name: /workout summary/i })
    await expect(summary.getByText('Working Sets')).toBeVisible()
    await expect(summary.getByText('1', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: /^done$/i }).click()

    await page.goto('/history')
    await expect(page.getByText(/loading workouts/i)).not.toBeVisible({ timeout: 15_000 })
    const historyEntry = page.getByRole('link', {
      name: /gym session.*restored journey marker/i,
    })
    await expect(historyEntry).toBeVisible()
    await historyEntry.click()
    const setTable = page.getByRole('table', { name: /sets for barbell squat/i })
    await expect(setTable).toContainText('105 kg')
    await expect(setTable).toContainText('4')

    await page.context().setOffline(true)
    await page.reload()
    await expect(page.getByRole('table', { name: /sets for barbell squat/i })).toContainText(
      '105 kg',
    )
    await page.context().setOffline(false)
    await page.goto('/progress')
    await expect(page.getByText(/loading analytics/i)).not.toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('heading', { name: /recent personal records/i })).toBeVisible()
    await expect(page.getByText(/weight pr/i)).toBeVisible()
    const records = page.getByRole('region', { name: 'Recent Personal Records' })
    const weightPr = records.getByRole('listitem').filter({ hasText: '105 kg' })
    await expect(weightPr.getByText('105 kg', { exact: true })).toBeVisible()

    await page.goto('/profile')
    await page.getByRole('button', { name: /^Forge\b/ }).click()
    await expect(page.getByRole('button', { name: /^Forge\b/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await page.getByRole('spinbutton', { name: 'Ramp 1 percentage' }).fill('45')
    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: /download full backup/i }).click()
    const download = await downloadPromise
    const backupPath = await download.path()
    if (!backupPath) throw new Error('Backup download did not produce a local file.')

    page.once('dialog', (dialog) => dialog.accept())
    await page.getByRole('button', { name: /reset hephaestus database/i }).click()
    await expect(page.getByRole('status')).toContainText(/database cleared/i)
    await page.getByRole('button', { name: /^Daylight\b/ }).click()
    await expect(page.getByRole('button', { name: /^Daylight\b/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await page.getByRole('spinbutton', { name: 'Ramp 1 percentage' }).fill('55')
    await page.reload()

    await page.goto('/history')
    await expect(page.getByText(/loading workouts/i)).not.toBeVisible({ timeout: 15_000 })
    await expect(
      page.getByRole('link', { name: /gym session.*restored journey marker/i }),
    ).toHaveCount(0)

    await page.goto('/profile')
    await page.getByLabel('Choose backup file').setInputFiles(backupPath)
    await expect(page.getByText(/preview: .*1 workout.*1 template/i)).toBeVisible()
    page.once('dialog', (dialog) => dialog.accept())
    await page.getByRole('button', { name: /replace local data from backup/i }).click()
    await expect(page.getByRole('status')).toContainText(/backup restored/i)
    await page.reload()
    await page.goto('/profile')
    await expect(page.getByRole('button', { name: /^Forge\b/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(page.getByRole('spinbutton', { name: 'Ramp 1 percentage' })).toHaveValue('45')

    await page.goto('/templates')
    await expect(page.getByRole('link', { name: new RegExp(templateName, 'i') })).toBeVisible()
    await page.goto('/history')
    await expect(page.getByText(/loading workouts/i)).not.toBeVisible({ timeout: 15_000 })
    await expect(
      page.getByRole('link', { name: /gym session.*restored journey marker/i }),
    ).toBeVisible()
    await page.goto('/progress')
    await expect(page.getByText(/loading analytics/i)).not.toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/weight pr/i)).toBeVisible()
  })
})
test.describe('manual strength recovery', () => {
  test('keeps the session inactive until resumed and exposes the finished lift offline', async ({
    page,
  }) => {
    await page.goto('/workout')
    await page.getByLabel('Session type').selectOption('gym')
    await page.getByRole('button', { name: /start empty session/i }).click()
    await addBarbellSquat(page)
    const exercise = page.getByRole('region', { name: 'Barbell Squat' })
    await exercise.getByRole('button', { name: '+ Set' }).click()
    const dialog = page.getByRole('dialog', { name: /edit set 1.*barbell squat/i })
    await dialog.getByLabel('Weight', { exact: true }).fill('80')
    await dialog.getByLabel('Reps', { exact: true }).fill('8')
    await expect(dialog.getByRole('button', { name: 'Save Changes', exact: true })).toBeEnabled()
    await dialog.getByRole('button', { name: 'Save Changes', exact: true }).click()
    await expect(dialog).toBeHidden()
    const pendingSet = exercise.getByRole('listitem').filter({ hasText: 'Draft—not performed' })
    await expect(pendingSet.getByLabel('Weight (kg) for set 1 for Barbell Squat')).toHaveValue('80')
    await expect(pendingSet.getByLabel('Reps for set 1 for Barbell Squat')).toHaveValue('8')
    await pendingSet
      .getByRole('button', { name: 'Complete set 1 for Barbell Squat', exact: true })
      .click()
    const loggedSet = page.getByRole('button', { name: 'Edit set 1 for Barbell Squat' })
    await expect(loggedSet).toContainText('80')
    await expect(loggedSet).toContainText('8')
    await expect(loggedSet).toHaveCount(1)
    await page.reload()
    await expect(page.getByRole('heading', { name: /unfinished session/i })).toBeVisible()
    await page.getByRole('button', { name: /^resume$/i }).click()
    await page.getByRole('button', { name: /^finish$/i }).click()
    await page.getByRole('button', { name: /save workout/i }).click()
    await expect(page.getByRole('heading', { name: /session complete — strength/i })).toBeVisible()
    await page.getByRole('button', { name: /^done$/i }).click()

    await page.goto('/history')
    await page.context().setOffline(true)
    await page.reload()
    await expect(page.getByRole('link', { name: /gym session/i })).toBeVisible()
    await page.getByRole('link', { name: /gym session/i }).click()
    await expect(page.getByRole('table', { name: /sets for barbell squat/i })).toContainText(
      '80 kg',
    )
    await page.context().setOffline(false)
  })
})
test.describe('session modes', () => {
  test('records manual run details and finishes a run session', async ({ page }) => {
    await page.goto('/workout')
    await page.getByLabel('Session type').selectOption('run')
    await page.getByRole('button', { name: /start empty session/i }).click()
    await expect(page.getByRole('heading', { name: /manual run details/i })).toBeVisible()
    await page.getByLabel('Distance (km)').fill('5.25')
    await page.getByLabel('Duration (seconds)').fill('1500')
    await page.getByRole('button', { name: /save run details/i }).click()
    await page.getByRole('button', { name: /^finish$/i }).click()
    await page.getByRole('button', { name: /save workout/i }).click()

    await expect(page.getByRole('heading', { name: /session complete — run/i })).toBeVisible()
    await expect(page.getByText('5.25 km', { exact: true })).toBeVisible()
  })

  for (const mode of [
    { label: 'custom', phase: 'Work', session: 'conditioning' },
    { label: 'mobility', phase: 'Hold / practice', session: 'mobility' },
  ]) {
    test(`starts and finishes a ${mode.label} interval`, async ({ page }) => {
      await page.goto('/templates/intervals/new')
      await page.getByRole('button', { name: new RegExp(`^${mode.label}$`, 'i') }).click()
      await page.getByLabel('Name').fill(`E2E ${mode.label} interval`)
      await page.getByLabel('Rounds').fill('1')
      await page.getByLabel('Work (s)').fill('120')
      await page.getByLabel('Rest (s)').fill('30')
      await page.getByRole('button', { name: /^save$/i }).click()

      await expect(page).toHaveURL('/templates/intervals')
      await page.getByRole('link', { name: 'Start', exact: true }).click()
      await expect(page.getByRole('heading', { name: `E2E ${mode.label} interval` })).toBeVisible()
      await page.getByRole('button', { name: /start session/i }).click()
      await expect(page.getByText(mode.phase, { exact: true })).toBeVisible()
      await page.getByRole('button', { name: /finish session/i }).click()
      await expect(page.getByRole('status')).toContainText(/session saved/i)

      await page.goto('/history')
      await expect(
        page.getByRole('link', { name: new RegExp(`${mode.session} session`, 'i') }),
      ).toBeVisible()
    })
  }
})

test.describe('equipment-aware progression', () => {
  test('suggests an available load while allowing a manual override', async ({ page }) => {
    await page.goto('/workout')
    await page.getByLabel('Session type').selectOption('gym')
    await page.getByRole('button', { name: /start empty session/i }).click()
    await addBarbellSquat(page)
    const exercise = page.getByRole('region', { name: 'Barbell Squat' })
    await exercise.getByRole('button', { name: '+ Set' }).click()
    const dialog = page.getByRole('dialog', { name: /edit set 1.*barbell squat/i })
    await dialog.getByLabel('Weight', { exact: true }).fill('107')
    await dialog.getByLabel('Reps', { exact: true }).fill('5')
    await dialog.getByLabel('RPE', { exact: true }).fill('6')
    await dialog.getByRole('button', { name: 'Save Changes', exact: true }).click()
    await exercise
      .getByRole('button', { name: 'Complete set 1 for Barbell Squat', exact: true })
      .click()
    await page.getByRole('button', { name: /^finish$/i }).click()
    await page.getByRole('button', { name: /save workout/i }).click()
    await page.getByRole('button', { name: /^done$/i }).click()

    await page.goto('/equipment')
    const profile = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: 'Barbell Squat' }) })
    await profile.getByLabel(/^minimum/i).fill('0')
    await profile.getByLabel(/^increment/i).fill('10')
    await profile.getByRole('button', { name: /save profile/i }).click()

    await page.goto('/workout')
    await page.getByLabel('Session type').selectOption('gym')
    await page.getByRole('button', { name: /start empty session/i }).click()
    await addBarbellSquat(page)
    await exercise.getByRole('button', { name: '+ Set' }).click()
    await expect(page.getByText(/suggested 110(?:\.0)? kg/i)).toBeVisible()
    await expect(page.getByRole('button', { name: /use suggestion/i })).toBeVisible()
    await dialog.getByLabel('Weight', { exact: true }).fill('107.3')
    await dialog.getByLabel('Reps', { exact: true }).fill('5')
    await expect(dialog.getByLabel('Weight', { exact: true })).toHaveValue('107.3')
    await dialog.getByRole('button', { name: 'Save Changes', exact: true }).click()
    await exercise
      .getByRole('button', { name: 'Complete set 1 for Barbell Squat', exact: true })
      .click()
    await expect(page.getByRole('button', { name: 'Edit set 1 for Barbell Squat' })).toContainText(
      '107.3',
    )
  })
})
