/// <reference lib="dom" />
// DOM for the code inside page.evaluate, which runs in the browser.
import { actorCodec, settingsOf } from '@molvia/model'
import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { facesIn } from './scroll'
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
 * How far the words of the elements a selector finds stand past the inner edge of their card, at most — a tail
 * of a row cut by its card is no width of the page (adversarial Б1, Б2, Б4).
 */
function pastCard(page: Page, selector: string, card = '.card'): Promise<number> {
  return page.locator(selector).evaluateAll(
    (elements, around) =>
      Math.max(
        -1,
        ...elements.map((element) => {
          const box = element.closest(around)!
          const edge =
            box.getBoundingClientRect().right - parseFloat(getComputedStyle(box).paddingRight)
          const range = document.createRange()
          range.selectNodeContents(element)
          return Math.max(...[...range.getClientRects()].map((line) => line.right)) - edge
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
      spentOn: day(1),
      amount: { amount, currency: 'AMD' },
      categoryId: categories[index]?.id,
      accountId: card,
    })
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
        ['/money/exchange', page.locator('article button.body')],
        ['/money/incomes', page.locator('.cards button.body')],
        ['/money/charts', page.locator('.center')],
        ['/money/charts?mode=year', page.locator('.columns')],
        ['/money/accounts', page.getByRole('button', { name: 'Добавить счёт' })],
        [`/money/accounts/${card}`, page.locator('.balance .figure')],
        [`/money/accounts/${savings}`, page.locator('.balance .figure')],
        [`/money/accounts/${dinars}`, page.locator('.balance .figure')],
      ]
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
      // The legend of «Графики» keeps its names: with the ring in the card they were narrowed to nothing;
      // and every sum stands within the card (adversarial А3).
      await page.goto('/money/charts')
      await expect(page.locator('.legend .name').first()).toBeVisible()
      await facesIn(page)
      for (const name of await page.locator('.legend .name').all())
        expect((await name.boundingBox())!.width).toBeGreaterThan(40)
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
      await expect(page.locator('article button.body').first()).toBeVisible()
      // «Как меняли»: «Не указано · Банк, нал · Безнал · Обменник».
      expect(await sheetSideways(page, page.locator('article button.body').first())).toBe(0)
      await page.goto('/money/accounts')
      expect(await sheetSideways(page, page.getByRole('button', { name: 'Добавить счёт' }))).toBe(0)
      await page.goto('/money/budget')
      expect(
        await sheetSideways(page, page.getByRole('button', { name: 'Задать план категории' })),
      ).toBe(0)
      // A record opened from «Траты»: its sum and its category, the category under the sum where the two do
      // not fit (adversarial Б4).
      await aRecord(page, '12540')
      await page.goto('/money/spendings')
      const record = page.getByRole('button', { name: /Ереван Сити/ }).first()
      await expect(record).toBeVisible()
      await record.click()
      const sheet = page.locator('dialog[open]').last()
      await expect(sheet.locator('.summary .figure')).toBeVisible()
      await expect
        .poll(() => sheet.evaluate((dialog) => dialog.getAnimations({ subtree: true }).length))
        .toBe(0)
      await facesIn(page)
      expect(await sheet.evaluate((dialog) => dialog.scrollWidth - dialog.clientWidth)).toBe(0)
      expect(await pastCard(page, 'dialog[open] .summary .badge', '.summary')).toBeLessThanOrEqual(
        0.5,
      )
      await page.keyboard.press('Escape')
      await expect(page.locator('dialog[open]')).toHaveCount(0)
      // A new category's colours, four and four (adversarial А10).
      await page.goto('/money/categories')
      expect(
        await sheetSideways(page, page.getByRole('button', { name: 'Добавить категорию' })),
      ).toBe(0)
    })
  })
