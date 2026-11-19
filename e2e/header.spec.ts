/// <reference lib="dom" />
import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { actorCodec, settingsOf } from '@molvia/model'
import { TITLE_GAP, actionRow, anAccount, apart, collapse } from './header-row'
import type { Box } from './header-row'
import { asBrowser, signedIn } from './session'

/**
 * MOL-75. The back label of a nested screen at 320px — the narrowest phone that will really
 * come — in both languages, since their labels differ in length. At rest the row is the
 * label's; once the small title comes in, the label gives way by the iOS ladder and never
 * reaches past the window or under the title. Which step of the ladder a screen gets is the
 * font's to decide and is not asserted: only that nothing overlaps.
 */

test.use({ viewport: { width: 320, height: 568 }, reducedMotion: 'reduce' })

interface Words {
  /**
   * A screen where the whole label must survive the scroll at 320px — room for it with 6–8px to
   * spare, which no difference of font rasterising closes: the ladder must not step down where it
   * need not (review Р-3). «Деньги» 59 in ~74 over «Доходы»; «Settings» 68 in ~74 over
   * «Devices». Not «Запись» over «Что взяли?», which took «Поход»'s place (MOL-128): 59.4 in 60.2 on
   * macOS, and on Linux it steps to «Назад» — the ladder is right, the margin is not there.
   */
  kept: string
  back: string
  settings: string
  money: string
  /** The record typed by hand, over its search. */
  entry: string
  purchases: string
  /** The parent of an account's screen, and the action in its row (MOL-336). */
  accounts: string
  edit: string
}

const LANGUAGES: [string, Words][] = [
  [
    'ru-RU',
    {
      kept: '/money/incomes',
      back: 'Назад',
      settings: 'Настройки',
      money: 'Деньги',
      entry: 'Запись',
      purchases: 'Покупки',
      accounts: 'Счета',
      edit: 'Править',
    },
  ],
  [
    'en-US',
    {
      kept: '/settings/devices',
      back: 'Back',
      settings: 'Settings',
      money: 'Money',
      entry: 'Entry',
      purchases: 'Purchases',
      accounts: 'Accounts',
      edit: 'Edit',
    },
  ],
]

/** Every screen with `meta.parent`, and the title its chevron is labelled with. */
function screens(trip: string, words: Words): [string, string][] {
  return [
    ['/money/exchange', words.money],
    ['/money/incomes', words.money],
    ['/settings/devices', words.settings],
    ['/privacy', words.settings],
    ['/money/categories', words.money],
    ['/purchases/manual/add', words.entry],
    [`/purchases/${trip}`, words.purchases],
    // A finished record is a record too: one word over its search and the open one's (MOL-208, Е-13).
    [`/purchases/${trip}/add`, words.entry],
  ]
}

/** A finished record, so the two screens under «Покупки» have something to open. */
async function finishedTrip(page: Page): Promise<string> {
  const headers = await asBrowser(page)
  const context = settingsOf(
    actorCodec.parse(await (await page.request.get('/api/actors/me', { headers })).json()),
  )
  const started = await page.request.post('/api/trips', {
    headers,
    data: { context, id: randomUUID(), place: { name: 'Header shop', kind: 'store' } },
  })
  expect(started.status()).toBe(201)
  const { id } = (await started.json()) as { id: string }
  const finished = await page.request.post(`/api/trips/${id}/finish`, {
    headers,
    data: { finishedOnDeviceAt: new Date().toISOString() },
  })
  expect(finished.status()).toBe(204)
  return id
}

/** The button, the small title and the page's width, read in one frame. */
async function row(
  page: Page,
): Promise<{ back: Box; small: Box; label: Box | null; page: number }> {
  return page.evaluate(() => {
    const box = (node: Element) => {
      const { left, right, top, bottom } = node.getBoundingClientRect()
      return { left, right, top, bottom }
    }
    const back = document.querySelector('.back')
    const small = document.querySelector('.small')
    if (!back || !small) throw new Error('no back button or small title in the row')
    const label = back.querySelector('.label')
    return {
      back: box(back),
      small: box(small),
      label: label ? box(label) : null,
      page: document.documentElement.scrollWidth,
    }
  })
}

/**
 * The label as wide as its own sample, in fractions: the integers of `scrollWidth` and
 * `clientWidth` called a label cut by 0.39px whole, ellipsis and all (review А1).
 */
async function whole(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const label = document.querySelector('.back .label')
    const sample = Array.from(document.querySelectorAll('.samples > span')).find(
      (each) => each.textContent === label?.textContent,
    )
    if (!label || !sample) throw new Error('no label, or no sample drawn for it')
    return label.getBoundingClientRect().width >= sample.getBoundingClientRect().width - 0.01
  })
}

for (const [locale, words] of LANGUAGES) {
  test.describe(locale, () => {
    test.use({ locale })

    test('at rest every back label is whole and inside the window', async ({ page }) => {
      test.setTimeout(60_000)
      await signedIn(page)
      const trip = await finishedTrip(page)

      for (const [path, parent] of screens(trip, words)) {
        await test.step(path, async () => {
          await page.goto(path)
          const back = page.getByRole('button', { name: `${words.back} ${parent}`, exact: true })
          await expect(back).toBeVisible()
          await expect(page.locator('.screen')).not.toHaveClass(/collapsed/)
          const label = back.locator('.label')
          await expect(label).toHaveText(parent)
          expect(await whole(page)).toBe(true)

          const { back: box, page: width } = await row(page)
          expect(box.left).toBeGreaterThanOrEqual(0)
          expect(box.right - box.left).toBeGreaterThanOrEqual(44)
          expect(box.bottom - box.top).toBeGreaterThanOrEqual(44)
          expect(width).toBeLessThanOrEqual(320)
        })
      }
    })

    test('scrolled, the back label gives way to the title and stays inside the window', async ({
      page,
    }) => {
      test.setTimeout(60_000)
      await signedIn(page)
      const trip = await finishedTrip(page)

      for (const [path, parent] of screens(trip, words)) {
        await test.step(path, async () => {
          await page.goto(path)
          await expect(page.locator('.back')).toBeVisible()
          await collapse(page)

          const { back, small, label, page: width } = await row(page)
          expect(back.left).toBeGreaterThanOrEqual(0)
          expect(back.right - back.left).toBeGreaterThanOrEqual(44)
          expect(back.bottom - back.top).toBeGreaterThanOrEqual(44)
          expect(apart(back, small), 'the back button reaches under the small title').toBe(true)
          if (label) expect(apart(label, small)).toBe(true)
          expect(width).toBeLessThanOrEqual(320)

          // Whatever the label became, the name is the same — the word shown first, where it
          // leads after it (review Р-2) — and a label that is shown is whole.
          await expect(
            page.getByRole('button', { name: `${words.back} ${parent}`, exact: true }),
          ).toBeVisible()
          const shown = page.locator('.back .label')
          if (path === words.kept) await expect(shown).toHaveText(parent)
          if ((await shown.count()) > 0) {
            await expect(shown).toHaveText(new RegExp(`^(${parent}|${words.back})$`))
            expect(await whole(page)).toBe(true)
          }
        })
      }
    })

    test('an action in the row keeps its words, and the small title gives way before it (MOL-336)', async ({
      page,
    }) => {
      test.setTimeout(60_000)
      await signedIn(page)
      // 28 letters: wider than the row at 320 and at 390 alike; «Наличные» fits beside the action.
      for (const [name, cut] of [
        ['Зарплатная карта Ардшинбанка', true],
        ['Наличные', false],
      ] as const) {
        const id = await anAccount(page, name)
        await test.step(name, async () => {
          await page.goto(`/money/accounts/${id}`)
          const action = page.getByRole('button', { name: words.edit, exact: true })
          await expect(action).toBeVisible()
          await expect(
            page.getByRole('button', { name: `${words.back} ${words.accounts}`, exact: true }),
          ).toBeVisible()
          await expect(page.locator('.screen')).not.toHaveClass(/collapsed/)
          const rest = await actionRow(page)
          expect(rest.wordsPast, 'the action at rest').toBeLessThanOrEqual(0.01)
          expect(apart(rest.back, rest.action), 'the back button reaches under the action').toBe(
            true,
          )

          await collapse(page)

          const row = await actionRow(page)
          // The action's words whole inside its box, and «…» on the title only where it does not fit.
          expect(row.wordsPast, 'the action collapsed').toBeLessThanOrEqual(0.01)
          expect(row.cut, 'the small title cut').toBe(cut)
          // A gap of --space-2 between the title and the action, never the one against the other.
          expect(row.gap).toBeGreaterThanOrEqual(TITLE_GAP)
          expect(apart(row.back, row.small)).toBe(true)
          expect(apart(row.back, row.action)).toBe(true)
          expect(row.action.right).toBeLessThanOrEqual(320)
          expect(row.page).toBeLessThanOrEqual(320)
        })
      }
    })
  })
}
