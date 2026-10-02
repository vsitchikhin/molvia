/// <reference lib="dom" />
// DOM for the code inside page.evaluate, which runs in the browser.
import { actorCodec, settingsOf } from '@molvia/model'
import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { asBrowser, signedIn } from './session'
import type { Page } from '@playwright/test'

/**
 * The sheet «how much, for what price» against the real API: the pick from the real search, the
 * write through the trip queue, the answer of the server. What the component tests cannot show is
 * that a purchase typed at the shelf ends up as one row on the server — with its query, without a
 * double from a double tap, and after a dropped connection comes back.
 *
 * Each test arrives as a new device with its own trip, so the rows it counts are its own. The item
 * is named with a word no catalogue holds, so the search finds it and nothing else.
 */

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

interface Row {
  readonly quantity: { readonly value: string; readonly unit: string } | null
  readonly amount: { readonly amount: string; readonly currency: string } | null
  readonly unitPrice: { readonly amount: string } | null
}

interface Setting {
  readonly page: Page
  readonly actor: string
  readonly word: string
  /** The rows of this device's trip, as the server has them. */
  readonly rows: () => Promise<Row[]>
}

/**
 * A device signed in, a trip open in a shop, and one item of its own in the catalogue.
 *
 * `page.request` and not the standalone `request` fixture: it shares the browser context's
 * cookie jar, so these calls go out as the very person the page is (MOL-53). The old header is
 * gone, and with it the need to read an identifier out of storage to speak as somebody.
 */
async function onTrip(page: Page): Promise<Setting> {
  const actor = await signedIn(page)
  const headers = await asBrowser(page)

  const word = nonsense()
  const proposed = await page.request.post('/api/catalogue/items', {
    headers,
    data: { kind: 'product', name: `Молоко «${word}»`, defaultUnit: 'l' },
  })
  expect([200, 201]).toContain(proposed.status())

  const context = settingsOf(
    actorCodec.parse(await (await page.request.get('/api/actors/me', { headers })).json()),
  )
  const started = await page.request.post('/api/trips', {
    headers,
    data: { context, id: randomUUID(), place: { kind: 'store', name: 'Ереван Сити' } },
  })
  expect(started.status()).toBe(201)

  const rows = async (): Promise<Row[]> => {
    const response = await page.request.get('/api/trips/current', { headers })
    const body = (await response.json()) as { trip: { expenses: Row[] } | null }
    return body.trip?.expenses ?? []
  }
  return { page, actor, word, rows }
}

const field = (page: Page) => page.getByRole('combobox', { name: 'What did you pick up?' })
const sheet = (page: Page) => page.locator('dialog[open]')
const addButton = (page: Page) => sheet(page).getByRole('button', { name: 'Record', exact: true })

/** From the trip to the search, the item found and picked, its sheet up. */
async function pick({ page, word }: Pick<Setting, 'page' | 'word'>): Promise<void> {
  await page.goto('/purchases/manual/add')
  await field(page).fill(word)
  await page.getByRole('option').first().click()
  await expect(sheet(page)).toContainText(`Молоко «${word}»`)
  // The sheet takes no tap while it rises.
  await page.waitForTimeout(400)
}

test.describe('the sheet', () => {
  test('prices 520 for 0.9 l per litre, adds it, and leads back to the trip', async ({ page }) => {
    const setting = await onTrip(page)
    await pick(setting)

    await sheet(page).getByLabel('How much').fill('0.9')
    await sheet(page).getByLabel('Price as on the tag').fill('520')
    await expect(sheet(page).locator('.per-unit-value')).toContainText('577.78')
    await expect(sheet(page).locator('.per-unit-value')).toContainText('/l')

    const sent = page.waitForRequest(
      (request) => request.method() === 'POST' && request.url().endsWith('/expenses'),
    )
    await addButton(page).click()

    // The sheet and the search go in one step back, to the trip.
    await expect(page).toHaveURL(/\/purchases\/manual$/)
    const body = (await sent).postDataJSON() as { query?: string }
    expect(body.query).toBe(setting.word)

    await expect.poll(setting.rows).toHaveLength(1)
    const [row] = await setting.rows()
    expect(row?.quantity).toEqual({ value: '0.900', unit: 'l' })
    expect(row?.amount).toEqual({ amount: '520.00', currency: 'AMD' })
    expect(row?.unitPrice?.amount).toMatch(/^577\.7{2}/)
  })

  test('adds the item alone when nothing else is filled in', async ({ page }) => {
    const setting = await onTrip(page)
    await pick(setting)
    await sheet(page).getByLabel('How much').fill('')

    await addButton(page).click()

    await expect.poll(setting.rows).toHaveLength(1)
    const [row] = await setting.rows()
    expect(row?.amount).toBeNull()
    expect(row?.quantity).toBeNull()
  })

  test('writes nothing when closed with ×', async ({ page }) => {
    const setting = await onTrip(page)
    await pick(setting)
    await sheet(page).getByLabel('Price as on the tag').fill('520')

    await sheet(page).getByRole('button', { name: 'Close' }).click()

    await expect(sheet(page)).toHaveCount(0)
    await page.waitForTimeout(300)
    expect(await setting.rows()).toEqual([])
  })

  test('adds one purchase for a double tap', async ({ page }) => {
    const setting = await onTrip(page)
    await pick(setting)
    await sheet(page).getByLabel('Price as on the tag').fill('520')

    await addButton(page).dblclick()

    await expect(page).toHaveURL(/\/purchases\/manual$/)
    await expect.poll(setting.rows).toHaveLength(1)
    await page.waitForTimeout(300)
    expect(await setting.rows()).toHaveLength(1)
  })

  test('does not send what was typed as a price and is not one', async ({ page }) => {
    const setting = await onTrip(page)
    await pick(setting)
    await sheet(page).getByLabel('Price as on the tag').fill('57o')

    await addButton(page).click()

    await expect(sheet(page)).toContainText('That does not look like an amount')
    await expect(sheet(page).getByLabel('Price as on the tag')).toBeFocused()
    expect(await setting.rows()).toEqual([])
  })

  test('prices in roubles when the price is in roubles', async ({ page }) => {
    const setting = await onTrip(page)
    await pick(setting)

    await sheet(page).getByLabel('Price currency').selectOption('RUB')
    await sheet(page).getByLabel('How much').fill('0.9')
    await sheet(page).getByLabel('Price as on the tag').fill('90')
    await expect(sheet(page).locator('.per-unit-value')).toContainText('₽')
    await addButton(page).click()

    await expect.poll(setting.rows).toHaveLength(1)
    const [row] = await setting.rows()
    expect(row?.amount).toEqual({ amount: '90.00', currency: 'RUB' })
  })
})

test.describe('with no connection', () => {
  test('keeps the purchase on the phone and sends it once when the connection is back', async ({
    page,
    context,
  }) => {
    const setting = await onTrip(page)
    await pick(setting)
    await sheet(page).getByLabel('How much').fill('0.9')
    await sheet(page).getByLabel('Price as on the tag').fill('520')

    await context.setOffline(true)
    await expect(sheet(page)).toContainText('Saved on the phone, sent once you are back online')
    await addButton(page).click()

    // Closed at once, as with a connection: nothing waits on the network.
    await expect(page).toHaveURL(/\/purchases\/manual$/)
    const queued = () =>
      page.evaluate(
        (key) => (JSON.parse(localStorage.getItem(key) ?? '[]') as unknown[]).length,
        `molvia.trip-queue.${setting.actor}`,
      )
    expect(await queued()).toBe(1)

    await context.setOffline(false)
    await expect.poll(setting.rows).toHaveLength(1)
    await expect.poll(queued).toBe(0)
    await page.waitForTimeout(300)
    expect(await setting.rows()).toHaveLength(1)
  })
})

/**
 * «Тут дешевле» (MOL-92): a purchase in one shop, then the same item on the sheet in another — the
 * hint from the real server, compared as the price is typed, kept on the phone for no signal.
 */
test.describe('«Тут дешевле»', () => {
  /** Milk bought at Зовуни for 540 the litre, in a record already finished, and a record open at Ереван Сити. */
  async function boughtAtZovuni(
    page: Page,
    alternative?: { readonly price: string; readonly score: number },
  ): Promise<{ word: string; itemId: string; other: string | null }> {
    await signedIn(page)
    const headers = await asBrowser(page)
    const word = nonsense()
    const proposed = await page.request.post('/api/catalogue/items', {
      headers,
      data: { kind: 'product', name: `Молоко «${word}»`, defaultUnit: 'l' },
    })
    expect([200, 201]).toContain(proposed.status())
    const { id: itemId } = (await proposed.json()) as { id: string }
    const context = settingsOf(
      actorCodec.parse(await (await page.request.get('/api/actors/me', { headers })).json()),
    )

    const earlier = randomUUID()
    const start = (id: string, name: string) =>
      page.request.post('/api/trips', {
        headers,
        data: { context, id, place: { kind: 'store', name } },
      })
    expect((await start(earlier, 'Зовуни')).status()).toBe(201)
    const added = await page.request.post(`/api/trips/${earlier}/expenses`, {
      headers,
      data: {
        id: randomUUID(),
        itemId,
        quantity: { value: '1', unit: 'l' },
        amount: { amount: '540', currency: 'AMD' },
      },
    })
    expect(added.status()).toBe(201)
    // Another milk of one's own, rated, bought in the same shop (MOL-92, В-3).
    let other: string | null = null
    if (alternative) {
      other = `Молоко «${nonsense()}»`
      const made = await page.request.post('/api/catalogue/items', {
        headers,
        data: { kind: 'product', name: other, defaultUnit: 'l' },
      })
      const { id: otherId } = (await made.json()) as { id: string }
      const bought = await page.request.post(`/api/trips/${earlier}/expenses`, {
        headers,
        data: {
          id: randomUUID(),
          itemId: otherId,
          quantity: { value: '1', unit: 'l' },
          amount: { amount: alternative.price, currency: 'AMD' },
        },
      })
      expect(bought.status()).toBe(201)
      const rated = await page.request.put(`/api/verdicts/${otherId}`, {
        headers,
        data: { score: alternative.score },
      })
      expect(rated.status()).toBe(201)
    }
    expect(
      (await page.request.post(`/api/trips/${earlier}/finish`, { headers, data: {} })).status(),
    ).toBe(204)
    expect((await start(randomUUID(), 'Ереван Сити')).status()).toBe(201)
    return { word, itemId, other }
  }

  const hint = (page: Page) => sheet(page).locator('[data-hint="item"]')

  test('names the cheaper shop once a dearer price is typed, and nothing for «не брать нигде»', async ({
    page,
  }) => {
    const { word, itemId } = await boughtAtZovuni(page)
    await pick({ page, word })

    // Before a price: the cheapest one, said plainly.
    await expect(hint(page)).toContainText('Cheapest you paid: Зовуни')
    await sheet(page).getByLabel('How much').fill('1')
    await sheet(page).getByLabel('Price as on the tag').fill('620')
    await expect(hint(page)).toContainText('You paid ֏540.00/l at Зовуни')
    // The fields stay where they were: the hint is below them.
    const price = await sheet(page).getByLabel('Price as on the tag').boundingBox()
    const line = await hint(page).boundingBox()
    expect(line && price && line.y > price.y).toBe(true)

    await sheet(page).getByRole('button', { name: 'Close' }).click()
    const headers = await asBrowser(page)
    expect(
      (await page.request.put(`/api/verdicts/${itemId}`, { headers, data: { score: 1 } })).status(),
    ).toBe(201)
    await pick({ page, word })
    await sheet(page).getByLabel('How much').fill('1')
    await sheet(page).getByLabel('Price as on the tag').fill('620')
    await expect(sheet(page).locator('.per-unit-value')).toContainText('620')
    await expect(sheet(page).locator('[data-hint]')).toHaveCount(0)
  })

  test('shows the hint remembered on the phone with no signal', async ({ page, context }) => {
    const { word } = await boughtAtZovuni(page)
    await pick({ page, word })
    await expect(hint(page)).toContainText('Зовуни')
    await sheet(page).getByRole('button', { name: 'Close' }).click()
    await expect(sheet(page)).toHaveCount(0)

    await context.setOffline(true)
    // The search still shows what it found: the same item, picked again with no signal.
    await page.getByRole('option').first().click()
    await expect(sheet(page)).toContainText(`Молоко «${word}»`)
    await expect(hint(page)).toContainText('Cheapest you paid: Зовуни')
    await context.setOffline(false)
  })

  test('names a cheaper milk of one’s own rated no worse, second (В-3, review №5)', async ({
    page,
  }) => {
    const { word, other } = await boughtAtZovuni(page, { price: '480', score: 5 })
    await pick({ page, word })
    await sheet(page).getByLabel('How much').fill('1')
    await sheet(page).getByLabel('Price as on the tag').fill('620')

    const line = sheet(page).locator('[data-hint="alternative"]')
    await expect(line).toContainText(`${other ?? ''} — ֏480.00/l at Зовуни`)
    await expect(line).toContainText('rated 5.0')
  })

  test('comes in over frames: the fields rise with it, never in one jump (adversarial Е)', async ({
    page,
  }) => {
    const { word } = await boughtAtZovuni(page)
    // A shelf's connection: the answer comes after the sheet is up and still.
    await page.route('**/api/advice/prices**', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500))
      await route.continue()
    })
    await pick({ page, word })
    await expect
      .poll(() => page.evaluate(() => document.getAnimations().length), { timeout: 10_000 })
      .toBe(0)
    await expect(hint(page)).toHaveCount(0)

    // The top of the price field, frame by frame, until the hint is in and still.
    await page.evaluate(() => {
      const w = window as unknown as { __tops: number[]; __stop: boolean }
      w.__tops = []
      w.__stop = false
      const step = () => {
        const field = document.querySelector('dialog[open] [data-field="amount"]')
        if (field) w.__tops.push(field.getBoundingClientRect().top)
        if (!w.__stop) requestAnimationFrame(step)
      }
      requestAnimationFrame(step)
    })
    await expect(hint(page)).toContainText('Зовуни', { timeout: 5000 })
    await page.waitForTimeout(600)
    const tops = await page.evaluate(() => {
      const w = window as unknown as { __tops: number[]; __stop: boolean }
      w.__stop = true
      return w.__tops
    })
    const steps = tops.slice(1).map((top, index) => Math.abs(top - (tops[index] ?? top)))
    const moved = Math.abs((tops.at(-1) ?? 0) - (tops[0] ?? 0))

    expect(moved).toBeGreaterThan(20)
    expect(steps.filter((step) => step > 0.5).length).toBeGreaterThan(3)
    expect(Math.max(...steps)).toBeLessThan(moved / 2)
  })
})
