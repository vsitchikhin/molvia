import { randomBytes } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { ERROR, ISSUE } from '@molvia/model'
import { buildServer } from '@/server'
import { createErasureRepository } from '@/db/erasure-repository'
import { actors, erasures, items, sessions, verdicts } from '@/db/schema'
import { connectDrizzle } from './db'
import {
  aStrangersCookie,
  clearAll,
  insertActor,
  insertItem,
  insertPlace,
  insertSession,
  signIn,
  telegramId,
} from './fixtures'
import { aLife } from './life'

const { db, close } = connectDrizzle()
const botSecret = randomBytes(32).toString('base64url')
const app = buildServer({ db, login: { username: 'molvia_bot', botSecret } })
beforeAll(() => app.ready())
beforeEach(() => clearAll(db))
afterAll(async () => {
  await app.close()
  await close()
})

function erase(body: unknown, authorization: string | null = `Bearer ${botSecret}`) {
  return app.inject({
    method: 'POST',
    url: '/internal/actors/erase',
    headers: authorization ? { authorization } : {},
    payload: body as Record<string, unknown>,
  })
}

describe('POST /internal/actors/erase — удаление самим человеком из бота (MOL-58)', () => {
  it('стирает владельца этого Telegram-id вместе с сессиями', async () => {
    const tg = telegramId()
    const actorId = await insertActor(db, { telegramUserId: tg })
    await insertSession(db, { actorId })

    const response = await erase({ telegramUserId: tg })

    expect(response.statusCode).toBe(204)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(await db.select().from(actors).where(eq(actors.id, actorId))).toEqual([])
    expect(await db.select().from(sessions).where(eq(sessions.actorId, actorId))).toEqual([])
  })

  it('повтор и незнакомый id отвечают тем же 204', async () => {
    const tg = telegramId()
    await insertActor(db, { telegramUserId: tg })
    expect((await erase({ telegramUserId: tg })).statusCode).toBe(204)
    expect((await erase({ telegramUserId: tg })).statusCode).toBe(204)
    expect((await erase({ telegramUserId: telegramId() })).statusCode).toBe(204)
  })

  it('без секрета бота или с чужим — отказ, и никто не стёрт', async () => {
    const tg = telegramId()
    const actorId = await insertActor(db, { telegramUserId: tg })

    for (const authorization of [null, 'Bearer wrong', `Bearer ${botSecret}x`]) {
      const response = await erase({ telegramUserId: tg }, authorization)
      expect(response.statusCode).toBe(401)
      expect(response.json()).toEqual({ code: ERROR.BOT_UNAUTHORIZED })
      expect(response.headers['cache-control']).toBe('no-store')
    }
    expect(await db.select().from(actors).where(eq(actors.id, actorId))).toHaveLength(1)
  })

  it.each([{}, { telegramUserId: 0 }, { telegramUserId: '42' }, { telegramUserId: 42, extra: 1 }])(
    'тело %j — 400, до базы не доходит',
    async (body) => {
      const response = await erase(body)
      expect(response.statusCode).toBe(400)
      expect(response.json()).toMatchObject({ code: ISSUE.BODY_INVALID })
    },
  )

  it('копия без настроенного входа не стирает никого', async () => {
    const closed = buildServer({ db, login: null })
    await closed.ready()
    const tg = telegramId()
    await insertActor(db, { telegramUserId: tg })

    const response = await closed.inject({
      method: 'POST',
      url: '/internal/actors/erase',
      headers: { authorization: `Bearer ${botSecret}` },
      payload: { telegramUserId: tg },
    })

    expect(response.statusCode).toBe(401)
    await closed.close()
  })
})

function eraseMine(cookie?: string, url = '/actors/me') {
  return app.inject({ method: 'DELETE', url, headers: cookie === undefined ? {} : { cookie } })
}

describe('DELETE /actors/me — «Удалить мои данные» в настройках (MOL-94)', () => {
  it('стирает ровно то же, что дверь бота: две одинаковые жизни, по одной каждой дверью', async () => {
    const shared = { itemId: await insertItem(db), placeId: await insertPlace(db) }
    const byBot = telegramId()
    const bySettings = telegramId()
    const anna = await insertActor(db, { telegramUserId: byBot })
    const boris = await insertActor(db, { telegramUserId: bySettings })
    await aLife(db, anna, byBot, shared)
    await aLife(db, boris, bySettings, shared)
    const cookie = await signIn(db, boris)
    const erasure = createErasureRepository(db)
    // What each erasure would take, counted by the dry run — the real run, rolled back.
    const before = await erasure.erase(byBot, { dryRun: true })
    const counted = await erasure.erase(bySettings, { dryRun: true })
    // Boris has one session more, the one he asks with.
    expect({
      ...counted,
      erased: { ...counted.erased, sessions: counted.erased.sessions - 1 },
    }).toEqual(before)

    expect((await erase({ telegramUserId: byBot })).statusCode).toBe(204)
    expect((await eraseMine(cookie)).statusCode).toBe(204)

    for (const tg of [byBot, bySettings]) {
      const left = await erasure.erase(tg, { dryRun: true })
      expect(left.found).toBe(false)
      expect(Object.values(left.erased).every((n) => n === 0)).toBe(true)
    }
    expect((await db.select().from(erasures)).map((row) => row.erased)).toEqual([2])
  })

  it('первый запрос дня: срок сдвинут и тут же погашен — одна строка Set-Cookie (ревью 3)', async () => {
    const anna = await insertActor(db)
    const cookie = await signIn(db, anna)
    const yesterday = new Date(Date.now() - 30 * 3_600_000)
    await db
      .update(sessions)
      .set({ createdAt: yesterday, lastSeenAt: yesterday })
      .where(eq(sessions.actorId, anna))

    const response = await eraseMine(cookie)

    expect(response.statusCode).toBe(204)
    expect(response.headers['set-cookie']).toBe(
      '__Host-molvia_session=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax',
    )
  })

  it('стирает владельца сессии со всей его жизнью, входами на всех устройствах и гасит cookie', async () => {
    const tg = telegramId()
    const anna = await insertActor(db, { telegramUserId: tg })
    const shared = { itemId: await insertItem(db), placeId: await insertPlace(db) }
    await aLife(db, anna, tg, shared)
    const phone = await signIn(db, anna)
    const laptop = await signIn(db, anna)

    const response = await eraseMine(phone)

    expect(response.statusCode).toBe(204)
    expect(response.body).toBe('')
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.headers['set-cookie']).toMatch(/^__Host-molvia_session=; Max-Age=0;/)
    expect(await db.select().from(actors).where(eq(actors.id, anna))).toEqual([])
    expect(await db.select().from(sessions).where(eq(sessions.actorId, anna))).toEqual([])
    expect(await db.select().from(verdicts).where(eq(verdicts.actorId, anna))).toEqual([])
    // The same erasure as the bot's: one in the count of the week, the catalogue kept.
    expect((await db.select().from(erasures)).map((row) => row.erased)).toEqual([1])
    expect(await db.select().from(items).where(eq(items.id, shared.itemId))).toHaveLength(1)
    // The other device learns it from its next request.
    const after = await app.inject({
      method: 'GET',
      url: '/actors/me',
      headers: { cookie: laptop },
    })
    expect(after.statusCode).toBe(401)
  })

  it('не трогает другого человека — ни его строк, ни его входа', async () => {
    const shared = { itemId: await insertItem(db), placeId: await insertPlace(db) }
    const annaTg = telegramId()
    const borisTg = telegramId()
    const anna = await insertActor(db, { telegramUserId: annaTg })
    const boris = await insertActor(db, { telegramUserId: borisTg })
    await aLife(db, anna, annaTg, shared)
    await aLife(db, boris, borisTg, shared)
    const borisCookie = await signIn(db, boris)

    expect((await eraseMine(await signIn(db, anna))).statusCode).toBe(204)

    expect(await db.select().from(actors).where(eq(actors.id, boris))).toHaveLength(1)
    expect(await db.select().from(verdicts).where(eq(verdicts.actorId, boris))).toHaveLength(2)
    const own = await app.inject({
      method: 'GET',
      url: '/actors/me',
      headers: { cookie: borisCookie },
    })
    expect(own.statusCode).toBe(200)
  })

  it('повтор после потерянного ответа и запрос без сессии — 401 no_actor, никто не стёрт', async () => {
    const anna = await insertActor(db)
    const cookie = await signIn(db, anna)
    expect((await eraseMine(cookie)).statusCode).toBe(204)

    for (const sent of [cookie, aStrangersCookie(), undefined]) {
      const response = await eraseMine(sent)
      expect(response.statusCode).toBe(401)
      expect(response.json()).toEqual({ code: ERROR.NO_ACTOR })
    }
    expect((await db.select().from(erasures)).map((row) => row.erased)).toEqual([1])
  })

  it('владельца не назвать ни параметром, ни телом — отказ, и никто не стёрт', async () => {
    const anna = await insertActor(db)
    const boris = await insertActor(db)
    const cookie = await signIn(db, boris)

    const named = await eraseMine(cookie, `/actors/me?actorId=${anna}`)
    const withBody = await app.inject({
      method: 'DELETE',
      url: '/actors/me',
      headers: { cookie },
      payload: { actorId: anna },
    })

    expect(named.statusCode).toBe(400)
    expect(named.json()).toMatchObject({ details: 'actorId' })
    expect(withBody.statusCode).toBe(400)
    expect(withBody.json()).toMatchObject({ code: ISSUE.BODY_INVALID })
    expect(await db.select().from(actors)).toHaveLength(2)
  })
})
