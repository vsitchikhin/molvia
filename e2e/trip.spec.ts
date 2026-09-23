/// <reference lib="dom" />
// DOM for the code inside page.evaluate, which runs in the browser.
import { expect, test } from '@playwright/test'
import { asBrowser, signedIn } from './session'
import type { Page } from '@playwright/test'

/**
 * The trip from end to end, against the real API: started at the door of a shop, filled one
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

async function startTrip(page: Page, place: string): Promise<void> {
  await page.getByRole('button', { name: 'Start a trip' }).click()
  await expect(sheet(page)).toContainText('Where are you?')
  // The sheet takes no tap while it rises.
  await page.waitForTimeout(400)
  await sheet(page).getByLabel('Another place').fill(place)
  await sheet(page).getByRole('button', { name: 'Start a trip' }).click()
  await expect(sheet(page)).toBeHidden()
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
  await sheet(page).getByRole('button', { name: 'Add to the trip' }).click()
  // The path, not the whole address: what the query string carries is not this test's business.
  expect(new URL(page.url()).pathname).toBe('/')
}

test.describe('the trip', () => {
  test('is started, filled, corrected and finished', async ({ page }) => {
    const setting = await device(page)

    await startTrip(page, 'Ереван Сити')
    // The place is on screen before the server has answered, and the server gets it all the same.
    await expect(page.locator('.meta')).toContainText('Ереван Сити')
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

    await page.getByRole('button', { name: 'Finish the trip' }).click()
    await expect(sheet(page)).toContainText('Finish this trip?')
    await page.waitForTimeout(400)
    await sheet(page).getByRole('button', { name: 'Finish', exact: true }).click()

    // Over on the phone at once, and over on the server as soon as the queue has been out.
    await expect(page.getByRole('heading', { name: 'A new trip', exact: true })).toBeVisible()
    await expect.poll(setting.current).toBeNull()
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
    await page.getByRole('button', { name: 'Finish the trip' }).click()
    await page.waitForTimeout(400)
    await sheet(page).getByRole('button', { name: 'Finish', exact: true }).click()
    // The trip is over on the phone at once, though nothing has reached the server.
    await expect(page.getByRole('heading', { name: 'A new trip', exact: true })).toBeVisible()
    expect(await setting.current()).not.toBeNull()

    await startTrip(page, 'Ереван Сити')
    await expect(page.locator('.meta')).toContainText('Ереван Сити')
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
