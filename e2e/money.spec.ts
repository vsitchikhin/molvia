import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { signedIn } from './session'

test.use({ locale: 'ru-RU', reducedMotion: 'reduce' })

/**
 * «Деньги» end to end (MOL-82): a spending written on the screen goes through the queue, the
 * month the server counts takes it in, a removal comes back with «Вернуть» — and all of it with
 * no connection too. What no component test shows is that the screen, the queue and the server
 * agree.
 */

async function openMoney(page: Page): Promise<void> {
  await signedIn(page)
  await page.getByRole('link', { name: 'Деньги', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Деньги')
}

async function writeSpending(
  page: Page,
  amount: string,
  category: string,
  note?: string,
): Promise<void> {
  const sheet = page.locator('dialog[open]')
  await expect(sheet).toContainText('Новая трата')
  // The sheet takes no tap while it rises.
  await page.waitForTimeout(400)
  await sheet.getByLabel('Сумма').fill(amount)
  await sheet.getByRole('radio', { name: category }).check()
  if (note) await sheet.getByLabel(/Что это/).fill(note)
  await sheet.getByRole('button', { name: 'Сохранить трату' }).click()
  await expect(sheet).toBeHidden()
}

test('a spending lands in the month, and a removal comes back with «Вернуть»', async ({ page }) => {
  await openMoney(page)
  await expect(page.getByRole('heading', { name: 'Добавьте первую трату' })).toBeVisible()
  await page.getByRole('button', { name: 'Добавить трату' }).click()

  // Checked on «Сохранить», not under the finger: both errors, and nothing leaves.
  const sheet = page.locator('dialog[open]')
  await page.waitForTimeout(400)
  await sheet.getByRole('button', { name: 'Сохранить трату' }).click()
  await expect(sheet).toContainText('Введите сумму больше нуля')
  await expect(sheet).toContainText('Выберите категорию')
  await sheet.getByLabel('Сумма').fill('5000')
  await sheet.getByRole('radio', { name: 'Красота и гигиена' }).check()
  await sheet.getByLabel(/Что это/).fill('Барбер')
  await sheet.getByRole('button', { name: 'Сохранить трату' }).click()
  await expect(sheet).toBeHidden()

  // The server's figure on the card, and the row in today's day.
  await expect(page.locator('.spent .figure')).toHaveText(/5\s000\s֏/)
  const row = page.getByRole('button', { name: /Открыть трату: Барбер/ })
  await expect(row).toBeVisible()

  // Removed without a question; «Вернуть» brings the same spending back.
  await row.click()
  await page.waitForTimeout(400)
  await sheet.getByRole('button', { name: 'Удалить трату' }).click()
  await expect(sheet).toBeHidden()
  await expect(row).toBeHidden()
  // The only spending gone, the month read again is empty — a newcomer's screen — and «Вернуть»
  // still stands: a person reads the strip before reaching for it (adversarial Г).
  await expect(page.getByRole('heading', { name: 'Добавьте первую трату' })).toBeVisible()
  await page.waitForTimeout(1000)
  await page.getByRole('button', { name: 'Вернуть' }).click()
  await expect(row).toBeVisible()
  await expect(page.locator('.spent .figure')).toHaveText(/5\s000\s֏/)
  await expect(page.getByRole('button', { name: 'Трата', exact: true })).toBeVisible()
})

test('with no connection a spending waits on the phone, uncounted, and goes when it is back', async ({
  page,
  context,
}) => {
  await openMoney(page)
  await page.getByRole('button', { name: 'Добавить трату' }).click()
  await writeSpending(page, '160000', 'Аренда жилья')
  await expect(page.locator('.spent .figure')).toHaveText(/160\s000\s֏/)

  await context.setOffline(true)
  await page.getByRole('button', { name: 'Трата', exact: true }).click()
  await expect(page.locator('dialog[open]')).toContainText('Нет связи')
  await writeSpending(page, '1500', 'Транспорт', 'Такси')

  // A row «Отправляем…», a line on the card — and the total is still the server's (Р-3).
  await expect(page.getByRole('button', { name: /Открыть трату: Такси/ })).toContainText(
    'Отправляем…',
  )
  await expect(page.locator('.spent')).toContainText('Ещё не учтено: 1 трата отправляется')
  await expect(page.locator('.spent .figure')).toHaveText(/160\s000\s֏/)

  await context.setOffline(false)
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await expect(page.locator('.spent .figure')).toHaveText(/161\s500\s֏/)
  await expect(page.getByRole('button', { name: /Открыть трату: Такси/ })).not.toContainText(
    'Отправляем…',
  )
})

test('a spending saved while another month is looked at brings the screen to its own month', async ({
  page,
}) => {
  await openMoney(page)
  await page.getByRole('button', { name: 'Добавить трату' }).click()
  await writeSpending(page, '5000', 'Красота и гигиена', 'Барбер')
  await page.getByRole('button', { name: 'Предыдущий месяц' }).click()
  await expect(page).toHaveURL(/month=\d{4}-\d{2}/)

  await page.getByRole('button', { name: 'Трата', exact: true }).click()
  await writeSpending(page, '1500', 'Транспорт', 'Такси')
  // Today's spending: the screen comes back to this month and shows it (adversarial И).
  await expect(page).not.toHaveURL(/month=/)
  await expect(page.getByRole('button', { name: /Открыть трату: Такси/ })).toBeVisible()
})

test('changing the month writes nothing into the history', async ({ page }) => {
  await openMoney(page)
  const before = await page.evaluate(() => window.history.length)
  await page.getByRole('button', { name: 'Предыдущий месяц' }).click()
  await expect(page).toHaveURL(/month=\d{4}-\d{2}/)
  expect(await page.evaluate(() => window.history.length)).toBe(before)
})

test('a category of one’s own is made from the sheet, and a preset’s name is refused', async ({
  page,
}) => {
  await openMoney(page)
  await page.getByRole('button', { name: 'Добавить трату' }).click()
  const sheet = page.locator('dialog[open]')
  await page.waitForTimeout(400)
  await sheet.getByLabel('Сумма').fill('2000')
  await sheet.getByRole('button', { name: 'Своя' }).click()

  const named = page.locator('dialog[open]').last()
  await expect(named).toContainText('Новая категория')
  await page.waitForTimeout(400)
  await named.getByLabel('Название').fill('Продукты')
  await named.getByRole('button', { name: 'Добавить' }).click()
  await expect(named).toContainText('Такая категория уже есть')
  await named.getByLabel('Название').fill('Такси')
  await named.getByRole('button', { name: 'Добавить' }).click()

  // Chosen as soon as it exists (В-1).
  await expect(sheet.getByRole('radio', { name: 'Такси' })).toBeChecked()
  await sheet.getByRole('button', { name: 'Сохранить трату' }).click()
  await expect(sheet).toBeHidden()
  await expect(page.getByRole('button', { name: /Открыть трату: Такси/ })).toBeVisible()

  await page.getByRole('link', { name: 'Категории' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Категории')
  await expect(page.getByText('Такси')).toBeVisible()
  await page.getByRole('button', { name: 'Убрать категорию «Такси»' }).click()
  await expect(page.getByRole('heading', { name: 'Убранные' })).toBeVisible()
  await page.getByRole('button', { name: 'Вернуть категорию «Такси»' }).click()
  await expect(page.getByRole('heading', { name: 'Убранные' })).toBeHidden()
})

async function fitsNarrowPhone(page: Page, money: string): Promise<void> {
  await page.setViewportSize({ width: 320, height: 640 })
  await signedIn(page)
  await page.getByRole('link', { name: money, exact: true }).click()
  const labels = page.locator('.tabbar .label')
  await expect(labels).toHaveCount(5)
  for (const label of await labels.all()) {
    const box = await label.boundingBox()
    const tab = await label.locator('xpath=..').boundingBox()
    // One line of an 11 px caption: «Настройки» and «What to buy» on 64 px columns — and inside
    // its own column, not spilling into the next.
    expect(box?.height ?? 0).toBeLessThan(20)
    expect(box?.x ?? -1).toBeGreaterThanOrEqual(tab?.x ?? 0)
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual((tab?.x ?? 0) + (tab?.width ?? 0))
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320)
}

test('five tabs fit a 320 px phone, one line each', async ({ page }) => {
  await fitsNarrowPhone(page, 'Деньги')
})

test.describe('in English', () => {
  test.use({ locale: 'en-US' })

  test('five tabs fit a 320 px phone, one line each', async ({ page }) => {
    await fitsNarrowPhone(page, 'Money')
  })
})
