/// <reference lib="dom" />
import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { actorCodec, settingsOf } from '@molvia/model'
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
  back: string
  settings: string
  money: string
  trip: string
  history: string
  finished: string
}

const LANGUAGES: [string, Words][] = [
  [
    'ru-RU',
    {
      back: 'Назад',
      settings: 'Настройки',
      money: 'Деньги',
      trip: 'Поход',
      history: 'История походов',
      finished: 'Завершённый поход',
    },
  ],
  [
    'en-US',
    {
      back: 'Back',
      settings: 'Settings',
      money: 'Money',
      trip: 'Trip',
      history: 'Trip history',
      finished: 'Completed trip',
    },
  ],
]

/** Every screen with `meta.parent`, and the title its chevron is labelled with. */
function screens(trip: string, words: Words): [string, string][] {
  return [
    ['/settings/exchange', words.settings],
    ['/settings/incomes', words.settings],
    ['/settings/devices', words.settings],
    ['/privacy', words.settings],
    ['/money/categories', words.money],
    ['/trip/add', words.trip],
    ['/trip/history', words.trip],
    // The longest labels: «История походов» over «Завершённый поход», and that over «Что взяли?».
    [`/trip/history/${trip}`, words.history],
    [`/trip/history/${trip}/add`, words.finished],
  ]
}

/** A finished trip, so the two screens under the history have something to open. */
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

interface Box {
  left: number
  right: number
  top: number
  bottom: number
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

function apart(one: Box, other: Box): boolean {
  return (
    one.right <= other.left ||
    other.right <= one.left ||
    one.bottom <= other.top ||
    other.bottom <= one.top
  )
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
          expect(await label.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true)

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
          // A short screen has nothing to scroll; room under it changes nothing in the row.
          await page.addStyleTag({ content: 'body { padding-bottom: 150vh; }' })
          await page.evaluate(() => {
            window.scrollTo(0, 400)
          })
          await expect(page.locator('.screen')).toHaveClass(/collapsed/)

          const { back, small, label, page: width } = await row(page)
          expect(back.left).toBeGreaterThanOrEqual(0)
          expect(back.right - back.left).toBeGreaterThanOrEqual(44)
          expect(back.bottom - back.top).toBeGreaterThanOrEqual(44)
          expect(apart(back, small), 'the back button reaches under the small title').toBe(true)
          if (label) expect(apart(label, small)).toBe(true)
          expect(width).toBeLessThanOrEqual(320)

          // Whatever the label became, «Back» is read first, and a label that is shown is whole.
          const button = page.getByRole('button', { name: new RegExp(`^${words.back}`) })
          await expect(button).toBeVisible()
          const shown = page.locator('.back .label')
          if ((await shown.count()) > 0) {
            await expect(shown).toHaveText(new RegExp(`^(${parent}|${words.back})$`))
            expect(await shown.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true)
          }
        })
      }
    })
  })
}
