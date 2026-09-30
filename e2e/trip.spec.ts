/// <reference lib="dom" />
// DOM for the code inside page.evaluate, which runs in the browser.
import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { actorCodec, settingsOf } from '@molvia/model'
import { asBrowser, signedIn } from './session'
import type { Page } from '@playwright/test'

/**
 * The record typed by hand — «the trip» in code, «запись» on screen (MOL-128) — from end to end,
 * against the real API: started at the door of a shop, filled one
 * purchase at a time, corrected, and finished. What no component test can show is that the screen
 * and the server agree about every one of those — the trip the phone named, the row the server
 * priced per litre, the total it added up, and the trip that stops being current once it is over.
 *
 * Each test arrives as a new device with its own identity, so what it counts is its own.
 */

/** A word no catalogue holds, so the search finds this test's item and nothing else. */
function nonsense(): string {
  const consonants = 'бвгджзклмнпрстфхцчш'
  const vowels = 'аоуиэы'
  let word = ''
  for (let i = 0; i < 5; i += 1) {
    word += consonants.charAt(Math.floor(Math.random() * consonants.length))
    word += vowels.charAt(Math.floor(Math.random() * vowels.length))
  }
  return word
}

interface Setting {
  readonly page: Page
  readonly word: string
  /** What the server holds of this device's current trip. */
  readonly current: () => Promise<{ expenses: unknown[]; place: { name: string } } | null>
}

/**
 * A device signed in and one item of its own in the catalogue — but no trip yet. The session
 * arrives by itself on the first visit, through the seam (MOL-52, MOL-53), and `page.request`
 * shares the browser context's cookie jar, so these calls are that person's own.
 */
async function device(page: Page): Promise<Setting> {
  await signedIn(page)
  const headers = await asBrowser(page)

  const word = nonsense()
  const proposed = await page.request.post('/api/catalogue/items', {
    headers,
    data: { kind: 'product', name: `Молоко «${word}»`, defaultUnit: 'l' },
  })
  expect([200, 201]).toContain(proposed.status())

  const current = async () => {
    const response = await page.request.get('/api/trips/current', { headers })
    const body = (await response.json()) as {
      trip: { expenses: unknown[]; place: { name: string } } | null
    }
    return body.trip
  }
  return { page, word, current }
}

const sheet = (page: Page) => page.locator('dialog[open]')
const row = (page: Page) => page.locator('.row')
const heading = (page: Page) => page.getByRole('heading', { level: 1 })
/** A row of «Записаны» on «Покупки». */
const recorded = (page: Page, place: string) =>
  page.locator('.recorded .purchase-row').filter({ hasText: place })

/**
 * «Записать покупки» stands in the strip of «Покупки» and of the newcomer's «Что брать» (MOL-128);
 * once «Где вы?» is answered the record itself opens.
 */
async function startTrip(page: Page, place: string): Promise<void> {
  await page.getByRole('button', { name: 'Record purchases' }).click()
  await expect(sheet(page)).toContainText('Where are you?')
  // The sheet takes no tap while it rises.
  await page.waitForTimeout(400)
  await sheet(page).getByLabel('Another place').fill(place)
  await sheet(page).getByRole('button', { name: 'Start the entry' }).click()
  // Gone, not only closed: a sheet slides away for `--dur` after it loses `[open]`, its buttons
  // still drawn, and the next «Start a trip» on the screen was named twice — once in the sheet on
  // its way out (MOL-76, review Р-7; seen under load and on CI, where a trip deleted at once leaves
  // one tap between two starts).
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page).toHaveURL(/\/purchases\/manual$/)
}

/** «Закончить» in the record's header, then the sheet's own «Finish». */
async function finish(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Finish', exact: true }).click()
  await page.waitForTimeout(400)
  await sheet(page).getByRole('button', { name: 'Finish', exact: true }).click()
}

/** From the record up to «Покупки», where a finished record is opened from «Записаны». */
async function toPurchases(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Back Purchases' }).click()
  await expect(page).toHaveURL(/\/purchases$/)
}

async function addItem(page: Page, word: string, price: string): Promise<void> {
  // An empty trip asks for the first item; one with rows has «Add an item» at the end of the card.
  await page.getByRole('button', { name: /Add an item|Find an item/ }).click()
  await page.getByRole('combobox', { name: 'What did you pick up?' }).fill(word)
  await page.getByRole('option').first().click()
  await expect(sheet(page)).toContainText(word)
  await page.waitForTimeout(400)
  await sheet(page).getByLabel('How much').fill('1')
  await sheet(page).getByLabel('Price as on the tag').fill(price)
  await sheet(page).getByRole('button', { name: 'Record' }).click()
  // The path, not the whole address: what the query string carries is not this test's business.
  expect(new URL(page.url()).pathname).toBe('/purchases/manual')
}

/** A purchase with no price: the item and how much, the price left for later (or never). */
async function addUnpriced(page: Page, word: string): Promise<void> {
  await page.getByRole('button', { name: /Add an item|Find an item/ }).click()
  await page.getByRole('combobox', { name: 'What did you pick up?' }).fill(word)
  await page.getByRole('option').first().click()
  await expect(sheet(page)).toContainText(word)
  await page.waitForTimeout(400)
  await sheet(page).getByLabel('How much').fill('1')
  await sheet(page).getByRole('button', { name: 'Record' }).click()
  expect(new URL(page.url()).pathname).toBe('/purchases/manual')
}

test.describe('the trip', () => {
  test('is started, filled, corrected and finished', async ({ page }) => {
    const setting = await device(page)

    await startTrip(page, 'Ереван Сити')
    // The place is on screen before the server has answered, and the server gets it all the same.
    await expect(heading(page)).toHaveText('Ереван Сити')
    await expect.poll(async () => (await setting.current())?.place.name).toBe('Ереван Сити')

    await addItem(page, setting.word, '570')
    await expect(row(page)).toHaveCount(1)
    // The price per litre is the server's: the phone divides nothing once the row is written.
    await expect(row(page).first()).toContainText('570.00')
    await expect(row(page).first()).toContainText('per l')
    await expect(page.locator('.sum')).toContainText('570.00')
    await expect.poll(async () => (await setting.current())?.expenses.length).toBe(1)

    await row(page).first().click()
    await page.waitForTimeout(400)
    await sheet(page).getByLabel('Price as on the tag').fill('580')
    await sheet(page).getByRole('button', { name: 'Save' }).click()
    await expect(sheet(page)).toBeHidden()
    await expect(row(page).first()).toContainText('580.00')
    await expect(page.locator('.sum')).toContainText('580.00')

    await row(page).first().click()
    await page.waitForTimeout(400)
    await sheet(page).getByRole('button', { name: 'Remove the item' }).click()
    await expect(row(page)).toHaveCount(0)
    await expect.poll(async () => (await setting.current())?.expenses.length).toBe(0)

    // The trip is empty again, so «Finish» offers to delete it instead (MOL-76, В-2); finishing
    // it stays the second action, and this trip is kept for the history below.
    await page.getByRole('button', { name: 'Finish', exact: true }).click()
    await expect(sheet(page)).toContainText('Nothing in this entry')
    await page.waitForTimeout(400)
    await sheet(page).getByRole('button', { name: 'Finish anyway' }).click()

    // Over on the phone at once — the record goes up to «Покупки» — and over on the server as soon
    // as the queue has been out (MOL-128).
    await expect(page).toHaveURL(/\/purchases$/)
    await expect(page.getByRole('button', { name: 'Record purchases' })).toBeVisible()
    await expect.poll(setting.current).toBeNull()

    // «Записаны» lists the record just finished, and opens it.
    const recent = recorded(page, 'Ереван Сити')
    await expect(recent).toBeVisible()
    await expect(page.getByText('Your purchases will be here')).toHaveCount(0)
    await recent.click()
    await expect(page).toHaveURL(/\/purchases\/[0-9a-f-]+$/)
    // Both «back»s lead to «Покупки», and the chevron says so.
    await page.getByRole('button', { name: 'Back Purchases' }).click()
    await expect(page).toHaveURL(/\/purchases$/)
    await recent.click()
    await expect(page).toHaveURL(/\/purchases\/[0-9a-f-]+$/)
    await page.goBack()
    await expect(page).toHaveURL(/\/purchases$/)
  })

  test('an empty trip is deleted at once, and the next one starts (MOL-76)', async ({ page }) => {
    const setting = await device(page)
    await startTrip(page, 'SAS')
    await expect.poll(async () => (await setting.current())?.place.name).toBe('SAS')

    // No question for a trip with nothing in it — only «Undo» after.
    await page.getByRole('button', { name: 'Delete the entry' }).click()
    await expect(sheet(page)).toHaveCount(0)
    await expect(page.locator('.undo').filter({ hasText: 'Entry deleted: SAS' })).toBeVisible()
    await expect.poll(setting.current).toBeNull()

    await startTrip(page, 'Ереван Сити')
    await expect(page.locator('.undo').filter({ hasText: 'Entry deleted: SAS' })).toHaveCount(0)
    await expect.poll(async () => (await setting.current())?.place.name).toBe('Ереван Сити')
  })

  test('a trip with a purchase asks first, and «Undo» brings it back whole (MOL-76)', async ({
    page,
  }) => {
    const setting = await device(page)
    await startTrip(page, 'Ереван Сити')
    await addItem(page, setting.word, '570')
    await expect(row(page)).toHaveCount(1)
    await expect.poll(async () => (await setting.current())?.expenses.length).toBe(1)

    await page.getByRole('button', { name: 'Delete the entry' }).click()
    await expect(sheet(page)).toContainText('Delete this entry?')
    await expect(sheet(page)).toContainText('Ереван Сити')
    await expect(sheet(page)).toContainText('1 item')
    await page.waitForTimeout(400)
    await sheet(page).getByRole('button', { name: 'Delete the entry' }).click()
    await expect(page.getByRole('button', { name: 'Record purchases' })).toBeVisible()
    await expect.poll(setting.current).toBeNull()

    // Back as the record going on: first on «Покупки», and whole inside.
    await page.getByRole('button', { name: 'Undo' }).click()
    await page.locator('.open .purchase-row').click()
    await expect(row(page)).toHaveCount(1)
    await expect.poll(async () => (await setting.current())?.expenses.length).toBe(1)
  })

  test('a trip deleted with no connection goes before the next one’s start — no question about it (MOL-76, А3)', async ({
    page,
    context,
  }) => {
    const setting = await device(page)
    await startTrip(page, 'Рынок')
    await addItem(page, setting.word, '570')
    await expect.poll(async () => (await setting.current())?.expenses.length).toBe(1)

    // No signal: «Рынок» finished, «Ереван Сити» started with a purchase, then «Рынок» deleted.
    await context.setOffline(true)
    await finish(page)
    await startTrip(page, 'Ереван Сити')
    await addItem(page, setting.word, '250')
    await toPurchases(page)
    await recorded(page, 'Рынок').click()
    await page.getByRole('button', { name: 'Delete the entry' }).click()
    await page.waitForTimeout(400)
    await sheet(page).getByRole('button', { name: 'Delete the entry' }).click()
    await expect(page).toHaveURL(/\/purchases$/)
    await page.locator('.open .purchase-row').click()
    await expect(heading(page)).toHaveText('Ереван Сити')

    await context.setOffline(false)
    await page.evaluate(() => window.dispatchEvent(new Event('online')))
    await expect
      .poll(async () => (await setting.current())?.place.name, { timeout: 15_000 })
      .toBe('Ереван Сити')
    await expect.poll(async () => (await setting.current())?.expenses.length).toBe(1)
    await expect(page.getByRole('heading', { name: /is already open/ })).toHaveCount(0)
  })

  test('«Undo» puts a deleted trip back in its place — the trip going on stays the one going on (MOL-76, А4)', async ({
    page,
    context,
  }) => {
    const setting = await device(page)
    // The item has to be among the recent ones: with no signal the search looks only there.
    await startTrip(page, 'SAS')
    await addItem(page, setting.word, '500')
    await expect.poll(async () => (await setting.current())?.expenses.length).toBe(1)
    await finish(page)
    await expect.poll(setting.current).toBeNull()

    await context.setOffline(true)
    await startTrip(page, 'Рынок')
    await addItem(page, setting.word, '570')
    await finish(page)
    await startTrip(page, 'Ереван Сити')
    await addItem(page, setting.word, '250')

    // A slip of the finger: «Рынок» deleted from the history, and «Undo» at once.
    await toPurchases(page)
    await recorded(page, 'Рынок').click()
    await page.getByRole('button', { name: 'Delete the entry' }).click()
    await page.waitForTimeout(400)
    await sheet(page).getByRole('button', { name: 'Delete the entry' }).click()
    await expect(page).toHaveURL(/\/purchases$/)
    await page.getByRole('button', { name: 'Undo' }).click()
    await page.locator('.open .purchase-row').click()
    await expect(heading(page)).toHaveText('Ереван Сити')

    await context.setOffline(false)
    await page.evaluate(() => window.dispatchEvent(new Event('online')))
    await expect
      .poll(async () => (await setting.current())?.place.name, { timeout: 15_000 })
      .toBe('Ереван Сити')
    await expect.poll(async () => (await setting.current())?.expenses.length).toBe(1)
    await expect(page.getByRole('heading', { name: /is already open/ })).toHaveCount(0)
    await expect(heading(page)).toHaveText('Ереван Сити')
  })

  test('a trip the server never saw cannot come back once the next one has started there (MOL-76, Б3)', async ({
    page,
    context,
  }) => {
    const setting = await device(page)
    // The item has to be among the recent ones: with no signal the search looks only there.
    await startTrip(page, 'SAS')
    await addItem(page, setting.word, '500')
    await expect.poll(async () => (await setting.current())?.expenses.length).toBe(1)
    await finish(page)
    await expect.poll(setting.current).toBeNull()

    await context.setOffline(true)
    await startTrip(page, 'Рынок')
    await addItem(page, setting.word, '570')
    await finish(page)
    await startTrip(page, 'Ереван Сити')
    await addItem(page, setting.word, '250')
    await toPurchases(page)
    await recorded(page, 'Рынок').click()
    await page.getByRole('button', { name: 'Delete the entry' }).click()
    await page.waitForTimeout(400)
    await sheet(page).getByRole('button', { name: 'Delete the entry' }).click()
    await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible()

    // Out of the dead zone with the strip still up: «Ереван Сити» opens on the server, and «Рынок»,
    // which it never had, can no longer be put back before it — the offer goes.
    await context.setOffline(false)
    await page.evaluate(() => window.dispatchEvent(new Event('online')))
    await expect
      .poll(async () => (await setting.current())?.place.name, { timeout: 15_000 })
      .toBe('Ереван Сити')
    await expect(page.getByRole('button', { name: 'Undo' })).toHaveCount(0)
    await page.locator('.open .purchase-row').click()
    await expect(heading(page)).toHaveText('Ереван Сити')
    await expect(page.getByRole('heading', { name: /is already open/ })).toHaveCount(0)
  })

  test('«Undo» after the queue has gone brings a trip finished offline back finished (MOL-76, В1)', async ({
    page,
    context,
  }) => {
    const setting = await device(page)
    await startTrip(page, 'Рынок')
    await addItem(page, setting.word, '570')
    await expect.poll(async () => (await setting.current())?.expenses.length).toBe(1)
    const market = (await setting.current()) as { id?: string } | null

    // No signal: «Рынок» finished, «Ереван Сити» started, «Рынок» deleted from the history.
    await context.setOffline(true)
    await finish(page)
    await startTrip(page, 'Ереван Сити')
    await addItem(page, setting.word, '250')
    await toPurchases(page)
    await recorded(page, 'Рынок').click()
    await page.getByRole('button', { name: 'Delete the entry' }).click()
    await page.waitForTimeout(400)
    await sheet(page).getByRole('button', { name: 'Delete the entry' }).click()
    await expect(page).toHaveURL(/\/purchases$/)

    // The signal comes back and the queue goes: «Рынок» marked, «Ереван Сити» open. Then «Undo».
    await context.setOffline(false)
    await page.evaluate(() => window.dispatchEvent(new Event('online')))
    await expect
      .poll(async () => (await setting.current())?.place.name, { timeout: 15_000 })
      .toBe('Ереван Сити')
    await page.getByRole('button', { name: 'Undo' }).click()

    // Back finished, with its purchase; the trip going on stays the one going on.
    const headers = await asBrowser(page)
    await expect
      .poll(async () =>
        (await page.request.get(`/api/trips/${market?.id ?? ''}`, { headers })).status(),
      )
      .toBe(200)
    const back = (await (
      await page.request.get(`/api/trips/${market?.id ?? ''}`, { headers })
    ).json()) as { finishedAt: string | null; expenses: unknown[] }
    expect(back.finishedAt).not.toBeNull()
    expect(back.expenses).toHaveLength(1)
    expect((await setting.current())?.place.name).toBe('Ереван Сити')
    await expect(page.getByRole('heading', { name: /did not come back/ })).toHaveCount(0)
  })

  test('is started with no connection, and catches up when it comes back', async ({
    page,
    context,
  }) => {
    const setting = await device(page)
    // The catalogue is asked for while the connection is still there: the search has no offline
    // answer beyond the recent items, and this test is about the trip, not about the search.
    await startTrip(page, 'Рынок')
    await addItem(page, setting.word, '250')
    await expect.poll(async () => (await setting.current())?.expenses.length).toBe(1)

    await context.setOffline(true)
    await finish(page)
    // The record is over on the phone at once, though nothing has reached the server.
    await expect(page.getByRole('button', { name: 'Record purchases' })).toBeVisible()
    await expect(recorded(page, 'Рынок')).toBeVisible()
    expect(await setting.current()).not.toBeNull()

    await startTrip(page, 'Ереван Сити')
    await expect(heading(page)).toHaveText('Ереван Сити')
    // Nothing has gone out: the second trip exists only on the phone.
    await expect.poll(async () => (await setting.current())?.place.name).toBe('Рынок')

    await context.setOffline(false)
    // The queue goes out in order: «finish» of the first trip, then the second trip itself.
    await expect
      .poll(async () => (await setting.current())?.place.name, {
        timeout: 15_000,
      })
      .toBe('Ереван Сити')
  })
})

test.describe('the newcomer`s «Что брать» (MOL-77, MOL-128)', () => {
  for (const size of [
    { width: 390, height: 844 },
    { width: 375, height: 667 },
  ]) {
    test(`greets a newcomer, and «Record purchases» is in view at ${String(size.width)}×${String(size.height)}`, async ({
      page,
    }) => {
      await page.setViewportSize(size)
      await signedIn(page)

      await expect(page.getByRole('heading', { name: 'Record your first purchases' })).toBeVisible()
      // Not a circle over the button any more: the only action is the button with words.
      await expect(page.locator('.circle')).toHaveCount(0)
      const start = page.getByRole('button', { name: 'Record purchases' })
      await expect(start).toBeInViewport({ ratio: 1 })

      // The cycle's third step leads to «Ratings» as a change of tab.
      await page.getByRole('button', { name: /At home/ }).click()
      await expect(page).toHaveURL(/\/verdicts$/)
    })
  }

  test('keeps «Record purchases» in view with large text', async ({ page }) => {
    await signedIn(page)
    await page.addStyleTag({ content: 'html { font-size: 130% }' })
    await expect(page.getByRole('heading', { name: 'Record your first purchases' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Record purchases' })).toBeInViewport({
      ratio: 1,
    })
  })

  // Large text on a small phone: the home screen is taller than the window for real — no filler
  // — so the title collapses, and the last step scrolls out from under the strip (review Р-6, С-8).
  test('on a small phone with large text the title collapses and the last step is reachable', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await signedIn(page)
    await page.addStyleTag({ content: 'html { font-size: 130% }' })
    await expect(page.getByRole('heading', { name: 'Record your first purchases' })).toBeVisible()
    const start = page.getByRole('button', { name: 'Record purchases' })

    await page.evaluate(() => {
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' })
    })
    await expect(page.locator('.screen')).toHaveClass(/collapsed/)
    await expect(start).toBeInViewport({ ratio: 1 })
    // The last line stands above the strip, not under it.
    const last = await page.locator('.trust').boundingBox()
    const strip = await page.locator('.dock').boundingBox()
    expect(last && strip && last.y + last.height <= strip.y).toBe(true)
  })

  // A shop's full name has no spaces to break at: in «ждут оценки» it was cut by the card's edge
  // and ran under the chevron, while the same name wraps in the record's row (round 4, Л1). The
  // card is the newcomer's (в) now: purchases recorded and none rated.
  test('a long shop name in «waiting to be rated» wraps inside the card', async ({ page }) => {
    const shop = `ЕреванСитиТЦКомитасаМоллВторойЭтажОтделБытовойХимии${randomUUID().slice(0, 8)}`
    await page.setViewportSize({ width: 375, height: 667 })
    await signedIn(page)

    const headers = await asBrowser(page)
    const context = settingsOf(
      actorCodec.parse(await (await page.request.get('/api/actors/me', { headers })).json()),
    )
    const id = randomUUID()
    const started = await page.request.post('/api/trips', {
      headers,
      data: { context, id, place: { name: shop, kind: 'store' } },
    })
    expect(started.status()).toBe(201)
    const item = await page.request.post('/api/catalogue/items', {
      headers,
      data: { kind: 'product', name: `Порошок ${randomUUID()}`, defaultUnit: 'piece' },
    })
    const { id: itemId } = (await item.json()) as { id: string }
    const added = await page.request.post(`/api/trips/${id}/expenses`, {
      headers,
      data: { id: randomUUID(), itemId },
    })
    expect(added.status()).toBe(201)
    const finished = await page.request.post(`/api/trips/${id}/finish`, {
      headers,
      data: { finishedOnDeviceAt: new Date().toISOString() },
    })
    expect(finished.status()).toBe(204)
    await page.reload()

    const sub = page.locator('.pending .meta')
    await expect(sub).toContainText(shop)
    expect(await sub.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true)
    const inside = await page.evaluate(() => {
      const card = document.querySelector('.pending')?.getBoundingClientRect()
      const text = document.querySelector('.pending .meta')
      if (!card || !text) return false
      const range = document.createRange()
      range.selectNodeContents(text)
      return range.getBoundingClientRect().right <= card.right
    })
    expect(inside).toBe(true)
  })
})

/**
 * «Сумма по чеку» (MOL-78): the receipt typed whole when not every price was — at «Закончить» and
 * any time after — and the record's money everywhere, the prices untouched.
 */
test.describe('the receipt total (MOL-78)', () => {
  test('asked at «Finish» while some price is missing, then amended and removed on the finished record', async ({
    page,
  }) => {
    const setting = await device(page)
    const headers = await asBrowser(page)
    await startTrip(page, 'Ереван Сити')
    await addItem(page, setting.word, '570')
    await addUnpriced(page, setting.word)
    await expect(row(page)).toHaveCount(2)
    await expect.poll(async () => (await setting.current())?.expenses.length).toBe(2)

    await page.getByRole('button', { name: 'Finish', exact: true }).click()
    await expect(sheet(page)).toContainText('1 of 2 have no price')
    await page.waitForTimeout(400)
    await sheet(page).getByLabel('What did the receipt come to?').fill('1400')
    await sheet(page).getByRole('button', { name: 'Finish', exact: true }).click()
    await expect(page).toHaveURL(/\/purchases$/)

    // The receipt went before the finish, and «Записаны» shows it as the record's money.
    await expect(recorded(page, 'Ереван Сити')).toContainText('1,400.00', { timeout: 15_000 })
    const history = (await (await page.request.get('/api/trips/history', { headers })).json()) as {
      trips: { total: { amount: string }[] | null }[]
    }
    expect(history.trips[0]?.total).toEqual([{ amount: '1400.00', currency: 'AMD' }])

    await recorded(page, 'Ереван Сити').click()
    await expect(page.locator('.caption')).toHaveText('Total by receipt')
    await expect(page.locator('.sum')).toContainText('1,400.00')
    await expect(page.locator('.split')).toContainText('With a price — 1 of 2')
    await expect(page.locator('.split')).toContainText('570.00')
    await expect(page.locator('.split')).toContainText('Without a price — 1')
    await expect(page.locator('.split')).toContainText('830.00')
    // The price of the milk stayed what it was: nothing is worked out of the sum.
    await expect(row(page).first()).toContainText('570.00')

    await page.getByRole('button', { name: 'Change the receipt total' }).click()
    await page.waitForTimeout(400)
    await expect(sheet(page).getByLabel('Amount')).toHaveValue('1400')
    await sheet(page).getByRole('button', { name: 'Remove the total' }).click()
    await expect(page.locator('.caption')).toHaveText('Total')
    await expect(page.locator('.sum')).toContainText('570.00')
  })

  test('typed with no connection goes when it comes back, and the total says it is on its way', async ({
    page,
    context,
  }) => {
    const setting = await device(page)
    await startTrip(page, 'SAS')
    await addUnpriced(page, setting.word)
    await expect.poll(async () => (await setting.current())?.expenses.length).toBe(1)

    await context.setOffline(true)
    await page.getByRole('button', { name: '+ Receipt total' }).click()
    await page.waitForTimeout(400)
    await sheet(page).getByLabel('Amount').fill('2500')
    await sheet(page).getByRole('button', { name: 'Save' }).click()
    await expect(page.locator('.waiting')).toContainText('Receipt total')
    await expect(page.locator('.waiting')).toContainText('sending')

    await context.setOffline(false)
    await page.evaluate(() => window.dispatchEvent(new Event('online')))
    await expect(page.locator('.caption')).toHaveText('Total by receipt', { timeout: 15_000 })
    await expect(page.locator('.sum')).toContainText('2,500.00')
    await expect(page.locator('.waiting')).toHaveCount(0)
  })

  test('an empty record offers no sum, and «Finish» hands it to «Money» as a spending (В-1)', async ({
    page,
  }) => {
    const setting = await device(page)
    await startTrip(page, 'Рынок')
    await expect(page.getByRole('button', { name: '+ Receipt total' })).toHaveCount(0)

    await page.getByRole('button', { name: 'Finish', exact: true }).click()
    await expect(sheet(page)).toContainText('Nothing in this entry')
    await page.waitForTimeout(400)
    await sheet(page).getByRole('button', { name: 'Record as a spending in “Money”' }).click()

    await expect(page).toHaveURL(/\/money/)
    await expect(sheet(page)).toContainText('New spending')
    await expect(sheet(page).getByLabel('Where')).toHaveValue('Рынок')
    await expect(sheet(page).getByRole('radio', { name: 'Groceries' })).toBeChecked()
    await expect.poll(setting.current).toBeNull()
  })
})
