import { expect, test } from '@playwright/test'
import { SESSION_COOKIE } from '@molvia/model'
import type { Page } from '@playwright/test'
import { open } from './session'
import { recordLiveRegion } from './live-region'

/**
 * How a request proves who it is, through a real browser (MOL-53). None of this can be shown
 * with a mocked fetch: `HttpOnly` is the browser's own rule, a cookie surviving a reload is the
 * browser's own jar, and «no identifier travels any more» is a fact about the wire.
 */
const KEY = 'molvia.actor'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

async function knownOwner(page: Page): Promise<string | null> {
  return page.evaluate((key) => localStorage.getItem(key), KEY)
}

async function sessionCookie(page: Page) {
  const cookies = await page.context().cookies()
  return cookies.find((cookie) => cookie.name === SESSION_COOKIE)
}

test('keeps the session across a reload, and no script can read it', async ({ page }) => {
  const identifiers: string[] = []
  page.on('request', (request) => {
    // The header is gone with the thing it carried. Watched rather than assumed: the client
    // could grow it back and every unit test would still pass.
    const header = request.headers()['x-molvia-actor']
    if (header) identifiers.push(header)
  })

  await open(page)

  await expect.poll(async () => (await sessionCookie(page))?.value).toMatch(/^[A-Za-z0-9_-]{43}$/)
  const session = await sessionCookie(page)

  expect(session?.httpOnly).toBe(true)
  expect(session?.path).toBe('/')
  expect(session?.sameSite).toBe('Lax')
  // Persistent, not a session cookie: closing the browser must not be a way out. Playwright
  // reports a session cookie as `expires === -1`.
  expect(session?.expires).toBeGreaterThan(Date.now() / 1000)

  // The whole point of `HttpOnly`: an XSS cannot carry the account away.
  expect(await page.evaluate(() => document.cookie)).not.toContain(SESSION_COOKIE)

  await page.reload()

  expect((await sessionCookie(page))?.value).toBe(session?.value)
  await expect(page.getByRole('heading', { level: 1 })).not.toHaveText('Sign in')
  expect(identifiers).toEqual([])
})

test('remembers whose drawer this is, so an offline launch finds its own', async ({ page }) => {
  // The owner id stays on the device — not as a credential, as the key the trip queue and the
  // recent items are filed under, read before the server can be asked (MOL-53, Р-9).
  await open(page)

  await expect.poll(() => knownOwner(page)).toMatch(UUID)
  const owner = await knownOwner(page)

  await page.reload()

  expect(await knownOwner(page)).toBe(owner)
})

test('a session that is gone brings back the same owner, not a new person', async ({ page }) => {
  // Решение владельца от 22.09.2026: «владелец аккаунта не должен меняться». До этого шов чеканил
  // новый Telegram-id на каждый вызов, и истёкшая сессия делала человека другим — а всё, что
  // устройство сложило под прежнего (неотправленная очередь похода в первую очередь), оставалось
  // недостижимым. Проверяется в браузере, потому что держится это на двух настоящих cookie.
  await open(page)
  await expect.poll(() => knownOwner(page)).toMatch(UUID)
  const owner = await knownOwner(page)

  // Ровно то, что делает истечение или отзыв: сессии нет, аккаунт остался.
  await page.context().clearCookies({ name: SESSION_COOKIE })

  await page.reload()

  // Экран входа, а не пустое приложение и не новый человек (MOL-56): входим снова тем же швом.
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sign in')
  await page.getByRole('button', { name: 'Sign in for development' }).click()

  await expect.poll(async () => (await sessionCookie(page))?.value).toMatch(/^[A-Za-z0-9_-]{43}$/)
  expect(await knownOwner(page)).toBe(owner)
})

// The identity's error is polite, so the region is its only way to a screen reader. «Try again»
// failing the same way must be heard again, not swallowed as «no change» (MOL-19, C1).
//
// Сервер, который не ответил, — это не «сессии нет»: сессия может быть жива за порталом кафе,
// поэтому приложение показывается с плашкой, а не дверью (MOL-56).
test('the same answer after «Try again» is said again', async ({ page }) => {
  const said = await recordLiveRegion(page)
  await page.route('**/api/actors/me**', (route) => route.fulfill({ status: 500, body: '{}' }))
  await page.goto('/')
  const notice = 'Could not check the sign-in'
  await expect(page.getByRole('heading', { name: notice })).toBeVisible()
  await expect
    .poll(async () => (await said()).filter((text) => text.includes(notice)))
    .toHaveLength(1)

  await page.getByRole('button', { name: 'Try again' }).click()
  await expect
    .poll(async () => (await said()).filter((text) => text.includes(notice)))
    .toHaveLength(2)
})
