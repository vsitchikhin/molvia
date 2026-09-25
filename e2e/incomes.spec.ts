import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { actorCodec, settingsOf } from '@molvia/model'
import { asBrowser, signedIn } from './session'

test.use({ locale: 'ru-RU', reducedMotion: 'reduce' })

/**
 * «Доходы» end to end (MOL-66): an income written on the screen lands in its month with the sum
 * the server worked out, an amendment keeps the version before it, and a removal can be taken
 * back — what no component test shows is that the screen and the server agree on all three.
 */
test('an income lands in its month, is amended with a trace, and comes back after removal', async ({
  page,
}) => {
  await signedIn(page)
  await page.getByRole('link', { name: 'Настройки', exact: true }).click()
  await page.getByRole('link', { name: 'Доходы' }).click()

  await expect(page.getByRole('heading', { name: 'Доходов пока нет' })).toBeVisible()
  await page.getByRole('button', { name: 'Записать доход' }).click()

  const sheet = page.locator('dialog[open]')
  await expect(sheet).toContainText('Сколько и когда пришло')
  // The sheet takes no tap while it rises.
  await page.waitForTimeout(400)
  await sheet.getByLabel('Сумма').fill('99615')
  // Without a source nothing is sent (В-3).
  await sheet.getByRole('button', { name: 'Сохранить доход' }).click()
  await expect(sheet).toContainText('Выберите, откуда пришли деньги')
  await sheet.getByLabel('Откуда').selectOption('salary')
  await sheet.getByLabel('Заметка').fill('Викаса')
  await sheet.getByRole('button', { name: 'Сохранить доход' }).click()
  await expect(sheet).toBeHidden()

  // The month and its sum, by the heading — the server's figure, not the phone's.
  await expect(page.getByRole('heading', { name: /\d{4} 99 615,00 ₽/ })).toBeVisible()
  const row = page.locator('button.body')
  await expect(row).toContainText('Зарплата')
  await expect(row).toContainText('Викаса')

  // An amendment: the row opens it, the sum moves, the row says so, the old version stays.
  await row.click()
  await expect(sheet).toContainText('Правка дохода')
  await page.waitForTimeout(400)
  await sheet.getByLabel('Сумма').fill('102345')
  await sheet.getByRole('button', { name: 'Сохранить правку' }).click()
  await expect(sheet).toBeHidden()
  await expect(page.getByRole('heading', { name: /\d{4} 102 345,00 ₽/ })).toBeVisible()
  await expect(row).toContainText('исправлен')
  await row.click()
  await expect(sheet.locator('.versions')).toContainText('99 615,00 ₽')
  await page.keyboard.press('Escape')
  await expect(sheet).toBeHidden()

  // Removal asks first, and «Вернуть» brings the same income back.
  await page.getByRole('button', { name: /Удалить доход/ }).click()
  await expect(sheet).toContainText('Удалить доход?')
  await page.waitForTimeout(400)
  await sheet.getByRole('button', { name: 'Удалить доход' }).click()
  await expect(page.getByRole('heading', { name: 'Доходов пока нет' })).toBeVisible()
  await page.getByRole('button', { name: 'Вернуть' }).click()
  await expect(page.getByRole('heading', { name: /\d{4} 102 345,00 ₽/ })).toBeVisible()
  await expect(row).toContainText('исправлен')
})

/**
 * An income moves the wallet (MOL-66, В-1): drams that came in are valued at the central bank of
 * their day, and a run has no cached rates — so the cost of the drams becomes unknown, «Обмен
 * денег» names the income it was lost on, and the next trip takes no rate of the person's own.
 * The number the bank gives is pinned by the integration tests, where the cache can be filled.
 */
test('drams that came in with no rate of their day make the wallet unknown, and say so', async ({
  page,
}) => {
  await signedIn(page)
  await page.getByRole('link', { name: 'Настройки', exact: true }).click()
  await page.getByRole('link', { name: 'Обмен денег' }).click()

  const sheet = page.locator('dialog[open]')
  await page.getByRole('button', { name: 'Записать обмен' }).click()
  await page.waitForTimeout(400)
  await sheet.getByLabel('Отдал').fill('20000')
  await sheet.getByLabel('Получил').fill('95000')
  await sheet.getByRole('button', { name: 'Сохранить обмен' }).click()
  await expect(sheet).toBeHidden()
  await expect(page.locator('.figure')).toHaveText('4,75 ֏/₽')

  await page.goBack()
  await page.getByRole('link', { name: 'Доходы' }).click()
  await page.getByRole('button', { name: 'Записать доход' }).click()
  await page.waitForTimeout(400)
  await sheet.getByLabel('Сумма').fill('200000')
  await sheet.getByLabel('Валюта').selectOption('AMD')
  await expect(sheet).toContainText('Купили эти деньги за ₽?')
  await sheet.getByLabel('Откуда').selectOption('freelance')
  await sheet.getByRole('button', { name: 'Сохранить доход' }).click()
  await expect(sheet).toBeHidden()

  await page.goBack()
  await page.getByRole('link', { name: 'Обмен денег' }).click()
  await expect(page.getByText(/Курс неизвестен: поступление ֏ от/)).toBeVisible()

  const headers = await asBrowser(page)
  const me = actorCodec.parse(await (await page.request.get('/api/actors/me', { headers })).json())
  const started = await page.request.post('/api/trips', {
    headers,
    data: {
      id: randomUUID(),
      context: settingsOf(me),
      place: { kind: 'store', name: 'Ереван Сити' },
    },
  })
  expect(started.status()).toBe(201)
  // No rate of the person's own, and no cached official rate either.
  expect(await started.json()).toMatchObject({ rate: null })
})
