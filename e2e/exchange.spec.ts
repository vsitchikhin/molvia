import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
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
  await page.getByRole('link', { name: 'Деньги', exact: true }).click()
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
  await page.getByRole('link', { name: 'Деньги', exact: true }).click()
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
  await expect(page.locator('.costs li')).toHaveText(/^89,04 ₽\/\$ · по последнему обмену/)

  // The rate is «большее за меньшее» (MOL-81): the exchange of roubles for dollars says «89,04 ₽/$»,
  // never «0,011232 $/₽», and the very number the price of the dollar says above it.
  const roubles = page.locator('article').filter({ hasText: '224,63 $' })
  await expect(roubles.locator('.plate .line').first()).toHaveText(/^Курс обмена\s*89,04 ₽\/\$$/)

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
  await page.getByRole('link', { name: 'Деньги', exact: true }).click()
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

/**
 * What on the cards wraps or runs over another part. A figure never wraps — its spaces do not break
 * — it runs out of its column, so the overflow of every part and the amounts against the arrow are
 * measured, not the height alone (review Т-2).
 */
function brokenCards(page: Page): Promise<string[]> {
  return page.locator('article').evaluateAll((cards) =>
    cards.flatMap((card) => {
      const found: string[] = []
      for (const part of card.querySelectorAll<HTMLElement>('.side, .plate .line')) {
        if (part.scrollWidth > part.clientWidth + 1) found.push(`overflow: ${part.textContent}`)
        const size = parseFloat(getComputedStyle(part).fontSize)
        const tall =
          part.classList.contains('line') && part.getBoundingClientRect().height > size * 2
        if (tall) found.push(`wraps: ${part.textContent}`)
      }
      const arrow = card.querySelector('.arrow')?.getBoundingClientRect()
      for (const amount of card.querySelectorAll('.amount')) {
        const box = amount.getBoundingClientRect()
        const overlaps =
          arrow &&
          arrow.width > 0 &&
          box.left < arrow.right &&
          arrow.left < box.right &&
          box.top < arrow.bottom &&
          arrow.top < box.bottom
        if (overlaps) found.push(`over the arrow: ${amount.textContent}`)
      }
      return found
    }),
  )
}

/**
 * The card of an exchange at a phone's widths (MOL-81): the largest amounts the owner's journal has
 * — six digits with kopecks against seven of drams — stand side by side on this phone, and one
 * under the other on a 320 px one, and nothing wraps or runs over the arrow (review Т-2).
 */
test('the card of an exchange holds long amounts on this phone and on a 320 px one', async ({
  page,
}) => {
  await signedIn(page)
  await page.getByRole('link', { name: 'Деньги', exact: true }).click()
  await page.getByRole('link', { name: 'Обмен денег' }).click()
  await page.getByRole('button', { name: 'Записать обмен' }).click()
  const sheet = page.locator('dialog[open]')
  await page.waitForTimeout(400)
  await sheet.getByLabel('Отдал').fill('123456,78')
  await sheet.getByLabel('Получил').fill('1000000')
  await sheet.getByRole('button', { name: 'Сохранить обмен' }).click()
  await expect(sheet).toBeHidden()
  await expect(page.locator('article .amount').first()).toHaveText('123 456,78 ₽')

  expect(await brokenCards(page)).toEqual([])
  await page.setViewportSize({ width: 320, height: 700 })
  expect(await brokenCards(page)).toEqual([])
})

/**
 * «Как меняли» (MOL-137, В-1): the channel goes with the exchange, the next one starts from it, and
 * an amendment keeps or clears it. The market it is measured against is not in an end-to-end run —
 * the refresh is off here and the cache stays empty — so the card keeps the central bank's line as
 * it was, not a step quieter; the market lines are held by the integration and component tests.
 */
test('how the money was changed goes with the exchange, and the next one starts from it', async ({
  page,
}) => {
  await signedIn(page)
  await page.getByRole('link', { name: 'Деньги', exact: true }).click()
  await page.getByRole('link', { name: 'Обмен денег' }).click()
  await expect(page.getByRole('heading', { name: 'Обменов пока нет' })).toBeVisible()

  const sheet = page.locator('dialog[open]')
  await page.getByRole('button', { name: 'Записать обмен' }).click()
  await expect(sheet).toContainText('Сколько отдали и сколько получили')
  await page.waitForTimeout(400)
  await expect(sheet.getByRole('radio', { name: 'Не указано' })).toBeChecked()
  await sheet.getByText('Обменник', { exact: true }).click()
  await sheet.getByLabel('Отдал').fill('20000')
  await sheet.getByLabel('Получил').fill('83200')
  await sheet.getByRole('button', { name: 'Сохранить обмен' }).click()
  await expect(sheet).toBeHidden()

  // No market in this run: nothing is drawn of it, and the central bank's line stands as before.
  await expect(page.locator('.market')).toHaveCount(0)
  await expect(page.locator('article .official')).not.toHaveClass(/quiet/)

  // The next exchange starts from the way the last one was made.
  await page.getByRole('button', { name: 'Записать обмен' }).click()
  await expect(sheet).toContainText('Сколько отдали и сколько получили')
  await page.waitForTimeout(400)
  await expect(sheet.getByRole('radio', { name: 'Обменник' })).toBeChecked()
  await page.keyboard.press('Escape')
  await expect(sheet).toBeHidden()

  // An amendment opens on the exchange's own channel, and «—» clears it for good.
  await page
    .locator('article')
    .getByRole('button', { name: /^Исправить обмен от/ })
    .click()
  await expect(sheet).toContainText('Правка обмена')
  await page.waitForTimeout(400)
  await expect(sheet.getByRole('radio', { name: 'Обменник' })).toBeChecked()
  // The segment is tapped, as a finger does: its radio is hidden under it.
  await sheet.locator('label', { has: page.getByRole('radio', { name: 'Не указано' }) }).click()
  await sheet.getByRole('button', { name: 'Сохранить правку' }).click()
  await expect(sheet).toBeHidden()

  await page.reload()
  await page
    .locator('article')
    .getByRole('button', { name: /^Исправить обмен от/ })
    .click()
  await expect(sheet).toContainText('Правка обмена')
  await expect(sheet.getByRole('radio', { name: 'Не указано' })).toBeChecked()
})

/** A rate as it crosses the wire: drams per unit, the market's, dated by Yerevan's midnight. */
function wireRate(value: string, day: string) {
  return {
    base: 'RUB',
    quote: 'AMD',
    rate: value,
    source: 'official',
    asOf: new Date(Date.parse(`${day}T00:00:00.000Z`) - 4 * 60 * 60 * 1000).toISOString(),
  }
}

/**
 * «Курс рубля за 12 месяцев» (MOL-161) on a phone. This run has no market — the refresh is off —
 * so the server answers with no chart, and that is the first thing held. The line itself is put
 * into the answer on its way (`page.route`): what the server counts is held by the integration
 * tests; what only a browser shows is the tap on the line, the keys on the radios and the card in
 * its place under «Обмены против рынка».
 */
test('the rate of twelve months: no market — no card; the latest exchange first, a week by the finger', async ({
  page,
}) => {
  await signedIn(page)
  const headers = await asBrowser(page)
  const recorded = await page.request.post('/api/exchanges', {
    headers,
    data: {
      id: randomUUID(),
      given: { amount: '20000', currency: 'RUB' },
      received: { amount: '83200', currency: 'AMD' },
      exchangedOn: '2026-02-28',
    },
  })
  expect(recorded.status()).toBe(201)

  await page.getByRole('link', { name: 'Деньги', exact: true }).click()
  await page.getByRole('link', { name: 'Обмен денег' }).click()
  await expect(page.getByText('Мой курс', { exact: true })).toBeVisible()
  await expect(page.locator('.rate-chart')).toHaveCount(0)

  await page.route('**/api/exchanges', async (route) => {
    if (route.request().method() !== 'GET') return route.continue()
    const response = await route.fetch()
    const json = (await response.json()) as Record<string, unknown>
    json.rateChart = {
      pairs: [
        {
          currency: 'RUB',
          side: 'bankBuys',
          weeks: [
            { day: '2026-02-08', rate: wireRate('4.900000', '2026-02-06'), x: 0, level: 1000 },
            { day: '2026-02-15', rate: wireRate('4.800000', '2026-02-13'), x: 250, level: 800 },
            { day: '2026-02-22', rate: null, x: 500, level: null },
            { day: '2026-03-01', rate: wireRate('4.600000', '2026-02-27'), x: 750, level: 450 },
            { day: '2026-03-04', rate: wireRate('4.300000', '2026-03-04'), x: 1000, level: 0 },
          ],
          exchanges: [
            {
              id: randomUUID(),
              day: '2026-02-28',
              week: 3,
              x: 760,
              rate: wireRate('4.160000', '2026-02-28'),
              level: 300,
              place: 'Ардшинбанк',
              percent: 121,
              market: { rate: wireRate('4.110180', '2026-02-28'), level: 200, basis: 'bankCash' },
            },
          ],
          levels: [
            { rate: wireRate('4.300000', '2026-03-04'), level: 0 },
            { rate: wireRate('4.600000', '2026-03-04'), level: 500 },
            { rate: wireRate('4.900000', '2026-03-04'), level: 1000 },
          ],
        },
      ],
    }
    await route.fulfill({ response, json })
  })
  await page.reload()

  const card = page.locator('.rate-chart')
  await expect(card.getByRole('heading', { name: 'Курс рубля за 12 месяцев' })).toBeVisible()
  // Under «Обмены против рынка» when there is one, and above «Мой курс» always (handoff 05).
  const chartTop = (await card.boundingBox())?.y ?? 0
  const rateTop = (await page.getByText('Мой курс', { exact: true }).boundingBox())?.y ?? 0
  expect(chartTop).toBeLessThan(rateTop)

  await expect(card.locator('.mine-rate')).toHaveText('Мой обмен 28 февр. · 4,16 ֏/₽')
  await expect(card.locator('.mine-place')).toHaveText(/Ардшинбанк · \+1,21\s%\sк рынку/)

  // A finger lifted at the left edge: the first week, which had no exchange.
  const area = card.locator('.area')
  await area.tap({ position: { x: 2, y: 60 } })
  await expect(card.locator('.reading')).toContainText('Неделя по 8 февр. · рынок')
  await expect(card.locator('.none')).toHaveText('Обменов на этой неделе не было')

  // The keys walk the radios: one more step brings the second week.
  await card.getByRole('radio', { name: /Неделя по 8 февраля/ }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(card.locator('.figure')).toHaveText('4,80 ֏/₽')
  await page.keyboard.press('ArrowRight')
  await expect(card.locator('.figure')).toHaveText('Рынка за эту неделю нет')
})
