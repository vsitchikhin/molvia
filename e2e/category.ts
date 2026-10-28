import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

/**
 * Chooses a spending's category as a person does (MOL-198): its chip where the two rows hold it, else
 * through «Ещё…» — the list over the sheet, which a choice closes. Which categories the rows hold is the
 * phone's width and the person's frequency, so a spec names the category and not the way to it.
 */
export async function chooseCategory(page: Page, name: string): Promise<void> {
  const sheet = page.locator('dialog[open]').last()
  const chip = sheet.locator('.chips').getByRole('radio', { name, exact: true })
  if ((await chip.count()) > 0) {
    await chip.check()
    return
  }
  await sheet.getByRole('button', { name: 'Ещё…' }).click()
  const list = page.locator('dialog[open]').last()
  await expect(list).toContainText('Категория')
  // The list takes no tap while it rises.
  await page.waitForTimeout(400)
  await list.getByRole('radio', { name, exact: true }).click()
  await expect(page.locator('dialog[open]')).toHaveCount(1)
  await expect(sheet.locator('.chips').getByRole('radio', { name, exact: true })).toBeChecked()
}
