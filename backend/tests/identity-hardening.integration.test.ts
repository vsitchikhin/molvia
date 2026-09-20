/**
 * Regressions for the adversarial pass on MOL-8 (О-11…О-15 and the third finding of Г2).
 * Every one of these was green as a defect before the fix, and each says what an attacker
 * or an ordinary mistyped request actually gets now.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import process from 'node:process'
import Fastify from 'fastify'
import { ISSUE } from '@molvia/model'
import type { FastifyInstance } from 'fastify'
import { actors, events } from '@/db/schema'
import { buildServer } from '@/server'
import { withActor } from '@/routes/actor'
import { connectDrizzle } from './db'

const { db, close } = connectDrizzle()

let app: FastifyInstance

beforeAll(async () => {
  app = buildServer({ db })
  await app.ready()
})

beforeEach(async () => {
  await db.delete(events)
  await db.delete(actors)
})

afterAll(async () => {
  await db.delete(events)
  await db.delete(actors)
  await app.close()
  await close()
})

/**
 * The first visit through the development seam (MOL-52). The invite code it used to carry is
 * gone with the door; what the seam kept is everything the door had nothing to do with — the
 * refusal of a body, the shape of a malformed one, and `no-store` on the reply.
 */
function firstVisit(payload?: string) {
  return app.inject({
    method: 'POST',
    url: '/dev/actors',
    headers: payload === undefined ? {} : { 'content-type': 'application/json' },
    ...(payload === undefined ? {} : { payload }),
  })
}

describe('the seam that replaced the door', () => {
  it('refuses a body on the handle documented as having none', async () => {
    // Accepting `{"country":"RU"}` and answering «AM» told the caller their input was
    // understood when it had been discarded.
    const response = await firstVisit(JSON.stringify({ country: 'RU' }))

    expect(response.statusCode).toBe(400)
    expect(JSON.parse(response.body)).toMatchObject({ code: ISSUE.BODY_INVALID })
    expect(await db.select().from(actors)).toHaveLength(0)
  })

  it('refuses a stranger whatever they sent, instead of letting the size decide', async () => {
    // This used to be `withInvite`'s property, and it was lost when the door went: the check
    // moved onto `request.body`, so a megabyte came back 400 after being buffered and parsed,
    // while two megabytes came back 413 — what a caller learned depended on how much they sent
    // (adversarial А9). Decided by the headers on `onRequest` again, both are the same answer.
    const megabyte = await firstVisit(JSON.stringify({ junk: 'x'.repeat(900_000) }))
    const larger = await firstVisit(JSON.stringify({ junk: 'x'.repeat(2_000_000) }))

    expect(megabyte.statusCode).toBe(400)
    expect(larger.statusCode).toBe(400)
    expect(JSON.parse(larger.body)).toMatchObject({ code: ISSUE.BODY_INVALID })
    expect(await db.select().from(actors)).toHaveLength(0)
  })

  it('refuses a body of literal null, which is a body like any other', async () => {
    // Read off `request.body` it was indistinguishable from no body at all, so it wrote a row
    // in silence — the one case the old check let through (А9).
    const response = await firstVisit('null')

    expect(response.statusCode).toBe(400)
    expect(await db.select().from(actors)).toHaveLength(0)
  })

  it('does not answer the address the door used to stand at', async () => {
    // `POST /actors` and its invite code went together (MOL-52): taking the code off and
    // leaving the handle open to the internet would have been worse than either.
    const gone = await firstVisit()
    expect(gone.statusCode).toBe(201)

    const old = await app.inject({ method: 'POST', url: '/actors' })
    expect(old.statusCode).toBe(404)
  })

  it('is not registered at all when NODE_ENV says production', async () => {
    // The other half of «the seam cannot be switched on in production» (требования, проверка
    // 13). The build check in `bundle-seam` covers the artifact; this covers a server started
    // from source with that variable set — the way CI and a misconfigured host would run it.
    const was = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    try {
      const production = buildServer({ db })
      await production.ready()
      try {
        const response = await production.inject({ method: 'POST', url: '/dev/actors' })

        expect(response.statusCode).toBe(404)
        expect(await db.select().from(actors)).toHaveLength(0)
      } finally {
        await production.close()
      }
    } finally {
      process.env.NODE_ENV = was
    }
  })
})

describe('a body is a body, whatever is inside it', () => {
  // These used to check that a **malformed** body came back 400 with the registry's code
  // rather than a 400 carrying `error.internal`. On this handle that can no longer be asked:
  // the body is refused by its headers before anything parses it (А9), so `'{'`, `''` and a
  // well-formed object are one and the same answer — which is the property worth having here.
  // The malformed-JSON path itself is exercised where it belongs, in
  // `error-handler.integration.test.ts`, on a route that actually takes a body.
  it('answers the same to broken JSON, to empty JSON and to a valid object', async () => {
    const answers = await Promise.all(
      ['{', '', '{}'].map(async (payload) => {
        const response = await app.inject({
          method: 'POST',
          url: '/dev/actors',
          headers: { 'content-type': 'application/json' },
          payload,
        })
        return { status: response.statusCode, body: response.body }
      }),
    )

    expect(answers.map((answer) => answer.status)).toEqual([400, 400, 400])
    expect(new Set(answers.map((answer) => answer.body)).size).toBe(1)
    expect(JSON.parse(answers[0]?.body ?? '')).toMatchObject({ code: ISSUE.BODY_INVALID })
    expect(await db.select().from(actors)).toHaveLength(0)
  })
})

describe('the replies that carry the identity', () => {
  it('tell every cache not to keep them', async () => {
    // In 0.1 the identifier is the whole proof of identity — whoever reads it is the owner.
    // A shared or disk cache holding this reply is the account sitting in a file.
    const created = await firstVisit()
    const id = (JSON.parse(created.body) as { id: string }).id

    const mine = await app.inject({
      method: 'GET',
      url: '/actors/me',
      headers: { 'x-molvia-actor': id },
    })

    expect(created.headers['cache-control']).toBe('no-store')
    expect(mine.headers['cache-control']).toBe('no-store')
  })

  it('refuse with a challenge, as a 401 is required to', async () => {
    const refused = await app.inject({ method: 'GET', url: '/actors/me' })

    expect(refused.statusCode).toBe(401)
    expect(refused.headers['www-authenticate']).toContain('Molvia')
  })
})

describe('the guarded scope', () => {
  it('covers every route added to it, not only the one it was written for', async () => {
    // The scope used to be created inside the actor routes, so a route registered beside
    // them — which is how MOL-12, MOL-21 and MOL-27 will add theirs — got no hook at all.
    // Now the scope is the composition point's own, and this is the shape it has there.
    const server = Fastify()
    await server.register((scope, _options, done) => {
      withActor(scope, () => Promise.reject(new Error('never asked')))
      scope.get('/trips', () => ({ reached: true }))
      done()
    })
    await server.ready()

    const response = await server.inject({ method: 'GET', url: '/trips' })
    await server.close()

    // What matters here is that the handler never ran. Which status a refusal carries is
    // the error handler's business, and this bare instance deliberately has none — the 401
    // and its challenge are asserted above, on the server that does.
    expect(response.statusCode).not.toBe(200)
    expect(response.body).not.toContain('reached')
  })

  it('leaves /health outside it, so a container can still check itself', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' })

    expect(response.statusCode).toBe(200)
  })
})
