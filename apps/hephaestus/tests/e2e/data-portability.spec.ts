import { expect, test } from '@playwright/test'
import { activityEditor, authorStrengthTemplate, setEditor } from './domain-helpers'

test.describe('data portability safety', () => {
  test('reimports an exported prescription through Profile and restores consumer-visible values', async ({
    page,
  }) => {
    await authorStrengthTemplate(page, {
      name: 'E2E Portable Prescription',
      sets: [
        { kind: 'exact', reps: 5, weightKg: 105 },
        { kind: 'range', minimum: 8, maximum: 10, weightKg: 75 },
      ],
    })

    await page.goto('/profile')
    const portableDownload = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Export training configuration' }).click()
    const download = await portableDownload
    const stream = await download.createReadStream()
    if (!stream) throw new Error('Portable export did not provide a readable download stream')
    const chunks: Buffer[] = []
    for await (const chunk of stream) chunks.push(Buffer.from(chunk))
    const payload = Buffer.concat(chunks)

    const importFile = page.getByLabel('Choose training configuration file')
    const importAndConfirm = async () => {
      await importFile.setInputFiles({
        name: 'hephaestus-training-portable.json',
        mimeType: 'application/json',
        buffer: payload,
      })
      await page.getByRole('button', { name: 'Import without overwriting' }).click()
      const confirmation = page.getByRole('alertdialog', { name: /import training configuration/i })
      await confirmation.getByRole('button', { name: 'Import' }).click()
      await expect(page.getByRole('button', { name: 'Import without overwriting' })).toBeHidden()
    }

    await importAndConfirm()
    await importAndConfirm()
    await page.goto('/templates')
    const templates = page.getByRole('link', { name: /^E2E Portable Prescription\b/ })
    await expect(templates).toHaveCount(3)
    await templates.nth(2).click()
    await page.getByRole('link', { name: 'Edit template' }).click()
    const activity = activityEditor(page, 'Barbell Squat')
    const exactSet = setEditor(activity, 1)
    const rangeSet = setEditor(activity, 2)
    await expect(exactSet).toBeVisible()
    await expect(exactSet.getByLabel('Exact reps fixed value')).toHaveValue('5')
    await expect(exactSet.getByLabel('Load (kg) fixed value')).toHaveValue('105')
    await expect(rangeSet.getByLabel('Minimum', { exact: true })).toHaveValue('8')
    await expect(rangeSet.getByLabel('Maximum', { exact: true })).toHaveValue('10')
    await expect(rangeSet.getByLabel('Load (kg) fixed value')).toHaveValue('75')
  })
})
