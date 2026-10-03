/// <reference lib="dom" />
import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { actorCodec, settingsOf } from '@molvia/model'
import { asBrowser, open, signedIn } from './session'

interface WireTrip {
  id: string
  place: { name: string }
  expenses: { id: string; amount: { amount: string; currency: string } | null }[]
  finishedOnDeviceAt: string | null
}
const sheet = (page: Page) => page.locator('dialog[open]')
/** A row of «Записаны» on «Покупки» (MOL-128). */
const recorded = (page: Page) => page.locator('.recorded .purchase-row')
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
  await page.getByRole('button', { name: 'Add by hand' }).click()
  await page.waitForTimeout(400)
  await sheet(page).getByLabel('Another place').fill(name)
  await sheet(page).getByRole('button', { name: 'Start the entry' }).click()
  await expect(sheet(page)).toBeHidden()
}

test('pages through all of «Записаны» and adds, amends and removes in an old record while another is open', async ({
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
  await open(page, '/purchases')
  await expect(recorded(page)).toHaveCount(20)
  await page.getByRole('button', { name: 'Show more' }).click()
  await expect(recorded(page)).toHaveCount(21)
  await recorded(page)
    .filter({ has: page.locator('.title', { hasText: /^History shop 1$/ }) })
    .click()
  await expect(page).toHaveURL(new RegExp(`/purchases/${oldest}$`))
  await page.getByRole('button', { name: 'Add an item' }).click()
  await page.getByRole('combobox').fill(word)
  await page.getByRole('option').filter({ hasText: word }).first().click()
  await page.waitForTimeout(400)
  await sheet(page).getByLabel('How much').fill('0.5')
  await sheet(page).getByLabel('Price as on the tag').fill('1200')
  await sheet(page).getByRole('button', { name: 'Record' }).click()
  await expect(page).toHaveURL(new RegExp(`/purchases/${oldest}$`))
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
  await open(page, '/purchases/manual')
  await expect(page.locator('.row')).toHaveCount(1)
  await page.route('**/api/**', (route) => route.abort())
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false }),
  )
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false })
    window.dispatchEvent(new Event('offline'))
  })
  await page.getByRole('button', { name: 'Finish', exact: true }).click()
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
  // Finished, the record goes up to «Покупки», where it is a row of «Записаны» (MOL-128).
  await expect(page).toHaveURL(/\/purchases$/)
  await page.reload()
  await recorded(page).filter({ hasText: 'Offline shop' }).click()
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
    await page.getByRole('button', { name: 'Choose the entry' }).click()
    await page.waitForTimeout(400)
    await expect(sheet(page)).toContainText('Same shop')
    // Closing the choice neither discards the start nor resolves it.
    await sheet(page).getByRole('button', { name: 'Close' }).click()
    await expect(page.getByRole('button', { name: 'Choose the entry' })).toBeVisible()
    await page.getByRole('button', { name: 'Choose the entry' }).click()
    await page.waitForTimeout(400)
    await sheet(page)
      .getByRole('button', {
        name: choice === 'join' ? 'Add them to that entry' : 'Finish that entry',
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
    await expect(page.getByRole('button', { name: 'Choose the entry' })).toHaveCount(0)
  })
}

test('a finished record deleted from its own screen leaves «Записаны», after a reload too (MOL-76)', async ({
  page,
}) => {
  await signedIn(page)
  const trip = await createTrip(page, 'Deleted shop')
  const itemResponse = await page.request.post('/api/catalogue/items', {
    headers: await asBrowser(page),
    data: { kind: 'product', name: `Deleted ${randomUUID()}`, defaultUnit: 'piece' },
  })
  const item = (await itemResponse.json()) as { id: string }
  expect(
    (
      await page.request.post(`/api/trips/${trip.id}/expenses`, {
        headers: await asBrowser(page),
        data: { id: randomUUID(), itemId: item.id },
      })
    ).status(),
  ).toBe(201)
  await finish(page, trip.id, new Date().toISOString())
  await open(page, '/purchases')

  const recent = recorded(page).filter({ hasText: 'Deleted shop' })
  await recent.click()
  await expect(page).toHaveURL(new RegExp(`/purchases/${trip.id}$`))
  await page.getByRole('button', { name: 'Delete the entry' }).click()
  await expect(sheet(page)).toContainText('1 item')
  await page.waitForTimeout(400)
  await sheet(page).getByRole('button', { name: 'Delete the entry' }).click()

  // Back where it was opened from — «Покупки» — with «Undo» there.
  await expect(page).toHaveURL(/\/purchases$/)
  await expect(
    page.locator('.undo').filter({ hasText: 'Entry deleted: Deleted shop' }),
  ).toBeVisible()
  await expect(recent).toHaveCount(0)
  await expect
    .poll(async () =>
      (
        await page.request.get(`/api/trips/${trip.id}`, { headers: await asBrowser(page) })
      ).status(),
    )
    .toBe(404)
  await page.reload()
  await expect(page.getByRole('button', { name: 'Add by hand' })).toBeVisible()
  await expect(recent).toHaveCount(0)
})

test('a trip deleted with no connection is gone at once, and the removal goes with the signal (MOL-76)', async ({
  page,
}) => {
  await signedIn(page)
  const trip = await createTrip(page, 'Offline delete')
  await open(page, '/purchases/manual')
  await expect(page.getByRole('button', { name: 'Delete the entry' })).toBeVisible()
  await page.route('**/api/**', (route) => route.abort())
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false })
    window.dispatchEvent(new Event('offline'))
  })
  await page.getByRole('button', { name: 'Delete the entry' }).click()
  await expect(page.getByRole('button', { name: 'Add by hand' })).toBeVisible()
  // Kept on the phone across a reload, and the trip does not come back from memory.
  await page.reload()
  await expect(page.getByRole('button', { name: 'Add by hand' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Delete the entry' })).toHaveCount(0)

  await page.unroute('**/api/**')
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true })
    window.dispatchEvent(new Event('online'))
  })
  await expect
    .poll(async () =>
      (
        await page.request.get(`/api/trips/${trip.id}`, { headers: await asBrowser(page) })
      ).status(),
    )
    .toBe(404)
})
