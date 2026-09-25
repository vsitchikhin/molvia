import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { actorCodec, settingsOf } from '@molvia/model'
import { asBrowser, signedIn } from './session'

test.use({ locale: 'ru-RU', reducedMotion: 'reduce' })

/**
 * «Обмен денег» end to end (MOL-40): an exchange recorded on the screen becomes the rate of the
 * next trip the server starts, and «по курсу ЦБ РА» takes it back out. What no component test
 * shows is that the screen, the wallet the server works out and the snapshot of a trip agree.
 */
test('an exchange becomes the rate of the next trip, and the preference takes it back', async ({
  page,
}) => {
  await signedIn(page)
  await page.getByRole('link', { name: 'Настройки', exact: true }).click()
  await page.getByRole('link', { name: 'Обмен денег' }).click()

  // The state by its heading: its words are said out loud too (MOL-64).
  await expect(page.getByRole('heading', { name: 'Обменов пока нет' })).toBeVisible()
  await page.getByRole('button', { name: 'Записать обмен' }).click()

  const sheet = page.locator('dialog[open]')
  await expect(sheet).toContainText('Сколько отдали и сколько получили')
  // The sheet takes no tap while it rises.
  await page.waitForTimeout(400)
  await sheet.getByLabel('Отдал').fill('20000')
  await sheet.getByLabel('Получил').fill('95000')
  await sheet.getByRole('button', { name: 'Сохранить обмен' }).click()
  await expect(sheet).toBeHidden()

  await expect(page.locator('.figure')).toHaveText('4,75 ֏/₽')
  await expect(page.getByText(/по последнему обмену/)).toBeVisible()

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
  expect(await started.json()).toMatchObject({
    rate: { base: 'RUB', quote: 'AMD', rate: '4.750000', source: 'personal' },
    rateProvider: null,
  })

  // «По курсу ЦБ РА», and it holds after a reload — it is the server's, not the screen's.
  const saved = page.waitForResponse((response) => response.url().endsWith('/rate-preference'))
  await page.getByText('по курсу ЦБ РА', { exact: true }).click()
  expect((await saved).status()).toBe(200)
  await page.reload()
  await expect(page.getByRole('radio', { name: 'по курсу ЦБ РА' })).toBeChecked()
})

/**
 * A chain (MOL-42): roubles to dollars, dollars to drams. The price of the dollars travels into
 * the drams, the screen shows the dollars at their own price, and the next trip takes the drams'.
 */
test('roubles to dollars to drams: the chain is the rate of the next trip', async ({ page }) => {
  await signedIn(page)
  await page.getByRole('link', { name: 'Настройки', exact: true }).click()
  await page.getByRole('link', { name: 'Обмен денег' }).click()
  await expect(page.getByRole('heading', { name: 'Обменов пока нет' })).toBeVisible()

  const sheet = page.locator('dialog[open]')
  async function record(given: string, from: string, received: string, to: string) {
    await page.getByRole('button', { name: 'Записать обмен' }).click()
    await expect(sheet).toContainText('Сколько отдали и сколько получили')
    await page.waitForTimeout(400)
    const currencies = sheet.getByLabel('Валюта')
    await currencies.nth(0).selectOption(from)
    await currencies.nth(1).selectOption(to)
    await sheet.getByLabel('Отдал').fill(given)
    await sheet.getByLabel('Получил').fill(received)
    await sheet.getByRole('button', { name: 'Сохранить обмен' }).click()
    await expect(sheet).toBeHidden()
  }

  await record('20000', 'RUB', '224,63', 'USD')
  await record('100', 'USD', '36150', 'AMD')

  await expect(page.locator('.figure')).toHaveText('4,06 ֏/₽')
  await expect(page.locator('.costs li')).toHaveText(/^\$: 89,04 ₽\/\$ · по последнему обмену/)

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
  expect(await started.json()).toMatchObject({
    rate: { base: 'RUB', quote: 'AMD', rate: '4.060187', source: 'personal' },
  })
})

/**
 * An amendment (MOL-42, В-3): a tap on the row opens it, the rate follows the new amounts, and the
 * row says it was amended, with the version before it one tap away.
 */
test('an amended exchange changes the rate and keeps what it said before', async ({ page }) => {
  await signedIn(page)
  await page.getByRole('link', { name: 'Настройки', exact: true }).click()
  await page.getByRole('link', { name: 'Обмен денег' }).click()
  await page.getByRole('button', { name: 'Записать обмен' }).click()

  const sheet = page.locator('dialog[open]')
  await page.waitForTimeout(400)
  await sheet.getByLabel('Отдал').fill('20000')
  await sheet.getByLabel('Получил').fill('100000')
  await sheet.getByRole('button', { name: 'Сохранить обмен' }).click()
  await expect(sheet).toBeHidden()
  await expect(page.locator('.figure')).toHaveText('5,00 ֏/₽')

  await page.getByRole('button', { name: /^Исправить обмен/ }).click()
  await expect(sheet).toContainText('Правка обмена')
  await page.waitForTimeout(400)
  await sheet.getByLabel('Получил').fill('95000')
  await sheet.getByLabel('Где и заметка').fill('ВТБ банкомат')
  await sheet.getByRole('button', { name: 'Сохранить правку' }).click()
  await expect(sheet).toBeHidden()

  await expect(page.locator('.figure')).toHaveText('4,75 ֏/₽')
  await expect(page.locator('.amended')).toContainText('исправлен')
  await expect(page.locator('.note')).toHaveText('ВТБ банкомат')

  await page.getByRole('button', { name: /^Исправить обмен/ }).click()
  await expect(sheet.locator('.versions')).toContainText('100 000,00')
})
