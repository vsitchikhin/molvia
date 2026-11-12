/// <reference lib="dom" />
// DOM for the code inside page.evaluate, which runs in the browser.
import { setsRoot, zooms } from '@molvia/frontend/testing/root-font-size'
import { actorCodec, settingsOf } from '@molvia/model'
import { randomUUID } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { facesIn, stillIn } from './scroll'
import { asBrowser, signedIn } from './session'

/**
 * Android's text at 150 % and 200 % on a phone of 320 (MOL-321, owner's В-4 «б»): no screen and no sheet
 * stands past the phone. The text is made large as the project's other specs make it — the root's
 * font-size, which every size of the app is in. Before the task the switches of «Настройки» and of the
 * exchange's sheet went 120 px sideways at 150 %, the rings of «Деньги» and «Графики» 43 and 47, a
 * newcomer's «Что брать» 42, and at 200 % the month's switcher, the day's sum, the account's balance and
 * the sheets of an account and a plan besides.
 */

test.use({ locale: 'ru-RU', reducedMotion: 'reduce' })

function day(back: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Yerevan' }).format(
    new Date(Date.now() - back * 24 * 60 * 60 * 1000),
  )
}

async function post(page: Page, path: string, data: object): Promise<void> {
  const made = await page.request.post(path, { headers: await asBrowser(page), data })
  expect(made.status(), `${path} ${await made.text()}`).toBeLessThan(300)
}

/** How far the page stands past the window, once the answer and its faces are there. */
async function pageSideways(page: Page, answer: Locator): Promise<number> {
  await expect(answer.first()).toBeVisible()
  await facesIn(page)
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
}

async function sheetSideways(page: Page, opener: Locator): Promise<number> {
  await opener.click()
  const sheet = page.locator('dialog[open]').last()
  await expect(sheet).toBeVisible()
  // The sheet's segments are measured a frame after it opens (`SegmentedControl`): wait for its rise.
  await expect
    .poll(() => sheet.evaluate((dialog) => dialog.getAnimations({ subtree: true }).length))
    .toBe(0)
  await facesIn(page)
  const sideways = await sheet.evaluate((dialog) => dialog.scrollWidth - dialog.clientWidth)
  await page.keyboard.press('Escape')
  await expect(page.locator('dialog[open]')).toHaveCount(0)
  return sideways
}

/**
 * How far the words of the elements a selector finds stand past an inner edge of their card, either side, at
 * most — a tail of a row cut by its card is no width of the page (adversarial Б1, Б2, Б4, В5).
 */
function pastCard(page: Page, selector: string, card = '.card'): Promise<number> {
  return page.locator(selector).evaluateAll(
    (elements, around) =>
      Math.max(
        -1,
        ...elements.map((element) => {
          const box = element.closest(around)!
          const rect = box.getBoundingClientRect()
          const style = getComputedStyle(box)
          const range = document.createRange()
          range.selectNodeContents(element)
          const lines = [...range.getClientRects()]
          // Either side: a sum under narrow words stood past the card's left edge, «00 000 ₽» (adversarial В5).
          return Math.max(
            Math.max(...lines.map((line) => line.right)) -
              (rect.right - parseFloat(style.paddingRight)),
            rect.left + parseFloat(style.paddingLeft) - Math.min(...lines.map((line) => line.left)),
          )
        }),
      ),
    card,
  )
}

/** A record by hand at «Ереван Сити», finished: a row of «Траты» that opens the sheet of a record. */
async function aRecord(page: Page, amount: string): Promise<void> {
  const headers = await asBrowser(page)
  const made = await page.request.post('/api/catalogue/items', {
    headers,
    data: {
      kind: 'product',
      name: `Молоко «Марианна» ${randomUUID().slice(0, 4)}`,
      defaultUnit: 'l',
    },
  })
  expect(made.status()).toBeLessThan(300)
  const body = (await made.json()) as { id?: string; item?: { id: string } }
  const context = settingsOf(
    actorCodec.parse(await (await page.request.get('/api/actors/me', { headers })).json()),
  )
  const trip = randomUUID()
  await post(page, '/api/trips', {
    context,
    id: trip,
    place: { kind: 'store', name: 'Ереван Сити' },
  })
  await post(page, `/api/trips/${trip}/expenses`, {
    id: randomUUID(),
    itemId: body.item?.id ?? body.id,
    quantity: { value: '1', unit: 'l' },
    amount: { amount, currency: 'AMD' },
  })
  await post(page, `/api/trips/${trip}/finish`, {})
}

/**
 * An account, two spendings of the month, an exchange and an income: every figure of «Деньги» drawn — and the
 * sums of a month in drams and of savings in roubles, «Потрачено 125 403 ֏» and «1 234 567,89 ₽», which a
 * month of four digits passed by (adversarial А1, А4, А5).
 */
async function aMonth(page: Page): Promise<{ card: string; savings: string; dinars: string }> {
  const card = randomUUID()
  await post(page, '/api/money/accounts', {
    id: card,
    name: 'Карта',
    currency: 'AMD',
    savings: false,
    start: { amount: '100000', currency: 'AMD' },
    startOn: day(3),
  })
  const { categories } = (await (
    await page.request.get('/api/spending-categories', { headers: await asBrowser(page) })
  ).json()) as { categories: { id: string }[] }
  const savings = randomUUID()
  await post(page, '/api/money/accounts', {
    id: savings,
    name: 'Рубли',
    currency: 'RUB',
    savings: true,
    start: { amount: '1234567.89', currency: 'RUB' },
    startOn: day(3),
  })
  // A minus and capital letters are wider than figures: «−999,99 RSD» stood past its card (adversarial Б3).
  const dinars = randomUUID()
  await post(page, '/api/money/accounts', {
    id: dinars,
    name: 'Динары',
    currency: 'RSD',
    savings: false,
    start: { amount: '-999.99', currency: 'RSD' },
    startOn: day(3),
  })
  for (const [index, amount] of ['123603', '1800'].entries())
    await post(page, '/api/spendings', {
      id: randomUUID(),
      // Today, never yesterday: on the 1st yesterday is the month before, with no ring in this one.
      spentOn: day(0),
      amount: { amount, currency: 'AMD' },
      categoryId: categories[index]?.id,
      accountId: card,
    })
  // A spending on no account: «Счета» say «1 операция не попала в остатки», whose chevron stood past the phone
  // at 200 % (adversarial Д1).
  await post(page, '/api/spendings', {
    id: randomUUID(),
    spentOn: day(0),
    amount: { amount: '500', currency: 'AMD' },
    categoryId: categories[1]?.id,
  })
  // A plan of six figures and a spending of six in it: «Осталось 124 597 ֏» of a row of «Бюджет» stood 31 px
  // past the phone at 200 % (adversarial В4).
  const planned = await page.request.put('/api/budget/plans', {
    headers: await asBrowser(page),
    data: {
      categoryId: categories[0]?.id,
      from: day(0).slice(0, 7),
      plan: { kind: 'amount', amount: { amount: '250000', currency: 'AMD' } },
    },
  })
  expect(planned.ok(), await planned.text()).toBe(true)
  await post(page, '/api/exchanges', {
    id: randomUUID(),
    given: { amount: '1000', currency: 'RUB' },
    received: { amount: '4800', currency: 'AMD' },
    exchangedOn: day(1),
    receivedAccountId: card,
  })
  await post(page, '/api/incomes', {
    id: randomUUID(),
    amount: { amount: '20000', currency: 'AMD' },
    receivedOn: day(1),
    source: 'salary',
    accountId: card,
  })
  return { card, savings, dinars }
}

/**
 * A record at «Ереван Сити»: ground coffee by the kilogram, rated, so «Что брать» names its price — «12 800 ֏/кг» stood
 * past the plate of «За единицу» at 150 % (MOL-334) — here ten kilos at «125 403,50 ֏/кг», a price per unit of six
 * figures; caviar for «1 234 567,89 ₽», a sum of another currency under the total and in a row's meta, which broke
 * inside at 200 % (adversarial С1, С3); milk and bread wait in «Оценки». Then a record by hand still open, the coffee
 * dearer there: «Продолжить» on «Покупки», and «Тут дешевле» naming the price of «Ереван Сити» (С2).
 */
async function aLife(page: Page): Promise<{ finished: string }> {
  const headers = await asBrowser(page)
  const context = settingsOf(
    actorCodec.parse(await (await page.request.get('/api/actors/me', { headers })).json()),
  )
  const item = async (name: string, defaultUnit: string): Promise<string> => {
    const made = await page.request.post('/api/catalogue/items', {
      headers,
      data: { kind: 'product', name: `${name} ${randomUUID().slice(0, 4)}`, defaultUnit },
    })
    expect(made.status()).toBeLessThan(300)
    const body = (await made.json()) as { id?: string; item?: { id: string } }
    return (body.item?.id ?? body.id)!
  }
  const coffee = await item('Кофе «Ташир» молотый', 'kg')
  const milk = await item('Молоко «Марианна» 3,2 %', 'l')
  const bread = await item('Хлеб «Матнакаш»', 'piece')
  const caviar = await item('Икра «Русское море»', 'piece')
  const finished = randomUUID()
  await post(page, '/api/trips', {
    context,
    id: finished,
    place: { kind: 'store', name: 'Ереван Сити' },
  })
  for (const [itemId, value, unit, amount, currency] of [
    [coffee, '10', 'kg', '1254035', 'AMD'],
    [milk, '1', 'l', '2543.50', 'AMD'],
    [bread, '2', 'piece', '600', 'AMD'],
    [caviar, '1', 'piece', '1234567.89', 'RUB'],
  ] as const)
    await post(page, `/api/trips/${finished}/expenses`, {
      id: randomUUID(),
      itemId,
      quantity: { value, unit },
      amount: { amount, currency },
    })
  await post(page, `/api/trips/${finished}/finish`, {})
  const rated = await page.request.put(`/api/verdicts/${coffee}`, { headers, data: { score: 5 } })
  expect(rated.status()).toBeLessThan(300)
  const open = randomUUID()
  await post(page, '/api/trips', { context, id: open, place: { kind: 'store', name: 'SAS' } })
  await post(page, `/api/trips/${open}/expenses`, {
    id: randomUUID(),
    itemId: coffee,
    quantity: { value: '1', unit: 'kg' },
    amount: { amount: '1300000', currency: 'AMD' },
  })
  return { finished }
}

/** How many lines each element's text stands on, at most: a sum is one (`frontend.md`, «A sum never breaks»). */
function linesOf(page: Page, selector: string): Promise<number> {
  return page.locator(selector).evaluateAll((all) =>
    Math.max(
      0,
      ...all.map((one) => {
        const range = document.createRange()
        range.selectNodeContents(one)
        return new Set([...range.getClientRects()].map((line) => Math.round(line.top))).size
      }),
    ),
  )
}

/** Every word of a box on its lines: none cut by its box (`scrollWidth`) — «Написать разработч…» at 100 % on 320. */
function cutWords(page: Page, selector: string): Promise<number> {
  return page
    .locator(selector)
    .evaluateAll((all) => all.filter((one) => one.scrollWidth > one.clientWidth + 1).length)
}

/**
 * A receipt photographed, read by the fake reader (am-05: thirteen lines, «Итог чека 8 676,41 ֏») and open for review —
 * where «Итог чека» stood 71 px past its card at 150 % (MOL-334).
 */
async function aReceipt(page: Page, ru: boolean): Promise<void> {
  const L = (one: string, other: string): string => (ru ? one : other)
  await page.goto('/purchases')
  await page
    .getByRole('button', { name: L('Сфотографировать чек', 'Photograph a receipt') })
    .click()
  const encoded = await page.evaluate(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 900
    canvas.height = 2400
    const context = canvas.getContext('2d')!
    context.fillStyle = '#f7f3ea'
    context.fillRect(0, 0, 900, 2400)
    context.fillStyle = '#222'
    for (let y = 80; y < 2320; y += 60) context.fillRect(60, y, 780 - (y % 300), 18)
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', 0.9)
    })
    let binary = ''
    for (const byte of new Uint8Array(await blob!.arrayBuffer()))
      binary += String.fromCharCode(byte)
    return btoa(binary)
  })
  await page
    .locator('dialog[open] input[type="file"]:not([capture])')
    .first()
    .setInputFiles({
      name: 'part-1.jpg',
      mimeType: 'image/jpeg',
      buffer: Buffer.from(encoded, 'base64'),
    })
  const edges = page.locator('dialog[open]').filter({ hasText: L('Края чека', 'Receipt edges') })
  await expect(edges).toBeVisible()
  // Until it has risen a sheet takes no tap, and then for a double tap's floor (MOL-69), as `receipts.spec` waits.
  const risen = async (sheet: Locator): Promise<void> => {
    await stillIn(sheet)
    await page.waitForTimeout(350)
  }
  await risen(edges)
  await edges.getByRole('button', { name: L('Готово', 'Done') }).click()
  await expect(edges).toHaveCount(0)
  await risen(page.locator('dialog[open]').last())
  await page.getByRole('button', { name: L('Отправить чек', 'Send receipt') }).click()
  await expect(page.locator('dialog[open]')).toHaveCount(0)
  const parsed = async (): Promise<string | null> => {
    const answer = await page.request.get('/api/receipts', { headers: await asBrowser(page) })
    const { receipts } = (await answer.json()) as { receipts: { id: string; status: string }[] }
    return receipts.find((one) => one.status === 'parsed')?.id ?? null
  }
  await expect.poll(parsed, { timeout: 30_000 }).not.toBeNull()
  await page.goto(`/purchases/receipts/${(await parsed())!}`)
}

for (const size of ['150%', '200%'])
  test.describe(`the text at ${size} on a phone of 320`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 720 })
      await page.addInitScript((value) => {
        document.addEventListener('DOMContentLoaded', () => {
          const style = document.createElement('style')
          style.textContent = `html { font-size: ${value} }`
          document.head.append(style)
        })
      }, size)
    })

    test('a newcomer’s «Что брать» and «Настройки» stand within the phone', async ({ page }) => {
      await signedIn(page, '/')
      const title = page.locator('.intro-title')
      expect(await pageSideways(page, title)).toBe(0)
      // A hyphen only with large text: Safari knows no limit to it, and at 100 % it broke «по-купки»
      // (self-review №2). The inline size beats the injected one.
      const hyphens = () => title.evaluate((heading) => getComputedStyle(heading).hyphens)
      expect(await hyphens()).toBe('auto')
      await page.evaluate(() => {
        document.documentElement.style.fontSize = '100%'
      })
      await expect.poll(hyphens).toBe('manual')
      await page.evaluate(() => {
        document.documentElement.style.fontSize = ''
      })
      // The tab bar is fixed, so it is in no width of the page: every label within its own column and
      // the phone, as `--text-tab` holds it (self-review №1).
      for (const tab of await page.locator('nav.tabbar .tab').all()) {
        const fits = await tab.evaluate((column) => {
          const label = column.querySelector('.label')!.getBoundingClientRect()
          const box = column.getBoundingClientRect()
          return (
            label.left >= box.left - 0.5 && label.right <= box.right + 0.5 && box.right <= 320.5
          )
        })
        expect(fits, await tab.innerText()).toBe(true)
      }
      await page.goto('/settings')
      // The scheme's three segments one under another, each word whole (MOL-189).
      expect(await pageSideways(page, page.getByText('Тёмная', { exact: true }))).toBe(0)
      await expect(page.getByRole('group', { name: 'Тема' }).locator('.track')).toHaveClass(
        /stacked/,
      )
    })

    test('every screen of «Деньги» stands within the phone', async ({ page }) => {
      test.setTimeout(90_000)
      await signedIn(page)
      const { card, savings, dinars } = await aMonth(page)
      const screens: [string, Locator][] = [
        ['/money', page.locator('.donut .sector-name')],
        ['/money/spendings', page.locator('.day-head')],
        ['/money/budget', page.getByRole('button', { name: 'Задать план категории' })],
        ['/money/exchange', page.locator('.rows button.list-row')],
        ['/money/incomes', page.locator('.cards button.body')],
        ['/money/charts', page.locator('.center')],
        ['/money/charts?mode=year', page.locator('.columns')],
        ['/money/accounts', page.getByRole('button', { name: 'Добавить счёт' })],
        [`/money/accounts/${card}`, page.locator('.balance .figure')],
        [`/money/accounts/${savings}`, page.locator('.balance .figure')],
        [`/money/accounts/${dinars}`, page.locator('.balance .figure')],
      ]
      // First while the answer is on its way, before the device remembers any: the ring of the charts' skeleton, a square of 13.25rem, stood
      // «Графики» 47 px sideways at 150 % (adversarial Е1).
      const held =
        /\/api\/(money|spendings|spending-categories|budget|exchanges|incomes|trips|rates)/
      await page.route(held, () => undefined)
      for (const [path] of screens) {
        await page.goto(path)
        expect(
          await pageSideways(page, page.locator('[class*="skeleton-"]')),
          `${path} loading`,
        ).toBe(0)
        // The rows' skeleton is the rows' shape: no circle in a narrow row (self-review 10, №3).
        await expect(page.locator('.skeleton-rows .circle:visible'), `${path} loading`).toHaveCount(
          0,
        )
      }
      await page.unroute(held)
      for (const [path, answer] of screens) {
        await page.goto(path)
        expect(await pageSideways(page, answer), path).toBe(0)
        // Every balance within its card, «−999,99 RSD» too (adversarial А6, Б3).
        if (path.startsWith('/money/accounts/'))
          expect(await pastCard(page, '.balance p.figure', '.balance'), path).toBeLessThanOrEqual(
            0.5,
          )
      }
      // A row's tail within its card: the savings' «1 234 567,89 ₽», «Убрать» (adversarial Б1, Б2).
      await page.goto('/money/accounts')
      await expect(page.locator('.list-row .tail').first()).toBeVisible()
      await facesIn(page)
      expect(await pastCard(page, '.list-row .tail')).toBeLessThanOrEqual(0.5)
      // From the row's own edge too: a sum in the words' face is wider than the figures' (adversarial Г2).
      expect(await pastCard(page, '.list-row .tail', '.list-row')).toBeLessThanOrEqual(0.5)
      // The chevron of «1 операция не попала в остатки» within the phone: the words took it 19 px past at 200 %
      // (adversarial Д1).
      const unassigned = page.locator('button.unassigned svg').last()
      await expect(unassigned).toBeVisible()
      expect(
        (await unassigned.boundingBox())!.x + (await unassigned.boundingBox())!.width,
      ).toBeLessThanOrEqual(320.5)
      // «Осталось» of «Бюджет» within its line and still read: shrunk to a column of the words some 30 px wide
      // it was 4.9 px at 200 %, hidden by the title's `overflow` from any width of the page (adversarial Г1, В4).
      await page.goto('/money/budget')
      const left = page.locator('.head .amount').first()
      await expect(left).toBeVisible()
      await facesIn(page)
      expect(await pastCard(page, '.head .amount', '.head')).toBeLessThanOrEqual(0.5)
      expect(
        await left.evaluate((amount) => parseFloat(getComputedStyle(amount).fontSize)),
      ).toBeGreaterThanOrEqual(13)
      // The plan under the name whole, never under «…»: «125 403 ֏ из» and the plan hidden (adversarial Д2).
      const meta = page.locator('.list-row .meta').first()
      expect(
        await meta.evaluate((line) => line.scrollHeight - line.clientHeight),
      ).toBeLessThanOrEqual(1)
      await page.goto('/money/categories')
      await expect(page.locator('.list-row .tail').first()).toBeVisible()
      await facesIn(page)
      expect(await pastCard(page, '.list-row .tail')).toBeLessThanOrEqual(0.5)
      // «На счетах сейчас» is one line, never a sign a line beside «1 счёт ›» (adversarial А8).
      await page.goto('/money')
      const now = page.locator('.now .figure')
      await expect(now).toBeVisible()
      await facesIn(page)
      expect(
        await now.evaluate((figure) => {
          const range = document.createRange()
          range.selectNodeContents(figure)
          return new Set([...range.getClientRects()].map((line) => Math.round(line.top))).size
        }),
      ).toBe(1)
      // A link row's value is a unit as its label is: «Наличны / е» of the kit broke (adversarial Х4).
      await expect(page.locator('.nav-row .value').first()).toHaveCSS(
        'hyphenate-limit-chars',
        '6 2 2',
      )
      // So is a sector's name by the ring of «Куда ушли», a component of its own: «Развлеч / ения» (adversarial Х5).
      await expect(page.locator('.sector-name').first()).toHaveCSS('hyphenate-limit-chars', '6 2 2')
      // The legend of «Графики» keeps its names: with the ring in the card they were narrowed to nothing;
      // and every sum stands within the card (adversarial А3).
      await page.goto('/money/charts')
      await expect(page.locator('.legend .name').first()).toBeVisible()
      await facesIn(page)
      for (const name of await page.locator('.legend .name').all())
        expect((await name.boundingBox())!.width).toBeGreaterThan(40)
      // A name of the legend is a unit of words: a hyphen from six letters, never «Продук / ты» (adversarial Х4).
      await expect(page.locator('.legend .name').first()).toHaveCSS(
        'hyphenate-limit-chars',
        '6 2 2',
      )
      const amountsPast = await page.locator('.legend .amount').evaluateAll((amounts) =>
        amounts.map((amount) => {
          const card = amount.closest('.card')!
          const inner =
            card.getBoundingClientRect().right - parseFloat(getComputedStyle(card).paddingRight)
          return amount.getBoundingClientRect().right - inner
        }),
      )
      expect(Math.max(...amountsPast)).toBeLessThanOrEqual(0.5)
      // A balance of nine figures fits its card, not only the page (adversarial А6).
      await page.goto(`/money/accounts/${savings}`)
      const balance = page.locator('p.figure').first()
      await expect(balance).toBeVisible()
      await facesIn(page)
      expect(
        await balance.evaluate((figure) => {
          const card = figure.parentElement!
          const inner =
            card.getBoundingClientRect().right - parseFloat(getComputedStyle(card).paddingRight)
          const range = document.createRange()
          range.selectNodeContents(figure)
          return Math.max(...[...range.getClientRects()].map((line) => line.right)) - inner
        }),
      ).toBeLessThanOrEqual(0.5)
    })

    test('the sheets of «Деньги» stand within the phone', async ({ page }) => {
      test.setTimeout(90_000)
      await signedIn(page)
      await aMonth(page)
      await page.goto('/money')
      await expect(page.locator('.donut .sector-name').first()).toBeVisible()
      expect(await sheetSideways(page, page.getByRole('button', { name: 'Добавить трату' }))).toBe(
        0,
      )
      await page.goto('/money/exchange')
      await expect(page.locator('.rows button.list-row').first()).toBeVisible()
      // «Как меняли»: «Не указано · Банк, нал · Безнал · Обменник».
      expect(await sheetSideways(page, page.locator('.rows button.list-row').first())).toBe(0)
      await page.goto('/money/accounts')
      expect(await sheetSideways(page, page.getByRole('button', { name: 'Добавить счёт' }))).toBe(0)
      await page.goto('/money/budget')
      expect(
        await sheetSideways(page, page.getByRole('button', { name: 'Задать план категории' })),
      ).toBe(0)
      // A record opened from «Траты»: its sum and its category, the category under the sum where the two do
      // not fit (adversarial Б4); an item of seven figures, its sum alone under the name (adversarial Ж1).
      await aRecord(page, '1234567')
      await page.goto('/money/spendings')
      const record = page.getByRole('button', { name: /Ереван Сити/ }).first()
      await expect(record).toBeVisible()
      // While its items come their skeleton stands, a bar of 9rem stood the sheet 112 px sideways at 150 %: the
      // trip's answer is held until the skeleton is measured.
      const trip = /\/api\/trips\/[0-9a-f-]{36}$/
      let release: () => void = () => undefined
      const answered = new Promise<void>((resolve) => (release = resolve))
      await page.route(
        trip,
        async (route) => {
          await answered
          await route.continue()
        },
        { times: 1 },
      )
      await record.click()
      const sheet = page.locator('dialog[open]').last()
      await expect(sheet.locator('.summary .figure')).toBeVisible()
      await expect(sheet.locator('.ghost-item').first()).toBeVisible()
      await facesIn(page)
      const sideways = () => sheet.evaluate((dialog) => dialog.scrollWidth - dialog.clientWidth)
      expect(await sideways()).toBe(0)
      // A sheet's title beside its «×» takes a hyphen from five letters (owner's В-7 «а», adversarial Х6).
      await expect(sheet.locator('h2.title')).toHaveCSS('hyphenate-limit-chars', '5 2 2')
      release()
      await expect(sheet.locator('.item-name').first()).toBeVisible()
      await expect
        .poll(() => sheet.evaluate((dialog) => dialog.getAnimations({ subtree: true }).length))
        .toBe(0)
      await facesIn(page)
      expect(await sideways()).toBe(0)
      expect(await pastCard(page, 'dialog[open] .summary .badge', '.summary')).toBeLessThanOrEqual(
        0.5,
      )
      expect(await pastCard(page, 'dialog[open] .item-amount', '.item')).toBeLessThanOrEqual(0.5)
      await page.keyboard.press('Escape')
      await expect(page.locator('dialog[open]')).toHaveCount(0)
      // A new category's colours, four and four (adversarial А10).
      await page.goto('/money/categories')
      expect(
        await sheetSideways(page, page.getByRole('button', { name: 'Добавить категорию' })),
      ).toBe(0)
    })

    // The amount typed stands whole in its field, shrunk to it: at 150 % «12540» showed «2540» while typed and «12»
    // once left, at 200 % two figures and a half (adversarial З1); and «Откуда» says which account — «Ка…» at 150 %
    // beside the wallet and the label (adversarial З2).
    test('what is typed in a sheet of «Деньги» stands whole', async ({ page }) => {
      test.setTimeout(60_000)
      await signedIn(page)
      const { card } = await aMonth(page)
      await post(page, '/api/money/accounts', {
        id: randomUUID(),
        name: 'Наличные',
        currency: 'AMD',
        savings: false,
        start: { amount: '50000', currency: 'AMD' },
        startOn: day(3),
      })
      const typed = async (sheet: Locator): Promise<number> => {
        const field = sheet.locator('.app-field-entry input')
        await field.fill('125403')
        await field.blur()
        await facesIn(page)
        return field.evaluate((input) => input.scrollWidth - input.clientWidth)
      }
      await page.goto('/money')
      await page.getByRole('button', { name: 'Добавить трату' }).click()
      expect(await typed(page.locator('dialog[open]').last()), 'spending').toBeLessThanOrEqual(0)
      await page.goto(`/money/accounts/${card}`)
      await page.getByRole('button', { name: 'Перевести', exact: true }).click()
      const sheet = page.locator('dialog[open]').last()
      await expect(sheet.locator('.row .value').first()).toHaveText('Карта')
      await facesIn(page)
      for (const value of await sheet.locator('.row .value').all())
        expect(await value.evaluate((name) => name.scrollWidth - name.clientWidth)).toBe(0)
      expect(await typed(sheet), 'transfer').toBeLessThanOrEqual(0)
    })

    // A life's sums and names, every row, tile and field of «Деньги» and «Настройки» (self-review of round 9): at
    // 200 % a row's circle left its words some 40 px — «О|б|м|е|н», «Карта Амер|иабан|ка» — a tile broke its sum
    // («250 00|0 ₽»), «Темп месяца» stood 23 px past the phone, a select showed «Армя», and in an exchange the sum
    // and its currency side by side showed «1254» and no currency (adversarial И2, И3).
    test('a life’s sums and names stand whole in rows, tiles and fields', async ({ page }) => {
      test.setTimeout(90_000)
      await signedIn(page)
      const card = randomUUID()
      const savings = randomUUID()
      for (const [id, name, currency, amount, kept] of [
        [card, 'Карта Америабанка', 'AMD', '1250000', false],
        [savings, 'Копилка', 'RUB', '1234567.89', true],
      ] as const)
        await post(page, '/api/money/accounts', {
          id,
          name,
          currency,
          savings: kept,
          start: { amount, currency },
          startOn: day(3),
        })
      const { categories } = (await (
        await page.request.get('/api/spending-categories', { headers: await asBrowser(page) })
      ).json()) as { categories: { id: string }[] }
      await post(page, '/api/spendings', {
        id: randomUUID(),
        spentOn: day(0),
        amount: { amount: '12345678', currency: 'AMD' },
        categoryId: categories[0]?.id,
        accountId: card,
      })
      // The 15th of each of the two months before: one of them is a month of an even number (adversarial К3).
      const back = (months: number): string => {
        const [year, month] = day(0).split('-').map(Number) as [number, number]
        return new Date(Date.UTC(year, month - 1 - months, 15)).toISOString().slice(0, 10)
      }
      for (const spentOn of [back(1), back(2)])
        await post(page, '/api/spendings', {
          id: randomUUID(),
          spentOn,
          amount: { amount: '1000', currency: 'AMD' },
          categoryId: categories[0]?.id,
        })
      // A day in two currencies, the dinars with no rate: its sum breaks after «+» (adversarial К1).
      await post(page, '/api/spendings', {
        id: randomUUID(),
        spentOn: day(0),
        amount: { amount: '50', currency: 'RSD' },
        categoryId: categories[1]?.id,
      })
      await post(page, '/api/incomes', {
        id: randomUUID(),
        amount: { amount: '250000', currency: 'RUB' },
        receivedOn: day(0),
        source: 'salary',
        accountId: savings,
      })
      await post(page, '/api/exchanges', {
        id: randomUUID(),
        given: { amount: '50000', currency: 'RUB' },
        received: { amount: '240000', currency: 'AMD' },
        exchangedOn: day(0),
        givenAccountId: savings,
        receivedAccountId: card,
      })
      // A row's words take its width: no circle, the title whole.
      const rowsWhole = async (where: string): Promise<void> => {
        await expect(page.locator('.list-row').first()).toBeVisible()
        await facesIn(page)
        await expect(page.locator('.list-row .circle:visible'), where).toHaveCount(0)
        expect(
          await page
            .locator('.list-row .title')
            .evaluateAll(
              (titles) =>
                titles.filter((title) => title.scrollWidth > title.clientWidth + 1).length,
            ),
          where,
        ).toBe(0)
      }
      await page.goto('/money')
      await expect(page.locator('.tile-figure').first()).toBeVisible()
      await facesIn(page)
      expect(await pastCard(page, '.tile-figure', '.tile')).toBeLessThanOrEqual(0.5)
      await page.goto('/money/spendings')
      await rowsWhole('spendings')
      expect(await pastCard(page, '.day-total', '.day-head')).toBeLessThanOrEqual(0.5)
      // The month's figure shrinks to the head: «12 345 678 ֏» took «Траты» 27 px sideways at 200 % (adversarial К6).
      expect(await pastCard(page, '.total .figure', '.total')).toBeLessThanOrEqual(0.5)
      expect(await pageSideways(page, page.locator('.day-head'))).toBe(0)
      await page.goto(`/money/accounts/${card}`)
      await rowsWhole('account')
      expect(await pastCard(page, '.list-row .tail', '.list-row')).toBeLessThanOrEqual(0.5)
      await page.goto('/money/accounts')
      await rowsWhole('accounts')
      expect(await pastCard(page, '.tile-figure, .tile-second', '.tile')).toBeLessThanOrEqual(0.5)
      await page.goto('/money/charts')
      expect(await pageSideways(page, page.locator('.pace'))).toBe(0)
      await page.goto('/money/charts?mode=year')
      await expect(page.locator('.labels .letter').first()).toBeVisible()
      await expect(page.locator('.labels .word:visible')).toHaveCount(0)
      await facesIn(page)
      // Every other month's letter, none over its neighbour: a letter alone is 20 px over a column of 9 at 200 %.
      const letters = await page
        .locator('.labels .letter:visible')
        .evaluateAll((all) =>
          all
            .map((one) => one.getBoundingClientRect())
            .map((box) => ({ left: box.left, right: box.right })),
        )
      for (const [index, { left, right }] of letters.entries()) {
        const next = letters[index + 1]
        if (next && next.left > left) expect(right).toBeLessThanOrEqual(next.left + 0.5)
      }
      // The chosen month is named whatever its place: October chosen stood unnamed (adversarial К3).
      const even = [back(1), back(2)].find((date) => Number(date.slice(5, 7)) % 2 === 0)!
      await page.goto(`/money/charts?mode=year&year=${even.slice(0, 4)}`)
      await page
        .locator(`.chart input.radio[value="${String(Number(even.slice(5, 7)) - 1)}"]`)
        .first()
        .check({ force: true })
      await expect(page.locator('.labels .label.chosen .letter').first()).toBeVisible()
      // A screen's title breaks a word with a hyphen with large text: «Устройст|ва» at 150 % (adversarial Л5). CI's
      // Chromium may have no dictionary, so the style is read, as the block button's is.
      await page.goto('/settings/devices')
      await expect(page.getByRole('heading', { level: 1 })).toHaveCSS('hyphens', 'auto')
      // A select's chosen words wrap over it; a switch's words are never cut.
      await page.goto('/settings')
      await expect(page.locator('.chosen-words').first()).toBeVisible()
      await facesIn(page)
      for (const select of await page.locator('.app-field select').all())
        await expect(select).toHaveCSS('opacity', '0')
      expect(
        await page
          .locator('.list-row .title, .entry-text')
          .evaluateAll(
            (words) => words.filter((one) => one.scrollWidth > one.clientWidth + 1).length,
          ),
      ).toBe(0)
      // A category's dot stays before its name in a narrow row (adversarial К2).
      await page.goto('/money')
      await page.getByRole('button', { name: 'Добавить трату' }).click()
      const spending = page.locator('dialog[open]').last()
      await expect
        .poll(() => spending.evaluate((dialog) => dialog.getAnimations({ subtree: true }).length))
        .toBe(0)
      await facesIn(page)
      // A tap within a double tap of the sheet's opening is held (MOL-69) and opens nothing: tapped again till it opens.
      const more = spending.getByRole('button', { name: /Ещё/ })
      await expect(async () => {
        if ((await page.locator('dialog[open]').count()) < 2) await more.click()
        await expect(page.locator('dialog[open]')).toHaveCount(2, { timeout: 1000 })
      }).toPass()
      const dotted = page.locator('dialog[open]').last().locator('.list-row:has(> .dot)')
      await expect(dotted.first()).toBeVisible()
      expect(
        await dotted.evaluateAll(
          (rows) =>
            rows.filter(
              (row) =>
                row.querySelector(':scope > .dot')!.getBoundingClientRect().left >
                row.querySelector('.title')!.getBoundingClientRect().left,
            ).length,
        ),
      ).toBe(0)
      // An exchange: its sum and currency one under the other, the sum typed whole.
      await page.goto('/money/exchange')
      await page.getByRole('button', { name: 'Записать обмен' }).click()
      const sheet = page.locator('dialog[open]').last()
      const pair = sheet.locator('.pair').first()
      await expect(pair).toBeVisible()
      const [amount, currency] = await pair.locator('.app-field').all()
      expect((await currency!.boundingBox())!.y).toBeGreaterThan((await amount!.boundingBox())!.y)
      const typed = amount!.locator('input')
      await typed.fill('125403,50')
      await typed.blur()
      await facesIn(page)
      expect(
        await typed.evaluate((input) => input.scrollWidth - input.clientWidth),
      ).toBeLessThanOrEqual(0)
    })

    // Beyond «Деньги» (MOL-334): before it at 200 % the record went 102 px sideways, «Оценки» 23, «Данные и
    // приватность» 33, the strip of a record by hand 7, the price of «Что брать» 13; a sum in a row read «25 403,50»
    // for «125 403,50», and a key of the scale was 36 px at 150 %.
    test('every screen beyond «Деньги» stands within the phone', async ({ page }) => {
      test.setTimeout(90_000)
      await signedIn(page)
      const { finished } = await aLife(page)
      const screens: [string, Locator][] = [
        ['/', page.locator('.best .price')],
        ['/purchases', page.locator('.open .list-row')],
        ['/purchases/manual', page.locator('.list-row .tail')],
        [`/purchases/${finished}`, page.locator('.total .sum')],
        ['/verdicts', page.locator('.scale .key')],
        ['/privacy', page.locator('dd')],
        ['/terms', page.getByRole('heading', { level: 1 })],
        ['/settings/devices', page.getByRole('heading', { level: 1 })],
        ['/settings/bot', page.getByRole('heading', { level: 1 })],
      ]
      for (const [path, answer] of screens) {
        await page.goto(path)
        expect(await pageSideways(page, answer), path).toBe(0)
      }
      // The price of «Брали здесь» within its plate.
      await page.goto('/')
      await expect(page.locator('.best .price')).toBeVisible()
      await facesIn(page)
      expect(await pastCard(page, '.best .price', '.best')).toBeLessThanOrEqual(0.5)
      // The record's total and every sum of its rows within the card.
      await page.goto(`/purchases/${finished}`)
      await expect(page.locator('.total .sum')).toBeVisible()
      await facesIn(page)
      expect(await pastCard(page, '.total .sum', '.total')).toBeLessThanOrEqual(0.5)
      expect(await pastCard(page, '.list-row .amount', '.list-row')).toBeLessThanOrEqual(0.5)
      // A sum of another currency under the total and a price per unit in a row's meta, each whole and within: at 200 %
      // «1 234 567,89 / ₽», «125 403, / 50 ֏» (adversarial С1, С3; owner's В-6 «а»).
      for (const [money, box] of [
        ['.total .money', '.total'],
        ['.list-row .quantity .money', '.list-row'],
      ] as const) {
        expect(await linesOf(page, money), money).toBe(1)
        expect(await pastCard(page, money, box), money).toBeLessThanOrEqual(0.5)
      }
      // «Продолжить» whole in its card (А12 of MOL-321's review): its pill stands 8 into the row's padding by the
      // kit's rule (MOL-191), so the card is the edge.
      await page.goto('/purchases')
      await expect(page.locator('.open .list-row')).toBeVisible()
      await facesIn(page)
      expect(await pastCard(page, '.open .list-row .tail .button', '.card')).toBeLessThanOrEqual(
        0.5,
      )
      expect(await cutWords(page, '.open .list-row .tail .button')).toBe(0)
      // The strip of a record by hand within the phone: its pills of a glyph and a word stood 7 px past it.
      await page.goto('/purchases/manual')
      await expect(page.locator('.dock button').first()).toBeVisible()
      await facesIn(page)
      await stillIn(page.locator('.dock'))
      for (const button of await page.locator('.dock button').all())
        expect(
          (await button.boundingBox())!.x + (await button.boundingBox())!.width,
        ).toBeLessThanOrEqual(320.5)
      // Five keys of the scale in one row, none under 44 px — a thumb's, whatever the text (owner's В-3 «а»).
      await page.goto('/verdicts')
      const keys = page.locator('.scale .key')
      await expect(keys).toHaveCount(5)
      await facesIn(page)
      await stillIn(page.locator('.verdict'))
      const boxes = await keys.evaluateAll((all) =>
        all.map((key) => key.getBoundingClientRect().toJSON() as DOMRect),
      )
      for (const box of boxes) {
        expect(box.width).toBeGreaterThanOrEqual(44)
        expect(box.top).toBe(boxes[0]!.top)
        expect(box.right).toBeLessThanOrEqual(320.5)
      }
      // The keys alone take the card's sides: the scale's ends keep its padding, as the question does (review №3, №6).
      const sides = await page.locator('.verdict').evaluate((card) => {
        const inner =
          card.getBoundingClientRect().left + parseFloat(getComputedStyle(card).paddingLeft)
        return {
          ends: card.querySelector('.ends')!.getBoundingClientRect().left - inner,
          scale: card.querySelector('.scale')!.getBoundingClientRect().left - inner,
        }
      })
      expect(sides.ends).toBeGreaterThanOrEqual(-0.5)
      expect(sides.scale).toBeLessThan(-1)
      // From six letters in a unit of words, from twelve in a paragraph, never in a segment (owner's В-5 «а»): from six
      // in a paragraph «Данные и приватность» cut 394 words that would have stood whole (adversarial Х1). Each unit
      // includes `word-unit` itself — a row's title, a link row's label, a button, a switch row's words — and a
      // screen's title is a heading (review №5, adversarial Х3). CI's Chromium may have no dictionary, so the style is
      // read.
      await page.goto('/settings')
      await expect(page.locator('.list-row .title').first()).toBeVisible()
      for (const unit of ['.list-row .title', '.nav-row .label', '.button', 'label.row .label']) {
        await expect(page.locator(unit).first(), unit).toHaveCSS('hyphens', 'auto')
        await expect(page.locator(unit).first(), unit).toHaveCSS('hyphenate-limit-chars', '6 2 2')
      }
      // A title from five (owner's В-7 «а»): «Нова / я трата» beside the sheet's «×» (adversarial Х6).
      await expect(page.locator('h1').first()).toHaveCSS('hyphenate-limit-chars', '5 2 2')
      await expect(page.locator('.segment .word').first()).toHaveCSS('hyphens', 'manual')
      await page.goto('/settings/bot')
      await expect(page.locator('label.row .label').first()).toHaveCSS(
        'hyphenate-limit-chars',
        '6 2 2',
      )
      await page.goto('/privacy')
      // A kind of data is named in a unit, told in a paragraph: «Напоминан / ия об / оценке» broke (adversarial Х4).
      await expect(page.locator('dt').first()).toHaveCSS('hyphenate-limit-chars', '6 2 2')
      await expect(page.locator('dd').first()).toHaveCSS('hyphens', 'auto')
      await expect(page.locator('dd').first()).toHaveCSS('hyphenate-limit-chars', '12 5 5')
    })

    test('the sheets beyond «Деньги» stand within the phone', async ({ page }) => {
      test.setTimeout(90_000)
      await signedIn(page)
      const { finished } = await aLife(page)
      // A purchase of the record: «За единицу» over its price, the price within the plate.
      await page.goto(`/purchases/${finished}`)
      const coffee = page.locator('.list-row').filter({ hasText: 'Кофе' })
      await expect(coffee).toBeVisible()
      await coffee.click()
      const sheet = page.locator('dialog[open]').last()
      await expect(sheet.locator('.per-unit-value')).toBeVisible()
      await expect
        .poll(() => sheet.evaluate((dialog) => dialog.getAnimations({ subtree: true }).length))
        .toBe(0)
      await facesIn(page)
      expect(await sheet.evaluate((dialog) => dialog.scrollWidth - dialog.clientWidth)).toBe(0)
      expect(await pastCard(page, 'dialog[open] .per-unit-value', '.per-unit')).toBeLessThanOrEqual(
        0.5,
      )
      await page.keyboard.press('Escape')
      await expect(page.locator('dialog[open]')).toHaveCount(0)
      // «Тут дешевле» names the cheaper price whole within its line: «125 403,50 / ֏/кг» at 200 % (adversarial С2).
      await page.goto('/purchases/manual')
      await page.locator('.list-row').filter({ hasText: 'Кофе' }).click()
      const hint = page.locator('dialog[open] [data-hint="item"]')
      await expect(hint).toBeVisible()
      await stillIn(page.locator('dialog[open]').last())
      await facesIn(page)
      expect(await linesOf(page, 'dialog[open] .hint .money')).toBe(1)
      expect(await pastCard(page, 'dialog[open] .hint .money', '.hint')).toBeLessThanOrEqual(0.5)
      await page.keyboard.press('Escape')
      await expect(page.locator('dialog[open]')).toHaveCount(0)
      // The scale in the sheet of «Что брать»: its column is wide enough with no card's sides to take.
      await page.goto('/')
      const card = page.locator('button.tap').first()
      await expect(card).toBeVisible()
      // At 200 % the docked strip takes half the window, and a tap aimed by a script lands under it (MOL-321's price,
      // `frontend.md`): the card is clicked as itself; the list may be answered again as it comes in, and a click on
      // the card it replaced opens nothing.
      await expect(async () => {
        if ((await page.locator('dialog[open]').count()) === 0) await card.dispatchEvent('click')
        await expect(page.locator('dialog[open]')).toHaveCount(1, { timeout: 1000 })
      }).toPass()
      const rating = page.locator('dialog[open]').last()
      await expect(rating.locator('.scale .key')).toHaveCount(5)
      await expect
        .poll(() => rating.evaluate((dialog) => dialog.getAnimations({ subtree: true }).length))
        .toBe(0)
      await facesIn(page)
      for (const key of await rating.locator('.scale .key').all())
        expect((await key.boundingBox())!.width).toBeGreaterThanOrEqual(44)
      expect(await rating.evaluate((dialog) => dialog.scrollWidth - dialog.clientWidth)).toBe(0)
      await page.keyboard.press('Escape')
      await expect(page.locator('dialog[open]')).toHaveCount(0)
      await page.goto('/purchases/manual')
      expect(await sheetSideways(page, page.getByRole('button', { name: 'Закончить' }))).toBe(0)
      await page.goto('/settings')
      expect(
        await sheetSideways(page, page.getByRole('button', { name: /Написать разработчику/ })),
      ).toBe(0)
    })

    test('a receipt under review stands within the phone', async ({ page }) => {
      test.setTimeout(90_000)
      await signedIn(page)
      await aReceipt(page, true)
      expect(await pageSideways(page, page.locator('.total .amount'))).toBe(0)
      expect(await pastCard(page, '.total .amount', '.total')).toBeLessThanOrEqual(0.5)
      expect(await sheetSideways(page, page.locator('.total button.main'))).toBe(0)
      expect(await sheetSideways(page, page.locator('button.receipt-line').first())).toBe(0)
      // «За единицу» of a line of the receipt and of a line typed, a price per unit of six figures within its plate —
      // the plate hides what stands past it, so no width of the sheet tells (review №2).
      for (const opener of [
        page.locator('button.receipt-line').first(),
        page.getByRole('button', { name: /Добавить строку/ }),
      ]) {
        await opener.click()
        const sheet = page.locator('dialog[open]').last()
        await expect(sheet.locator('input[data-field="amount"]')).toBeVisible()
        await stillIn(sheet)
        await sheet.locator('input[data-field="quantity"]').fill('1')
        await sheet.locator('input[data-field="amount"]').fill('125403,50')
        await expect(sheet.locator('.per-unit-value')).toContainText('125')
        await facesIn(page)
        expect(
          await pastCard(page, 'dialog[open] .per-unit-value', '.per-unit'),
        ).toBeLessThanOrEqual(0.5)
        await page.keyboard.press('Escape')
        await expect(page.locator('dialog[open]')).toHaveCount(0)
      }
    })

    // In English a whole sum of drams is «֏125,403», wider for its count than Russian's «125 403 ֏» — a count at
    // 0.56 of the size let it 6 px past its card (adversarial В2, В3).
    test.describe('in English', () => {
      test.use({ locale: 'en-US' })
      test('the figures of «Money» stand within their cards', async ({ page }) => {
        test.setTimeout(60_000)
        await signedIn(page)
        await aMonth(page)
        await page.goto('/money')
        await expect(page.locator('.spent .figure')).toBeVisible()
        await facesIn(page)
        expect(await pastCard(page, '.spent .figure', '.spent')).toBeLessThanOrEqual(0.5)
        await page.goto('/money/charts?mode=year')
        await expect(page.locator('.chart-card .figure').first()).toBeVisible()
        await facesIn(page)
        expect(await pastCard(page, '.chart-card .figure', '.chart-card')).toBeLessThanOrEqual(0.5)
      })

      // «֏8,676.41» and «Receipt total»: 93 px past the card at 150 % (MOL-334).
      test('a receipt under review stands within the phone', async ({ page }) => {
        test.setTimeout(90_000)
        await signedIn(page)
        await aReceipt(page, false)
        expect(await pageSideways(page, page.locator('.total .amount'))).toBe(0)
        expect(await pastCard(page, '.total .amount', '.total')).toBeLessThanOrEqual(0.5)
      })
    })
  })

// A step or two over the browser's own size (MOL-334, adversarial С4): at 110–115 % a row of a record kept its sum
// beside words of 41–57 px, and a price per unit of a million shrank to 4.9 px in them. Since `$row-tight` is 17rem the
// sum goes under the words from some 106 % on 320, and the price stands whole, in its column, at the meta's own size.
for (const size of ['110%', '115%'])
  test(`a price per unit in a record's row stands whole at ${size} on 320`, async ({ page }) => {
    test.setTimeout(60_000)
    await page.setViewportSize({ width: 320, height: 720 })
    await page.addInitScript((value) => {
      document.addEventListener('DOMContentLoaded', () => {
        const style = document.createElement('style')
        style.textContent = `html { font-size: ${value} }`
        document.head.append(style)
      })
    }, size)
    await signedIn(page)
    const { finished } = await aLife(page)
    await page.goto(`/purchases/${finished}`)
    const money = page.locator('.list-row .quantity .money')
    await expect(money.first()).toBeVisible()
    await facesIn(page)
    expect(await linesOf(page, '.list-row .quantity .money')).toBe(1)
    expect(await pastCard(page, '.list-row .quantity .money', '.words')).toBeLessThanOrEqual(0.5)
    for (const one of await money.all())
      expect(
        await one.evaluate(
          (price) =>
            getComputedStyle(price).fontSize === getComputedStyle(price.closest('.meta')!).fontSize,
        ),
        await one.innerText(),
      ).toBe(true)
  })

// At 100 % on 320 nothing of MOL-334 moves (the control): no figure shrinks, the scale keeps its gap of 8 and its
// keys of 44, and no word is hyphenated — but «Написать разработчику», which read «Написать разработч…» (MOL-334).
test('the text at 100 % on a phone of 320 keeps its look', async ({ page }) => {
  test.setTimeout(60_000)
  await page.setViewportSize({ width: 320, height: 720 })
  await signedIn(page)
  const { finished } = await aLife(page)
  await page.goto(`/purchases/${finished}`)
  await expect(page.locator('.total .sum')).toBeVisible()
  await facesIn(page)
  await expect(page.locator('.total .sum')).toHaveCSS('font-size', '28px')
  await page.goto('/verdicts')
  await expect(page.locator('.scale')).toHaveCSS('column-gap', '8px')
  await expect(page.locator('.scale .key').first()).toHaveCSS('hyphens', 'manual')
  await page.goto('/settings')
  await expect(page.locator('.list-row .title').first()).toBeVisible()
  await facesIn(page)
  expect(await cutWords(page, '.list-row .title')).toBe(0)
})

// The narrowest list cards at 100 % on 320 — «Категории», «Бюджет», «Счета», some 17.88rem — stand 0.88rem over
// `$row-tight` (MOL-334, self-review №7): a row of theirs keeps the look of 100 %, its circle shown and its tail beside
// its words; the large text's look begins only at some 106 %. A category is told by its circle, an account by its
// balance beside its name.
test('the narrowest list cards at 100 % on a phone of 320 keep their rows', async ({ page }) => {
  test.setTimeout(60_000)
  await page.setViewportSize({ width: 320, height: 720 })
  await signedIn(page)
  await aMonth(page)
  for (const [path, sign] of [
    ['/money/categories', 'circle'],
    ['/money/budget', 'circle'],
    ['/money/accounts', 'tail'],
  ] as const) {
    await page.goto(path)
    await expect(page.locator(`.list-row > .${sign}`).first(), path).toBeVisible()
    await facesIn(page)
    const rows = await page.locator('.list-row:visible').evaluateAll((all) =>
      all.map((row) => {
        const circle = row.querySelector(':scope > :is(.circle, .icon)')
        const words = row.querySelector(':scope > .words')!.getBoundingClientRect()
        const tail = row.querySelector(':scope > .tail')?.getBoundingClientRect()
        return {
          title: row.querySelector('.title')?.textContent,
          circleGone: circle !== null && getComputedStyle(circle).display === 'none',
          tailUnder:
            tail !== undefined && (tail.top >= words.bottom || tail.left < words.right - 0.5),
        }
      }),
    )
    expect(
      rows.filter(({ circleGone, tailUnder }) => circleGone || tailUnder),
      path,
    ).toEqual([])
  }
})

// The system's font size is the root's, and reaches the eye, whatever reaches the page (MOL-334, adversarial Г8, Г13,
// Г14, Г15): a sheet of `public/` by a `<link>`, a `.css` or a partial a script imports, a nested rule of plain CSS, a
// package beside the module, a link in it, a `<style>` a template renders, a sheet it imports — each ways past a guard
// that reads the sources by where they lie. So the outcome is read here, by the rule `useLargeText.test.ts` reads the
// sources by: every sheet the build made, whatever it imported, and every sheet of the page as the browser holds it,
// its imports opened — under a media query or a state the page is not in too — with no `zoom`, which draws large
// text back at 100 % with the root untouched; and the browser's own size set apart from 16, the root's the same with
// every sheet and its `style` as with none, and no element of the page drawn zoomed.
test('the system’s font size is the root’s, whatever reaches the page', async ({ page }) => {
  test.setTimeout(60_000)
  const holdsBack = (css: string): boolean => setsRoot(css) || zooms(css)
  // The build of this run, made before any test by the preview's server (`playwright.config.ts`).
  const built = new URL('../frontend/dist-e2e/', import.meta.url)
  const bundle = readdirSync(built, { recursive: true, encoding: 'utf8' }).filter((path) =>
    path.endsWith('.css'),
  )
  expect(bundle.length).toBeGreaterThan(0)
  expect(bundle.filter((path) => holdsBack(readFileSync(new URL(path, built), 'utf8')))).toEqual([])
  const browser = await page.context().newCDPSession(page)
  await browser.send('Page.setFontSizes', { fontSizes: { standard: 20 } })
  await page.setViewportSize({ width: 320, height: 720 })
  await signedIn(page)
  for (const path of ['/', '/purchases', '/money', '/settings']) {
    await page.goto(path)
    await expect(page.locator('h1').first(), path).toBeVisible()
    const root = await page.evaluate(() => {
      const html = document.documentElement
      const size = () => getComputedStyle(html).fontSize
      const authored = size()
      const style = html.getAttribute('style')
      const sheets = [...document.styleSheets].filter((sheet) => !sheet.disabled)
      // A sheet whose rules the page may not read is one this test cannot vouch for: refused, never passed — an
      // import is read through to its own sheet (Г14), whose `cssText` names only its address.
      const refused = ':root { font-size: 0 }'
      const textOf = (sheet: CSSStyleSheet): string => {
        try {
          return [...sheet.cssRules]
            .map((rule) =>
              rule instanceof CSSImportRule
                ? rule.styleSheet
                  ? textOf(rule.styleSheet)
                  : refused
                : rule.cssText,
            )
            .join('\n')
        } catch {
          return refused
        }
      }
      const texts = sheets.map((sheet, at) => ({
        where: sheet.href ?? `<style> ${String(at)}`,
        css: textOf(sheet),
      }))
      const zoomed = [...document.querySelectorAll('*')]
        .filter((element) => element.currentCSSZoom !== 1)
        .map(
          (element) =>
            element.tagName.toLowerCase() +
            (element.id ? `#${element.id}` : '') +
            [...element.classList].map((name) => `.${name}`).join(''),
        )
      for (const sheet of sheets) sheet.disabled = true
      html.removeAttribute('style')
      const own = size()
      for (const sheet of sheets) sheet.disabled = false
      if (style !== null) html.setAttribute('style', style)
      return { authored, own, texts, zoomed }
    })
    expect(root.texts.length, path).toBeGreaterThan(0)
    expect(
      root.texts.filter(({ css }) => holdsBack(css)).map(({ where }) => where),
      path,
    ).toEqual([])
    expect({ authored: root.authored, own: root.own, zoomed: root.zoomed }, path).toEqual({
      authored: '20px',
      own: '20px',
      zoomed: [],
    })
  }
})

// Large text reaches the eye whatever holds it back, on a phone upright and on its side (MOL-334, adversarial
// Г12–Г18): the rules above refuse what sets the root and what zooms, by name, and each round found one more way
// to draw the text small with neither — `font-size-adjust`, the scale's tokens in px, a `transform` — under a media
// query the window of 320 never meets, or over a row or a sheet rather than the title. So the outcome, in both
// windows: every step of the type scale is twice as wide at 200 % as at 100 % where nothing stands over it — in the
// root, out of the body — and as wide in every element of the screen with words of its own as there, a sheet's
// too. No place of the app redefines a step, so a place that draws one otherwise holds the text back. The probe
// takes its face, weight and spacing for itself, since those are each place's own. The scale is read where it is
// declared, in `rem`; `--text-tab` stops at 13.75 px on purpose (В-3 «а»), the tab bar's own, and is no step of it.
const typeScale = [
  ...readFileSync(new URL('../frontend/src/styles/_tokens.scss', import.meta.url), 'utf8').matchAll(
    /^\s*(--text-[-\w]+):\s*[\d.]+rem\b/gm,
  ),
].map(([, step = '']) => step)

test('large text is drawn twice as large at 200 %, everywhere, on a phone upright and on its side', async ({
  page,
}) => {
  test.setTimeout(240_000)
  expect(typeScale.length).toBeGreaterThan(8)
  const browser = await page.context().newCDPSession(page)
  await signedIn(page)
  await aMonth(page)
  const places = [
    { path: '/' },
    { path: '/purchases' },
    { path: '/money' },
    { path: '/settings' },
    { path: '/money', sheet: 'Добавить трату' },
  ]
  const drawn = async (
    place: { path: string; sheet?: string },
    standard: number,
  ): Promise<{
    root: Record<string, number>
    astray: string[]
    places: number
    fields: number
  }> => {
    await browser.send('Page.setFontSizes', { fontSizes: { standard } })
    await page.goto(place.path)
    await expect(page.locator('h1').first(), place.path).toBeVisible()
    if (standard > 16) await expect(page.locator('html')).toHaveAttribute('data-large-text')
    else await expect(page.locator('html')).not.toHaveAttribute('data-large-text')
    if (place.sheet !== undefined) {
      await page.getByRole('button', { name: place.sheet }).click()
      const sheet = page.locator('dialog[open]').last()
      await expect(sheet).toBeVisible()
      await expect
        .poll(() => sheet.evaluate((dialog) => dialog.getAnimations({ subtree: true }).length))
        .toBe(0)
    }
    return page.evaluate(async (steps) => {
      const text = 'ЖЖЖЖЖЖЖЖЖЖЖЖЖЖЖЖЖЖЖЖ'
      const look = (step: string): string =>
        'position: absolute; inset: 0 auto auto 0; white-space: nowrap; font-family: var(--font); ' +
        'font-weight: var(--weight-medium); font-style: normal; letter-spacing: normal; word-spacing: normal; ' +
        `text-transform: none; font-size: var(${step})`
      const probeIn = (host: Element, step: string): HTMLElement => {
        const probe = document.createElement('span')
        probe.style.cssText = look(step)
        probe.textContent = text
        host.append(probe)
        return probe
      }
      // What is typed is a field's value, no node of its own (adversarial Г19): a copy of the field beside it, as
      // wide as what it holds, takes the rules of its classes and its place, and holds the probe's words.
      const typedBeside = (
        field: HTMLInputElement | HTMLTextAreaElement,
        step: string,
      ): HTMLElement => {
        const copy = field.cloneNode(false) as HTMLInputElement | HTMLTextAreaElement
        copy.removeAttribute('id')
        copy.removeAttribute('name')
        copy.setAttribute('aria-hidden', 'true')
        copy.tabIndex = -1
        copy.style.cssText = `${look(step)}; field-sizing: content; box-sizing: content-box; padding: 0; border: 0; width: auto; min-width: 0; max-width: none`
        copy.value = text
        field.after(copy)
        return copy
      }
      const nameOf = (element: Element): string =>
        element.tagName.toLowerCase() + [...element.classList].map((name) => `.${name}`).join('')
      const drawnNow = (element: Element): boolean => element.getClientRects().length > 0
      // The probes' face comes first, by the root's probes alone: a wait with the probes in the screen let it redraw
      // a place under them — a name of «Деньги» answered again took its probe out of the page, 0 px (master, run
      // 41731048482). Then the places are found, probed and measured in one task, with nothing to redraw between.
      const root = steps.map((step) => probeIn(document.documentElement, step))
      document.documentElement.getBoundingClientRect()
      await document.fonts.ready
      // What draws words of its own and is drawn: a closed sheet, a field's inside and an icon hold none.
      const hosts = [...document.body.querySelectorAll('*')].filter(
        (element) =>
          element instanceof HTMLElement &&
          !/^(SCRIPT|STYLE|TEMPLATE|OPTION|SELECT|TEXTAREA)$/.test(element.tagName) &&
          [...element.childNodes].some(
            (node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim() !== '',
          ) &&
          drawnNow(element),
      )
      const fields = [...document.body.querySelectorAll('input, textarea')].filter(
        (field): field is HTMLInputElement | HTMLTextAreaElement =>
          (field instanceof HTMLTextAreaElement ||
            (field instanceof HTMLInputElement &&
              /^(text|search|tel|email|url)$/.test(field.type))) &&
          drawnNow(field),
      )
      const placed = [
        ...hosts.map((host) => ({ host, probes: steps.map((step) => probeIn(host, step)) })),
        ...fields.map((host) => ({ host, probes: steps.map((step) => typedBeside(host, step)) })),
      ]
      const width = (probe: HTMLElement | undefined): number =>
        probe?.getBoundingClientRect().width ?? 0
      const astray = placed.flatMap(({ host, probes }) =>
        steps
          .map((step, index) => ({ step, ratio: width(probes[index]) / width(root[index]) }))
          .filter(({ ratio }) => !(Math.abs(ratio - 1) < 0.01))
          .map(({ step, ratio }) => `${nameOf(host)} ${step} ×${ratio.toFixed(2)}`),
      )
      const widths = Object.fromEntries(steps.map((step, index) => [step, width(root[index])]))
      for (const probe of [...root, ...placed.flatMap(({ probes }) => probes)]) probe.remove()
      return {
        root: widths,
        astray: astray.slice(0, 12),
        places: hosts.length,
        fields: fields.length,
      }
    }, typeScale)
  }
  for (const [width, height] of [
    [320, 720],
    [720, 320],
  ] as const) {
    await page.setViewportSize({ width, height })
    for (const place of places) {
      const where = `${place.path}${place.sheet === undefined ? '' : ` «${place.sheet}»`} at ${String(width)} × ${String(height)}`
      const usual = await drawn(place, 16)
      const large = await drawn(place, 32)
      const short = typeScale
        .map((step) => ({ step, ratio: (large.root[step] ?? 0) / (usual.root[step] ?? 1) }))
        .filter(({ ratio }) => !(ratio > 1.9 && ratio < 2.1))
        .map(({ step, ratio }) => `${step} ×${ratio.toFixed(2)}`)
      expect(short, where).toEqual([])
      expect(usual.places, where).toBeGreaterThan(3)
      // The sheet is opened for its sum: a place with no field read would prove nothing of what is typed.
      if (place.sheet !== undefined) expect(usual.fields, where).toBeGreaterThan(0)
      expect({ usual: usual.astray, large: large.astray }, where).toEqual({ usual: [], large: [] })
    }
  }
})
