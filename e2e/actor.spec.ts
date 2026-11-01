import { expect, test } from '@playwright/test'
import { SESSION_COOKIE } from '@molvia/model'
import type { Page } from '@playwright/test'
import { open } from './session'

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
  await expect(page.getByRole('heading', { level: 1 })).not.toHaveText(/^(Sign in|Molvia)$/)
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
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Molvia')
  await page.getByRole('button', { name: 'Sign in for development' }).click()

  await expect.poll(async () => (await sessionCookie(page))?.value).toMatch(/^[A-Za-z0-9_-]{43}$/)
  expect(await knownOwner(page)).toBe(owner)
})

// MOL-349, owner's В-2 «б»: an identity the server did not check has no notice and no «Try again» of
// its own — they stood over the screen's error and its «Try again» (kit-settings-7) — and asks again
// by itself. Сервер, который не ответил, — это не «сессии нет»: приложение показывается, а не дверь
// (MOL-56).
test('an identity the server did not check says nothing of its own, and asks again by itself', async ({
  page,
}) => {
  // Плашка была про телефон, который уже знает своего владельца: на пустом устройстве это дверь.
  await open(page)
  let refused = 0
  await page.route('**/api/actors/me', (route) => {
    refused += 1
    return route.fulfill({ status: 500, body: '{}' })
  })
  await page.reload()
  await expect.poll(() => refused).toBeGreaterThan(0)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('What to buy')
  await expect(page.locator('.notice-slot')).toBeEmpty()

  // The first try again comes five seconds after the failure, with no tap.
  await page.unroute('**/api/actors/me')
  const answered = await page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/api/actors/me',
    { timeout: 15_000 },
  )
  expect(answered.status()).toBe(200)
})
