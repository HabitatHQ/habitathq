import { expect, test } from '@playwright/test'
import { activityEditor, authorStrengthTemplate, setEditor } from './domain-helpers'

test.describe('template prescription authoring and persistence', () => {
  test('authors ordered exact and range targets and starts once with captured intent', async ({
    page,
  }) => {
    await authorStrengthTemplate(page, {
      name: 'E2E Mixed Prescription',
      sets: [
        { kind: 'exact', reps: 6, weightKg: 80 },
        { kind: 'range', minimum: 8, maximum: 12, weightKg: 60 },
      ],
    })

    await page.getByRole('link', { name: 'Edit template' }).click()
    const activity = activityEditor(page, 'Barbell Squat')
    const exactSet = setEditor(activity, 1)
    const rangeSet = setEditor(activity, 2)
    await expect(exactSet.getByLabel('Load (kg) fixed value')).toHaveValue('80')
    await expect(exactSet.getByLabel('Reps fixed value')).toHaveValue('6')
    await expect(rangeSet.getByLabel('Load (kg) fixed value')).toHaveValue('60')
    await expect(rangeSet.getByLabel('Minimum', { exact: true })).toHaveValue('8')
    await expect(rangeSet.getByLabel('Maximum', { exact: true })).toHaveValue('12')
    await page.getByRole('link', { name: 'Cancel' }).click()

    await page.goto('/workout')
    await page.getByRole('button', { name: /E2E Mixed Prescription/i }).click()
    await expect(page.getByRole('heading', { name: 'Start once' })).toBeVisible()
    await page.getByRole('button', { name: 'Start workout', exact: true }).click()
    await expect(page.getByRole('region', { name: 'Barbell Squat' })).toBeVisible()
    const exercise = page.getByRole('region', { name: 'Barbell Squat' })
    await expect(exercise.getByLabel('Weight (kg) for set 1')).toHaveValue('80')
    await expect(exercise.getByLabel('Reps for set 1')).toHaveValue('6')
    await exercise
      .getByRole('button', { name: 'Edit set 2 for Barbell Squat', exact: true })
      .last()
      .click()
    await expect(exercise.getByLabel('Weight (kg) for set 2')).toHaveValue('60')
    await expect(exercise.getByLabel('Reps for set 2')).toHaveValue('')
  })

  test('creates a named template and retains prescription values after navigating away and back', async ({
    page,
  }) => {
    await authorStrengthTemplate(page, {
      name: 'E2E Persistence',
      exercise: 'Bench Press',
      sets: [{ kind: 'exact', reps: 5, weightKg: 75 }],
    })
    await page.goto('/templates')
    await page.getByRole('link', { name: /^E2E Persistence\b/ }).click()
    await expect(page.getByRole('heading', { name: '1. Bench Press', exact: true })).toBeVisible()
    await page.getByRole('link', { name: 'Edit template' }).click()
    const activity = activityEditor(page, 'Bench Press')
    await expect(setEditor(activity, 1).getByLabel('Reps fixed value')).toHaveValue('5')
    await expect(setEditor(activity, 1).getByLabel('Load (kg) fixed value')).toHaveValue('75')
  })
})
