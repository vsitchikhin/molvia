import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { actorCodec, ERROR, settingsOf } from '@molvia/model'
import type { ActorSettings } from '@molvia/model'
import type { FastifyInstance } from 'fastify'
import { actors } from '@/db/schema'
import { buildServer } from '@/server'
import { connectDrizzle } from './db'
import { clearAll, insertActor, signIn } from './fixtures'

const { db, close } = connectDrizzle()
let app: FastifyInstance
const initial: ActorSettings = {
  country: 'AM',
  city: 'Гюмри',
  spendCurrency: 'AMD',
  incomeCurrency: 'RUB',
}
const changed: ActorSettings = {
  ...initial,
  city: 'Ереван',
  spendCurrency: 'USD',
  incomeCurrency: 'EUR',
}
beforeAll(async () => {
  app = buildServer({ db })
  await app.ready()
})
beforeEach(async () => {
  await clearAll(db)
})
afterAll(async () => {
  await app.close()
  await clearAll(db)
  await close()
})

async function save(cookie: string, previous: ActorSettings, settings: ActorSettings) {
  return app.inject({
    method: 'PUT',
    url: '/actors/me/settings',
    headers: { cookie },
    payload: { previous, settings },
  })
}

describe('settings and offline trip context', () => {
  it('changes only the session owner, keeps identity/access, and accepts an exact repeat', async () => {
    const owner = await insertActor(db, { sharedUntil: new Date('2030-01-01') })
    const other = await insertActor(db)
    const cookie = await signIn(db, owner)
    const response = await save(cookie, initial, changed)
    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(settingsOf(actorCodec.parse(response.json()))).toEqual(changed)
    expect((await save(cookie, initial, changed)).statusCode).toBe(200)
    const rows = await db.select().from(actors)
    expect(rows.find((row) => row.id === other)).toMatchObject(initial)
    expect(rows.find((row) => row.id === owner)).toMatchObject({
      sharedUntil: new Date('2030-01-01'),
    })
    const extra = await app.inject({
      method: 'PUT',
      url: '/actors/me/settings',
      headers: { cookie },
      payload: { previous: changed, settings: initial, actorId: other },
    })
    expect(extra.statusCode).toBe(400)
  })

  it('two devices cannot overwrite one another from the same base', async () => {
    const owner = await insertActor(db)
    const first = await signIn(db, owner)
    const second = await signIn(db, owner)
    const replies = await Promise.all([
      save(first, initial, changed),
      save(second, initial, { ...initial, incomeCurrency: 'USD' }),
    ])
    expect(replies.map((reply) => reply.statusCode).sort()).toEqual([200, 409])
    expect(replies.find((reply) => reply.statusCode === 409)?.json()).toMatchObject({
      code: ERROR.CONFLICT,
    })
    // Unrelated account changes are not a settings conflict.
    await db
      .update(actors)
      .set({ sharedUntil: new Date('2031-01-01') })
      .where(eq(actors.id, owner))
    const winner = actorCodec.parse(replies.find((reply) => reply.statusCode === 200)?.json())
    expect((await save(first, settingsOf(winner), initial)).statusCode).toBe(200)
  })

  it('requires a session and rejects unsupported new geography while preserving historical values', async () => {
    const owner = await insertActor(db, { country: 'GE', city: 'Тбилиси' })
    const cookie = await signIn(db, owner)
    const legacy = { ...initial, country: 'GE', city: 'Тбилиси' }
    expect((await save('', legacy, legacy)).statusCode).toBe(401)
    expect((await save(cookie, legacy, { ...legacy, incomeCurrency: 'AMD' })).statusCode).toBe(200)
    expect((await save(cookie, legacy, { ...legacy, city: 'Батуми' })).statusCode).toBe(400)
    expect((await save(cookie, { ...legacy, incomeCurrency: 'AMD' }, initial)).statusCode).toBe(200)
  })
})
