import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import type { APIRequestContext, Page } from '@playwright/test'
import { liveRegion, recordLiveRegion } from './live-region'

interface Person {
  readonly id: string
  call(method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown): Promise<unknown>
}

/** A new person for each test: «Что брать» is personal, so nothing leaks between tests. */
async function person(request: APIRequestContext, page: Page): Promise<Person> {
  const created = await request.post('/api/dev/actors')
  expect(created.status()).toBe(201)
  const { id } = (await created.json()) as { id: string }
  await page.addInitScript((actor) => {
    localStorage.setItem('molvia.actor', actor)
  }, id)

  return {
    id,
    async call(method, path, body) {
      const response = await request.fetch(`/api${path}`, {
        method,
        headers: { 'x-molvia-actor': id },
        ...(body === undefined ? {} : { data: body }),
      })
      expect(response.ok(), `${method} ${path}: ${String(response.status())}`).toBe(true)
      return response.status() === 204 ? null : ((await response.json()) as unknown)
    },
  }
}

// Unique per run: the catalogue is shared, and a name another run proposed would come back as
// that item — rated by nobody here, but the test would read someone else's name.
const tag = randomUUID().slice(0, 8)

/** Bought once in «SAS», at 520 ֏ for 0,9 l, and rated — which is the whole path to this screen. */
async function ratedPurchase(who: Person, name: string, score: number): Promise<void> {
  const tripId = randomUUID()
  await who.call('POST', '/trips', { id: tripId, place: { kind: 'store', name: 'SAS' } })
  const entry = (await who.call('POST', '/catalogue/items', {
    kind: 'product',
    name,
    defaultUnit: 'l',
  })) as { id: string }
  await who.call('POST', `/trips/${tripId}/expenses`, {
    id: randomUUID(),
    itemId: entry.id,
    quantity: { value: '0.9', unit: 'l' },
    amount: { amount: '520', currency: 'AMD' },
  })
  await who.call('PUT', `/verdicts/${entry.id}`, { score })
}

/** Waits for the sheet to be up: until it has risen it deliberately takes no tap at all. */
async function openSheet(page: Page): Promise<void> {
  await expect(page.locator('dialog[open]')).toBeVisible()
  await page.waitForTimeout(400)
}

test('a rated purchase becomes a recommendation with the place and the price per unit', async ({
  page,
  request,
}) => {
  const who = await person(request, page)
  const name = `Молоко «Ашхар» ${tag}`
  await ratedPurchase(who, name, 5)

  await page.goto('/advice')

  await expect(page.getByRole('heading', { name: 'What to buy', exact: true })).toBeVisible()
  await expect(page.getByText('Your own ratings only, for now')).toBeVisible()

  const take = page.locator('section.take')
  await expect(take.getByRole('heading', { name: 'Buy it' })).toBeVisible()
  await expect(take.getByText(name)).toBeVisible()
  // One place, so no superlative: «Bought here» is what one observation can honestly say.
  await expect(take.getByText('Bought here: SAS')).toBeVisible()
  await expect(take.getByText('577.78')).toBeVisible()
  // The own mode leaves the count out: it is always one, and the subtitle says so (МР-12).
  await expect(take.getByText('5.0 out of 5', { exact: true })).toBeVisible()
  await expect(take.getByText('1 rating')).toHaveCount(0)
})

test('a bad verdict carries no price and no place: there is nothing to be cheap with', async ({
  page,
  request,
}) => {
  const who = await person(request, page)
  const name = `Колбаса «Молочная» ${tag}`
  await ratedPurchase(who, name, 1)

  await page.goto('/advice')

  const never = page.locator('section.never')
  await expect(never.getByText(name)).toBeVisible()
  await expect(never.getByText('The price is left out on purpose')).toBeVisible()
  // The row was bought for 520 ֏ at 577,78 ֏/l in SAS, and none of it is anywhere on the screen.
  await expect(page.getByText('577.78')).toHaveCount(0)
  await expect(page.getByText('SAS')).toHaveCount(0)
  await expect(never.getByText(name)).toHaveCSS('text-decoration-line', 'line-through')
})

test('nothing rated yet: the empty state explains the link and leads to «Ratings»', async ({
  page,
  request,
}) => {
  await person(request, page)

  await page.goto('/advice')

  await expect(page.getByRole('heading', { name: 'Nothing to advise yet' })).toBeVisible()
  await page.getByRole('button', { name: 'Rate a purchase' }).click()

  await expect(page).toHaveURL(/\/verdicts$/)
})

// The commonest break at a shelf: the connection goes while the answer is on its way. It is
// offline, yellow and polite — not the red error the first cut of MOL-19 drew (A1).
test('a connection lost mid-request is offline, not an error', async ({
  page,
  context,
  request,
}) => {
  await person(request, page)
  let release: () => void = () => undefined
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/api/advice', async (route) => {
    await held
    await route.abort('internetdisconnected')
  })
  await page.goto('/advice')
  await expect(page.locator('.skeleton')).toBeVisible()

  await context.setOffline(true)
  release()

  await expect(
    page.getByRole('heading', { name: 'The list will show up once you are online' }),
  ).toBeVisible()
  await expect(
    page.getByText('Verdicts are worked out on the server, there is no local copy'),
  ).toHaveCount(0)
  await expect(page.locator('[role="alert"]')).toHaveCount(0)
})

// Loading is drawn as the content that is coming, and says so to a screen reader. The answer
// is held back rather than slowed down, so the check does not race a fast local API.
test('the skeleton is there while the answer is on its way, and the region says so', async ({
  page,
  request,
}) => {
  await person(request, page)
  let release: () => void = () => undefined
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/api/advice', async (route) => {
    await held
    await route.continue()
  })
  const said = await recordLiveRegion(page)
  await page.goto('/advice')

  await expect(page.locator('.skeleton')).toBeVisible()
  await expect.poll(said).toContainEqual(expect.stringContaining('Loading…'))

  release()
  await expect(page.getByRole('heading', { name: 'Nothing to advise yet' })).toBeVisible()
  await expect(page.locator('.skeleton')).toHaveCount(0)
  // «Loading…» leaves the region with the skeleton: left behind, it is read in browse mode
  // under the answer (MOL-19, C3).
  await expect.poll(() => liveRegion(page)).not.toContain('Loading…')
})

// The server broke rather than the connection: red, an alert, and a way to ask again.
test('reports a failure instead of an empty screen, and recovers on retry', async ({
  page,
  request,
}) => {
  await person(request, page)
  await page.route('**/api/advice', (route) => route.fulfill({ status: 500, body: '{}' }))
  await page.goto('/advice')

  await expect(page.locator('[role="alert"]')).toContainText('The server did not answer')

  await page.unroute('**/api/advice')
  await page.getByRole('button', { name: 'Try again' }).click()

  await expect(page.getByRole('heading', { name: 'Nothing to advise yet' })).toBeVisible()
})

// Offline and not identified yet: the identity's own notice says what is wrong, and the screen
// asks the server for nothing — one «no connection» on a screen, never two (MOL-19, B3; Р-6).
test('offline without an identity: one notice, and the screen comes back with the connection', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __online: boolean }
    w.__online = false
    Object.defineProperty(Navigator.prototype, 'onLine', { get: () => w.__online })
  })
  await page.goto('/advice')

  await expect(
    page.getByRole('heading', { name: "This device isn't identified yet" }),
  ).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'The list will show up once you are online' }),
  ).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0)

  await page.evaluate(() => {
    ;(window as unknown as { __online: boolean }).__online = true
    window.dispatchEvent(new Event('online'))
  })

  await expect(page.getByRole('heading', { name: 'Nothing to advise yet' })).toBeVisible()
})

test('the action of the empty state is large enough to hit with a thumb', async ({
  page,
  request,
}) => {
  await person(request, page)
  await page.goto('/advice')

  const button = page.getByRole('button', { name: 'Rate a purchase' })
  await expect(button).toBeVisible()

  const box = await button.boundingBox()
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
})

test('a mis-tapped verdict is amended where it is met, and withdrawn from there too', async ({
  page,
  request,
}) => {
  const who = await person(request, page)
  const name = `Сыр «Чанах» ${tag}`
  await ratedPurchase(who, name, 1)

  await page.goto('/advice')
  await expect(page.locator('section.never').getByText(name)).toBeVisible()

  // A «1» given by mistake used to stand until the item was bought again: «Ratings» only ever
  // asks about purchases with no verdict at all.
  await page.locator('section.never').getByRole('button').first().click()
  // The sheet takes no tap until it has come up: the second tap of a double tap must not
  // press anything inside it (MOL-18).
  await openSheet(page)
  await page.getByRole('button', { name: 'Rating 5 out of 5' }).click()
  await page.getByRole('button', { name: 'Save the rating' }).click()

  await expect(page.locator('section.take').getByText(name)).toBeVisible()
  await expect(page.locator('section.never')).toHaveCount(0)

  // Withdrawn, it leaves the screen altogether — and the purchase goes back to «Ratings».
  await page.locator('section.take').getByRole('button').first().click()
  await openSheet(page)
  await page.getByRole('button', { name: 'Withdraw the rating' }).click()

  await expect(page.getByRole('heading', { name: 'Nothing to advise yet' })).toBeVisible()
})

// Loading breathes, and stands still for whoever asked for less motion. The only place the
// skeleton's animation is checked against real CSS — happy-dom has none — and it went missing
// with `home.spec.ts` (MOL-32, МР-5).
test('the skeleton breathes, and stops for someone who asked for less motion', async ({
  page,
  request,
}) => {
  await person(request, page)
  await page.route('**/api/advice', () => new Promise(() => undefined))
  const bars = page.locator('.skeleton .bars')
  const animation = () => bars.evaluate((element) => getComputedStyle(element).animationName)

  await page.goto('/advice')
  await expect(bars).toBeVisible()
  expect(await animation()).not.toBe('none')

  await page.emulateMedia({ reducedMotion: 'reduce' })
  expect(await animation()).toBe('none')
})
