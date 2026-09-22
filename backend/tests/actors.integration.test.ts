/**
 * The whole path of an identity, through the server rather than around it: the seam, the
 * cookie, the hook and the central error handler all take part, and every one of them is a
 * place where a wrong answer would only show up here.
 */
import { randomBytes } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { ERROR, SESSION_COOKIE, actorWireSchema } from '@molvia/model'
import type { ActorWire } from '@molvia/model'
import type { FastifyInstance } from 'fastify'
import { actors, events } from '@/db/schema'
import { buildServer } from '@/server'
import { connectDrizzle } from './db'
import { signIn } from './fixtures'

const { db, close } = connectDrizzle()

const UNKNOWN_ID = '11111111-1111-4111-8111-111111111111'

interface Reply {
  readonly status: number
  readonly body: unknown
}

async function served<T>(use: (app: FastifyInstance) => Promise<T>): Promise<T> {
  // Pointed at the test database, not at the one `.env` names: otherwise the server writes
  // into the database entered by hand while this file reads an empty one, and every
  // assertion about rows passes without proving anything.
  const app = buildServer({ db })
  await app.ready()
  try {
    return await use(app)
  } finally {
    await app.close()
  }
}

/**
 * The reply read through the contract the API answers with, rather than cast to a shape this
 * test hopes for: a server that stopped sending what it promised should fail here.
 */
function actorIn(body: unknown): ActorWire {
  return actorWireSchema.parse(body)
}

/** The first visit through the development seam that replaced the invite door (MOL-52). */
async function firstVisit(): Promise<Reply> {
  return served(async (app) => {
    const response = await app.inject({ method: 'POST', url: '/dev/login' })
    return { status: response.statusCode, body: JSON.parse(response.body) as unknown }
  })
}

/** «Кто я» с любым заголовком `Cookie`, каким бы он ни был, — или вовсе без него. */
async function withCookie(cookie: string | null): Promise<Reply> {
  return served(async (app) => {
    const response = await app.inject({
      method: 'GET',
      url: '/actors/me',
      headers: cookie === null ? {} : { cookie },
    })
    return { status: response.statusCode, body: JSON.parse(response.body) as unknown }
  })
}

/** «Кто я» от лица владельца, которому только что выдали сессию. */
async function asActor(id: string | null): Promise<Reply> {
  return withCookie(id === null ? null : await signIn(db, id))
}

/** 32 байта, как чеканит сам сервер: такой токен есть кому не найти, а не нечем прочитать. */
function aToken(): string {
  return randomBytes(32).toString('base64url')
}

beforeEach(async () => {
  await db.delete(events)
  await db.delete(actors)
})

afterAll(async () => {
  await db.delete(events)
  await db.delete(actors)
  await close()
})

describe('the first visit', () => {
  it('issues an identity with the four settings a person starts with', async () => {
    const { status, body } = await firstVisit()
    const actor = actorIn(body)

    expect(status).toBe(201)
    expect(actor).toMatchObject({
      country: 'AM',
      city: 'Гюмри',
      spendCurrency: 'AMD',
      incomeCurrency: 'RUB',
    })
    expect(actor.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })

  it('sends the timestamps as ISO strings, not as whatever JSON made of a Date', async () => {
    const actor = actorIn((await firstVisit()).body)

    expect(actor.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/)
    expect(new Date(actor.createdAt).getTime()).not.toBeNaN()
  })

  it('never sends the Telegram id, though the row it just wrote holds one', async () => {
    // The wire schema is strict, so a reply that grew the field would fail `actorIn` rather
    // than travel unnoticed — which is the whole reason it is strict (MOL-52, Р-11).
    const { body } = await firstVisit()

    expect(body).not.toHaveProperty('telegramUserId')
    expect(actorIn(body)).not.toHaveProperty('telegramUserId')

    const [row] = await db.select().from(actors)
    expect(row?.telegramUserId).toBeGreaterThan(0)
  })

  it('gives two visits two identities: the server does not guess the device', async () => {
    const first = actorIn((await firstVisit()).body)
    const second = actorIn((await firstVisit()).body)

    expect(first.id).not.toBe(second.id)
    expect(await db.select().from(actors)).toHaveLength(2)
  })

  it('writes nothing to the event log at all', async () => {
    // The log holds only what no domain table can answer, and «when this person first
    // appeared» is `actors.created_at`. MOL-12 writes the first event there is.
    await firstVisit()

    expect(await db.select().from(events)).toHaveLength(0)
  })
})

describe('a request that proves who it is', () => {
  it('gets back that owner and nobody else', async () => {
    const mine = actorIn((await firstVisit()).body)
    const other = actorIn((await firstVisit()).body)

    const { status, body } = await asActor(mine.id)

    expect(status).toBe(200)
    expect(actorIn(body).id).toBe(mine.id)
    expect(actorIn(body).id).not.toBe(other.id)
  })

  it('is refused with 401 when there is no cookie at all', async () => {
    expect(await asActor(null)).toEqual({ status: 401, body: { code: ERROR.NO_ACTOR } })
  })

  it('is refused the same way for a value this server could not have minted', async () => {
    // The repository refuses the shape before Postgres sees it, so «not a token» is nothing
    // found rather than an error about its form — which would be a third distinguishable
    // answer where the whole point is that there is one.
    for (const bad of ['abc', ' ', 'не токен вовсе', UNKNOWN_ID]) {
      expect(await withCookie(`${SESSION_COOKIE}=${bad}`)).toEqual({
        status: 401,
        body: { code: ERROR.NO_ACTOR },
      })
    }
  })

  it('is refused when the token is well formed but nobody holds it', async () => {
    expect(await withCookie(`${SESSION_COOKIE}=${aToken()}`)).toEqual({
      status: 401,
      body: { code: ERROR.NO_ACTOR },
    })
  })

  it('does not create an identity for a token nobody holds', async () => {
    await withCookie(`${SESSION_COOKIE}=${aToken()}`)

    expect(await db.select().from(actors)).toHaveLength(0)
  })

  it('finds its cookie among other people’s', async () => {
    // A browser at one origin carries whatever anything there has set. Read by prefix, a
    // neighbouring `molvia_session_x` would have been ours.
    const actor = actorIn((await firstVisit()).body)
    const mine = await signIn(db, actor.id)

    const found = await withCookie(`ab=1; ${SESSION_COOKIE}_x=${aToken()}; ${mine}; z=2`)
    expect(found.status).toBe(200)

    const only = await withCookie(`${SESSION_COOKIE}_x=${aToken()}`)
    expect(only.status).toBe(401)
  })

  it('leaves the row exactly as the first visit wrote it', async () => {
    // The hook reads, it never writes: `updated_at` moving here would mean every request
    // silently touched the row the trigger is meant to guard.
    const actor = actorIn((await firstVisit()).body)
    const [before] = await db.select().from(actors).where(eq(actors.id, actor.id))

    await asActor(actor.id)
    const [after] = await db.select().from(actors).where(eq(actors.id, actor.id))

    expect(after?.updatedAt).toEqual(before?.updatedAt)
  })
})

describe('health', () => {
  it('still answers without any identity at all', async () => {
    // The door and the hook cover the actor scope only; a probe that needed an identity
    // would make the container unable to start itself.
    const response = await served((app) => app.inject({ method: 'GET', url: '/health' }))

    expect(response.statusCode).toBe(200)
  })
})
