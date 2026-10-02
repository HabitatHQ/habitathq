import { expect, test } from '@playwright/test'

test.describe('data portability safety', () => {
  test('rejects unsupported backup versions without changing preferences', async ({ page }) => {
    const storedPreferences = JSON.stringify({ theme: 'forge', weightUnit: 'lbs' })
    await page.addInitScript(
      (value) => localStorage.setItem('hephaestus-app-settings', value),
      storedPreferences,
    )
    await page.goto('/profile')
    await expect(page.getByRole('heading', { name: 'Profile' })).toBeVisible()

    const fileInput = page.getByLabel('Choose backup file')
    await expect(fileInput).toHaveAttribute('type', 'file')
    await fileInput.setInputFiles({
      name: 'unsupported-backup-version.json',
      mimeType: 'application/json',
      buffer: Buffer.from(
        JSON.stringify({
          format: 'hephaestus-backup',
          version: 999,
          exportedAt: new Date().toISOString(),
          settings: {},
          tables: {},
        }),
      ),
    })

    const portability = page.getByRole('region', { name: 'Data portability' })
    await expect(portability.getByRole('alert')).toHaveCount(1)
    await expect(portability.getByRole('alert')).toContainText(/unsupported or malformed/i)
    await expect(page.getByRole('button', { name: 'Replace local data from backup' })).toHaveCount(
      0,
    )
    expect(await page.evaluate(() => localStorage.getItem('hephaestus-app-settings'))).toBe(
      storedPreferences,
    )
  })

  test('reset clears Hephaestus database while preserving sibling origin-private storage', async ({
    page,
  }) => {
    await page.goto('/profile')
    await expect(page.getByRole('heading', { name: 'Profile' })).toBeVisible()
    await page.evaluate(async () => {
      const root = await navigator.storage.getDirectory()
      const sibling = await root.getDirectoryHandle('sibling-app', { create: true })
      const file = await sibling.getFileHandle('sentinel.txt', { create: true })
      const writer = await file.createWritable()
      await writer.write('preserve sibling data')
      await writer.close()
    })

    page.once('dialog', (dialog) => dialog.accept())
    await page.getByRole('button', { name: 'Reset Hephaestus database' }).click()
    await expect(page.getByRole('status')).toContainText('Hephaestus application database cleared')

    expect(
      await page.evaluate(async () => {
        const root = await navigator.storage.getDirectory()
        const sibling = await root.getDirectoryHandle('sibling-app')
        const file = await sibling.getFileHandle('sentinel.txt')
        return (await file.getFile()).text()
      }),
    ).toBe('preserve sibling data')
  })
})
