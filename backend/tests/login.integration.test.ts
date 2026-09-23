import { randomBytes, randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ERROR,
  ISSUE,
  LOGIN_COOKIE,
  LOGIN_HEADER,
  LOGIN_LIFETIME_SECONDS,
  SESSION_COOKIE,
  loginStartedCodec,
  loginPollCodec,
  loginPreviewCodec,
} from '@molvia/model'
import { buildServer } from '@/server'
import { createLoginRequestRepository } from '@/db/login-requests-repository'
import { actors, events, loginRequests, sessions } from '@/db/schema'
import { connectDrizzle } from './db'
import { clearAll, insertActor, insertPlace, insertTrip, telegramId } from './fixtures'

const { db, close } = connectDrizzle()
const botSecret = randomBytes(32).toString('base64url')
const botHeaders = { authorization: `Bearer ${botSecret}` }
const browserHeaders = { [LOGIN_HEADER]: '1' }
const app = buildServer({ db, login: { username: 'molvia_bot', botSecret } })
const requests = createLoginRequestRepository(db)
beforeAll(() => app.ready())
beforeEach(() => clearAll(db))
afterAll(async () => {
  await app.close()
  await clearAll(db)
  await close()
})

async function start() {
  const response = await app.inject({
    method: 'POST',
    url: '/auth/login',
    headers: {
      ...browserHeaders,
      'user-agent': 'Mozilla/5.0 (iPhone) Version/18.0 Mobile Safari/604.1',
    },
  })
  expect(response.statusCode).toBe(201)
  const view = loginStartedCodec.parse(response.json())
  const secret = response.cookies.find((cookie) => cookie.name === LOGIN_COOKIE)?.value ?? ''
  expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/)
  expect(String(response.headers['set-cookie'])).toContain('HttpOnly; Secure; SameSite=Lax')
  expect(response.headers['cache-control']).toBe('no-store')
  return {
    ...view,
    code: new URL(view.url).searchParams.get('start') ?? '',
    secret,
    headers: { ...browserHeaders, cookie: `${LOGIN_COOKIE}=${secret}` },
  }
}
function confirm(code: string, telegramUserId = telegramId()) {
  return app.inject({
    method: 'POST',
    url: `/internal/auth/login/${code}/confirm`,
    headers: botHeaders,
    payload: { telegramUserId },
  })
}
function poll(request: Awaited<ReturnType<typeof start>>) {
  return app.inject({ method: 'GET', url: `/auth/login/${request.id}`, headers: request.headers })
}

describe('Telegram login over HTTP', () => {
  it('waits for the button, then hands the browser one session without exposing credentials', async () => {
    const request = await start()
    const pending = await poll(request)
    expect(loginPollCodec.parse(pending.json()).status).toBe('pending')
    expect(pending.headers['set-cookie']).toBeUndefined()
    const preview = await app.inject({
      method: 'GET',
      url: `/internal/auth/login/${request.code}`,
      headers: botHeaders,
    })
    expect(loginPreviewCodec.parse(preview.json()).deviceName).toBe('iPhone · Safari')
    expect(await db.select().from(actors)).toHaveLength(0)
    expect(await db.select().from(sessions)).toHaveLength(0)
    expect((await confirm(request.code)).statusCode).toBe(204)
    expect(await db.select().from(sessions)).toHaveLength(0)
    const signedIn = await poll(request)
    const view = loginPollCodec.parse(signedIn.json())
    expect(view.status).toBe('authenticated')
    const token = signedIn.cookies.find((cookie) => cookie.name === SESSION_COOKIE)?.value ?? ''
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    const me = await app.inject({
      method: 'GET',
      url: '/actors/me',
      headers: { cookie: `${SESSION_COOKIE}=${token}` },
    })
    expect(me.statusCode).toBe(200)
    for (const response of [pending, preview, signedIn]) {
      expect(response.headers['cache-control']).toBe('no-store')
      for (const forbidden of [
        'telegramUserId',
        'secretHash',
        'tokenHash',
        request.secret,
        token,
      ]) {
        expect(response.body).not.toContain(forbidden)
      }
    }
    expect(JSON.stringify(await db.select().from(sessions))).not.toContain(token)
    expect(await db.select().from(events)).toHaveLength(0)
    const repeat = await poll(request)
    expect(repeat.statusCode).toBe(404)
    expect(repeat.headers['set-cookie']).toBeUndefined()
    expect(await db.select().from(sessions)).toHaveLength(1)
  })

  it('returns existing settings and purchases on another device', async () => {
    const telegramUserId = telegramId()
    const actorId = await insertActor(db, {
      telegramUserId,
      city: 'Ереван',
      spendCurrency: 'USD',
      incomeCurrency: 'EUR',
    })
    const placeId = await insertPlace(db)
    const tripId = await insertTrip(db, { actorId, placeId })
    const [original] = await db.select().from(actors).where(eq(actors.id, actorId))
    const request = await start()
    await confirm(request.code, telegramUserId)
    const response = await poll(request)
    const view = loginPollCodec.parse(response.json())
    expect(view.status).toBe('authenticated')
    if (view.status !== 'authenticated') throw new Error('not authenticated')
    expect(view.actor).toMatchObject({
      id: actorId,
      city: 'Ереван',
      spendCurrency: 'USD',
      incomeCurrency: 'EUR',
    })
    const token = response.cookies.find((cookie) => cookie.name === SESSION_COOKIE)?.value ?? ''
    const trip = await app.inject({
      method: 'GET',
      url: '/trips/current',
      headers: { cookie: `${SESSION_COOKIE}=${token}` },
    })
    expect(trip.statusCode).toBe(200)
    expect(trip.json<{ trip: { id: string } }>().trip.id).toBe(tripId)
    expect((await db.select().from(actors))[0]).toEqual(original)
  })

  it('unknown, expired, refused, consumed, malformed and foreign requests answer alike', async () => {
    const request = await start()
    const foreign = {
      ...browserHeaders,
      cookie: `${LOGIN_COOKIE}=${randomBytes(32).toString('base64url')}`,
    }
    const replies = await Promise.all([
      app.inject({ method: 'GET', url: `/auth/login/${request.id}`, headers: browserHeaders }),
      app.inject({ method: 'GET', url: `/auth/login/${request.id}`, headers: foreign }),
      app.inject({
        method: 'GET',
        url: `/auth/login/${request.id}`,
        headers: {
          ...request.headers,
          cookie: `${request.headers.cookie}; ${request.headers.cookie}`,
        },
      }),
      app.inject({ method: 'GET', url: `/auth/login/${randomUUID()}`, headers: request.headers }),
      app.inject({ method: 'GET', url: '/auth/login/bad-id', headers: request.headers }),
    ])
    await db
      .update(loginRequests)
      .set({ createdAt: sql`now() - interval '5 minutes'`, expiresAt: sql`now()` })
    replies.push(await poll(request))
    const declined = await start()
    await app.inject({
      method: 'POST',
      url: `/internal/auth/login/${declined.code}/decline`,
      headers: botHeaders,
    })
    replies.push(await poll(declined))
    for (const response of replies) {
      expect(response.statusCode).toBe(404)
      expect(response.json()).toEqual({ code: ERROR.LOGIN_UNAVAILABLE })
      expect(response.headers['cache-control']).toBe('no-store')
      expect(response.headers['set-cookie']).toBeUndefined()
    }
    expect(await db.select().from(sessions)).toHaveLength(0)
  })

  it('protects every bot operation before parsing the body, without a browser session', async () => {
    const request = await start()
    for (const [method, suffix] of [
      ['GET', ''],
      ['POST', '/confirm'],
      ['POST', '/decline'],
    ] as const) {
      for (const authorization of ['', `Bearer ${randomBytes(32).toString('base64url')}`]) {
        const response = await app.inject({
          method,
          url: `/internal/auth/login/${request.code}${suffix}`,
          headers: { authorization, 'content-type': 'application/json' },
          payload: '{',
        })
        expect(response.statusCode).toBe(401)
        expect(response.json()).toEqual({ code: ERROR.BOT_UNAUTHORIZED })
        expect(response.headers['cache-control']).toBe('no-store')
      }
    }
    expect((await requests.byIdAndSecret(request.id, request.secret))?.telegramUserId).toBeNull()
  })

  it('does not allow a repeat confirmation to change the Telegram account', async () => {
    const request = await start()
    const first = telegramId()
    expect((await confirm(request.code, first)).statusCode).toBe(204)
    expect((await confirm(request.code, telegramId())).statusCode).toBe(404)
    expect((await requests.byIdAndSecret(request.id, request.secret))?.telegramUserId).toBe(first)
  })

  it.each([false, true])('decline works before collection (confirmed: %s)', async (confirmed) => {
    const request = await start()
    if (confirmed) await confirm(request.code)
    const declined = await app.inject({
      method: 'POST',
      url: `/internal/auth/login/${request.code}/decline`,
      headers: botHeaders,
    })
    expect(declined.statusCode).toBe(204)
    expect((await poll(request)).statusCode).toBe(404)
    expect((await confirm(request.code)).statusCode).toBe(404)
    expect(await db.select().from(sessions)).toHaveLength(0)
  })

  it('old polls cannot remove or replace a newer request cookie', async () => {
    const old = await start()
    const newer = await start()
    await confirm(old.code)
    const response = await app.inject({
      method: 'GET',
      url: `/auth/login/${old.id}`,
      headers: newer.headers,
    })
    expect(response.statusCode).toBe(404)
    expect(response.headers['set-cookie']).toBeUndefined()
    expect((await poll(newer)).statusCode).toBe(200)
  })

  it('requires the custom browser header and rejects foreign fetch metadata and HEAD', async () => {
    const request = await start()
    await confirm(request.code)
    for (const headers of [
      { cookie: request.headers.cookie },
      { ...request.headers, 'sec-fetch-site': 'cross-site' },
      { ...request.headers, 'sec-fetch-site': 'same-site' },
    ]) {
      const response = await app.inject({
        method: 'GET',
        url: `/auth/login/${request.id}`,
        headers,
      })
      expect(response.statusCode).toBe(403)
      expect(response.headers['set-cookie']).toBeUndefined()
    }
    const head = await app.inject({
      method: 'HEAD',
      url: `/auth/login/${request.id}`,
      headers: request.headers,
    })
    expect(head.statusCode).toBe(403)
    expect(head.headers['cache-control']).toBe('no-store')
    expect((await requests.byIdAndSecret(request.id, request.secret))?.consumedAt).toBeNull()
    expect(await db.select().from(sessions)).toHaveLength(0)
    expect((await poll(request)).statusCode).toBe(200)
  })

  it('start rejects bodies, query fields and missing browser headers without writing', async () => {
    for (const payload of ['null', '{}', '{"telegramUserId":123}']) {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/login',
        headers: { ...browserHeaders, 'content-type': 'application/json' },
        payload,
      })
      expect(response.statusCode).toBe(400)
      expect(response.headers['set-cookie']).toBeUndefined()
    }
    expect(
      (await app.inject({ method: 'POST', url: '/auth/login?actorId=x', headers: browserHeaders }))
        .statusCode,
    ).toBe(400)
    expect((await app.inject({ method: 'POST', url: '/auth/login' })).statusCode).toBe(403)
    expect(await db.select().from(loginRequests)).toHaveLength(0)
  })

  it('an unconfigured development server has no real login door', async () => {
    const disabled = buildServer({ db, login: null })
    try {
      const response = await disabled.inject({
        method: 'POST',
        url: '/auth/login',
        headers: browserHeaders,
      })
      expect(response.statusCode).toBe(503)
      expect(response.json()).toEqual({ code: ERROR.LOGIN_DISABLED })
      const bot = await disabled.inject({
        method: 'POST',
        url: '/internal/auth/login/code/confirm',
        headers: { authorization: 'Bearer ' },
        payload: { telegramUserId: 1 },
      })
      expect(bot.statusCode).toBe(401)
    } finally {
      await disabled.close()
    }
  })

  it('is no-store even where Fastify answers itself, and a path that does not decode is ours', async () => {
    // Adversarial А4: no route, or a URL refused before any hook, used to leave the auth prefix
    // without `no-store`.
    for (const [method, url] of [
      ['GET', '/auth/login'],
      ['PUT', '/auth/login'],
      ['DELETE', '/auth/login/x'],
      ['GET', '/internal/auth/nothing'],
    ] as const) {
      const response = await app.inject({ method, url, headers: browserHeaders })
      expect(response.statusCode).toBe(404)
      expect(response.headers['cache-control']).toBe('no-store')
    }
    const undecodable = await app.inject({
      method: 'GET',
      url: '/auth/login/%E0',
      headers: browserHeaders,
    })
    expect(undecodable.statusCode).toBe(400)
    expect(undecodable.headers['cache-control']).toBe('no-store')
    expect(undecodable.json()).toEqual({ code: ISSUE.PATH_INVALID })
  })

  it('must not fire: a reply outside the auth paths does not become no-store', async () => {
    const response = await app.inject({ method: 'GET', url: '/nowhere/%E0' })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ code: ISSUE.PATH_INVALID })
    expect(response.headers['cache-control']).toBeUndefined()
  })
})

describe('the term of a login is the database clock alone', () => {
  afterEach(() => vi.useRealTimers())

  // Adversarial А5: the row's term came from Postgres, but its check and the cookie's `Max-Age`
  // from this process. Six minutes ahead made every start a 500; four made the cookie a minute.
  it.each([-6, -4, 4, 6])(
    'the API %i minutes off Postgres still gives five minutes',
    async (minutes) => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date(Date.now() + minutes * 60_000))
      const response = await app.inject({
        method: 'POST',
        url: '/auth/login',
        headers: browserHeaders,
      })
      expect(response.statusCode).toBe(201)
      expect(String(response.headers['set-cookie'])).toContain(
        `Max-Age=${String(LOGIN_LIFETIME_SECONDS)}`,
      )
      const code = new URL(loginStartedCodec.parse(response.json()).url).searchParams.get('start')
      const preview = await app.inject({
        method: 'GET',
        url: `/internal/auth/login/${code ?? ''}`,
        headers: botHeaders,
      })
      const row = loginPreviewCodec.parse(preview.json())
      expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBe(LOGIN_LIFETIME_SECONDS * 1000)
    },
  )
})
