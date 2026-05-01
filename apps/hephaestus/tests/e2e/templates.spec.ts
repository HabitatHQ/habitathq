import { expect, test } from '@playwright/test'

const MOBILE = { viewport: { width: 390, height: 844 } }

// Helper: wait for exercises to be seeded so the picker works
async function waitForExercises(page: import('@playwright/test').Page) {
  await expect(page.getByText('Barbell Squat')).toBeVisible({ timeout: 20_000 })
}

// Helper: create a template named "Push Day" with Bench Press
async function createTemplate(page: import('@playwright/test').Page, name = 'Push Day') {
  await page.goto('/templates/new')
  await page.getByRole('textbox', { name: /name/i }).fill(name)
  await page.getByRole('button', { name: /add exercise/i }).click()
  // Wait for exercises to load in picker
  await waitForExercises(page)
  await page.getByRole('searchbox', { name: /search exercises/i }).fill('bench press')
  await page.getByText('Bench Press').first().click()
  await page.getByRole('button', { name: /save/i }).click()
  // After save, navigates to /workout
  await expect(page).toHaveURL('/workout')
}

test.describe('Templates list', () => {
  test('templates page loads with heading', async ({ page }) => {
    await page.goto('/templates')
    await expect(page.locator('h1')).toContainText('Templates')
  })

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
  test('loads with New Template heading', async ({ page }) => {
    await page.goto('/templates/new')
    await expect(page.locator('h1')).toContainText('New Template')
  })

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

  test('exercise picker does not get stuck on "Loading exercises…" (cold start)', async ({
    page,
  }) => {
    // Navigate directly — no prior page has warmed up the DB or seeded exercises.
    // This specifically catches the bug where migration:v3 tries to add equipment_sub
    // which already exists in the schema, crashing the worker so readyPromise never resolves.
    await page.goto('/templates/new')
    await page.getByRole('button', { name: /add exercise/i }).click()
    const dialog = page.getByRole('dialog', { name: /add exercise to template/i })
    await expect(dialog).toBeVisible()
    // "Loading exercises…" must disappear within 30 s
    await expect(page.getByText('Loading exercises')).not.toBeVisible({ timeout: 30_000 })
    // At least one exercise must be present
    await waitForExercises(page)
  })

  test('can search for exercise in picker', async ({ page }) => {
    await page.goto('/templates/new')
    await page.getByRole('button', { name: /add exercise/i }).click()
    await waitForExercises(page)
    await page.getByRole('searchbox', { name: /search exercises/i }).fill('squat')
    await expect(page.getByText(/squat/i).first()).toBeVisible()
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
    await page.getByText('Barbell Squat').first().click()

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
    await page.getByText('Barbell Squat').first().click()

    await expect(page.getByLabel(/sets for barbell squat/i)).toBeVisible()
    await expect(page.getByLabel(/reps for barbell squat/i)).toBeVisible()
    await expect(page.getByLabel(/rest seconds for barbell squat/i)).toBeVisible()
  })

  test('can edit sets for an exercise', async ({ page }) => {
    await page.goto('/templates/new')
    await page.getByRole('button', { name: /add exercise/i }).click()
    await waitForExercises(page)
    await page.getByText('Barbell Squat').first().click()

    const setsInput = page.getByLabel(/sets for barbell squat/i)
    await setsInput.fill('5')
    await expect(setsInput).toHaveValue('5')
  })

  test('can remove an exercise from the list', async ({ page }) => {
    await page.goto('/templates/new')
    await page.getByRole('button', { name: /add exercise/i }).click()
    await waitForExercises(page)
    await page.getByText('Barbell Squat').first().click()
    // Wait for picker to close before asserting
    await expect(page.getByRole('dialog', { name: /add exercise to template/i })).not.toBeVisible()
    await expect(page.getByText('Barbell Squat')).toBeVisible()

    await page.getByRole('button', { name: /remove exercise/i }).click()
    await expect(page.getByText('Barbell Squat')).not.toBeVisible()
  })

  test('can add multiple exercises and Save button becomes enabled', async ({ page }) => {
    await page.goto('/templates/new')
    await page.getByRole('textbox', { name: /name/i }).fill('My Template')
    await page.getByRole('button', { name: /add exercise/i }).click()
    await waitForExercises(page)
    await page.getByRole('searchbox', { name: /search exercises/i }).fill('deadlift')
    await page.getByText('Deadlift').first().click()

    await expect(page.getByRole('button', { name: /save/i })).toBeEnabled()
  })

  test('back arrow navigates to /workout', async ({ page }) => {
    await page.goto('/templates/new')
    await page.getByRole('link', { name: '' }).first().click()
    await expect(page).toHaveURL('/workout')
  })
})

test.describe('Template creation and persistence', () => {
  test('created template appears in /templates list', async ({ page }) => {
    await createTemplate(page, 'E2E Push Day')
    await page.goto('/templates')
    await expect(page.getByText('E2E Push Day')).toBeVisible({ timeout: 5_000 })
  })

  test('created template shows exercise count', async ({ page }) => {
    await createTemplate(page, 'E2E Count Test')
    await page.goto('/templates')
    await expect(page.getByText('1 exercise')).toBeVisible({ timeout: 5_000 })
  })

  test('created template appears in workout page template section', async ({ page }) => {
    await createTemplate(page, 'E2E Workout Template')
    await page.goto('/workout')
    await expect(page.getByText('E2E Workout Template')).toBeVisible()
  })

  test('workout page shows template play button', async ({ page }) => {
    await createTemplate(page, 'E2E Play Button')
    await page.goto('/workout')
    await expect(page.getByText('E2E Play Button')).toBeVisible()
    // The play icon button is present (within the template row)
    const templateRow = page.locator('button').filter({ hasText: 'E2E Play Button' })
    await expect(templateRow).toBeVisible()
  })

  test('starting workout from template shows active session', async ({ page }) => {
    await createTemplate(page, 'E2E Start Test')
    await page.goto('/workout')
    await page.locator('button').filter({ hasText: 'E2E Start Test' }).click()
    await expect(page.getByText('Active Session')).toBeVisible({ timeout: 10_000 })
  })

  test('starting workout from template pre-loads exercises', async ({ page }) => {
    await createTemplate(page, 'E2E Exercise Load')
    await page.goto('/workout')
    await page.locator('button').filter({ hasText: 'E2E Exercise Load' }).click()
    await expect(page.getByText('Active Session')).toBeVisible({ timeout: 10_000 })
    // Bench Press from the template should be in the workout
    await expect(page.getByText('Bench Press')).toBeVisible({ timeout: 10_000 })
  })
})

test.describe('Template detail page', () => {
  test('template detail shows name and exercise list', async ({ page }) => {
    await createTemplate(page, 'E2E Detail View')
    await page.goto('/templates')
    await page.getByText('E2E Detail View').click()
    await expect(page.locator('h1')).toContainText('E2E Detail View')
    await expect(page.getByText('Bench Press')).toBeVisible({ timeout: 5_000 })
  })

  test('template detail shows exercise config', async ({ page }) => {
    await createTemplate(page, 'E2E Config View')
    await page.goto('/templates')
    await page.getByText('E2E Config View').click()
    // Should show sets · reps · rest
    await expect(page.getByText(/3 sets/i)).toBeVisible({ timeout: 5_000 })
  })

  test('Start Workout button starts workout', async ({ page }) => {
    await createTemplate(page, 'E2E Start From Detail')
    await page.goto('/templates')
    await page.getByText('E2E Start From Detail').click()
    await page.getByRole('button', { name: /start workout/i }).click()
    await expect(page.getByText('Active Session')).toBeVisible({ timeout: 10_000 })
  })

  test('shows delete template button', async ({ page }) => {
    await createTemplate(page, 'E2E Delete Test')
    await page.goto('/templates')
    await page.getByText('E2E Delete Test').click()
    await expect(page.getByRole('button', { name: /delete template/i })).toBeVisible()
  })

  test('delete shows confirmation UI', async ({ page }) => {
    await createTemplate(page, 'E2E Delete Confirm')
    await page.goto('/templates')
    await page.getByText('E2E Delete Confirm').click()
    await page.getByRole('button', { name: /delete template/i }).click()
    await expect(page.getByText(/delete this template/i)).toBeVisible()
    await expect(page.getByRole('button', { name: /^delete$/i })).toBeVisible()
  })

  test('cancel in delete confirm dismisses confirmation', async ({ page }) => {
    await createTemplate(page, 'E2E Cancel Delete')
    await page.goto('/templates')
    await page.getByText('E2E Cancel Delete').click()
    await page.getByRole('button', { name: /delete template/i }).click()
    await page.getByRole('button', { name: /cancel/i }).click()
    await expect(page.getByText(/delete this template/i)).not.toBeVisible()
  })

  test('confirming delete removes template', async ({ page }) => {
    await createTemplate(page, 'E2E Confirm Delete')
    await page.goto('/templates')
    await page.getByText('E2E Confirm Delete').click()
    await page.getByRole('button', { name: /delete template/i }).click()
    await page.getByRole('button', { name: /^delete$/i }).click()
    // Navigates back to /workout after delete
    await expect(page).toHaveURL('/workout')
    // Template should no longer appear
    await page.goto('/templates')
    await expect(page.getByText('E2E Confirm Delete')).not.toBeVisible()
  })
})

test.describe('Workout page template section', () => {
  test('workout page shows Templates heading', async ({ page }) => {
    await page.goto('/workout')
    await expect(page.getByRole('heading', { name: 'Templates' })).toBeVisible()
  })

  test('shows empty template state with create link', async ({ page }) => {
    await page.goto('/workout')
    await expect(page.getByText(/no templates yet/i)).toBeVisible()
    await expect(page.getByRole('link', { name: /create one/i })).toBeVisible()
  })

  test('New link in template section navigates to /templates/new', async ({ page }) => {
    await page.goto('/workout')
    const newLink = page.getByRole('link', { name: 'New' }).first()
    await expect(newLink).toBeVisible()
    await expect(newLink).toHaveAttribute('href', '/templates/new')
  })

  test('All link navigates to /templates', async ({ page }) => {
    await page.goto('/workout')
    await expect(page.getByRole('link', { name: 'All' })).toHaveAttribute('href', '/templates')
  })
})

test.describe('Template screenshots', () => {
  test('templates empty state', async ({ page }) => {
    await page.setViewportSize(MOBILE.viewport)
    await page.goto('/templates')
    await page.screenshot({
      path: 'test-results/screenshots/templates-empty.png',
      fullPage: false,
    })
  })

  test('new template page', async ({ page }) => {
    await page.setViewportSize(MOBILE.viewport)
    await page.goto('/templates/new')
    await page.screenshot({ path: 'test-results/screenshots/templates-new.png', fullPage: false })
  })

  test('new template page with exercise picker open', async ({ page }) => {
    await page.setViewportSize(MOBILE.viewport)
    await page.goto('/templates/new')
    await page.getByRole('button', { name: /add exercise/i }).click()
    await expect(page.getByRole('dialog', { name: /add exercise to template/i })).toBeVisible()
    await waitForExercises(page)
    await page.screenshot({
      path: 'test-results/screenshots/templates-new-picker.png',
      fullPage: false,
    })
  })

  test('new template page with exercise added', async ({ page }) => {
    await page.setViewportSize(MOBILE.viewport)
    await page.goto('/templates/new')
    await page.getByRole('textbox', { name: /name/i }).fill('Push Day A')
    await page.getByRole('button', { name: /add exercise/i }).click()
    await waitForExercises(page)
    await page.getByRole('searchbox', { name: /search exercises/i }).fill('bench press')
    await page.getByText('Bench Press').first().click()
    await page.screenshot({
      path: 'test-results/screenshots/templates-new-with-exercise.png',
      fullPage: false,
    })
  })

  test('template detail page', async ({ page }) => {
    await page.setViewportSize(MOBILE.viewport)
    await createTemplate(page, 'Screenshot Template')
    await page.goto('/templates')
    await page.getByText('Screenshot Template').click()
    await expect(page.getByText('Bench Press')).toBeVisible({ timeout: 5_000 })
    await page.screenshot({
      path: 'test-results/screenshots/template-detail.png',
      fullPage: false,
    })
  })

  test('workout page with template section', async ({ page }) => {
    await page.setViewportSize(MOBILE.viewport)
    await createTemplate(page, 'Screenshot Workout Template')
    await page.goto('/workout')
    await expect(page.getByText('Screenshot Workout Template')).toBeVisible()
    await page.screenshot({
      path: 'test-results/screenshots/workout-with-templates.png',
      fullPage: false,
    })
  })
})
