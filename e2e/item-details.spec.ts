/// <reference lib="dom" />
// DOM for the code inside page.evaluate, which runs in the browser.
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

  const started = await page.request.post('/api/trips', {
    headers,
    data: { id: randomUUID(), place: { kind: 'store', name: 'Ереван Сити' } },
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
const addButton = (page: Page) => sheet(page).getByRole('button', { name: 'Add to the trip' })

/** From the trip to the search, the item found and picked, its sheet up. */
async function pick({ page, word }: Setting): Promise<void> {
  await page.goto('/trip/add')
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
    await expect(page).toHaveURL(/\/$/)
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

    await expect(page).toHaveURL(/\/$/)
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
    await expect(page).toHaveURL(/\/$/)
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
