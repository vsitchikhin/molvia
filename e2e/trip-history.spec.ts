/// <reference lib="dom" />
import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { actorCodec, settingsOf } from '@molvia/model'
import { asBrowser, signedIn } from './session'

interface WireTrip {
  id: string
  place: { name: string }
  expenses: { id: string; amount: { amount: string; currency: string } | null }[]
  finishedOnDeviceAt: string | null
}
const sheet = (page: Page) => page.locator('dialog[open]')
async function createTrip(page: Page, name: string): Promise<WireTrip> {
  const headers = await asBrowser(page)
  // A trip names the settings it was started with since MOL-65; the server takes its city and
  // currencies from there, so a start without them is the old queue's and answers 409.
  const context = settingsOf(
    actorCodec.parse(await (await page.request.get('/api/actors/me', { headers })).json()),
  )
  const response = await page.request.post('/api/trips', {
    headers,
    data: { context, id: randomUUID(), place: { name, kind: 'store' } },
  })
  expect(response.status()).toBe(201)
  return (await response.json()) as WireTrip
}
async function finish(page: Page, id: string, at: string): Promise<void> {
  expect(
    (
      await page.request.post(`/api/trips/${id}/finish`, {
        headers: await asBrowser(page),
        data: { finishedOnDeviceAt: at },
      })
    ).status(),
  ).toBe(204)
}
async function read(page: Page, id: string): Promise<WireTrip> {
  const response = await page.request.get(`/api/trips/${id}`, { headers: await asBrowser(page) })
  expect(response.status()).toBe(200)
  return (await response.json()) as WireTrip
}
async function startInUi(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'Start a trip' }).click()
  await page.waitForTimeout(400)
  await sheet(page).getByLabel('Another place').fill(name)
  await sheet(page).getByRole('button', { name: 'Start a trip' }).click()
  await expect(sheet(page)).toBeHidden()
}

test('pages through all history and adds, amends and removes in an old trip while another is active', async ({
  page,
}) => {
  test.setTimeout(60_000)
  await signedIn(page)
  let oldest = ''
  for (let i = 1; i <= 21; i += 1) {
    const trip = await createTrip(page, `History shop ${String(i)}`)
    if (i === 1) oldest = trip.id
    await finish(page, trip.id, `2026-09-${String(i).padStart(2, '0')}T10:00:00Z`)
  }
  const active = await createTrip(page, 'Active shop')
  const word = `Историческийсыр${randomUUID().replace(/-/g, '')}`
  const item = await page.request.post('/api/catalogue/items', {
    headers: await asBrowser(page),
    data: { kind: 'product', name: word, defaultUnit: 'kg' },
  })
  expect(item.status()).toBe(201)
  await page.reload()
  await page.getByRole('button', { name: 'Trip history', exact: true }).click()
  await expect(page.locator('.history-row')).toHaveCount(20)
  await page.getByRole('button', { name: 'Show more' }).click()
  await expect(page.locator('.history-row')).toHaveCount(21)
  await page
    .locator('.history-row')
    .filter({ has: page.locator('.place', { hasText: /^History shop 1$/ }) })
    .click()
  await expect(page).toHaveURL(new RegExp(`/trip/history/${oldest}$`))
  await page.getByRole('button', { name: 'Add an item' }).click()
  await page.getByRole('combobox').fill(word)
  await page.getByRole('option').filter({ hasText: word }).first().click()
  await page.waitForTimeout(400)
  await sheet(page).getByLabel('How much').fill('0.5')
  await sheet(page).getByLabel('Price as on the tag').fill('1200')
  await sheet(page).getByRole('button', { name: 'Add to the trip' }).click()
  await expect(page).toHaveURL(new RegExp(`/trip/history/${oldest}$`))
  await expect.poll(async () => (await read(page, oldest)).expenses.length).toBe(1)
  await expect(page.locator('.row')).toContainText('1,200.00')
  await page.locator('.row').click()
  await page.waitForTimeout(400)
  await sheet(page).getByLabel('Price as on the tag').fill('1300')
  await sheet(page).getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.locator('.row')).toContainText('1,300.00')
  expect(
    await page.locator('.row .name').evaluate((node) => node.scrollWidth <= node.clientWidth),
  ).toBe(true)
  await page.screenshot({ path: test.info().outputPath('finished-trip.png'), fullPage: true })
  await page.locator('.row').click()
  await page.waitForTimeout(400)
  await sheet(page).getByRole('button', { name: 'Remove the item' }).click()
  await expect.poll(async () => (await read(page, oldest)).expenses.length).toBe(0)
  const current = await page.request.get('/api/trips/current', { headers: await asBrowser(page) })
  expect(await current.json()).toMatchObject({ trip: { id: active.id, expenses: [] } })
})

test('keeps an offline finish and its purchases across reload, then sends the original time', async ({
  page,
}) => {
  await signedIn(page)
  const old = await createTrip(page, 'Offline shop')
  const itemResponse = await page.request.post('/api/catalogue/items', {
    headers: await asBrowser(page),
    data: { kind: 'product', name: `Offline ${randomUUID()}`, defaultUnit: 'piece' },
  })
  const item = (await itemResponse.json()) as { id: string }
  expect(
    (
      await page.request.post(`/api/trips/${old.id}/expenses`, {
        headers: await asBrowser(page),
        data: { id: randomUUID(), itemId: item.id },
      })
    ).status(),
  ).toBe(201)
  await page.reload()
  await expect(page.locator('.row')).toHaveCount(1)
  await page.route('**/api/**', (route) => route.abort())
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false }),
  )
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false })
    window.dispatchEvent(new Event('offline'))
  })
  await page.getByRole('button', { name: 'Finish the trip' }).click()
  await page.waitForTimeout(400)
  await sheet(page).getByRole('button', { name: 'Finish', exact: true }).click()
  await expect(sheet(page)).toBeHidden()
  const at = await page.evaluate(() => {
    const owner = localStorage.getItem('molvia.actor') ?? ''
    const queue = JSON.parse(localStorage.getItem(`molvia.trip-queue.${owner}`) ?? '[]') as {
      write: { kind: string; finishedOnDeviceAt?: string }
    }[]
    return queue.find((row) => row.write.kind === 'finish')?.write.finishedOnDeviceAt
  })
  expect(at).toBeTruthy()
  // With no trip going on, the way into the history is the home screen's own row (MOL-77).
  await page.getByRole('button', { name: 'All trips' }).click()
  await expect(page).toHaveURL(/\/trip\/history$/)
  await page.reload()
  await page.locator('.history-row').filter({ hasText: 'Offline shop' }).click()
  await expect(page.locator('.row')).toHaveCount(1)
  await page.unroute('**/api/**')
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true })
    window.dispatchEvent(new Event('online'))
  })
  await expect.poll(async () => (await read(page, old.id)).finishedOnDeviceAt).toBe(at)
})

for (const choice of ['join', 'finish'] as const) {
  test(`asks before ${choice} even when both trips name the same shop`, async ({ page }) => {
    await signedIn(page)
    const old = await createTrip(page, 'Same shop')
    await startInUi(page, 'Same shop')
    await page.getByRole('button', { name: 'Choose trip' }).click()
    await page.waitForTimeout(400)
    await expect(sheet(page)).toContainText('Same shop')
    // Closing the choice neither discards the start nor resolves it.
    await sheet(page).getByRole('button', { name: 'Close' }).click()
    await expect(page.getByRole('button', { name: 'Choose trip' })).toBeVisible()
    await page.getByRole('button', { name: 'Choose trip' }).click()
    await page.waitForTimeout(400)
    await sheet(page)
      .getByRole('button', {
        name: choice === 'join' ? 'Add them to that trip' : 'Finish that trip',
        exact: true,
      })
      .click()
    await expect(sheet(page)).toBeHidden()
    await expect
      .poll(async () => {
        const response = await page.request.get('/api/trips/current', {
          headers: await asBrowser(page),
        })
        const body = (await response.json()) as { trip: WireTrip | null }
        return body.trip?.id === old.id
      })
      .toBe(choice === 'join')
    await expect(page.getByRole('button', { name: 'Choose trip' })).toHaveCount(0)
  })
}
