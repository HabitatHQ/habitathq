import { expect, type Page, test } from '@playwright/test'

// Helper: wait for exercises to be seeded so the picker works
async function waitForExercises(page: Page) {
  const picker = page.getByRole('dialog', { name: /add exercise to template/i })
  await expect(picker.getByRole('button', { name: /barbell squat/i })).toBeVisible({
    timeout: 20_000,
  })
}

// Helper: create a template named "Push Day" with Bench Press
async function createTemplate(page: Page, name = 'Push Day') {
  await page.goto('/templates/new')
  await page.getByRole('textbox', { name: /^name$/i }).fill(name)
  await page.getByRole('button', { name: /add exercise/i }).click()
  const picker = page.getByRole('dialog', { name: /add exercise to template/i })
  await expect(picker.getByRole('button', { name: /^bench press\b/i })).toBeVisible({
    timeout: 20_000,
  })
  await picker.getByRole('searchbox', { name: /search exercises/i }).fill('bench press')
  await picker.getByRole('button', { name: /^bench press\b/i }).click()
  const exercise = page
    .getByRole('region', { name: 'Exercises' })
    .getByRole('listitem')
    .filter({ hasText: 'Bench Press' })
  await exercise.getByLabel('Sets').fill('4')
  await exercise.getByLabel('Reps', { exact: true }).fill('6')
  await page.getByRole('button', { name: /^save$/i }).click()
  await expect(page).toHaveURL(/\/templates\/[^/]+$/)
}

test.describe('Templates list', () => {
  test('shows empty state when no templates exist', async ({ page }) => {
    await page.goto('/templates')
    await expect(page.getByText(/no templates yet/i)).toBeVisible()
  })

  test('has New button that links to /templates/new', async ({ page }) => {
    await page.goto('/templates')
    const newBtn = page.getByRole('link', { name: 'New' })
    await expect(newBtn).toBeVisible()
    await expect(newBtn).toHaveAttribute('href', '/templates/new')
  })

  test('empty state Create Template button goes to /templates/new', async ({ page }) => {
    await page.goto('/templates')
    await page.getByRole('link', { name: /create template/i }).click()
    await expect(page).toHaveURL('/templates/new')
  })
})

test.describe('New template page', () => {
  test('Save button is disabled with no name', async ({ page }) => {
    await page.goto('/templates/new')
    await expect(page.getByRole('button', { name: /save/i })).toBeDisabled()
  })

  test('Save button is disabled with name but no exercises', async ({ page }) => {
    await page.goto('/templates/new')
    await page.getByRole('textbox', { name: /name/i }).fill('Test Template')
    await expect(page.getByRole('button', { name: /save/i })).toBeDisabled()
  })

  test('Add Exercise button opens exercise picker', async ({ page }) => {
    await page.goto('/templates/new')
    await page.getByRole('button', { name: /add exercise/i }).click()
    await expect(page.getByRole('dialog', { name: /add exercise to template/i })).toBeVisible()
  })

  test('exercise picker shows exercises after loading', async ({ page }) => {
    await page.goto('/templates/new')
    await page.getByRole('button', { name: /add exercise/i }).click()
    await expect(page.getByRole('dialog', { name: /add exercise to template/i })).toBeVisible()
    await waitForExercises(page)
  })

  test('can search for exercise in picker', async ({ page }) => {
    await page.goto('/templates/new')
    await page.getByRole('button', { name: /add exercise/i }).click()
    await waitForExercises(page)
    await page.getByRole('searchbox', { name: /search exercises/i }).fill('squat')
    const picker = page.getByRole('dialog', { name: /add exercise to template/i })
    await expect(picker.getByRole('button', { name: /^barbell squat\b/i })).toBeVisible()
  })

  test('close button dismisses exercise picker', async ({ page }) => {
    await page.goto('/templates/new')
    await page.getByRole('button', { name: /add exercise/i }).click()
    await expect(page.getByRole('dialog', { name: /add exercise to template/i })).toBeVisible()
    await page.getByRole('button', { name: /close exercise picker/i }).click()
    await expect(page.getByRole('dialog', { name: /add exercise to template/i })).not.toBeVisible()
  })

  test('selecting an exercise adds it to the list', async ({ page }) => {
    await page.goto('/templates/new')
    await page.getByRole('button', { name: /add exercise/i }).click()
    await waitForExercises(page)
    await page.getByRole('searchbox', { name: /search exercises/i }).fill('barbell squat')
    const picker = page.getByRole('dialog', { name: /add exercise to template/i })
    await picker.getByRole('button', { name: /barbell squat/i }).click()

    // Picker should close
    await expect(page.getByRole('dialog', { name: /add exercise to template/i })).not.toBeVisible()
    // Exercise should appear in list
    await expect(page.getByText('Barbell Squat')).toBeVisible()
  })

  test('added exercise shows sets, reps, rest config fields', async ({ page }) => {
    await page.goto('/templates/new')
    await page.getByRole('button', { name: /add exercise/i }).click()
    await waitForExercises(page)
    await page.getByRole('searchbox', { name: /search exercises/i }).fill('barbell squat')
    await page
      .getByRole('dialog', { name: /add exercise to template/i })
      .getByRole('button', { name: /barbell squat/i })
      .click()
    const exercise = page
      .getByRole('region', { name: 'Exercises' })
      .getByRole('listitem')
      .filter({ hasText: 'Barbell Squat' })
    await expect(exercise.getByLabel('Sets')).toBeVisible()
    await expect(exercise.getByLabel('Reps', { exact: true })).toBeVisible()
    await expect(exercise.getByLabel('Rest (s)')).toBeVisible()
  })

  test('can edit sets for an exercise', async ({ page }) => {
    await page.goto('/templates/new')
    await page.getByRole('button', { name: /add exercise/i }).click()
    await waitForExercises(page)
    await page.getByRole('searchbox', { name: /search exercises/i }).fill('barbell squat')
    await page
      .getByRole('dialog', { name: /add exercise to template/i })
      .getByRole('button', { name: /barbell squat/i })
      .click()
    const exercise = page
      .getByRole('region', { name: 'Exercises' })
      .getByRole('listitem')
      .filter({ hasText: 'Barbell Squat' })
    const setsInput = exercise.getByLabel('Sets')
    await setsInput.fill('5')
    await expect(setsInput).toHaveValue('5')
  })

  test('can remove an exercise from the list', async ({ page }) => {
    await page.goto('/templates/new')
    await page.getByRole('button', { name: /add exercise/i }).click()
    await waitForExercises(page)
    await page
      .getByRole('dialog', { name: /add exercise to template/i })
      .getByRole('button', { name: /barbell squat/i })
      .click()
    const exercise = page
      .getByRole('region', { name: 'Exercises' })
      .getByRole('listitem')
      .filter({ hasText: 'Barbell Squat' })
    await expect(exercise).toBeVisible()
    await exercise.getByRole('button', { name: 'Options for Barbell Squat' }).click()
    await page.getByRole('menuitem', { name: 'Remove', exact: true }).click()
    await expect(exercise).toHaveCount(0)
  })

  test('can add multiple exercises and Save button becomes enabled', async ({ page }) => {
    await page.goto('/templates/new')
    await page.getByRole('textbox', { name: /name/i }).fill('My Template')
    await page.getByRole('button', { name: /add exercise/i }).click()
    await waitForExercises(page)
    await page.getByRole('searchbox', { name: /search exercises/i }).fill('deadlift')
    const picker = page.getByRole('dialog', { name: /add exercise to template/i })
    await picker.getByRole('button', { name: /^deadlift\b/i }).click()

    await expect(page.getByRole('button', { name: /save/i })).toBeEnabled()
  })

  test('back link navigates to the templates list', async ({ page }) => {
    await page.goto('/templates/new')
    await page.getByRole('link', { name: 'Back to templates' }).click()
    await expect(page).toHaveURL('/templates')
  })
})

test.describe('Template creation and persistence', () => {
  test('created template appears in /templates list', async ({ page }) => {
    await createTemplate(page, 'E2E Push Day')
    await page.goto('/templates')
    await expect(page.getByText('E2E Push Day')).toBeVisible({ timeout: 5_000 })
  })

  test('starting a template loads its prescribed exercises in the active workout', async ({
    page,
  }) => {
    const name = 'E2E Exercise Load'
    await createTemplate(page, name)
    await page.goto('/workout')
    const startTemplate = page.getByRole('button', { name: new RegExp(name) })
    await expect(startTemplate).toBeVisible()
    await startTemplate.click()
    await expect(page.getByText('Active Session')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByRole('region', { name: /bench press/i })).toBeVisible()
  })
})

test.describe('Template detail page', () => {
  test('template detail shows name and exercise list', async ({ page }) => {
    await createTemplate(page, 'E2E Detail View')
    await page.goto('/templates')
    await page.getByText('E2E Detail View').click()
    await expect(page.getByRole('button', { name: 'Edit name: E2E Detail View' })).toBeVisible()
    await expect(page.getByText('Bench Press', { exact: true })).toBeVisible()
  })

  test('template detail preserves the configured exercise prescription', async ({ page }) => {
    await createTemplate(page, 'E2E Config View')
    await page.goto('/templates')
    await page.getByText('E2E Config View').click()
    await expect(page.getByText('4 × 6')).toBeVisible()
  })

  test('Start Workout opens a preview and starts the selected session type', async ({ page }) => {
    await createTemplate(page, 'E2E Start From Detail')
    await page.goto('/templates')
    await page.getByRole('link', { name: 'E2E Start From Detail' }).click()
    await page.getByRole('button', { name: 'Start Workout', exact: true }).click()
    const preview = page.getByRole('dialog', { name: /preview: e2e start from detail/i })
    await expect(preview).toBeVisible()
    await preview.getByRole('radio', { name: /strength/i }).check()
    await preview.getByRole('button', { name: 'Start Workout', exact: true }).click()
    await expect(page.getByText('Active Session')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByRole('region', { name: /bench press/i })).toBeVisible()
  })

  test('cancel in delete confirm dismisses confirmation', async ({ page }) => {
    await createTemplate(page, 'E2E Cancel Delete')
    await page.goto('/templates')
    await page.getByRole('link', { name: 'E2E Cancel Delete' }).click()
    await page.getByRole('button', { name: /delete template/i }).click()
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(page.getByRole('button', { name: /delete template/i })).toBeVisible()
  })

  test('confirming delete removes template', async ({ page }) => {
    await createTemplate(page, 'E2E Confirm Delete')
    await page.goto('/templates')
    await page.getByRole('link', { name: 'E2E Confirm Delete' }).click()
    await page.getByRole('button', { name: /delete template/i }).click()
    await page.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(page).toHaveURL('/templates')
    await expect(page.getByRole('link', { name: 'E2E Confirm Delete' })).not.toBeVisible()
  })
})

test.describe('Workout page template section', () => {
  test('New link in template section navigates to /templates/new', async ({ page }) => {
    await page.goto('/workout')
    const newLink = page
      .getByRole('region', { name: 'Templates' })
      .getByRole('link', { name: 'New' })
    await expect(newLink).toBeVisible()
    await expect(newLink).toHaveAttribute('href', '/templates/new')
  })

  test('All link navigates to /templates', async ({ page }) => {
    await page.goto('/workout')
    await expect(page.getByRole('link', { name: 'All' })).toHaveAttribute('href', '/templates')
  })
})
