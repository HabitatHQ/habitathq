import { expect, test } from '@playwright/test'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function waitForExercises(page: import('@playwright/test').Page) {
  await expect(page.getByText('Barbell Squat')).toBeVisible({ timeout: 20_000 })
}

async function createSupersetTemplate(
  page: import('@playwright/test').Page,
  name = 'Superset Push',
) {
  await page.goto('/templates/new')
  await page.getByRole('textbox', { name: /name/i }).fill(name)

  // Add Bench Press
  await page.getByRole('button', { name: /add exercise/i }).click()
  await waitForExercises(page)
  await page.getByRole('searchbox', { name: /search exercises/i }).fill('bench press')
  await page.getByText('Bench Press').first().click()
  await expect(page.getByRole('dialog', { name: /add exercise to template/i })).not.toBeVisible()

  // Add Barbell Row
  await page.getByRole('button', { name: /add exercise/i }).click()
  await waitForExercises(page)
  await page.getByRole('searchbox', { name: /search exercises/i }).fill('barbell row')
  await page
    .getByText(/barbell row/i)
    .first()
    .click()
  await expect(page.getByRole('dialog', { name: /add exercise to template/i })).not.toBeVisible()

  // Assign Bench Press to group A via ··· menu
  await page.getByRole('button', { name: /options for bench press/i }).click()
  await expect(page.getByRole('menu')).toBeVisible()
  await page.getByRole('menuitem', { name: /new group a/i }).click()

  // Assign second exercise to group A
  const rowExerciseName = await page.locator('li').nth(1).locator('p.font-medium').textContent()
  if (rowExerciseName) {
    await page
      .getByRole('button', { name: new RegExp(`options for ${rowExerciseName}`, 'i') })
      .click()
    await page
      .getByRole('menuitem', { name: /group a/i })
      .first()
      .click()
  }

  // Save template → redirects to template detail, then navigate to /workout
  await page.getByRole('button', { name: /^save$/i }).click()
  await expect(page).not.toHaveURL('/templates/new', { timeout: 5_000 })
  await page.goto('/workout')
}

// Enable showSupersets feature flag for all tests in this file
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const stored = JSON.parse(localStorage.getItem('hephaestus-app-settings') || '{}')
    localStorage.setItem(
      'hephaestus-app-settings',
      JSON.stringify({ ...stored, showSupersets: true }),
    )
  })
})

// ---------------------------------------------------------------------------
// Template editor — superset groups
// ---------------------------------------------------------------------------

test.describe('Template editor — superset groups', () => {
  test('opening ··· menu for an exercise shows group options', async ({ page }) => {
    await page.goto('/templates/new')
    await page.getByRole('textbox', { name: /name/i }).fill('Menu Test')

    // Add one exercise
    await page.getByRole('button', { name: /add exercise/i }).click()
    await waitForExercises(page)
    await page.getByRole('searchbox', { name: /search exercises/i }).fill('bench press')
    await page.getByText('Bench Press').first().click()
    await expect(page.getByRole('dialog', { name: /add exercise to template/i })).not.toBeVisible()

    // Open ··· menu
    await page.getByRole('button', { name: /options for bench press/i }).click()
    await expect(page.getByRole('menu')).toBeVisible()

    // Should see a "New group A" option
    await expect(page.getByRole('menuitem', { name: /new group a/i })).toBeVisible()
  })

  test('"New group A" creates a group A badge on the exercise', async ({ page }) => {
    await page.goto('/templates/new')
    await page.getByRole('textbox', { name: /name/i }).fill('Group Badge Test')

    // Add Bench Press
    await page.getByRole('button', { name: /add exercise/i }).click()
    await waitForExercises(page)
    await page.getByRole('searchbox', { name: /search exercises/i }).fill('bench press')
    await page.getByText('Bench Press').first().click()
    await expect(page.getByRole('dialog', { name: /add exercise to template/i })).not.toBeVisible()

    // Assign to new group A
    await page.getByRole('button', { name: /options for bench press/i }).click()
    await expect(page.getByRole('menu')).toBeVisible()
    await page.getByRole('menuitem', { name: /new group a/i }).click()

    // Badge with "A" should appear next to the exercise
    await expect(page.getByText('A').first()).toBeVisible()
  })

  test('second exercise can be assigned to existing group A', async ({ page }) => {
    await page.goto('/templates/new')
    await page.getByRole('textbox', { name: /name/i }).fill('Two Exercises Group Test')

    // Add Bench Press
    await page.getByRole('button', { name: /add exercise/i }).click()
    await waitForExercises(page)
    await page.getByRole('searchbox', { name: /search exercises/i }).fill('bench press')
    await page.getByText('Bench Press').first().click()
    await expect(page.getByRole('dialog', { name: /add exercise to template/i })).not.toBeVisible()

    // Add Barbell Row
    await page.getByRole('button', { name: /add exercise/i }).click()
    await waitForExercises(page)
    await page.getByRole('searchbox', { name: /search exercises/i }).fill('barbell row')
    await page
      .getByText(/barbell row/i)
      .first()
      .click()
    await expect(page.getByRole('dialog', { name: /add exercise to template/i })).not.toBeVisible()

    // Put Bench Press in new group A
    await page.getByRole('button', { name: /options for bench press/i }).click()
    await expect(page.getByRole('menu')).toBeVisible()
    await page.getByRole('menuitem', { name: /new group a/i }).click()

    // Assign Barbell Row to existing group A
    const rowExerciseName = await page.locator('li').nth(1).locator('p.font-medium').textContent()
    if (rowExerciseName) {
      await page
        .getByRole('button', { name: new RegExp(`options for ${rowExerciseName}`, 'i') })
        .click()
      await expect(page.getByRole('menu')).toBeVisible()
      // Should show existing group A, not "new"
      await expect(page.getByRole('menuitem', { name: /group a/i }).first()).toBeVisible()
      await page
        .getByRole('menuitem', { name: /group a/i })
        .first()
        .click()
    }

    // Both exercises should show "A" badge
    const aBadges = page.getByText('A')
    await expect(aBadges.first()).toBeVisible()
  })

  test('"Superset Groups" section appears when groups exist', async ({ page }) => {
    await page.goto('/templates/new')
    await page.getByRole('textbox', { name: /name/i }).fill('Groups Section Test')

    // Add one exercise
    await page.getByRole('button', { name: /add exercise/i }).click()
    await waitForExercises(page)
    await page.getByRole('searchbox', { name: /search exercises/i }).fill('bench press')
    await page.getByText('Bench Press').first().click()
    await expect(page.getByRole('dialog', { name: /add exercise to template/i })).not.toBeVisible()

    // Before grouping: section should not exist
    await expect(page.getByText(/superset groups/i)).not.toBeVisible()

    // Assign to new group A
    await page.getByRole('button', { name: /options for bench press/i }).click()
    await expect(page.getByRole('menu')).toBeVisible()
    await page.getByRole('menuitem', { name: /new group a/i }).click()

    // Now "Superset Groups" section should appear
    await expect(page.getByText(/superset groups/i)).toBeVisible()
  })

  test('group type can be changed to Circuit', async ({ page }) => {
    await page.goto('/templates/new')
    await page.getByRole('textbox', { name: /name/i }).fill('Circuit Type Test')

    // Add Bench Press and assign to group A
    await page.getByRole('button', { name: /add exercise/i }).click()
    await waitForExercises(page)
    await page.getByRole('searchbox', { name: /search exercises/i }).fill('bench press')
    await page.getByText('Bench Press').first().click()
    await expect(page.getByRole('dialog', { name: /add exercise to template/i })).not.toBeVisible()

    await page.getByRole('button', { name: /options for bench press/i }).click()
    await expect(page.getByRole('menu')).toBeVisible()
    await page.getByRole('menuitem', { name: /new group a/i }).click()

    // Locate the group type select in the Superset Groups section
    await expect(page.getByText(/superset groups/i)).toBeVisible()
    const groupTypeSelect = page
      .getByText(/superset groups/i)
      .locator('~ *')
      .getByRole('combobox')
      .first()

    // Open and choose circuit
    await groupTypeSelect.selectOption('circuit')
    await expect(groupTypeSelect).toHaveValue('circuit')
  })

  test('smart defaults apply on group type change: circuit → transition 15s, round 90s', async ({
    page,
  }) => {
    await page.goto('/templates/new')
    await page.getByRole('textbox', { name: /name/i }).fill('Smart Defaults Test')

    // Add Bench Press and assign to group A
    await page.getByRole('button', { name: /add exercise/i }).click()
    await waitForExercises(page)
    await page.getByRole('searchbox', { name: /search exercises/i }).fill('bench press')
    await page.getByText('Bench Press').first().click()
    await expect(page.getByRole('dialog', { name: /add exercise to template/i })).not.toBeVisible()

    await page.getByRole('button', { name: /options for bench press/i }).click()
    await expect(page.getByRole('menu')).toBeVisible()
    await page.getByRole('menuitem', { name: /new group a/i }).click()

    await expect(page.getByText(/superset groups/i)).toBeVisible()

    // Find the group type select and change to circuit
    const groupSection = page.getByText(/superset groups/i).locator('..')
    const groupTypeSelect = groupSection.getByRole('combobox').first()
    await groupTypeSelect.selectOption('circuit')

    // Transition rest should default to 15
    const transitionInput = groupSection.getByRole('spinbutton').first()
    await expect(transitionInput).toHaveValue('15')

    // Round rest should default to 90
    const roundRestInput = groupSection.getByRole('spinbutton').nth(1)
    await expect(roundRestInput).toHaveValue('90')
  })

  test('can remove a group via x button in group config section', async ({ page }) => {
    await page.goto('/templates/new')
    await page.getByRole('textbox', { name: /name/i }).fill('Remove Group Test')

    // Add Bench Press and assign to group A
    await page.getByRole('button', { name: /add exercise/i }).click()
    await waitForExercises(page)
    await page.getByRole('searchbox', { name: /search exercises/i }).fill('bench press')
    await page.getByText('Bench Press').first().click()
    await expect(page.getByRole('dialog', { name: /add exercise to template/i })).not.toBeVisible()

    await page.getByRole('button', { name: /options for bench press/i }).click()
    await expect(page.getByRole('menu')).toBeVisible()
    await page.getByRole('menuitem', { name: /new group a/i }).click()

    // Superset Groups section should be visible
    await expect(page.getByText(/superset groups/i)).toBeVisible()

    // Click the remove/x button for group A (try multiple selectors)
    const removeBtn = page
      .getByRole('button', { name: /remove group a/i })
      .or(page.getByRole('button', { name: /delete group a/i }))
      .or(
        page
          .getByText(/superset groups/i)
          .locator('..')
          .getByRole('button')
          .last(),
      )
    await removeBtn.click()

    // Superset Groups section should disappear
    await expect(page.getByText(/superset groups/i)).not.toBeVisible()
  })

  test('group can have custom transition rest and round rest configured', async ({ page }) => {
    await page.goto('/templates/new')
    await page.getByRole('textbox', { name: /name/i }).fill('Custom Rest Test')

    // Add Bench Press and assign to group A
    await page.getByRole('button', { name: /add exercise/i }).click()
    await waitForExercises(page)
    await page.getByRole('searchbox', { name: /search exercises/i }).fill('bench press')
    await page.getByText('Bench Press').first().click()
    await expect(page.getByRole('dialog', { name: /add exercise to template/i })).not.toBeVisible()

    await page.getByRole('button', { name: /options for bench press/i }).click()
    await expect(page.getByRole('menu')).toBeVisible()
    await page.getByRole('menuitem', { name: /new group a/i }).click()

    await expect(page.getByText(/superset groups/i)).toBeVisible()

    const groupSection = page.getByText(/superset groups/i).locator('..')
    const spinbuttons = groupSection.getByRole('spinbutton')

    // Set custom transition rest
    await spinbuttons.first().fill('20')
    await expect(spinbuttons.first()).toHaveValue('20')

    // Set custom round rest
    await spinbuttons.nth(1).fill('120')
    await expect(spinbuttons.nth(1)).toHaveValue('120')
  })
})

// ---------------------------------------------------------------------------
// Active workout — SupersetCard rendering
// ---------------------------------------------------------------------------

test.describe('Active workout — SupersetCard rendering', () => {
  test('starting from superset template shows SupersetCard with group label header', async ({
    page,
  }) => {
    await createSupersetTemplate(page, 'SC Render 1')

    // Find the template and start it
    await expect(page.getByText('SC Render 1')).toBeVisible({ timeout: 10_000 })
    await page.locator('button').filter({ hasText: 'SC Render 1' }).click()
    await expect(page.getByText('Active Session')).toBeVisible({ timeout: 10_000 })

    // SupersetCard section should have aria-labelledby="group-hd-A"
    const supersetSection = page.locator('[aria-labelledby="group-hd-A"]')
    await expect(supersetSection).toBeVisible({ timeout: 10_000 })
  })

  test('SupersetCard shows "Superset" type label', async ({ page }) => {
    await createSupersetTemplate(page, 'SC Render 2')

    await expect(page.getByText('SC Render 2')).toBeVisible({ timeout: 10_000 })
    await page.locator('button').filter({ hasText: 'SC Render 2' }).click()
    await expect(page.getByText('Active Session')).toBeVisible({ timeout: 10_000 })

    // The group header should show "Superset" label
    await expect(page.getByText(/superset/i).first()).toBeVisible({ timeout: 10_000 })
  })

  test('both exercises are visible within the SupersetCard', async ({ page }) => {
    await createSupersetTemplate(page, 'SC Render 3')

    await expect(page.getByText('SC Render 3')).toBeVisible({ timeout: 10_000 })
    await page.locator('button').filter({ hasText: 'SC Render 3' }).click()
    await expect(page.getByText('Active Session')).toBeVisible({ timeout: 10_000 })

    const supersetSection = page.locator('[aria-labelledby="group-hd-A"]')
    await expect(supersetSection).toBeVisible({ timeout: 10_000 })

    // Both exercise names should appear inside the superset card
    await expect(supersetSection.getByText(/bench press/i)).toBeVisible()
    await expect(supersetSection.getByText(/barbell row/i)).toBeVisible()
  })

  test('each exercise in the card has a "+ Set" button', async ({ page }) => {
    await createSupersetTemplate(page, 'SC Render 4')

    await expect(page.getByText('SC Render 4')).toBeVisible({ timeout: 10_000 })
    await page.locator('button').filter({ hasText: 'SC Render 4' }).click()
    await expect(page.getByText('Active Session')).toBeVisible({ timeout: 10_000 })

    const supersetSection = page.locator('[aria-labelledby="group-hd-A"]')
    await expect(supersetSection).toBeVisible({ timeout: 10_000 })

    // Each exercise should have a "Log set for …" button
    await expect(
      supersetSection.getByRole('button', { name: /log set for bench press/i }),
    ).toBeVisible()
    await expect(supersetSection.getByRole('button', { name: /log set for/i }).nth(1)).toBeVisible()
  })

  test('exercise step indicators (A, B letter circles) are visible', async ({ page }) => {
    await createSupersetTemplate(page, 'SC Render 5')

    await expect(page.getByText('SC Render 5')).toBeVisible({ timeout: 10_000 })
    await page.locator('button').filter({ hasText: 'SC Render 5' }).click()
    await expect(page.getByText('Active Session')).toBeVisible({ timeout: 10_000 })

    const supersetSection = page.locator('[aria-labelledby="group-hd-A"]')
    await expect(supersetSection).toBeVisible({ timeout: 10_000 })

    // Step rail letters A and B should appear in the exercise list
    const exerciseList = supersetSection.locator('ul[role="list"]')
    await expect(exerciseList).toBeVisible()
    await expect(exerciseList.getByText('A').first()).toBeVisible()
    await expect(exerciseList.getByText('B').first()).toBeVisible()
  })

  test('footer shows rest timing info', async ({ page }) => {
    await createSupersetTemplate(page, 'SC Render 6')

    await expect(page.getByText('SC Render 6')).toBeVisible({ timeout: 10_000 })
    await page.locator('button').filter({ hasText: 'SC Render 6' }).click()
    await expect(page.getByText('Active Session')).toBeVisible({ timeout: 10_000 })

    const supersetSection = page.locator('[aria-labelledby="group-hd-A"]')
    await expect(supersetSection).toBeVisible({ timeout: 10_000 })

    // Footer should contain rest timing (e.g. "Xs between" or "Ys after round")
    const footer = supersetSection.locator('footer')
    await expect(footer).toBeVisible()
    await expect(footer.getByText(/between|after round/i).first()).toBeVisible()
  })
})

// ---------------------------------------------------------------------------
// Active workout — SupersetCard interaction
// ---------------------------------------------------------------------------

test.describe('Active workout — SupersetCard interaction', () => {
  test('clicking "+ Set" for exercise A opens log set dialog', async ({ page }) => {
    await createSupersetTemplate(page, 'SC Interact 1')

    await expect(page.getByText('SC Interact 1')).toBeVisible({ timeout: 10_000 })
    await page.locator('button').filter({ hasText: 'SC Interact 1' }).click()
    await expect(page.getByText('Active Session')).toBeVisible({ timeout: 10_000 })

    const supersetSection = page.locator('[aria-labelledby="group-hd-A"]')
    await expect(supersetSection).toBeVisible({ timeout: 10_000 })

    // Click the first "+ Set" button (Bench Press)
    await supersetSection.getByRole('button', { name: /log set for bench press/i }).click()

    // A dialog / sheet for logging should open
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 })
  })

  test('after logging a set for exercise A, set chip appears in the card', async ({ page }) => {
    await createSupersetTemplate(page, 'SC Interact 2')

    await expect(page.getByText('SC Interact 2')).toBeVisible({ timeout: 10_000 })
    await page.locator('button').filter({ hasText: 'SC Interact 2' }).click()
    await expect(page.getByText('Active Session')).toBeVisible({ timeout: 10_000 })

    const supersetSection = page.locator('[aria-labelledby="group-hd-A"]')
    await expect(supersetSection).toBeVisible({ timeout: 10_000 })

    // Open log set dialog for Bench Press
    await supersetSection.getByRole('button', { name: /log set for bench press/i }).click()
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 })

    // Fill in weight and reps
    const dialog = page.getByRole('dialog')
    const weightInput = dialog.getByRole('spinbutton').first()
    const repsInput = dialog.getByRole('spinbutton').nth(1)
    await weightInput.fill('80')
    await repsInput.fill('8')

    // Submit / save the set
    await dialog.getByRole('button', { name: /log|save|add set/i }).click()

    // Skip rest timer if it appears
    const skipBtn = page.getByRole('button', { name: /skip/i })
    if (await skipBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await skipBtn.click()
    }

    // A chip showing "80kg × 8" should appear in the superset section
    await expect(supersetSection.getByText(/80.*×.*8|80kg.*8/i)).toBeVisible({
      timeout: 5_000,
    })
  })

  test('after logging sets for both exercises, round counter "1× done" appears', async ({
    page,
  }) => {
    await createSupersetTemplate(page, 'SC Interact 3')

    await expect(page.getByText('SC Interact 3')).toBeVisible({ timeout: 10_000 })
    await page.locator('button').filter({ hasText: 'SC Interact 3' }).click()
    await expect(page.getByText('Active Session')).toBeVisible({ timeout: 10_000 })

    const supersetSection = page.locator('[aria-labelledby="group-hd-A"]')
    await expect(supersetSection).toBeVisible({ timeout: 10_000 })

    // Log a set for Bench Press
    await supersetSection.getByRole('button', { name: /log set for bench press/i }).click()
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 })
    const dialog1 = page.getByRole('dialog')
    await dialog1.getByRole('spinbutton').first().fill('80')
    await dialog1.getByRole('spinbutton').nth(1).fill('8')
    await dialog1.getByRole('button', { name: /log|save|add set/i }).click()

    const skipBtn1 = page.getByRole('button', { name: /skip/i })
    if (await skipBtn1.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await skipBtn1.click()
    }

    // Log a set for the second exercise (Barbell Row)
    const logBtns = supersetSection.getByRole('button', { name: /log set for/i })
    await logBtns.nth(1).click()
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 })
    const dialog2 = page.getByRole('dialog')
    await dialog2.getByRole('spinbutton').first().fill('70')
    await dialog2.getByRole('spinbutton').nth(1).fill('8')
    await dialog2.getByRole('button', { name: /log|save|add set/i }).click()

    const skipBtn2 = page.getByRole('button', { name: /skip/i })
    if (await skipBtn2.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await skipBtn2.click()
    }

    // Round counter "1× done" should appear (aria-live region)
    await expect(supersetSection.getByText(/1×\s*done/i)).toBeVisible({ timeout: 5_000 })
  })

  test('round counter increments to "2× done" after second round', async ({ page }) => {
    await createSupersetTemplate(page, 'SC Interact 4')

    await expect(page.getByText('SC Interact 4')).toBeVisible({ timeout: 10_000 })
    await page.locator('button').filter({ hasText: 'SC Interact 4' }).click()
    await expect(page.getByText('Active Session')).toBeVisible({ timeout: 10_000 })

    const supersetSection = page.locator('[aria-labelledby="group-hd-A"]')
    await expect(supersetSection).toBeVisible({ timeout: 10_000 })

    // Helper to log a set in the open dialog
    async function logSet(weight: string, reps: string) {
      await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 })
      const dialog = page.getByRole('dialog')
      await dialog.getByRole('spinbutton').first().fill(weight)
      await dialog.getByRole('spinbutton').nth(1).fill(reps)
      await dialog.getByRole('button', { name: /log|save|add set/i }).click()
      const skipBtn = page.getByRole('button', { name: /skip/i })
      if (await skipBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await skipBtn.click()
      }
    }

    // Round 1
    await supersetSection.getByRole('button', { name: /log set for bench press/i }).click()
    await logSet('80', '8')

    await supersetSection
      .getByRole('button', { name: /log set for/i })
      .nth(1)
      .click()
    await logSet('70', '8')

    await expect(supersetSection.getByText(/1×\s*done/i)).toBeVisible({ timeout: 5_000 })

    // Round 2
    await supersetSection.getByRole('button', { name: /log set for bench press/i }).click()
    await logSet('80', '6')

    await supersetSection
      .getByRole('button', { name: /log set for/i })
      .nth(1)
      .click()
    await logSet('70', '6')

    await expect(supersetSection.getByText(/2×\s*done/i)).toBeVisible({ timeout: 5_000 })
  })
})

// ---------------------------------------------------------------------------
// Active workout — superset rest timer
// ---------------------------------------------------------------------------

test.describe('Active workout — superset rest timer', () => {
  test('rest timer appears after completing a full superset round', async ({ page }) => {
    await createSupersetTemplate(page, 'SC Rest 1')

    await expect(page.getByText('SC Rest 1')).toBeVisible({ timeout: 10_000 })
    await page.locator('button').filter({ hasText: 'SC Rest 1' }).click()
    await expect(page.getByText('Active Session')).toBeVisible({ timeout: 10_000 })

    const supersetSection = page.locator('[aria-labelledby="group-hd-A"]')
    await expect(supersetSection).toBeVisible({ timeout: 10_000 })

    // Log set for exercise A (no rest timer yet — transition_rest_sec = 0 for superset)
    await supersetSection.getByRole('button', { name: /log set for bench press/i }).click()
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 })
    let dialog = page.getByRole('dialog')
    await dialog.getByRole('spinbutton').first().fill('80')
    await dialog.getByRole('spinbutton').nth(1).fill('8')
    await dialog.getByRole('button', { name: /log|save|add set/i }).click()
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 3_000 })

    // Log set for exercise B to complete a round → triggers round rest (120s)
    await supersetSection
      .getByRole('button', { name: /log set for/i })
      .nth(1)
      .click()
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 })
    dialog = page.getByRole('dialog')
    await dialog.getByRole('spinbutton').first().fill('70')
    await dialog.getByRole('spinbutton').nth(1).fill('8')
    await dialog.getByRole('button', { name: /log|save|add set/i }).click()

    // Rest timer (WorkoutRestTimer) should appear with a skip button after full round
    await expect(page.getByRole('button', { name: /skip/i })).toBeVisible({ timeout: 5_000 })
  })

  test('skip button on rest timer dismisses it', async ({ page }) => {
    await createSupersetTemplate(page, 'SC Rest 2')

    await expect(page.getByText('SC Rest 2')).toBeVisible({ timeout: 10_000 })
    await page.locator('button').filter({ hasText: 'SC Rest 2' }).click()
    await expect(page.getByText('Active Session')).toBeVisible({ timeout: 10_000 })

    const supersetSection = page.locator('[aria-labelledby="group-hd-A"]')
    await expect(supersetSection).toBeVisible({ timeout: 10_000 })

    // Log set for exercise A
    await supersetSection.getByRole('button', { name: /log set for bench press/i }).click()
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 })
    let dialog = page.getByRole('dialog')
    await dialog.getByRole('spinbutton').first().fill('80')
    await dialog.getByRole('spinbutton').nth(1).fill('8')
    await dialog.getByRole('button', { name: /log|save|add set/i }).click()
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 3_000 })

    // Log set for exercise B to complete a round → triggers round rest
    await supersetSection
      .getByRole('button', { name: /log set for/i })
      .nth(1)
      .click()
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 })
    dialog = page.getByRole('dialog')
    await dialog.getByRole('spinbutton').first().fill('70')
    await dialog.getByRole('spinbutton').nth(1).fill('8')
    await dialog.getByRole('button', { name: /log|save|add set/i }).click()

    // Wait for rest timer skip button and click it
    const skipBtn = page.getByRole('button', { name: /skip/i })
    await expect(skipBtn).toBeVisible({ timeout: 5_000 })
    await skipBtn.click()

    // Rest timer should be gone
    await expect(skipBtn).not.toBeVisible({ timeout: 3_000 })
  })
})
