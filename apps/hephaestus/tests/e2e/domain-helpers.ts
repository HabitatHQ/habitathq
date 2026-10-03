import { expect, type Locator, type Page } from '@playwright/test'

export type SetPrescription =
  | { kind: 'exact'; reps: number; weightKg?: number }
  | { kind: 'range'; minimum: number; maximum: number; weightKg?: number }

export function activityEditor(page: Page, exerciseName: string, occurrence = 0): Locator {
  const activities = page
    .getByRole('heading', { name: 'Activities and ordered sets', exact: true })
    .locator('..')
    .locator('..')
  return activities
    .getByRole('article')
    .filter({ has: page.getByRole('heading', { name: exerciseName, level: 3, exact: true }) })
    .nth(occurrence)
}

export function setEditor(activity: Locator, order: number): Locator {
  return activity.getByText(`Set ${order}`, { exact: true }).locator('..').locator('..')
}

async function addActivity(page: Page, exerciseName: string, occurrence = 0): Promise<Locator> {
  await selectOptionControl(page.getByLabel('Add activity'), exerciseName)
  const activity = activityEditor(page, exerciseName, occurrence)
  await expect(activity).toBeVisible()
  return activity
}

async function configureSet(set: Locator, prescription: SetPrescription): Promise<void> {
  await selectOptionControl(
    set.getByRole('combobox', { name: 'Reps', exact: true }),
    prescription.kind,
  )
  if (prescription.kind === 'exact') {
    await selectOptionControl(set.getByLabel('Exact reps target mode'), 'Fixed')
    await set.getByLabel('Exact reps fixed value').fill(String(prescription.reps))
  } else {
    await set.getByLabel('Minimum', { exact: true }).fill(String(prescription.minimum))
    await set.getByLabel('Maximum', { exact: true }).fill(String(prescription.maximum))
  }
  if (prescription.weightKg !== undefined) {
    await selectOptionControl(set.getByLabel('Load (kg) target mode'), 'Fixed')
    await set.getByLabel('Load (kg) fixed value').fill(String(prescription.weightKg))
  }
}

export async function authorStrengthTemplate(
  page: Page,
  options: {
    name: string
    exercise?: string
    sets?: SetPrescription[]
    description?: string
  },
): Promise<string> {
  const exerciseName = options.exercise ?? 'Barbell Squat'
  const prescriptions: SetPrescription[] = options.sets ?? [
    { kind: 'exact', reps: 5, weightKg: 100 },
  ]
  if (prescriptions.length === 0) throw new Error('A strength template needs at least one set')

  await page.goto('/templates/new')
  await expect(page.getByRole('heading', { name: 'Create template' })).toBeVisible()
  await page.getByLabel('Name', { exact: true }).fill(options.name)
  if (options.description) await page.getByLabel('Description').fill(options.description)
  const activity = await addActivity(page, exerciseName)
  for (let index = 1; index < prescriptions.length; index += 1) {
    await activity.getByRole('button', { name: 'Add set', exact: true }).click()
  }
  for (const [index, prescription] of prescriptions.entries()) {
    await configureSet(setEditor(activity, index + 1), prescription)
  }

  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page).toHaveURL(/\/templates\/[^/]+$/)
  return page.url()
}

export async function authorGroupedTemplate(
  page: Page,
  options: {
    name: string
    groupType: 'superset' | 'giant_set' | 'circuit' | 'pre_exhaust'
    exercises?: [string, string]
  },
): Promise<void> {
  const exercises = options.exercises ?? ['Bench Press', 'Barbell Row']
  await page.goto('/templates/new')
  await expect(page.getByRole('heading', { name: 'Create template' })).toBeVisible()
  await page.getByLabel('Name', { exact: true }).fill(options.name)
  await addActivity(page, exercises[0])
  await addActivity(page, exercises[1])

  const groups = page
    .getByRole('heading', { name: 'Execution groups', exact: true })
    .locator('..')
    .locator('..')
  await groups.getByRole('button', { name: 'Add group' }).click()
  await selectOptionControl(groups.getByLabel('Group type'), options.groupType)
  for (const exercise of exercises) {
    await selectOptionControl(
      activityEditor(page, exercise).getByLabel('Execution group'),
      `A · ${options.groupType}`,
    )
  }
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page).toHaveURL(/\/templates\/[^/]+$/)
}

export async function configureRoutine(
  page: Page,
  options: {
    name: string
    templateName: string
    continuation?: 'calendar_bound' | 'carry_forward'
    deferral?: 'automatic' | 'manual'
  },
): Promise<void> {
  await page.goto('/routines/new')
  await expect(page.getByRole('heading', { name: 'Configure routine' })).toBeVisible()
  await page.getByLabel('Routine name').fill(options.name)
  await page.getByLabel('Template').selectOption({ label: options.templateName })
  await expect(
    page.getByRole('heading', { name: new RegExp(`${options.templateName} · revision`) }),
  ).toBeVisible()
  await selectLabeledOption(
    page,
    'Continuation policy',
    options.continuation === 'carry_forward' ? 'Carry forward' : 'Calendar-bound',
  )
  if (options.continuation === 'carry_forward') {
    await selectLabeledOption(
      page,
      'Deferral mode',
      options.deferral === 'manual' ? 'Manual deferral' : 'Automatic deferral',
    )
  }
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page).toHaveURL('/routines')
  await expect(page.getByRole('link', { name: options.name, exact: true })).toBeVisible()
}

export async function startTemplate(page: Page, templateName: string): Promise<void> {
  await page.goto('/workout')
  const template = page.getByRole('button', { name: new RegExp(templateName, 'i') })
  await expect(template).toBeVisible()
  await template.click()
  await expect(page.getByRole('heading', { name: 'Start once' })).toBeVisible()
  await page.getByRole('button', { name: 'Start workout', exact: true }).click()
  await expect(page.getByText('Active Session', { exact: true })).toBeVisible({ timeout: 10_000 })
}

export async function startRoutine(page: Page, routineName: string): Promise<void> {
  await page.goto('/routines')
  await page.getByRole('link', { name: routineName, exact: true }).click()
  await expect(page.getByRole('heading', { name: routineName, exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Start this routine' }).click()
  await expect(page.getByText('Active Session', { exact: true })).toBeVisible({ timeout: 10_000 })
}

export function localDate(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

type ControlScope = Page | Locator

export async function selectLabeledOption(
  scope: ControlScope,
  label: string,
  option: string,
): Promise<void> {
  const control = scope.getByRole('combobox', { name: label, exact: true })
  await selectOptionControl(control, option)
}

async function selectOptionControl(control: Locator, option: string): Promise<void> {
  const escaped = option.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const optionName = new RegExp(`^${escaped}(?: · .*)?$`, 'i')
  if ((await control.evaluate((element) => element.tagName)) === 'SELECT') {
    const selectedOption = control.getByRole('option', { name: optionName })
    const value = await selectedOption.getAttribute('value')
    if (value === null) throw new Error(`Option "${option}" has no selectable value`)
    await control.selectOption(value)
    return
  }

  const page = control.page()
  await control.click()
  await page.getByRole('listbox').getByRole('option', { name: optionName }).click()
}

export async function fillLabeledDate(
  scope: ControlScope,
  label: string,
  date: string,
): Promise<void> {
  const control = scope.getByLabel(label, { exact: true })
  if ((await control.getAttribute('type')) === 'date') {
    await control.fill(date)
    return
  }

  const [year, month, day] = date.split('-')
  if (!year || !month || !day) throw new Error(`Expected an ISO local date, received "${date}"`)
  await control.getByRole('spinbutton', { name: /month/i }).fill(String(Number(month)))
  await control.getByRole('spinbutton', { name: /day/i }).fill(String(Number(day)))
  await control.getByRole('spinbutton', { name: /year/i }).fill(year)
}
