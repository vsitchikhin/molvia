import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

/**
 * Opens «Дата, заметка, место» from its line in the spending sheet (MOL-199), as a tap does, and
 * gives the sheet over it — after its rise, which takes no tap.
 */
export async function openDetails(page: Page): Promise<Locator> {
  const spending = page.locator('dialog[open]').last()
  await spending.getByRole('button', { name: /^Дата, заметка, место:/ }).click()
  const details = page.locator('dialog[open]').last()
  await expect(details).toContainText('Дата, заметка, место')
  await page.waitForTimeout(400)
  return details
}

/**
 * Types the note and the place behind the line, as a person does, and goes back with «Готово»: the
 * spending sheet is the one open again, its line saying what was typed.
 */
export async function fillDetails(
  page: Page,
  typed: { readonly note?: string; readonly place?: string },
): Promise<void> {
  const open = await page.locator('dialog[open]').count()
  const details = await openDetails(page)
  if (typed.note !== undefined) await details.getByLabel(/Что это/).fill(typed.note)
  if (typed.place !== undefined) await details.getByLabel(/Где/).fill(typed.place)
  await details.getByRole('button', { name: 'Готово' }).click()
  await expect(page.locator('dialog[open]')).toHaveCount(open)
}
