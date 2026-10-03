import { describe, expect, it, vi } from 'vitest'
import { LOGIN_HEADER, ERROR, ISSUE } from '@molvia/model'
import { ApiError, createClient, createBotClient } from './index'

const id = '9f1b8c7d-4e2a-4b6f-8c3d-1a2b3c4d5e6f'
const expiresAt = '2026-09-22T12:00:00Z'
const secret = 'x'.repeat(43)

describe('login clients', () => {
  it('browser requests carry the guard header and use the existing date codecs', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id, url: 'https://t.me/molvia_bot?start=x', expiresAt }), {
          status: 201,
        }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'pending', expiresAt })))
    const client = createClient({ baseUrl: '/api', fetch })
    expect((await client.startLogin()).expiresAt).toEqual(new Date(expiresAt))
    await client.pollLogin(id)
    for (const [, options] of fetch.mock.calls) {
      expect(new Headers(options?.headers).get(LOGIN_HEADER)).toBe('1')
      expect(new Headers(options?.headers).has('authorization')).toBe(false)
      expect(options?.credentials).toBe('same-origin')
    }
  })

  it('a reply of ours cut off on its body keeps its status, so a login can tell it from a portal (MOL-68)', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response('{"id":"9f1b', { status: 201 }))
      .mockResolvedValueOnce(new Response('<html>portal</html>', { status: 200 }))
    const client = createClient({ baseUrl: '/api', fetch })
    await expect(client.startLogin()).rejects.toMatchObject({
      code: ISSUE.RESPONSE_INVALID,
      answered: true,
      status: 201,
    })
    await expect(client.startLogin()).rejects.toMatchObject({
      code: ISSUE.RESPONSE_INVALID,
      status: 200,
    })
  })

  it('a start says again=1 only when asked to, and nothing else in its query (MOL-68)', async () => {
    const started = (): Response =>
      new Response(JSON.stringify({ id, url: 'https://t.me/molvia_bot?start=x', expiresAt }), {
        status: 201,
      })
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(started())
      .mockResolvedValueOnce(started())
      .mockResolvedValueOnce(started())
    const client = createClient({ baseUrl: '/api', fetch })
    await client.startLogin()
    await client.startLogin({ again: false })
    await client.startLogin({ again: true })
    expect(
      fetch.mock.calls.map(([url]) => (url instanceof Request ? url.url : url.toString())),
    ).toEqual(['/api/auth/login', '/api/auth/login', '/api/auth/login?again=1'])
  })

  it('bot credentials only travel to its internal methods and never follow a redirect', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ deviceName: null, createdAt: expiresAt, expiresAt, confirmed: false }),
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    const bot = createBotClient({ baseUrl: 'http://backend', fetch, secret })
    await bot.previewLogin('code')
    await bot.confirmLogin('code', 123)
    await bot.declineLogin('code')
    await bot.eraseMe(123)
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      'http://backend/internal/auth/login/code',
      'http://backend/internal/auth/login/code/confirm',
      'http://backend/internal/auth/login/code/decline',
      'http://backend/internal/actors/erase',
    ])
    expect(fetch.mock.calls[3]?.[1]?.body).toBe(JSON.stringify({ telegramUserId: 123 }))
    for (const [, options] of fetch.mock.calls) {
      expect(new Headers(options?.headers).get('authorization')).toBe(`Bearer ${secret}`)
      expect(options?.credentials).toBe('omit')
      expect(options?.redirect).toBe('error')
    }
  })

  it('the reminder: a claim, and a press addressed by the item in lower case (MOL-101)', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            reminders: [
              {
                telegramUserId: 123,
                items: [{ itemId: id, name: 'Молоко', placeName: 'SAS', daysAgo: 1 }],
                total: 1,
              },
            ],
          }),
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    const bot = createBotClient({ baseUrl: 'http://backend', fetch, secret })
    expect((await bot.claimReminders()).reminders[0]?.items[0]?.daysAgo).toBe(1)
    await bot.rateFromBot(123, id.toUpperCase(), 4)
    expect(fetch.mock.calls.map(([url, options]) => [url, options?.method])).toEqual([
      ['http://backend/internal/reminders/claim', 'POST'],
      [`http://backend/internal/verdicts/${id}`, 'PUT'],
    ])
    expect(fetch.mock.calls[1]?.[1]?.body).toBe(JSON.stringify({ telegramUserId: 123, score: 4 }))
    for (const [, options] of fetch.mock.calls) {
      expect(new Headers(options?.headers).get('authorization')).toBe(`Bearer ${secret}`)
    }
  })

  it("the owner's channel: a failure reported by kind, the notices claimed (MOL-143)", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            to: 4242,
            notices: [
              {
                kind: 'failure_count',
                source: 'bot',
                errorName: 'GrammyError',
                route: 'callback:rate',
                build: 'v0.2.0',
                count: 10,
              },
            ],
          }),
        ),
      )
    const bot = createBotClient({ baseUrl: 'http://backend', fetch, secret })
    await bot.reportFailure({ errorName: 'TypeError', handler: 'callback:rate' })
    expect((await bot.claimOwnerNotices()).notices[0]).toMatchObject({ count: 10 })
    expect(fetch.mock.calls.map(([url, options]) => [url, options?.method])).toEqual([
      ['http://backend/internal/failures', 'POST'],
      ['http://backend/internal/owner/claim', 'POST'],
    ])
    expect(fetch.mock.calls[0]?.[1]?.body).toBe(
      JSON.stringify({ errorName: 'TypeError', handler: 'callback:rate' }),
    )
  })

  it("the owner's claim hears the caller's signal: the bot's stop has a deadline (MOL-143)", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      async (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'))
          })
        }),
    )
    const bot = createBotClient({ baseUrl: 'http://backend', fetch, secret })
    const deadline = new AbortController()
    const claim = bot.claimOwnerNotices(deadline.signal)
    deadline.abort()
    await expect(claim).rejects.toBeInstanceOf(ApiError)
  })

  it('a report that carries more than a kind is refused before it is sent (MOL-143)', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
    const bot = createBotClient({ baseUrl: 'http://backend', fetch, secret })
    const withText = { errorName: 'TypeError', handler: 'message', text: 'привет' }
    await expect(bot.reportFailure(withText)).rejects.toMatchObject({ code: ISSUE.BODY_INVALID })
    const sentence = { errorName: 'Не вышло: сыр', handler: 'message' }
    await expect(bot.reportFailure(sentence)).rejects.toMatchObject({ code: ISSUE.BODY_INVALID })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('a claim that grew a field about the person is refused (MOL-101)', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          reminders: [
            {
              telegramUserId: 123,
              actorId: id,
              items: [{ itemId: id, name: 'Молоко', placeName: 'SAS', daysAgo: 1 }],
              total: 1,
            },
          ],
        }),
      ),
    )
    const bot = createBotClient({ baseUrl: 'http://backend', fetch, secret })
    await expect(bot.claimReminders()).rejects.toMatchObject({ code: ISSUE.RESPONSE_INVALID })
  })

  it('bad paths and malformed confirmation are refused before sending the bot secret', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
    const bot = createBotClient({ baseUrl: 'http://backend', fetch, secret })
    await expect(bot.previewLogin('../health')).rejects.toMatchObject({ code: ISSUE.PATH_INVALID })
    await expect(bot.confirmLogin('code', 0)).rejects.toMatchObject({ code: ISSUE.BODY_INVALID })
    await expect(bot.eraseMe(0)).rejects.toMatchObject({ code: ISSUE.BODY_INVALID })
    await expect(bot.eraseMe(1.5)).rejects.toMatchObject({ code: ISSUE.BODY_INVALID })
    await expect(bot.rateFromBot(123, '../health', 4)).rejects.toMatchObject({
      code: ISSUE.PATH_INVALID,
    })
    await expect(bot.rateFromBot(123, id, 6)).rejects.toMatchObject({ code: ISSUE.BODY_INVALID })
    await expect(bot.rateFromBot(0, id, 4)).rejects.toMatchObject({ code: ISSUE.BODY_INVALID })
    expect(fetch).not.toHaveBeenCalled()
    expect(() => createBotClient({ baseUrl: 'http://backend', secret: '' })).toThrow()
  })

  it('an expired login is distinct from losing an authenticated session', async () => {
    const client = createClient({
      baseUrl: '/api',
      fetch: () =>
        Promise.resolve(
          new Response(JSON.stringify({ code: ERROR.LOGIN_UNAVAILABLE }), { status: 404 }),
        ),
    })
    await expect(client.pollLogin(id)).rejects.toMatchObject({ code: ERROR.LOGIN_UNAVAILABLE })
  })
})

describe('устройства и выход (MOL-57)', () => {
  it('выход несёт заголовок входа, список и завершение идут по своим адресам', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            sessions: [
              { id, deviceName: null, createdAt: expiresAt, lastSeenAt: expiresAt, current: true },
            ],
            total: 1,
          }),
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    const client = createClient({ baseUrl: '/api', fetch })

    await client.logout()
    const list = await client.sessions()
    await client.endSession(id.toUpperCase())

    expect(list.sessions[0]?.lastSeenAt).toEqual(new Date(expiresAt))
    const [logout, sessions, end] = fetch.mock.calls
    expect(logout?.[0]).toBe('/api/auth/logout')
    expect(logout?.[1]?.method).toBe('POST')
    expect(new Headers(logout?.[1]?.headers).get(LOGIN_HEADER)).toBe('1')
    expect(sessions?.[0]).toBe('/api/sessions')
    expect(end?.[0]).toBe(`/api/sessions/${id.toUpperCase()}`)
    expect(end?.[1]?.method).toBe('DELETE')
  })

  it('завершение уже ушедшей сессии приходит кодом not_found', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: ERROR.NOT_FOUND }), { status: 404 }),
      )
    const client = createClient({ baseUrl: '/api', fetch })
    await expect(client.endSession(id)).rejects.toMatchObject({ code: ERROR.NOT_FOUND })
  })

  it('портал, ответивший 200 своей страницей, — не выход и не завершение (round 4)', async () => {
    const portal = () =>
      Promise.resolve(
        new Response('<html>Wi-Fi</html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }),
      )
    const client = createClient({ baseUrl: '/api', fetch: vi.fn<typeof globalThis.fetch>(portal) })

    await expect(client.logout()).rejects.toMatchObject({
      code: ISSUE.RESPONSE_INVALID,
      answered: false,
    })
    await expect(client.endSession(id)).rejects.toMatchObject({
      code: ISSUE.RESPONSE_INVALID,
      answered: false,
    })
    await expect(client.eraseMe()).rejects.toMatchObject({
      code: ISSUE.RESPONSE_INVALID,
      answered: false,
    })
  })
})

describe('удаление из настроек (MOL-94)', () => {
  it('идёт DELETE на /actors/me без тела и без владельца в адресе', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    const client = createClient({ baseUrl: '/api', fetch })

    await client.eraseMe()

    const [call] = fetch.mock.calls
    expect(call?.[0]).toBe('/api/actors/me')
    expect(call?.[1]?.method).toBe('DELETE')
    expect(call?.[1]?.body).toBeUndefined()
    expect(new Headers(call?.[1]?.headers).get('content-type')).toBeNull()
  })

  it('повтор без сессии приходит кодом no_actor', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: ERROR.NO_ACTOR }), { status: 401 }),
      )
    const client = createClient({ baseUrl: '/api', fetch })
    await expect(client.eraseMe()).rejects.toMatchObject({ code: ERROR.NO_ACTOR })
  })
})
