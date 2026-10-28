/**
 * Два года тишины (MOL-239) на настоящем Postgres: кого и когда бот предупреждает, кого и когда таймер
 * стирает. Момент — свой у каждого теста: правило читает его, а не `now()` базы. Сервер здесь не
 * строится — его суточный проход при старте стирал бы состаренных владельцев в обход теста.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { actors, erasures, loginRequests, ownerNotices } from '@/db/schema'
import { createErasureRepository } from '@/db/erasure-repository'
import { createOwnerNoticeRepository } from '@/db/owner-notices-repository'
import { createSilenceRepository } from '@/db/silence-repository'
import { claimSilenceNotices, eraseSilent } from '@/usecases/silence'
import { connectDrizzle } from './db'
import { clearAll, insertActor, insertLoginRequest } from './fixtures'

const { db, close } = connectDrizzle()
const silence = createSilenceRepository(db)
const erasure = createErasureRepository(db)

beforeEach(async () => {
  await clearAll(db)
})

afterAll(async () => {
  await clearAll(db)
  await close()
})

const DAY = 24 * 3_600_000
/** Полдень в Ереване и Тбилиси, десять утра в Белграде (летнее время): день у всех трёх стран. */
const NOW = new Date('2027-09-26T08:00:00.000Z')
const DAYTIME = { countries: ['AM', 'GE', 'RS'], elsewhere: true }

/** Последний визит такой, что до стирания `days` суток от `NOW` (годы календарные, без 29 февраля). */
function silentFor(days: number): Date {
  const seen = new Date(NOW)
  seen.setUTCFullYear(seen.getUTCFullYear() - 2)
  return new Date(seen.getTime() + days * DAY)
}

async function rowOf(actorId: string) {
  const [row] = await db
    .select({
      warning: actors.silenceWarning,
      warnedAt: actors.silenceWarnedAt,
      updatedAt: actors.updatedAt,
    })
    .from(actors)
    .where(eq(actors.id, actorId))
  return row ?? null
}

async function telegramOf(actorId: string): Promise<number> {
  const [row] = await db
    .select({ id: actors.telegramUserId })
    .from(actors)
    .where(eq(actors.id, actorId))
  if (row === undefined) throw new Error('the owner is gone')
  return row.id
}

describe('предупреждения', () => {
  it('за 32 дня — ничего, за 31 — первое, отмеченное и отданное один раз (А2)', async () => {
    const early = await insertActor(db, { lastSeenAt: silentFor(32) })
    const due = await insertActor(db, { lastSeenAt: silentFor(31) })
    const updatedAt = (await rowOf(due))?.updatedAt

    const warned = await silence.claimWarnings(DAYTIME, NOW, 50)
    expect(warned).toEqual([
      {
        telegramUserId: await telegramOf(due),
        country: 'AM',
        step: 30,
        eraseAt: new Date(NOW.getTime() + 31 * DAY),
      },
    ])
    expect(await rowOf(due)).toEqual({ warning: 30, warnedAt: NOW, updatedAt })
    expect((await rowOf(early))?.warning).toBeNull()
    expect(await silence.claimWarnings(DAYTIME, NOW, 50)).toEqual([])
  })

  it('опоздавший бот шлёт только последнее, и стирание — не раньше недели после него (Р-3, Р-4)', async () => {
    const late = await insertActor(db, { lastSeenAt: silentFor(3) })
    const [warned] = await silence.claimWarnings(DAYTIME, NOW, 50)
    expect(warned?.step).toBe(7)
    expect(warned?.eraseAt).toEqual(new Date(NOW.getTime() + 7 * DAY))
    expect((await rowOf(late))?.warning).toBe(7)
  })

  it('второе — за 7 дней, но не раньше суток после первого', async () => {
    const actorId = await insertActor(db, { lastSeenAt: silentFor(7) })
    await db
      .update(actors)
      .set({ silenceWarning: 30, silenceWarnedAt: new Date(NOW.getTime() - 20 * 3_600_000) })
      .where(eq(actors.id, actorId))
    expect(await silence.claimWarnings(DAYTIME, NOW, 50)).toEqual([])

    const later = new Date(NOW.getTime() + 4 * 3_600_000)
    const [warned] = await silence.claimWarnings(DAYTIME, later, 50)
    expect(warned?.step).toBe(7)
    expect(await silence.claimWarnings(DAYTIME, later, 50)).toEqual([])
  })

  it('человеку страны не в её день — ничего', async () => {
    await insertActor(db, { lastSeenAt: silentFor(10), country: 'RS', city: 'Белград' })
    expect(
      await silence.claimWarnings({ countries: ['AM', 'GE'], elsewhere: true }, NOW, 50),
    ).toEqual([])
    expect(await silence.claimWarnings({ countries: [], elsewhere: false }, NOW, 50)).toEqual([])
  })

  it('бота, однажды услышанного заблокированным, всё равно пробуем (А4)', async () => {
    const blocked = await insertActor(db, {
      lastSeenAt: silentFor(20),
      botBlockedAt: new Date('2026-01-10T10:00:00.000Z'),
    })
    expect(await silence.claimWarnings(DAYTIME, NOW, 50)).toMatchObject([
      { telegramUserId: await telegramOf(blocked), step: 30 },
    ])
  })

  it('страна без пояса — в день Еревана, а не никогда (селфревью №4)', async () => {
    const nowhere = await insertActor(db, {
      lastSeenAt: silentFor(20),
      country: 'XX',
      city: 'Нигде',
    })
    expect(await silence.claimWarnings({ countries: ['AM'], elsewhere: false }, NOW, 50)).toEqual(
      [],
    )
    expect(await silence.claimWarnings({ countries: [], elsewhere: true }, NOW, 50)).toMatchObject([
      { telegramUserId: await telegramOf(nowhere), country: 'XX', step: 30 },
    ])
  })

  it('отметка, поставленная после начала входа, новую тишину не держит (А1)', async () => {
    // вход начался в NOW, claim успел поставить шаг 7 до его коммита, вход записал визит — NOW
    const login = NOW
    const actorId = await insertActor(db, { lastSeenAt: login })
    await db
      .update(actors)
      .set({ silenceWarning: 7, silenceWarnedAt: new Date(login.getTime() + 1_000) })
      .where(eq(actors.id, actorId))
    const deadline = new Date(login)
    deadline.setUTCFullYear(deadline.getUTCFullYear() + 2)

    // старая отметка не делает его предупреждённым: без новых он не стирается
    expect(await silence.due(new Date(deadline.getTime() + DAY), 50)).toEqual([])
    // и «за 30 дней» новой тишины уходит
    const [first] = await silence.claimWarnings(
      DAYTIME,
      new Date(deadline.getTime() - 31 * DAY),
      50,
    )
    expect(first?.step).toBe(30)
  })

  it('вход после предупреждения гасит его: тишина считается заново', async () => {
    const actorId = await insertActor(db, { lastSeenAt: silentFor(30) })
    await silence.claimWarnings(DAYTIME, NOW, 50)
    const login = new Date(NOW.getTime() + DAY)
    await db.update(actors).set({ lastSeenAt: login }).where(eq(actors.id, actorId))

    const weekLater = new Date(NOW.getTime() + 23 * DAY)
    expect(await silence.claimWarnings(DAYTIME, weekLater, 50)).toEqual([])
    expect(await silence.due(new Date(NOW.getTime() + 40 * DAY), 50)).toEqual([])
    // за 30 дней до двух лет от входа — снова первое предупреждение
    const again = new Date(login)
    again.setUTCFullYear(again.getUTCFullYear() + 2)
    const [warned] = await silence.claimWarnings(DAYTIME, new Date(again.getTime() - 31 * DAY), 50)
    expect(warned?.step).toBe(30)
  })

  it('два claim разом не отдают одного человека дважды (skip locked)', async () => {
    await insertActor(db, { lastSeenAt: silentFor(30) })
    const both = await Promise.all([
      silence.claimWarnings(DAYTIME, NOW, 50),
      silence.claimWarnings(DAYTIME, NOW, 50),
    ])
    expect(both.flat()).toHaveLength(1)
  })
})

describe('стирание', () => {
  it('предупреждённого за 7 дней — через неделю после предупреждения, не раньше', async () => {
    const actorId = await insertActor(db, { lastSeenAt: silentFor(-1) })
    await db
      .update(actors)
      .set({ silenceWarning: 7, silenceWarnedAt: new Date(NOW.getTime() - 3 * DAY) })
      .where(eq(actors.id, actorId))
    expect(await silence.due(NOW, 50)).toEqual([])
    const weekOn = new Date(NOW.getTime() + 4 * DAY)
    expect(await silence.due(weekOn, 50)).toEqual([
      { telegramUserId: await telegramOf(actorId), blocked: false },
    ])
  })

  it('предупреждённого только за 30 дней бот не стёр бы молча: ждёт второго', async () => {
    const actorId = await insertActor(db, { lastSeenAt: silentFor(-5) })
    await db
      .update(actors)
      .set({ silenceWarning: 30, silenceWarnedAt: new Date(NOW.getTime() - 35 * DAY) })
      .where(eq(actors.id, actorId))
    expect(await silence.due(NOW, 50)).toEqual([])
  })

  it('блок после опоздавшего «через 7 дней» не приближает названный день (А3)', async () => {
    const actorId = await insertActor(db, { lastSeenAt: silentFor(3) })
    const [warned] = await silence.claimWarnings(DAYTIME, NOW, 50)
    expect(warned?.eraseAt).toEqual(new Date(NOW.getTime() + 7 * DAY))
    await db.update(actors).set({ botBlockedAt: NOW }).where(eq(actors.id, actorId))
    expect(await silence.due(new Date(NOW.getTime() + 3 * DAY), 50)).toEqual([])
    expect(await silence.due(new Date(NOW.getTime() + 7 * DAY), 50)).toEqual([
      { telegramUserId: await telegramOf(actorId), blocked: true },
    ])
  })

  it('заблокировавшего — ровно в срок, без предупреждения', async () => {
    const blocked = await insertActor(db, {
      lastSeenAt: silentFor(0),
      botBlockedAt: silentFor(500),
    })
    expect(await silence.due(new Date(NOW.getTime() - 1), 50)).toEqual([])
    expect(await silence.due(NOW, 50)).toEqual([
      { telegramUserId: await telegramOf(blocked), blocked: true },
    ])
  })

  it('стирает той же функцией и считает в erasures.silent; ручное — нет', async () => {
    const silent = await insertActor(db, {
      lastSeenAt: silentFor(0),
      botBlockedAt: silentFor(500),
      createdAt: new Date('2025-09-03T10:00:00.000Z'),
    })
    const self = await insertActor(db, { createdAt: new Date('2025-09-03T10:00:00.000Z') })

    const report = await erasure.erase(await telegramOf(silent), { dryRun: false, silentAt: NOW })
    expect(report).toMatchObject({ found: true, counted: true })
    await erasure.erase(await telegramOf(self), { dryRun: false })

    expect(await rowOf(silent)).toBeNull()
    expect(await db.select().from(erasures)).toEqual([
      { appearedWeek: '2025-09-01', erased: 2, silent: 1 },
    ])
  })

  it('вход под замком раньше стирания выигрывает: ничего не стёрто, запрос входа цел (Р-7)', async () => {
    const actorId = await insertActor(db, {
      lastSeenAt: silentFor(0),
      botBlockedAt: silentFor(500),
    })
    const telegramUserId = await telegramOf(actorId)
    await insertLoginRequest(db, { telegramUserId })
    // вход отметил визит до того, как стирание взяло замки
    await db.update(actors).set({ lastSeenAt: NOW }).where(eq(actors.id, actorId))

    const report = await erasure.erase(telegramUserId, { dryRun: false, silentAt: NOW })
    expect(report.found).toBe(false)
    expect(await rowOf(actorId)).not.toBeNull()
    expect(await db.select().from(loginRequests)).toHaveLength(1)
    expect(await db.select().from(erasures)).toEqual([])
  })
})

describe('сценарии', () => {
  it('проход дня стирает и говорит владельцу числами', async () => {
    await insertActor(db, { lastSeenAt: silentFor(-1), botBlockedAt: silentFor(500) })
    const warned = await insertActor(db, { lastSeenAt: silentFor(-1) })
    await db
      .update(actors)
      .set({ silenceWarning: 7, silenceWarnedAt: new Date(NOW.getTime() - 8 * DAY) })
      .where(eq(actors.id, warned))
    await insertActor(db, { lastSeenAt: silentFor(-1) }) // не предупреждён — ждёт бота

    const failed: unknown[] = []
    const deps = {
      silence,
      erasure,
      notices: createOwnerNoticeRepository(db),
      owner: true,
      failed: (error: unknown) => failed.push(error),
    }
    expect(await eraseSilent(deps, NOW)).toEqual({ erased: 2, erasedBlocked: 1 })
    expect(await eraseSilent(deps, NOW)).toEqual({ erased: 0, erasedBlocked: 0 })
    expect(failed).toEqual([])
    expect((await db.select().from(actors)).length).toBe(1)
    expect(await db.select({ payload: ownerNotices.payload }).from(ownerNotices)).toEqual([
      { payload: { kind: 'silence', warned30: 0, warned7: 0, erased: 2, erasedBlocked: 1 } },
    ])
  })

  it('claim называет день стирания и число дней в поясе человека, владельцу — сколько', async () => {
    const actorId = await insertActor(db, { lastSeenAt: silentFor(31) })
    const deps = {
      silence,
      notices: createOwnerNoticeRepository(db),
      owner: true,
      failed: () => undefined,
    }
    expect(await claimSilenceNotices(deps, NOW)).toEqual({
      notices: [{ telegramUserId: await telegramOf(actorId), day: '2027-10-27', days: 31 }],
    })
    expect(await db.select({ payload: ownerNotices.payload }).from(ownerNotices)).toEqual([
      { payload: { kind: 'silence', warned30: 1, warned7: 0, erased: 0, erasedBlocked: 0 } },
    ])
  })

  it('срок в 21:00 по Еревану: первое уходит наутро и всё равно за 30 дней (А2)', async () => {
    // срок — 26.10.2027 в 21:00 по Еревану
    const deadline = new Date('2027-10-26T17:00:00.000Z')
    const seen = new Date(deadline)
    seen.setUTCFullYear(seen.getUTCFullYear() - 2)
    const actorId = await insertActor(db, { lastSeenAt: seen })
    const deps = {
      silence,
      notices: createOwnerNoticeRepository(db),
      owner: false,
      failed: () => undefined,
    }
    // за 31 сутки — 21:00, окно закрыто; наутро, в 10:00, ещё 30 дней
    expect(await claimSilenceNotices(deps, new Date('2027-09-25T17:00:00.000Z'))).toEqual({
      notices: [],
    })
    expect(await claimSilenceNotices(deps, new Date('2027-09-26T06:00:00.000Z'))).toEqual({
      notices: [{ telegramUserId: await telegramOf(actorId), day: '2027-10-26', days: 30 }],
    })
  })

  it('ночью во всех трёх странах claim не трогает никого', async () => {
    const actorId = await insertActor(db, { lastSeenAt: silentFor(30) })
    // 01:00 в Ереване и Тбилиси, 23:00 в Белграде
    const night = new Date('2027-09-25T21:00:00.000Z')
    const deps = {
      silence,
      notices: createOwnerNoticeRepository(db),
      owner: true,
      failed: () => undefined,
    }
    expect(await claimSilenceNotices(deps, night)).toEqual({ notices: [] })
    expect((await rowOf(actorId))?.warning).toBeNull()
  })
})
