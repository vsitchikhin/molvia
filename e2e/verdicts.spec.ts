import { actorCodec, settingsOf } from '@molvia/model'
import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { asBrowser, signedIn } from './session'
import type { Page } from '@playwright/test'

interface Person {
  readonly id: string
  call(method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown): Promise<unknown>
}

/**
 * A new person for each test: the queue is personal, so nothing leaks between tests.
 *
 * Signed in through `page.request`, which shares the browser context's cookie jar — so the
 * session the seam hands out is the page's own, and every call below goes out as that person
 * without naming anybody (MOL-53). The standalone `request` fixture has a jar of its own and
 * would have logged in a second, invisible person.
 */
async function person(page: Page): Promise<Person> {
  const id = await signedIn(page)
  const headers = await asBrowser(page)

  return {
    id,
    async call(method, path, body) {
      const response = await page.request.fetch(`/api${path}`, {
        method,
        headers,
        ...(body === undefined ? {} : { data: body }),
      })
      expect(response.ok(), `${method} ${path}: ${String(response.status())}`).toBe(true)
      return response.status() === 204 ? null : ((await response.json()) as unknown)
    },
  }
}

/** Bought in one trip, in this order — so the last one is the newest and comes first. */
async function bought(who: Person, names: readonly string[]): Promise<void> {
  const tripId = randomUUID()
  await who.call('POST', '/trips', {
    context: settingsOf(actorCodec.parse(await who.call('GET', '/actors/me'))),
    id: tripId,
    place: { kind: 'store', name: 'SAS' },
  })
  for (const name of names) {
    const entry = (await who.call('POST', '/catalogue/items', {
      kind: 'product',
      name,
      defaultUnit: 'piece',
    })) as { id: string }
    await who.call('POST', `/trips/${tripId}/expenses`, { id: randomUUID(), itemId: entry.id })
  }
}

async function waiting(who: Person): Promise<number> {
  return ((await who.call('GET', '/verdicts/pending')) as { total: number }).total
}

async function rate(page: Page, score: number): Promise<void> {
  await page.getByRole('button', { name: `Rating ${String(score)} out of 5` }).click()
  await page.getByRole('button', { name: 'Save the rating' }).click()
}

// Unique per run: the catalogue is shared, and a name another run proposed would come back as
// that item — still unrated for a new person, but the test would read someone else's name.
const tag = randomUUID().slice(0, 8)

test('rates the purchases one by one, puts one off, and ends at «Everything is rated»', async ({
  page,
}) => {
  const who = await person(page)
  const milk = `Молоко ${tag}`
  const bread = `Хлеб ${tag}`
  await bought(who, [milk, bread])

  await page.goto('/verdicts')

  await expect(page.getByText('2 purchases are waiting to be rated')).toBeVisible()
  await expect(page.getByRole('heading', { level: 2 })).toContainText(bread)
  await expect(page.getByText(/today · SAS/i)).toBeVisible()

  await page.getByRole('button', { name: 'Rating 4 out of 5' }).click()
  await page.getByLabel('A couple of words — if you have any').fill('Мягкий\nна второй день тоже')
  await page.getByRole('button', { name: 'Save the rating' }).click()

  await expect(page.getByRole('heading', { level: 2 })).toContainText(milk)
  await expect(page.getByRole('heading', { level: 2 })).toBeFocused()
  await expect(page.getByText('1 purchase is waiting to be rated')).toBeVisible()

  // Put off, and it is the only one left: it comes round again rather than «all rated».
  await page.getByRole('button', { name: 'Not now' }).click()
  await expect(page.getByRole('heading', { level: 2 })).toContainText(milk)

  await rate(page, 2)

  await expect(page.getByRole('heading', { name: 'Everything is rated' })).toBeVisible()
  await expect.poll(() => waiting(who)).toBe(0)

  // The words went as typed, line break included: an amendment that changes nothing shows them.
  const itemId = (
    (await who.call('POST', '/catalogue/items', {
      kind: 'product',
      name: bread,
      defaultUnit: 'piece',
    })) as { id: string }
  ).id
  const verdict = (await who.call('PATCH', `/verdicts/${itemId}`, { score: 4 })) as {
    review: string
  }
  expect(verdict.review).toBe('Мягкий\nна второй день тоже')

  await page.getByRole('button', { name: 'Open «What to buy»' }).click()
  await expect(page.getByRole('heading', { name: 'What to buy' })).toBeVisible()
})

// The state's heading, not its words: `ScreenState` also hands «title. body» to the app's live
// region, so a plain getByText matches two nodes from ~200 ms onwards and the assertion becomes
// a race the machine wins or loses (MOL-60, measured).
test('7: rated without a connection — «saved», and it goes by itself once online', async ({
  page,
  context,
}) => {
  const who = await person(page)
  await bought(who, [`Сыр ${tag}`])

  await page.goto('/verdicts')
  await expect(page.getByRole('heading', { level: 2 })).toContainText('Сыр')

  await context.setOffline(true)
  await rate(page, 5)

  await expect(page.getByRole('heading', { name: 'The rating is saved' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Everything is rated' })).toHaveCount(0)
  expect(await page.locator('.bad').count()).toBe(0)

  await context.setOffline(false)

  await expect(page.getByRole('heading', { name: 'The rating is saved' })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Everything is rated' })).toBeVisible()
  expect(await waiting(who)).toBe(0)
})

test('7: rated without a connection and the app closed — sent when it is opened again', async ({
  page,
  context,
}) => {
  const who = await person(page)
  await bought(who, [`Творог ${tag}`, `Сметана ${tag}`])

  await page.goto('/verdicts')
  await expect(page.getByRole('heading', { level: 2 })).toContainText('Сметана')

  await context.setOffline(true)
  await rate(page, 3)
  await expect(page.getByRole('heading', { name: 'The rating is saved' })).toBeVisible()
  await page.close()
  expect(await waiting(who)).toBe(2)

  // Opened again with the connection back: the app sends at start, the screen shows what is
  // left — and never the card that was rated, whichever answer lands first.
  await context.setOffline(false)
  const again = await context.newPage()
  await again.goto('/verdicts')

  await expect(again.getByRole('heading', { level: 2 })).toContainText('Творог')
  await expect.poll(() => waiting(who)).toBe(1)
  await expect(again.getByText('1 purchase is waiting to be rated')).toBeVisible()
})

test('the queue that could not load is red and loads again on «Try again»', async ({ page }) => {
  const who = await person(page)
  // Не «Кефир»: справочник разработки общий, а `item-search` ищет это слово — строка отсюда
  // стала бы там первой строкой ответа и уронила бы чужой тест (правило соседних файлов:
  // «имена — те, которых никто не набирает»).
  await bought(who, [`Айран ${tag}`])
  await page.route('**/api/verdicts/pending', (route) => route.abort())

  await page.goto('/verdicts')
  await expect(
    page.getByRole('heading', { name: 'The list of purchases did not load' }),
  ).toBeVisible()

  await page.unroute('**/api/verdicts/pending')
  await page.getByRole('button', { name: 'Try again' }).click()

  await expect(page.getByRole('heading', { level: 2 })).toContainText('Айран')
})
