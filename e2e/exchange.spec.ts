import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { actorCodec, settingsOf } from '@molvia/model'
import { yerevanDay } from './days'
import { facesIn, standAt, stillIn, topOf } from './scroll'
import { asBrowser, signedIn } from './session'
import { textAt } from './text-size'

test.use({ locale: 'ru-RU', reducedMotion: 'reduce' })

// The English words are the dictionary's, never a copy in the spec (as in `incomes.spec`).
const en = JSON.parse(
  readFileSync(new URL('../frontend/src/i18n/en.json', import.meta.url), 'utf8'),
) as { exchange: { sheet: Record<string, string> } }

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
  await sheet.getByLabel('Отдал', { exact: true }).fill('20000')
  await sheet.getByLabel('Получил', { exact: true }).fill('95000')
  await sheet.getByRole('button', { name: 'Сохранить обмен' }).click()
  await expect(sheet).toBeHidden()

  await expect(page.locator('.figure')).toHaveText('4,75 ֏/₽')
  await expect(page.getByText(/по последнему обмену/)).toBeVisible()
  // End to end has no market: the exchange is «без сравнения», a bar on the line and its count —
  // never «Обменов пока нет» over the list it stands in (MOL-348, adversarial А1).
  const vsMarket = page.locator('.vs-market')
  await expect(vsMarket.locator('.cell')).toHaveCount(1)
  await expect(vsMarket).toContainText('1 обмен без сравнения')
  await expect(vsMarket).not.toContainText('Обменов пока нет')

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
    // Each currency in the well of its amount (MOL-348).
    await sheet.getByLabel('Валюта, которую отдали').selectOption(from)
    await sheet.getByLabel('Валюта, которую получили').selectOption(to)
    await sheet.getByLabel('Отдал', { exact: true }).fill(given)
    await sheet.getByLabel('Получил', { exact: true }).fill(received)
    await sheet.getByRole('button', { name: 'Сохранить обмен' }).click()
    await expect(sheet).toBeHidden()
  }

  await record('20000', 'RUB', '224,63', 'USD')
  await record('100', 'USD', '36150', 'AMD')

  await expect(page.locator('.figure')).toHaveText('4,06 ֏/₽')
  await expect(page.locator('.costs li')).toHaveText(/^89,04 ₽\/\$ · по последнему обмену/)

  // The rate is «большее за меньшее» (MOL-81): the exchange of roubles for dollars says «89,04 ₽/$»,
  // never «0,011232 $/₽», and the very number the price of the dollar says above it.
  // Since MOL-348 the rate stands on the plate of the amendment, which the row opens.
  await page.locator('.rows button.list-row').filter({ hasText: '224,63 $' }).click()
  await expect(sheet.locator('.comparison .line').first()).toHaveText(/^Курс обмена\s*89,04 ₽\/\$$/)
  await page.keyboard.press('Escape')
  await expect(sheet).toBeHidden()

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
  await sheet.getByLabel('Отдал', { exact: true }).fill('20000')
  await sheet.getByLabel('Получил', { exact: true }).fill('100000')
  await sheet.getByRole('button', { name: 'Сохранить обмен' }).click()
  await expect(sheet).toBeHidden()
  await expect(page.locator('.figure')).toHaveText('5,00 ֏/₽')

  await page.getByRole('button', { name: /^Исправить обмен/ }).click()
  await expect(sheet).toContainText('Правка обмена')
  await page.waitForTimeout(400)
  await sheet.getByLabel('Получил', { exact: true }).fill('95000')
  await sheet.getByLabel('Где и заметка').fill('ВТБ банкомат')
  await sheet.getByRole('button', { name: 'Сохранить правку' }).click()
  await expect(sheet).toBeHidden()

  await expect(page.locator('.figure')).toHaveText('4,75 ֏/₽')
  // The row says the place and the amendment in its line under the amounts (MOL-348).
  await expect(page.locator('.rows .meta')).toContainText('ВТБ банкомат')
  await expect(page.locator('.rows .meta')).toContainText('исправлен')

  await page.getByRole('button', { name: /^Исправить обмен/ }).click()
  await expect(sheet.locator('.versions')).toContainText('100 000 ֏')
})

/**
 * The row of an exchange at a phone's widths (MOL-348; the card of MOL-81 before): the largest amounts
 * the owner's journal has — six digits with kopecks against seven of drams — stand whole in its title,
 * on this phone and on a 320 px one, and nothing of the row stands past the screen.
 */
test('the row of an exchange holds long amounts on this phone and on a 320 px one', async ({
  page,
}) => {
  await signedIn(page)
  await page.getByRole('link', { name: 'Деньги', exact: true }).click()
  await page.getByRole('link', { name: 'Обмен денег' }).click()
  await page.getByRole('button', { name: 'Записать обмен' }).click()
  const sheet = page.locator('dialog[open]')
  await page.waitForTimeout(400)
  await sheet.getByLabel('Отдал', { exact: true }).fill('123456,78')
  await sheet.getByLabel('Получил', { exact: true }).fill('1000000')
  await sheet.getByRole('button', { name: 'Сохранить обмен' }).click()
  await expect(sheet).toBeHidden()
  const row = page.locator('.rows button.list-row').first()
  await expect(row).toContainText('123 456,78 ₽ → 1 000 000 ֏')

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 700 })
    const sideways = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(sideways).toBe(0)
    const box = await row.boundingBox()
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width)
  }
})

/**
 * «Записать обмен» is the strip's over the tab bar, not a button floating over the list (MOL-187,
 * Ф-28): at the end of the scroll the last card ends above the strip, and without a connection the
 * button stays, not now, saying why on itself, beside the strip of the connection (Ф-6, Р-1).
 */
test('«Записать обмен» stands in the strip: the last card ends above it, offline it says why', async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 390, height: 640 })
  await signedIn(page)
  await page.getByRole('link', { name: 'Деньги', exact: true }).click()
  await page.getByRole('link', { name: 'Обмен денег' }).click()
  await expect(page.getByRole('heading', { name: 'Обменов пока нет' })).toBeVisible()
  // The empty screen offers it in the strip too, and nowhere else (Ф-16).
  const record = page.locator('.dock').getByRole('button', { name: 'Записать обмен', exact: true })
  await expect(record).toBeVisible()
  await expect(page.getByRole('button', { name: /Записать обмен/ })).toHaveCount(1)

  const sheet = page.locator('dialog[open]')
  for (const [given, received] of [
    ['20000', '95000'],
    ['10000', '47000'],
    ['30000', '141000'],
  ] as const) {
    await record.click()
    await expect(sheet).toContainText('Сколько отдали и сколько получили')
    await page.waitForTimeout(400)
    await sheet.getByLabel('Отдал', { exact: true }).fill(given)
    await sheet.getByLabel('Получил', { exact: true }).fill(received)
    await sheet.getByRole('button', { name: 'Сохранить обмен' }).click()
    await expect(sheet).toBeHidden()
  }
  await expect(page.locator('.rows li')).toHaveCount(3)

  await page.evaluate(() => {
    window.scrollTo(0, document.documentElement.scrollHeight)
  })
  await page.waitForTimeout(300)
  const [last, dock] = await Promise.all([
    page.locator('.rows li').last().boundingBox(),
    page.locator('.dock').boundingBox(),
  ])
  expect((last?.y ?? 0) + (last?.height ?? 0)).toBeLessThanOrEqual(dock?.y ?? 0)

  await context.setOffline(true)
  // The strip's own node: its words are said in the live region too (MOL-181).
  const strip = page.locator('.strip', { hasText: /Без связи · обмены на/ })
  await expect(strip).toHaveText(
    /^Без связи · обмены на .+\d:\d\d\. Записать обмен и поменять курс можно со связью$/,
  )
  const offline = page
    .locator('.dock')
    .getByRole('button', { name: 'Записать обмен можно со связью' })
  await expect(offline).toHaveAttribute('aria-disabled', 'true')
  // Playwright itself counts an `aria-disabled` button as disabled: the tap is forced, as a finger's.
  await offline.click({ force: true })
  await page.waitForTimeout(400)
  await expect(sheet).toHaveCount(0)

  await context.setOffline(false)
  await expect(record).toBeVisible()
  await expect(record).not.toHaveAttribute('aria-disabled', 'true')
  await expect(strip).toBeHidden()
})

/** One exchange recorded through the strip and its sheet, the sheet gone. */
async function recordOne(page: Page): Promise<void> {
  const sheet = page.locator('dialog[open]')
  await page.locator('.dock').getByRole('button', { name: 'Записать обмен', exact: true }).click()
  await expect(sheet).toContainText('Сколько отдали и сколько получили')
  await page.waitForTimeout(400)
  await sheet.getByLabel('Отдал', { exact: true }).fill('20000')
  await sheet.getByLabel('Получил', { exact: true }).fill('95000')
  await sheet.getByRole('button', { name: 'Сохранить обмен' }).click()
  await expect(sheet).toBeHidden()
}

/**
 * Removing is the amendment's (MOL-189, Ф-34): the card is one button, «Удалить обмен» stands in its
 * sheet, the question rises over it with «‹» and no × (Д-1) — «‹» and the system's «back» take only the
 * question away, with what was typed kept — and «Удалить» closes both in one step, the screen staying.
 * «Вернуть» is the strip over «Записать обмен», with the focus on it (Ф-29).
 */
test('an exchange is removed from its amendment, the question over it, «Вернуть» over the strip', async ({
  page,
  context,
}) => {
  await signedIn(page)
  await page.getByRole('link', { name: 'Деньги', exact: true }).click()
  await page.getByRole('link', { name: 'Обмен денег' }).click()
  await recordOne(page)
  await expect(page.locator('.rows button.list-row')).toHaveCount(1)

  const sheet = page.locator('dialog[open]', { hasText: 'Правка обмена' })
  const question = page.locator('dialog[open]', { hasText: 'Удалить обмен?' })
  await page.getByRole('button', { name: /^Исправить обмен от/ }).click()
  await expect(sheet).toBeVisible()
  await page.waitForTimeout(400)
  await sheet.getByLabel('Получил', { exact: true }).fill('96000')

  await sheet.getByRole('button', { name: 'Удалить обмен' }).click()
  await expect(question).toBeVisible()
  await expect(question.getByRole('button', { name: 'Закрыть' })).toHaveCount(0)
  await page.waitForTimeout(400)
  await question.getByRole('button', { name: 'Назад' }).click()
  await expect(question).toBeHidden()
  await expect(sheet.getByLabel('Получил', { exact: true })).toHaveValue('96000')

  // The system's «back» takes the question alone, as «‹» does.
  await sheet.getByRole('button', { name: 'Удалить обмен' }).click()
  await expect(question).toBeVisible()
  await page.goBack()
  await expect(question).toBeHidden()
  await expect(sheet).toBeVisible()

  await sheet.getByRole('button', { name: 'Удалить обмен' }).click()
  await expect(question).toBeVisible()
  await page.waitForTimeout(400)
  await question.getByRole('button', { name: 'Удалить', exact: true }).click()
  await expect(page.locator('dialog[open]')).toHaveCount(0)
  await expect(page).toHaveURL(/\/money\/exchange$/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Обмен денег')
  await expect(page.locator('.rows li')).toHaveCount(0)

  const undo = page.locator('.undo-strip')
  await expect(undo).toContainText('Обмен удалён: 20 000 ₽ → 95 000 ֏')
  const restore = undo.getByRole('button', { name: 'Вернуть' })
  await expect(restore).toBeFocused()
  await stillIn(undo, page.locator('.dock'))
  const [strip, dock] = await Promise.all([undo.boundingBox(), page.locator('.dock').boundingBox()])
  expect((strip?.y ?? 0) + (strip?.height ?? 0)).toBeLessThanOrEqual(dock?.y ?? 0)

  // On a 320 px phone the words keep their 7rem: «Вернуть» holds «Возвращаем…» under it, offline it
  // says «Вернём, когда будет связь», and on one line with them the words broke a letter a line.
  await page.setViewportSize({ width: 320, height: 700 })
  for (const offline of [false, true]) {
    await context.setOffline(offline)
    await expect(undo.locator('button')).toHaveText(
      offline ? 'Вернём, когда будет связь' : 'Вернуть',
    )
    const [words, whole] = await Promise.all([
      undo.locator('.text').boundingBox(),
      undo.boundingBox(),
    ])
    expect(words?.width ?? 0).toBeGreaterThanOrEqual(112)
    expect((whole?.x ?? 0) + (whole?.width ?? 0)).toBeLessThanOrEqual(320)
  }
  await context.setOffline(false)

  await restore.click()
  await expect(undo).toBeHidden()
  await expect(page.locator('.rows li')).toHaveCount(1)
  await expect(
    page.locator('.dock').getByRole('button', { name: 'Записать обмен', exact: true }),
  ).toBeFocused()
})

/**
 * Without a connection the card still opens (MOL-189, С-19): the sheet says once what waits for it,
 * and «Сохраним / Удалим, когда будет связь» stay in the focus order and send nothing (Ф-6).
 */
test('without a connection the amendment opens, says what waits, and sends nothing', async ({
  page,
  context,
}) => {
  await signedIn(page)
  await page.getByRole('link', { name: 'Деньги', exact: true }).click()
  await page.getByRole('link', { name: 'Обмен денег' }).click()
  await recordOne(page)

  await context.setOffline(true)
  const sheet = page.locator('dialog[open]')
  await page.getByRole('button', { name: /^Исправить обмен от/ }).click()
  await expect(sheet).toContainText('Правка обмена')
  await page.waitForTimeout(400)
  // The strip's own node: its words are said in the sheet's live region too (MOL-181).
  await expect(sheet.locator('.strip')).toHaveText(
    'Без связи · исправить и удалить обмен можно со связью — введённое останется здесь',
  )
  const save = sheet.getByRole('button', { name: 'Сохраним, когда будет связь' })
  const remove = sheet.getByRole('button', { name: 'Удалим, когда будет связь' })
  await expect(save).toHaveAttribute('aria-disabled', 'true')
  await expect(remove).toHaveAttribute('aria-disabled', 'true')
  // Playwright counts an `aria-disabled` button as disabled: the tap is forced, as a finger's.
  await remove.click({ force: true })
  await page.waitForTimeout(400)
  await expect(page.locator('dialog[open]')).toHaveCount(1)

  await context.setOffline(false)
  await expect(sheet.getByRole('button', { name: 'Сохранить правку' })).not.toHaveAttribute(
    'aria-disabled',
    'true',
  )
  await expect(sheet.locator('.strip')).toHaveCount(0)
})

/**
 * «Как меняли» whole on a phone (MOL-189, Е-11): four segments of equal width cut «Обменник» at 390.
 * Each segment is as wide as its words, and a label of two breaks between them where the row is short:
 * every word has room in its segment, and the row never stands past the field — at 320, 360 and 390,
 * in Russian and in the English words of the dictionary, drawn in the control itself.
 */
test('«Как меняли» is whole on a phone, in both languages', async ({ page }) => {
  await signedIn(page)
  await page.getByRole('link', { name: 'Деньги', exact: true }).click()
  await page.getByRole('link', { name: 'Обмен денег' }).click()
  await page.locator('.dock').getByRole('button', { name: 'Записать обмен', exact: true }).click()
  const control = page.locator('dialog[open] fieldset.segmented')
  await expect(control).toContainText('Обменник')
  const english: string[] = [
    '—',
    ...['bankCash', 'bankNoncash', 'exchanger'].map(
      (key) => en.exchange.sheet[`channel_${key}`] ?? '',
    ),
  ]
  for (const width of [320, 360, 390]) {
    await page.setViewportSize({ width, height: 740 })
    for (const words of [null, english]) {
      const broken = await control.evaluate(async (set, words: string[] | null) => {
        await document.fonts.ready
        const segments = [...set.querySelectorAll<HTMLElement>('.segment')]
        if (words)
          segments.forEach((segment, n) => {
            const word = segment.querySelector('.word')
            if (word) word.textContent = words[n] ?? ''
          })
        const found: string[] = []
        const track = set.querySelector<HTMLElement>('.track')
        if (track && track.scrollWidth > track.clientWidth + 1) found.push('the row past the field')
        for (const segment of segments) {
          const word = segment.querySelector('.word')?.getBoundingClientRect()
          const box = segment.getBoundingClientRect()
          // Room on both sides, not the word flush with the edge: equal segments sized «Обменник» to
          // the word itself, and the track's round corner cut it (frame 036).
          if (word && (word.left - box.left < 4 || box.right - word.right < 4)) {
            found.push(`no room in its segment: ${segment.textContent.trim()}`)
          }
        }
        return found
      }, words)
      expect(broken, `${String(width)} px, ${words ? 'en' : 'ru'}`).toEqual([])
    }
  }
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
  await sheet.getByLabel('Отдал', { exact: true }).fill('20000')
  await sheet.getByLabel('Получил', { exact: true }).fill('83200')
  await sheet.getByRole('button', { name: 'Сохранить обмен' }).click()
  await expect(sheet).toBeHidden()

  // No market in this run: nothing is drawn of it, and the central bank's line stands as before.
  await expect(page.locator('.market')).toHaveCount(0)

  // The next exchange starts from the way the last one was made.
  await page.getByRole('button', { name: 'Записать обмен' }).click()
  await expect(sheet).toContainText('Сколько отдали и сколько получили')
  await page.waitForTimeout(400)
  await expect(sheet.getByRole('radio', { name: 'Обменник' })).toBeChecked()
  await page.keyboard.press('Escape')
  await expect(sheet).toBeHidden()

  // An amendment opens on the exchange's own channel, and «—» clears it for good.
  await page
    .locator('.rows')
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
    .locator('.rows')
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

/** The year of the rouble as the server lays it: four weeks of February and March, one exchange. */
function rateYear(id: string) {
  return {
    step: 'week',
    steps: [
      { day: '2026-02-08', rate: wireRate('4.900000', '2026-02-06'), x: 0, level: 1000 },
      { day: '2026-02-15', rate: wireRate('4.800000', '2026-02-13'), x: 250, level: 800 },
      { day: '2026-02-22', rate: null, x: 500, level: null },
      { day: '2026-03-01', rate: wireRate('4.600000', '2026-02-27'), x: 750, level: 450 },
      { day: '2026-03-04', rate: wireRate('4.300000', '2026-03-04'), x: 1000, level: 0 },
    ],
    exchanges: [
      {
        id,
        day: '2026-02-28',
        step: 3,
        x: 760,
        rate: wireRate('4.160000', '2026-02-28'),
        level: 300,
        place: 'Ардшинбанк',
        percent: 121,
        sign: 1,
        market: { rate: wireRate('4.110180', '2026-02-28'), level: 200, basis: 'bankCash' },
      },
    ],
    levels: [
      { rate: wireRate('4.300000', '2026-03-04'), level: 0 },
      { rate: wireRate('4.600000', '2026-03-04'), level: 500 },
      { rate: wireRate('4.900000', '2026-03-04'), level: 1000 },
    ],
  }
}

/** The month by days, 27 February to 4 March, the weekend at Friday's figure (MOL-168, В-2 «а»). */
function rateMonth(id: string) {
  const days = ['2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02', '2026-03-03', '2026-03-04']
  return {
    step: 'day',
    steps: days.map((day, index) => ({
      day,
      rate: wireRate(index < 3 ? '4.620000' : '4.550000', index < 3 ? '2026-02-27' : day),
      x: index * 200,
      level: index < 3 ? 900 : 100,
    })),
    exchanges: [{ ...rateYear(id).exchanges[0], step: 1, x: 200, level: 500 }],
    levels: [{ rate: wireRate('4.600000', '2026-03-04'), level: 500 }],
  }
}

/** Puts the line into the answer on its way (`page.route`): this run has no market of its own. */
async function withRateCharts(page: Page, id: string, before: object[] = []): Promise<void> {
  await page.route('**/api/exchanges', async (route) => {
    if (route.request().method() !== 'GET') return route.continue()
    const response = await route.fetch()
    const json = (await response.json()) as Record<string, unknown>
    json.rateCharts = {
      pairs: [
        {
          currency: 'RUB',
          side: 'bankBuys',
          periods: {
            1: rateMonth(id),
            6: null,
            12: { ...rateYear(id), exchanges: [...before, ...rateYear(id).exchanges] },
          },
        },
      ],
    }
    await route.fulfill({ response, json })
  })
}

/** An exchange of 28 February, written as the screen writes one. */
async function exchangeOfFebruary(page: Page): Promise<string> {
  const headers = await asBrowser(page)
  const id = randomUUID()
  const recorded = await page.request.post('/api/exchanges', {
    headers,
    data: {
      id,
      given: { amount: '20000', currency: 'RUB' },
      received: { amount: '83200', currency: 'AMD' },
      exchangedOn: '2026-02-28',
    },
  })
  expect(recorded.status()).toBe(201)
  return id
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
  const id = await exchangeOfFebruary(page)

  await page.getByRole('link', { name: 'Деньги', exact: true }).click()
  await page.getByRole('link', { name: 'Обмен денег' }).click()
  await expect(page.getByText('Мой курс', { exact: true })).toBeVisible()
  await expect(page.locator('.rate-chart')).toHaveCount(0)

  await withRateCharts(page, id)
  await page.reload()

  const card = page.locator('.rate-chart')
  await expect(card.getByRole('heading', { name: 'Курс рубля за 12 месяцев' })).toBeVisible()
  // Under «Обмены против рынка» when there is one, and above «Мой курс» always (handoff 05).
  const chartTop = (await card.boundingBox())?.y ?? 0
  const rateTop = (await page.getByText('Мой курс', { exact: true }).boundingBox())?.y ?? 0
  expect(chartTop).toBeLessThan(rateTop)

  await expect(card.locator('.mine-rate')).toHaveText('Мой обмен 28 февр. · 4,16 ֏/₽')
  await expect(card.locator('.mine-place')).toHaveText('Ардшинбанк')
  await expect(card.locator('.mine-diff')).toHaveText(/\+1,21\s%\s·\sлучше рынка/)

  // The reading is as tall as what it says: no room held for another week's plate, the chart under it
  // moving instead (MOL-404, the owner's word; MOL-190 held the plate's three lines before).
  const area = card.locator('.area')
  const reading = card.locator('.reading')
  const roomUnder = () =>
    reading.evaluate(
      (box) =>
        box.getBoundingClientRect().bottom -
        (box.lastElementChild?.getBoundingClientRect().bottom ?? NaN),
    )
  expect(await roomUnder()).toBeCloseTo(0, 0)

  // A finger lifted at the left edge: the first week, which had no exchange.
  await area.tap({ position: { x: 2, y: 60 } })
  await expect(reading).toContainText('Неделя по 8 февр. · рынок')
  await expect(card.locator('.none')).toHaveText('Обменов на этой неделе не было')
  expect(await roomUnder()).toBeCloseTo(0, 0)

  // The keys walk the radios: one more step brings the second week.
  await card.getByRole('radio', { name: /Неделя по 8 февраля/ }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(card.locator('.figure')).toHaveText('4,80 ֏/₽')
  await page.keyboard.press('ArrowRight')
  await expect(card.locator('.figure')).toHaveText('Рынка за эту неделю нет')
  expect(await roomUnder()).toBeCloseTo(0, 0)
})

/**
 * Only the chosen exchange's plate is drawn, at its own height (MOL-404; MOL-190 held every plate of the
 * period unseen before): a note of another exchange — a link to a map, no spaces — does not stretch the
 * plate shown, and chosen, it wraps within its plate and never pushes the page aside (adversarial В1, В2).
 */
test('a long note: the plate is as tall as its own lines, the page keeps its width', async ({
  page,
}) => {
  await signedIn(page)
  const id = await exchangeOfFebruary(page)
  const link = {
    ...rateYear(id).exchanges[0],
    id: randomUUID(),
    day: '2026-02-14',
    step: 1,
    x: 260,
    level: 700,
    place: 'https://yandex.ru/maps/org/ardshinbank/1234567890/?ll=43.8453,40.7894&z=17',
  }
  await withRateCharts(page, id, [link])

  await page.getByRole('link', { name: 'Деньги', exact: true }).click()
  await page.getByRole('link', { name: 'Обмен денег' }).click()
  const card = page.locator('.rate-chart')
  await expect(card.locator('.mine-place')).toHaveText('Ардшинбанк')

  const wide = () =>
    page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  const box = async (selector: string) =>
    (await card.locator(selector).boundingBox())?.height ?? NaN
  // The plate is its three lines and its padding (8 above, 8 below), not the link's four or more.
  const three = await box('.mine')
  expect(three).toBeCloseTo((await box('.mine .plate-text')) + 16, 0)
  expect(await wide()).toBe(0)

  // The link's own exchange: its plate grows by the link's lines, and the page keeps its width.
  await card.getByRole('radio', { name: /мой обмен 14 февраля/ }).focus()
  await page.keyboard.press('Space')
  await expect(card.locator('.mine-place')).toContainText('yandex.ru')
  expect(await box('.mine')).toBeGreaterThan(three)
  expect(await wide()).toBe(0)

  await card.locator('.area').tap({ position: { x: 2, y: 60 } })
  await expect(card.locator('.none')).toHaveText('Обменов на этой неделе не было')
  await expect(card.locator('.plate')).toHaveCount(0)
  expect(await wide()).toBe(0)
})

/**
 * The period of the line (MOL-168) on a phone: «Месяц» is the screen's own query — the page and the
 * switch stay where they were, nothing is asked of the server — the month is read by days, and
 * «back» and «forward» bring the period chosen back with the screen.
 */
test('the month of the rate by days: the switch and the page stay put, the address keeps it', async ({
  page,
}) => {
  await signedIn(page)
  const id = await exchangeOfFebruary(page)
  await withRateCharts(page, id)

  await page.getByRole('link', { name: 'Деньги', exact: true }).click()
  await page.getByRole('link', { name: 'Обмен денег' }).click()
  const card = page.locator('.rate-chart')
  await expect(card.getByRole('heading', { name: 'Курс рубля за 12 месяцев' })).toBeVisible()

  const periods = card.locator('.periods')
  await standAt(periods, 120)
  const down = await page.evaluate(() => window.scrollY)
  const at = await topOf(periods)
  let asked = 0
  page.on('request', (request) => {
    if (request.url().endsWith('/api/exchanges') && request.method() === 'GET') asked += 1
  })

  await periods.getByText('Месяц', { exact: true }).tap()
  await expect(card.getByRole('heading', { name: 'Курс рубля за месяц' })).toBeVisible()
  await expect(page).toHaveURL(/\/money\/exchange\?months=1$/)
  expect(await topOf(periods)).toBe(at)
  expect(await page.evaluate(() => window.scrollY)).toBe(down)
  expect(asked).toBe(0)

  // The exchange chosen in the year is the one of the month too; its day, at Friday's figure.
  await expect(card.locator('.reading')).toContainText('28 февр. · рынок')
  await expect(card.locator('.figure')).toHaveText('4,62 ֏/₽')
  await expect(card.locator('.mine-rate')).toHaveText('Мой обмен 28 февр. · 4,16 ֏/₽')
  await expect(card.locator('.month')).toHaveText(['2 мар.'])
  await card.locator('.area').tap({ position: { x: 2, y: 60 } })
  await expect(card.locator('.none')).toHaveText('В этот день обменов не было')

  await page.goBack()
  await expect(page).toHaveURL(/\/money$/)
  await page.goForward()
  await expect(card.getByRole('heading', { name: 'Курс рубля за месяц' })).toBeVisible()

  // Half a year has no market here: the card and its switch stay, and say so.
  await periods.getByText('6 месяцев', { exact: true }).tap()
  await expect(card.locator('.none')).toHaveText('Рынка за 6 месяцев нет')
  await expect(periods).toBeVisible()
})

/** How many lines a text stands on: one box a line of it. */
function linesOf(element: Locator): Promise<number> {
  return element.evaluate((box) => {
    const range = document.createRange()
    range.selectNodeContents(box)
    return new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size
  })
}

/**
 * «Обмены против рынка» of a year of exchanges, as the owner's 41 (MOL-404): with a bar 8 px wide, «нояб»
 * stood a letter a line, and every plate held unseen in one cell left a screen and a half of nothing under
 * the bars — «без сравнения · …» took the plate's whole width as an `auto` column, and a note of 122
 * characters stood a letter a line in what was left. This run has no market, so every bar is «без
 * сравнения», the longest word a plate has. At 390 and 320, and at 150 % and 200 % of the system's text.
 */
const LONG_NOTE =
  'Обменник у рынка на Ширакаци, второй этаж, окошко слева от входа; курс табло на утро, наличные, без комиссии, спросить Ару'
const ONE_WORD = 'Обменникрынкаширакацивторойэтажокошкосле'
for (const [width, size] of [
  [390, '100%'],
  [320, '100%'],
  [320, '150%'],
  [320, '200%'],
] as const)
  test(`a year of 41 exchanges: months on one line, one plate, nothing past the card — ${String(width)} at ${size}`, async ({
    page,
  }) => {
    test.setTimeout(60_000)
    await page.setViewportSize({ width, height: 800 })
    await textAt(page, size)
    await signedIn(page)
    const headers = await asBrowser(page)
    for (let index = 0; index < 41; index += 1) {
      const recorded = await page.request.post('/api/exchanges', {
        headers,
        data: {
          id: randomUUID(),
          given: { amount: '139.86', currency: 'USD' },
          received: { amount: '54000', currency: 'AMD' },
          exchangedOn: yerevanDay(index * 8 - 330),
          note: index === 20 ? LONG_NOTE : index === 30 ? ONE_WORD : 'Ардшинбанк',
        },
      })
      expect(recorded.status()).toBe(201)
    }

    await page.goto('/money/exchange')
    const card = page.locator('.vs-market')
    await expect(card.locator('.cell')).toHaveCount(41)
    const edges = async () => {
      const box = await card.boundingBox()
      return { left: box?.x ?? NaN, right: (box?.x ?? NaN) + (box?.width ?? NaN) }
    }
    const within = async () => {
      const { left, right } = await edges()
      for (const label of await card.locator('.bars .label').all()) {
        const box = await label.boundingBox()
        expect(box?.x ?? NaN).toBeGreaterThanOrEqual(left)
        expect((box?.x ?? NaN) + (box?.width ?? NaN)).toBeLessThanOrEqual(right)
      }
      expect(await card.evaluate((box) => box.scrollWidth - box.clientWidth)).toBe(0)
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      ).toBe(0)
    }

    // The first month and the last, each on one line (В-2 «а»): the chosen bar's day is on its plate.
    const months = card.locator('.month .label')
    await expect(months).toHaveCount(2)
    for (const month of await months.all()) expect(await linesOf(month)).toBe(1)
    // The values of the edge bars and the chosen one, the latest, «?» each.
    await expect(card.locator('.value')).toHaveCount(2)
    await within()

    // One plate, the chosen one; the place keeps about half of it — less the gap — the word of «без сравнения» the rest.
    const plate = card.locator('.plate')
    await expect(plate).toHaveCount(1)
    const share = () =>
      plate.evaluate((box) => {
        const where = box.querySelector('.plate-where')?.getBoundingClientRect().width ?? 0
        const style = getComputedStyle(box)
        const inner =
          box.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
        return where / inner
      })
    expect(await share()).toBeGreaterThanOrEqual(0.4)

    // The long note whole, and the word of forty letters broken within its half (MOL-318).
    for (const note of [LONG_NOTE, ONE_WORD]) {
      await card.getByRole('radio', { name: new RegExp(note.slice(0, 24)) }).focus()
      await page.keyboard.press('Space')
      await expect(plate.locator('.plate-where')).toContainText(note)
      await expect(plate).toHaveCount(1)
      expect(await share()).toBeGreaterThanOrEqual(0.4)
      await within()
    }

    // The list under it: «отдал → получил» on one line at the phone's own size (В-7 «б»), never under the caption —
    // at 200 % it wraps between its sums instead, each whole (adversarial А4); the row within the phone.
    const row = page.locator('.rows button.list-row').first()
    const amounts = row.locator('.amounts')
    if (size === '100%') expect(await linesOf(amounts)).toBe(1)
    expect(await amounts.evaluate(sizeOverCaption)).toBeGreaterThanOrEqual(0)
    await expect(amounts.locator('.sum')).toHaveCount(2)
    // Each sum whole, and no smaller than the caption where it alone fits its column — the arrow takes no width from
    // either (round 3, В1).
    for (const sum of await amounts.locator('.sum').all()) {
      expect(await linesOf(sum)).toBe(1)
      expect(await sum.evaluate(sizeOverCaption)).toBeGreaterThanOrEqual(0)
    }
    const box = await row.boundingBox()
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width)
  })

/** How far a text's size stands over `--text-caption` at the root's size now, in px. */
function sizeOverCaption(element: Element): number {
  const probe = document.createElement('span')
  probe.style.fontSize = 'var(--text-caption)'
  document.body.append(probe)
  const caption = parseFloat(getComputedStyle(probe).fontSize)
  probe.remove()
  return parseFloat(getComputedStyle(element).fontSize) - caption
}

/**
 * Bars measured against the market, as the server lays them (`vsMarketBars`), put into the answer on its way: this run
 * has no market of its own. Every one worse than the market, the last the furthest — the owner's year.
 */
function marketBars(days: readonly string[], mixed = false) {
  const differences = days.map((_, index) => 31_240 + index * 10_244)
  const furthest = Math.max(...differences)
  return days.map((day, index) => {
    const minor = differences[index] ?? 0
    // Mixed: better and worse than the market by turns, the furthest worse.
    const sign = mixed && (days.length - 1 - index) % 2 === 1 ? 1 : -1
    return {
      id: `a0000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      exchangedOn: day,
      place: 'Ардшинбанк',
      difference: { amount: `${sign < 0 ? '-' : ''}${(minor / 100).toFixed(2)}`, currency: 'AMD' },
      percent: sign * 150,
      sign,
      level: sign * Math.round((minor * 1000) / furthest),
    }
  })
}

/** The labels of a row of the card, each with its box — one given way keeps it, unseen. */
const labelsOf = (labels: Locator) =>
  labels.evaluateAll((all) =>
    all.map((one) => {
      const box = one.getBoundingClientRect()
      return {
        text: one.textContent,
        seen: getComputedStyle(one).visibility !== 'hidden',
        left: box.left,
        right: box.right,
        top: box.top,
        bottom: box.bottom,
      }
    }),
  )

type LabelBox = Awaited<ReturnType<typeof labelsOf>>[number]

/** Two labels stand `room` apart, across or one over the other. */
const apartBy = (a: LabelBox, b: LabelBox, room: number) =>
  a.right + room <= b.left ||
  b.right + room <= a.left ||
  a.bottom + room <= b.top ||
  b.bottom + room <= a.top

/**
 * The labels of measured bars (MOL-404, review №1–2, adversarial А1–А3): a label never wraps, so wider than its column
 * it stood over its neighbour — the chosen penultimate's value on the furthest's, eight months at 150 % and 200 %, six
 * values on 320 — and a column in from the edge, past the card. Whatever is seen stands apart and within the card; a
 * label is hidden only where it would stand on one seen — a value over the line and one under it are not neighbours
 * (round 2, Б1) — and among six a choice hides none (Б2).
 */
for (const [width, size] of [
  [390, '100%'],
  [320, '100%'],
  [320, '150%'],
  [320, '200%'],
] as const)
  test(`the labels of measured bars never run into each other nor past the card — ${String(width)} at ${size}`, async ({
    page,
  }) => {
    test.setTimeout(60_000)
    await page.setViewportSize({ width, height: 800 })
    await textAt(page, size)
    await signedIn(page)
    await exchangeOfFebruary(page)
    const scenarios = {
      year: Array.from({ length: 41 }, (_, index) => yerevanDay(index * 8 - 330)),
      // A month apart and never two in one: 31 days on.
      months: Array.from({ length: 8 }, (_, index) => yerevanDay(index * 31 - 220)),
      values: Array.from({ length: 6 }, (_, index) => yerevanDay(index * 31 - 158)),
    }
    let days: readonly string[] = []
    let mixed = false
    await page.route('**/api/exchanges', async (route) => {
      if (route.request().method() !== 'GET') return route.continue()
      const response = await route.fetch()
      const json = (await response.json()) as Record<string, unknown>
      json.bars = marketBars(days, mixed)
      await route.fulfill({ response, json })
    })

    const card = page.locator('.vs-market')
    const placed = async () => {
      await facesIn(page)
      await stillIn(card)
      const box = await card.boundingBox()
      const left = box?.x ?? NaN
      const right = left + (box?.width ?? NaN)
      const rows = {
        values: await labelsOf(card.locator('.value .label')),
        months: await labelsOf(card.locator('.month .label')),
      }
      for (const labels of Object.values(rows)) {
        const seen = labels.filter((one) => one.seen)
        expect(seen.length).toBeGreaterThan(0)
        for (const label of seen) {
          expect(label.left).toBeGreaterThanOrEqual(left)
          expect(label.right).toBeLessThanOrEqual(right)
          for (const other of seen)
            if (other !== label)
              expect(apartBy(label, other, 0), `${label.text} | ${other.text}`).toBe(true)
        }
        // Hidden only in the way of one seen, the room between labels counted (`LABEL_SPACE_PX`).
        for (const label of labels.filter((one) => !one.seen))
          expect(
            seen.some((other) => !apartBy(label, other, 8)),
            label.text,
          ).toBe(true)
      }
      // A value wider than its column crosses its neighbours' bars, and stands over them: a bar later in the row was
      // drawn over it, its «֏» lost (round 3, В2). What stands at any point across it is the label.
      expect(
        await card.locator('.value .label').evaluateAll((all) =>
          all
            .filter((one) => getComputedStyle(one).visibility !== 'hidden')
            .flatMap((one) => {
              // Only what is in the window is found at a point.
              one.scrollIntoView({ block: 'center' })
              const box = one.getBoundingClientRect()
              const y = (box.top + box.bottom) / 2
              return [box.left + 2, (box.left + box.right) / 2, box.right - 2]
                .filter((x) => document.elementFromPoint(x, y)?.closest('.label') !== one)
                .map((x) => `${one.textContent} at ${String(Math.round(x))}`)
            }),
        ),
      ).toEqual([])
      expect(await card.evaluate((one) => one.scrollWidth - one.clientWidth)).toBe(0)
      return {
        values: rows.values.filter((one) => one.seen).map(({ text }) => text),
        months: rows.months.filter((one) => one.seen).map(({ text }) => text),
      }
    }
    const choose = async (index: number) => {
      await card.locator('.cell').nth(index).locator('input').focus()
      await page.keyboard.press('Space')
      await expect(card.locator('.cell').nth(index)).toHaveClass(/chosen/)
    }

    // A year, the penultimate chosen, beside the furthest: the chosen one's value is seen, inside the card.
    days = scenarios.year
    await page.goto('/money/exchange')
    await expect(card.locator('.cell')).toHaveCount(41)
    await choose(39)
    const year = await placed()
    expect(year.values).toContain(await card.locator('.cell.chosen .value .label').textContent())

    // Eight months, every one a candidate: the first and the last always seen.
    days = scenarios.months
    await page.reload()
    await expect(card.locator('.cell')).toHaveCount(8)
    const months = await placed()
    const named = await card.locator('.month .label').allTextContents()
    expect(months.months.at(0)).toBe(named.at(0))
    expect(months.months.at(-1)).toBe(named.at(-1))

    // Six values, every one a candidate: another choice hides none and brings none back.
    days = scenarios.values
    await page.reload()
    await expect(card.locator('.cell')).toHaveCount(6)
    const six = await placed()
    await choose(1)
    expect((await placed()).values).toEqual(six.values)

    // Six better and worse by turns: over the line and under it, the values stand on both sides.
    mixed = true
    await page.reload()
    await expect(card.locator('.cell.good')).toHaveCount(3)
    await placed()
  })
