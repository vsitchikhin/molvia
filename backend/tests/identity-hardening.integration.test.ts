/**
 * Regressions for the adversarial pass on MOL-8 (О-11…О-15 and the third finding of Г2).
 * Every one of these was green as a defect before the fix, and each says what an attacker
 * or an ordinary mistyped request actually gets now.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import Fastify from 'fastify'
import { ERROR, ISSUE } from '@molvia/model'
import type { FastifyInstance } from 'fastify'
import { actors, events } from '@/db/schema'
import { buildServer } from '@/server'
import { withActor } from '@/routes/actor'
import { env } from '@/env'
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

function firstVisit(code: string | null, payload?: string) {
  return app.inject({
    method: 'POST',
    url: '/actors',
    headers: {
      ...(code === null ? {} : { 'x-molvia-invite': code }),
      ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(payload === undefined ? {} : { payload }),
  })
}

describe('the door speaks before the body does', () => {
  it('refuses a stranger whatever they sent, instead of letting the size decide', async () => {
    // The seam used to answer first: a megabyte was buffered and parsed for a caller who
    // was never allowed to speak, and a body past the limit came back 413 — so what a
    // stranger learned depended on what they sent rather than on the door.
    const megabyte = await firstVisit(null, JSON.stringify({ junk: 'x'.repeat(900_000) }))
    const larger = await firstVisit(null, JSON.stringify({ junk: 'x'.repeat(2_000_000) }))

    expect(megabyte.statusCode).toBe(401)
    expect(larger.statusCode).toBe(401)
    expect(JSON.parse(larger.body)).toEqual({ code: ERROR.NO_ACTOR })
  })

  it('refuses a body on the handle documented as having none', async () => {
    // Accepting `{"country":"RU"}` and answering «AM» told the caller their input was
    // understood when it had been discarded.
    const response = await firstVisit(env.SIGNUP_CODE, JSON.stringify({ country: 'RU' }))

    expect(response.statusCode).toBe(400)
    expect(JSON.parse(response.body)).toMatchObject({ code: ISSUE.BODY_INVALID })
    expect(await db.select().from(actors)).toHaveLength(0)
  })
})

describe('a malformed body is the caller’s mistake, and reads as one', () => {
  it('answers 400 with the code that means «your request», not «our fault»', async () => {
    // It used to be a 400 carrying `error.internal`: the status said one thing, the body
    // said another, and the PWA showed «Something went wrong». It also went through
    // `log.error`, filing a client's typo as a server failure.
    const response = await firstVisit(env.SIGNUP_CODE, '{')

    expect(response.statusCode).toBe(400)
    expect(JSON.parse(response.body)).toEqual({ code: ISSUE.BODY_INVALID })
  })

  it('answers an empty body announced as JSON the same way', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/actors',
      headers: { 'content-type': 'application/json', 'x-molvia-invite': env.SIGNUP_CODE },
      payload: '',
    })

    expect(response.statusCode).toBe(400)
    expect(JSON.parse(response.body)).toEqual({ code: ISSUE.BODY_INVALID })
  })
})

describe('the replies that carry the identity', () => {
  it('tell every cache not to keep them', async () => {
    // In 0.1 the identifier is the whole proof of identity — whoever reads it is the owner.
    // A shared or disk cache holding this reply is the account sitting in a file.
    const created = await firstVisit(env.SIGNUP_CODE)
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

describe('the door itself', () => {
  it('answers a wrong code exactly as it answers a missing one', async () => {
    const wrong = await firstVisit('not-the-code')
    const missing = await firstVisit(null)

    expect(wrong.statusCode).toBe(missing.statusCode)
    expect(wrong.body).toBe(missing.body)
    expect(await db.select().from(actors)).toHaveLength(0)
  })

  it('refuses a code that is right except for its last character', async () => {
    // The length rule lives in the env schema, so asserting it here could not fail — the
    // process would not have started. What is worth pinning is that a near miss is a miss:
    // the comparison is over digests, so it neither stops early nor leaks how much matched.
    const almost = `${env.SIGNUP_CODE.slice(0, -1)}${env.SIGNUP_CODE.endsWith('a') ? 'b' : 'a'}`

    const response = await firstVisit(almost)

    expect(response.statusCode).toBe(401)
    expect(await db.select().from(actors)).toHaveLength(0)
  })
})
