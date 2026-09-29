import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { exportFileCodec, yerevanDate } from '@molvia/model'
import type { FastifyInstance } from 'fastify'
import { buildServer } from '@/server'
import { connectDrizzle } from './db'
import { clearAll, insertActor, insertItem, insertPlace, signIn, telegramId } from './fixtures'
import { aLife } from './life'

const { db, close } = connectDrizzle()

let app: FastifyInstance

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

function download(url: string, cookie?: string) {
  return app.inject({ method: 'GET', url, headers: cookie === undefined ? {} : { cookie } })
}

describe('GET /actors/me/export (MOL-93)', () => {
  it('отдаёт своё файлом: no-store, attachment с днём по Еревану, формат с версией', async () => {
    const tg = telegramId()
    const anna = await insertActor(db, { telegramUserId: tg })
    await aLife(db, anna, tg, { itemId: await insertItem(db), placeId: await insertPlace(db) })
    const cookie = await signIn(db, anna)

    const reply = await download('/actors/me/export', cookie)

    expect(reply.statusCode).toBe(200)
    expect(reply.headers['cache-control']).toBe('no-store')
    expect(reply.headers['content-type']).toMatch(/^application\/json/)
    const file = exportFileCodec.parse(reply.json())
    expect(reply.headers['content-disposition']).toBe(
      `attachment; filename="molvia-${yerevanDate(file.exportedAt)}.json"`,
    )
    expect(file.account.id).toBe(anna)
    expect(file.spendings).toHaveLength(2)
    // The session this request came with is marked; the one `aLife` wrote beside it is not.
    expect(file.sessions.map((session) => session.current).sort()).toEqual([false, true])
  })

  it('чужая cookie открывает только своё, а назвать владельца параметром нельзя', async () => {
    const anna = await insertActor(db)
    const boris = await insertActor(db)
    const theirs = await signIn(db, boris)

    const own = await download('/actors/me/export', theirs)
    const named = await download(`/actors/me/export?actorId=${anna}`, theirs)

    expect(exportFileCodec.parse(own.json()).account.id).toBe(boris)
    expect(own.body).not.toContain(anna)
    expect(named.statusCode).toBe(400)
    expect(named.json()).toMatchObject({ details: 'actorId' })
  })

  it('без сессии — 401, и ни HEAD, ни POST по этому адресу нет', async () => {
    const owner = await insertActor(db)
    const cookie = await signIn(db, owner)

    expect((await download('/actors/me/export')).statusCode).toBe(401)
    const head = await app.inject({ method: 'HEAD', url: '/actors/me/export', headers: { cookie } })
    const post = await app.inject({ method: 'POST', url: '/actors/me/export', headers: { cookie } })
    expect(head.statusCode).toBe(404)
    expect(post.statusCode).toBe(404)
  })
})
