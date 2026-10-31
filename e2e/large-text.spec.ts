/// <reference lib="dom" />
// DOM for the code inside page.evaluate, which runs in the browser.
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

/** An account, two spendings of the month, an exchange and an income: every figure of «Деньги» drawn. */
async function aMonth(page: Page): Promise<string> {
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
  for (const [index, amount] of ['6500', '1800'].entries())
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
  return card
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
      expect(await pageSideways(page, page.locator('.intro-title'))).toBe(0)
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
      const card = await aMonth(page)
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
      ]
      for (const [path, answer] of screens) {
        await page.goto(path)
        expect(await pageSideways(page, answer), path).toBe(0)
      }
      // The legend of «Графики» keeps its names: with the ring in the card they were narrowed to nothing.
      await page.goto('/money/charts')
      await expect(page.locator('.legend .name').first()).toBeVisible()
      for (const name of await page.locator('.legend .name').all())
        expect((await name.boundingBox())!.width).toBeGreaterThan(40)
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
    })
  })
