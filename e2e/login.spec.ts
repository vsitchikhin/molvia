import process from 'node:process'
import { randomInt } from 'node:crypto'
import { expect, test } from '@playwright/test'
import {
  LOGIN_COOKIE,
  LOGIN_HEADER,
  SESSION_COOKIE,
  loginStartedCodec,
  loginPollCodec,
} from '@molvia/model'
import type { Page, APIRequestContext } from '@playwright/test'

async function start(page: Page) {
  // No app bootstrap: MOL-56 owns the screen; the development shell would auto-login.
  await page.goto('/api/health')
  const body: unknown = await page.evaluate(async (header) => {
    const response = await fetch('/api/auth/login', { method: 'POST', headers: { [header]: '1' } })
    const result: unknown = await response.json()
    return result
  }, LOGIN_HEADER)
  return loginStartedCodec.parse(body)
}
async function confirm(request: APIRequestContext, url: string, telegramUserId: number) {
  const code = new URL(url).searchParams.get('start') ?? ''
  // Synthetic test-only secret set on the isolated e2e backend, never a real bot token.
  const response = await request.post(
    `http://127.0.0.1:${process.env.E2E_API_PORT ?? ''}/internal/auth/login/${code}/confirm`,
    {
      headers: { authorization: `Bearer ${'e'.repeat(43)}` },
      data: { telegramUserId },
    },
  )
  expect(response.status()).toBe(204)
}
async function poll(page: Page, id: string) {
  const body: unknown = await page.evaluate(
    async ({ id, header }) => {
      const response = await fetch(`/api/auth/login/${id}`, { headers: { [header]: '1' } })
      const result: unknown = await response.json()
      return result
    },
    { id, header: LOGIN_HEADER },
  )
  return loginPollCodec.parse(body)
}

test('the browser receives HttpOnly cookies through /api and returns to the same account', async ({
  page,
  request,
}) => {
  const first = await start(page)
  const pending = await poll(page, first.id)
  expect(pending.status).toBe('pending')
  const loginCookie = (await page.context().cookies()).find(
    (cookie) => cookie.name === LOGIN_COOKIE,
  )
  expect(loginCookie).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Lax', path: '/' })
  const telegramUserId = randomInt(1, 2 ** 40)
  await confirm(request, first.url, telegramUserId)
  const firstLogin = await poll(page, first.id)
  expect(firstLogin.status).toBe('authenticated')
  const session = (await page.context().cookies()).find((cookie) => cookie.name === SESSION_COOKIE)
  expect(session).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Lax', path: '/' })
  expect(await page.evaluate(async () => (await fetch('/api/actors/me')).status)).toBe(200)
  await page.context().clearCookies()
  const next = await start(page)
  await confirm(request, next.url, telegramUserId)
  const nextLogin = await poll(page, next.id)
  if (firstLogin.status !== 'authenticated' || nextLogin.status !== 'authenticated')
    throw new Error('login failed')
  expect(nextLogin.actor.id).toBe(firstLogin.actor.id)
})

test('navigation and HEAD cannot collect a confirmed login', async ({ page, request }) => {
  const started = await start(page)
  await confirm(request, started.url, randomInt(1, 2 ** 40))
  const response = await page.goto(`/api/auth/login/${started.id}`)
  expect(response?.status()).toBe(403)
  expect((await page.context().cookies()).some((cookie) => cookie.name === SESSION_COOKIE)).toBe(
    false,
  )
  expect(
    await page.evaluate(
      async ({ id, header }) =>
        (
          await fetch(`/api/auth/login/${id}`, {
            method: 'HEAD',
            headers: { [header]: '1' },
          })
        ).status,
      { id: started.id, header: LOGIN_HEADER },
    ),
  ).toBe(403)
  expect((await poll(page, started.id)).status).toBe('authenticated')
})

test('a foreign origin cannot read or collect a login through fetch', async ({
  page,
  request,
  baseURL,
}) => {
  const started = await start(page)
  await confirm(request, started.url, randomInt(1, 2 ** 40))
  await page.route('http://foreign.invalid/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>Foreign origin</title>',
    }),
  )
  await page.goto('http://foreign.invalid/')
  const url = `${baseURL ?? ''}/api/auth/login/${started.id}`
  const reached = await page.evaluate(
    async ({ url, header }) => {
      try {
        await fetch(url, { credentials: 'include', headers: { [header]: '1' } })
        return true
      } catch {
        return false
      }
    },
    { url, header: LOGIN_HEADER },
  )
  expect(reached).toBe(false)
  await page.goto('/api/health')
  expect((await page.context().cookies()).some((cookie) => cookie.name === SESSION_COOKIE)).toBe(
    false,
  )
  expect((await poll(page, started.id)).status).toBe('authenticated')
})
