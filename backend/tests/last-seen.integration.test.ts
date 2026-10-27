/**
 * Последний визит аккаунта через живой сервер (MOL-238): первый запрос дня отмечает его, остальные
 * — нет, сколько бы ни было устройств; вход отмечает всегда; бот не отмечает (В-1 владельца) — и
 * `updated_at` визит не двигает. Это часы «двух лет тишины» MOL-239.
 */
import { randomBytes, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { ACCOUNT_SEEN_AFTER_HOURS, SESSION_COOKIE } from '@molvia/model'
import type { FastifyInstance } from 'fastify'
import { actors, sessions } from '@/db/schema'
import { createActorRepository } from '@/db/actors-repository'
import { createSessionRepository } from '@/db/sessions-repository'
import { signIn } from '@/usecases/sign-in'
import { DEV_ACCOUNT_COOKIE } from '@/cookie'
import { buildServer } from '@/server'
import { connectDrizzle } from './db'
import { anHourFromNow, clearAll, insertActor, insertItem } from './fixtures'

const { db, close } = connectDrizzle()
const actorRepository = createActorRepository(db)
const sessionRepository = createSessionRepository(db)
const botSecret = randomBytes(32).toString('base64url')

let app: FastifyInstance

beforeAll(async () => {
  app = buildServer({ db, login: { username: 'molvia_bot', botSecret } })
  await app.ready()
})

beforeEach(async () => {
  await clearAll(db)
})

afterAll(async () => {
  await clearAll(db)
  await app.close()
  await close()
})

const HOUR = 3_600_000
const LONG_AGO = new Date('2026-01-01T00:00:00.000Z')

/** Владелец, чей последний визит и последняя правка строки — давно, с одной сессией. */
async function owner(patch: Parameters<typeof insertActor>[1] = {}) {
  const actorId = await insertActor(db, { lastSeenAt: LONG_AGO, updatedAt: LONG_AGO, ...patch })
  return { actorId, cookie: await sessionOf(actorId) }
}

async function sessionOf(actorId: string, expiresAt = anHourFromNow()): Promise<string> {
  const token = randomBytes(32).toString('base64url')
  await sessionRepository.create(randomUUID(), actorId, token, null, expiresAt)
  return `${SESSION_COOKIE}=${token}`
}

async function rowOf(actorId: string) {
  const [row] = await db
    .select({
      lastSeenAt: actors.lastSeenAt,
      updatedAt: actors.updatedAt,
      createdAt: actors.createdAt,
    })
    .from(actors)
    .where(eq(actors.id, actorId))
  if (row === undefined) throw new Error('the owner is gone')
  return row
}

async function seenAgo(actorId: string, hours: number): Promise<Date> {
  const at = new Date(Date.now() - hours * HOUR)
  await db.update(actors).set({ lastSeenAt: at }).where(eq(actors.id, actorId))
  return at
}

function whoAmI(cookie: string) {
  return app.inject({ method: 'GET', url: '/actors/me', headers: { cookie } })
}

/** «Только что» — по часам базы, которые и ставят отметку. */
function isNow(at: Date): boolean {
  return Math.abs(at.getTime() - Date.now()) < 60_000
}

describe('первый запрос дня', () => {
  it('отмечает визит, а второй запрос того же дня — нет', async () => {
    const { actorId, cookie } = await owner()

    expect((await whoAmI(cookie)).statusCode).toBe(200)
    const first = await rowOf(actorId)
    expect(isNow(first.lastSeenAt)).toBe(true)

    expect((await whoAmI(cookie)).statusCode).toBe(200)
    expect((await rowOf(actorId)).lastSeenAt).toEqual(first.lastSeenAt)
  })

  it('граница — сутки: без минуты не пишет, через минуту пишет', async () => {
    const { actorId, cookie } = await owner()

    const recent = await seenAgo(actorId, ACCOUNT_SEEN_AFTER_HOURS - 1 / 60)
    await whoAmI(cookie)
    expect((await rowOf(actorId)).lastSeenAt).toEqual(recent)

    await seenAgo(actorId, ACCOUNT_SEEN_AFTER_HOURS + 1 / 60)
    await whoAmI(cookie)
    expect(isNow((await rowOf(actorId)).lastSeenAt)).toBe(true)
  })

  it('визит не правка: `updated_at` стоит, пока не меняются настройки', async () => {
    const { actorId, cookie } = await owner()

    await whoAmI(cookie)

    expect((await rowOf(actorId)).updatedAt).toEqual(LONG_AGO)
  })

  it('две сессии одного аккаунта — одна отметка в день', async () => {
    const { actorId, cookie } = await owner()
    const second = await sessionOf(actorId)

    await whoAmI(cookie)
    const marked = (await rowOf(actorId)).lastSeenAt
    await whoAmI(second)

    expect((await rowOf(actorId)).lastSeenAt).toEqual(marked)
  })

  it('два запроса разом пишут один раз: условие в самом `UPDATE`', async () => {
    const { actorId } = await owner()

    const written = await Promise.all([
      actorRepository.markSeen(actorId, ACCOUNT_SEEN_AFTER_HOURS),
      actorRepository.markSeen(actorId, ACCOUNT_SEEN_AFTER_HOURS),
    ])

    expect(written.toSorted()).toEqual([false, true])
  })

  it('истёкшая сессия — 401 и никакой отметки', async () => {
    const actorId = await insertActor(db, { lastSeenAt: LONG_AGO })
    const cookie = await sessionOf(actorId, new Date(Date.now() + HOUR))
    await db
      .update(sessions)
      .set({ createdAt: new Date(Date.now() - 2 * HOUR), expiresAt: new Date(Date.now() - HOUR) })
      .where(eq(sessions.actorId, actorId))

    expect((await whoAmI(cookie)).statusCode).toBe(401)
    expect((await rowOf(actorId)).lastSeenAt).toEqual(LONG_AGO)
  })

  it('это срок хранения, а не статистика: пишет и без согласия, и с выключенной статистикой', async () => {
    const objecting = await owner({
      consentVersion: 2,
      consentedAt: LONG_AGO,
      analyticsOffAt: LONG_AGO,
    })
    const unconsented = await owner({ consentVersion: null, consentedAt: null })

    await whoAmI(objecting.cookie)
    await whoAmI(unconsented.cookie)

    expect(isNow((await rowOf(objecting.actorId)).lastSeenAt)).toBe(true)
    expect(isNow((await rowOf(unconsented.actorId)).lastSeenAt)).toBe(true)
  })
})

describe('вход', () => {
  it('отмечает визит давнему владельцу, хоть бы он был час назад', async () => {
    const actorId = await insertActor(db, { lastSeenAt: new Date(Date.now() - HOUR) })
    const [row] = await db
      .select({ telegramUserId: actors.telegramUserId })
      .from(actors)
      .where(eq(actors.id, actorId))
    if (row === undefined) throw new Error('the owner is gone')

    await signIn(actorRepository, sessionRepository, row.telegramUserId)

    const seen = (await rowOf(actorId)).lastSeenAt
    expect(seen.getTime()).toBeGreaterThan(Date.now() - HOUR / 2)
  })

  it('новый владелец появляется с визитом в момент создания', async () => {
    const { actor } = await signIn(actorRepository, sessionRepository, 777_000_238)

    const row = await rowOf(actor.id)
    expect(isNow(row.lastSeenAt)).toBe(true)
    expect(row.lastSeenAt.getTime()).toBeGreaterThanOrEqual(row.createdAt.getTime())
  })

  it('шов разработки — тот же вход', async () => {
    const actorId = await insertActor(db, { lastSeenAt: LONG_AGO })
    const [row] = await db
      .select({ telegramUserId: actors.telegramUserId })
      .from(actors)
      .where(eq(actors.id, actorId))
    if (row === undefined) throw new Error('the owner is gone')

    const response = await app.inject({
      method: 'POST',
      url: '/dev/login',
      headers: { cookie: `${DEV_ACCOUNT_COOKIE}=${String(row.telegramUserId)}` },
    })

    expect(response.statusCode).toBe(201)
    expect(isNow((await rowOf(actorId)).lastSeenAt)).toBe(true)
  })
})

describe('бот', () => {
  it('оценка кнопкой напоминания визитом не считается (В-1 «а»)', async () => {
    const actorId = await insertActor(db, { lastSeenAt: LONG_AGO })
    const [row] = await db
      .select({ telegramUserId: actors.telegramUserId })
      .from(actors)
      .where(eq(actors.id, actorId))
    if (row === undefined) throw new Error('the owner is gone')
    const milk = await insertItem(db)

    const response = await app.inject({
      method: 'PUT',
      url: `/internal/verdicts/${milk}`,
      headers: { authorization: `Bearer ${botSecret}` },
      payload: { telegramUserId: row.telegramUserId, score: 4 },
    })

    expect(response.statusCode).toBe(204)
    expect((await rowOf(actorId)).lastSeenAt).toEqual(LONG_AGO)
  })
})
