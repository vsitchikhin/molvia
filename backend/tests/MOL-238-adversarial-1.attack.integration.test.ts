/**
 * MOL-238, адверсариальное ревью PR #234, атака А1. Зелёный тест атаки = дефект жив.
 *
 * Страница (`privacy.inactive`): «Если два года вы не открываете Molvia, аккаунт удалится сам… За 30 и за
 * 7 дней бот Molvia предупредит; чтобы оставить аккаунт, достаточно открыть приложение». PR опирается на
 * эту фразу как на «всё правило» (`auth.md`, В-1 «а»), а визит пишет только охранник — запрос с живой
 * сессией — и вход. Сессия живёт 180 дней без использования (`SESSION_LIFETIME_DAYS`), кука — столько же
 * (`Max-Age`). К предупреждению за 30 дней человек молчит ~700 дней: сессии у него нет ни в базе, ни в
 * браузере. Открыл приложение — экран входа, 401, визит не записан. Оставляет аккаунт только вход через
 * Telegram, а не «открыть приложение».
 *
 * Кладётся в `backend/tests/`, гоняется в CI (ветка мутаций), локально не гоняется.
 */
import { randomBytes, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { SESSION_COOKIE, SESSION_LIFETIME_DAYS } from '@molvia/model'
import type { FastifyInstance } from 'fastify'
import { actors, sessions } from '@/db/schema'
import { createActorRepository } from '@/db/actors-repository'
import { createSessionRepository } from '@/db/sessions-repository'
import { signIn } from '@/usecases/sign-in'
import { buildServer } from '@/server'
import { connectDrizzle } from './db'
import { anHourFromNow, clearAll, insertActor } from './fixtures'

const { db, close } = connectDrizzle()
const actorRepository = createActorRepository(db)
const sessionRepository = createSessionRepository(db)

let app: FastifyInstance

beforeAll(async () => {
  app = buildServer({ db, login: { username: 'molvia_bot', botSecret: randomBytes(32).toString('base64url') } })
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

const DAY = 86_400_000
/** Два года тишины MOL-239 и предупреждение за 30 дней до них (`privacy.inactive`). */
const SILENCE_DAYS = 730
const WARNED_AT_DAY = SILENCE_DAYS - 30

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * DAY)
}

async function lastSeenOf(actorId: string): Promise<Date> {
  const [row] = await db
    .select({ lastSeenAt: actors.lastSeenAt })
    .from(actors)
    .where(eq(actors.id, actorId))
  if (row === undefined) throw new Error('the owner is gone')
  return row.lastSeenAt
}

async function telegramOf(actorId: string) {
  const [row] = await db
    .select({ telegramUserId: actors.telegramUserId })
    .from(actors)
    .where(eq(actors.id, actorId))
  if (row === undefined) throw new Error('the owner is gone')
  return row.telegramUserId
}

/**
 * Сессия, которой последний раз пользовались `usedDaysAgo` дней назад: срок у неё — 180 дней от этого
 * использования, как его двигает `touch`.
 */
async function sessionUsed(actorId: string, usedDaysAgo: number): Promise<string> {
  const token = randomBytes(32).toString('base64url')
  const id = randomUUID()
  await sessionRepository.create(id, actorId, token, null, anHourFromNow())
  await db
    .update(sessions)
    .set({
      createdAt: daysAgo(usedDaysAgo + 1),
      lastSeenAt: daysAgo(usedDaysAgo),
      expiresAt: daysAgo(usedDaysAgo - SESSION_LIFETIME_DAYS),
    })
    .where(eq(sessions.id, id))
  return `${SESSION_COOKIE}=${token}`
}

function openTheApp(cookie?: string) {
  return app.inject({
    method: 'GET',
    url: '/actors/me',
    headers: cookie === undefined ? {} : { cookie },
  })
}

describe('MOL-238 атака А1: «достаточно открыть приложение» после 700 дней тишины', () => {
  it('К1, контроль: с живой сессией открыть приложение — визит', async () => {
    const actorId = await insertActor(db, { lastSeenAt: daysAgo(WARNED_AT_DAY) })
    const cookie = await sessionUsed(actorId, 2)

    expect((await openTheApp(cookie)).statusCode).toBe(200)
    expect((await lastSeenOf(actorId)).getTime()).toBeGreaterThan(Date.now() - DAY)
  })

  it('А1а: к предупреждению за 30 дней сессия не дожила — она живёт 180 дней без использования', () => {
    // Человек, которого предупреждает MOL-239, молчит не меньше 700 дней; сессия без использования
    // живёт 180, кука браузера — столько же. Живой сессии у него не бывает.
    expect(SESSION_LIFETIME_DAYS).toBeLessThan(WARNED_AT_DAY)
  })

  it('А1б: открыл приложение со старой кукой — 401, визит не записан', async () => {
    const seen = daysAgo(WARNED_AT_DAY)
    const actorId = await insertActor(db, { lastSeenAt: seen })
    // последний раз сессией пользовались в день последнего визита
    const cookie = await sessionUsed(actorId, WARNED_AT_DAY)

    expect((await openTheApp(cookie)).statusCode).toBe(401)
    expect(await lastSeenOf(actorId)).toEqual(seen)
  })

  it('А1в: браузер куку уже выбросил (Max-Age) — 401, визит не записан', async () => {
    const seen = daysAgo(WARNED_AT_DAY)
    const actorId = await insertActor(db, { lastSeenAt: seen })

    expect((await openTheApp()).statusCode).toBe(401)
    expect(await lastSeenOf(actorId)).toEqual(seen)
  })

  it('К2, контроль: оставляет аккаунт только вход через Telegram', async () => {
    const actorId = await insertActor(db, { lastSeenAt: daysAgo(WARNED_AT_DAY) })

    await signIn(actorRepository, sessionRepository, await telegramOf(actorId))

    expect((await lastSeenOf(actorId)).getTime()).toBeGreaterThan(Date.now() - DAY)
  })
})
