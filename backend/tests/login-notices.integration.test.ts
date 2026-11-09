import { randomBytes, randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  ERROR,
  LOGIN_COOKIE,
  LOGIN_HEADER,
  SESSION_COOKIE,
  LOGIN_NOTICE_LEASE_SECONDS,
  dueLoginNoticesSchema,
  loginStartedCodec,
} from '@molvia/model'
import type { LoginNoticesTold } from '@molvia/model'
import { buildServer } from '@/server'
import { sha256Hex } from '@/db/digest'
import { createLoginNoticeRepository } from '@/db/login-notices-repository'
import { loginDays, loginNotices, sessions } from '@/db/schema'
import { lockTelegramAccount } from '@/db/telegram-lock'
import { connectDrizzle } from './db'
import { clearAll, insertActor, telegramId } from './fixtures'
import { onlyRow, sorted, sum } from './rows'

// «В ваш аккаунт вошло новое устройство» (MOL-361, audit MOL-287 Ф-3): the collection of a session
// queues one notice, the bot's claim hands it once, and «Это не я — завершить» ends that session for
// the account Telegram says pressed it — and for nobody else.

const first = connectDrizzle()
const second = connectDrizzle()
const db = first.db
const botSecret = randomBytes(32).toString('base64url')
const botHeaders = { authorization: `Bearer ${botSecret}` }
const browserHeaders = { [LOGIN_HEADER]: '1' }
let sent = 0
const app = buildServer({ db, login: { username: 'molvia_bot', botSecret } })
beforeAll(() => app.ready())
beforeEach(() => clearAll(db))
afterAll(async () => {
  await app.close()
  await clearAll(db)
  await first.close()
  await second.close()
})

/** A login started, confirmed by `telegramUserId` and collected: the browser's session cookie. */
async function signedIn(telegramUserId = telegramId()) {
  sent += 1
  const started = await app.inject({
    method: 'POST',
    url: '/auth/login',
    headers: {
      ...browserHeaders,
      // An address of its own (MOL-359): the quota by address is not this file's to test.
      'x-forwarded-for': `198.51.100.${String((sent % 250) + 1)}`,
      'user-agent': 'Mozilla/5.0 (iPhone) Version/18.0 Mobile Safari/604.1',
    },
  })
  expect(started.statusCode).toBe(201)
  const view = loginStartedCodec.parse(started.json())
  const secret = started.cookies.find((cookie) => cookie.name === LOGIN_COOKIE)?.value ?? ''
  const headers = { ...browserHeaders, cookie: `${LOGIN_COOKIE}=${secret}` }
  const poll = () => app.inject({ method: 'GET', url: `/auth/login/${view.id}`, headers })
  const before = await queued()
  expect((await poll()).statusCode).toBe(200)
  // A poll that waits for the bot queues nothing.
  expect(await queued()).toBe(before)
  const confirmed = await app.inject({
    method: 'POST',
    url: `/internal/auth/login/${new URL(view.url).searchParams.get('start') ?? ''}/confirm`,
    headers: botHeaders,
    payload: { telegramUserId },
  })
  expect(confirmed.statusCode).toBe(204)
  const collected = await poll()
  expect(collected.json()).toMatchObject({ status: 'authenticated' })
  const token = collected.cookies.find((cookie) => cookie.name === SESSION_COOKIE)?.value ?? ''
  const session = onlyRow(
    await db
      .select()
      .from(sessions)
      .where(eq(sessions.tokenHash, sha256Hex(token))),
  )
  return { telegramUserId, sessionId: session!.id, cookie: `${SESSION_COOKIE}=${token}`, poll }
}

async function queued(): Promise<number> {
  return (
    onlyRow(await db.execute<{ n: number }>(sql`select count(*)::int as n from login_notices`))
      ?.n ?? 0
  )
}

async function claim() {
  const response = await app.inject({
    method: 'POST',
    url: '/internal/logins/claim',
    headers: botHeaders,
  })
  expect(response.statusCode).toBe(200)
  return dueLoginNoticesSchema.parse(response.json()).notices
}

function told(word: LoginNoticesTold) {
  return app.inject({
    method: 'POST',
    url: '/internal/logins/told',
    headers: botHeaders,
    payload: word,
  })
}

/** A notice written as the collection writes it, `minutesAgo` before now — for the order of the queue. */
async function queue(actorId: string, minutesAgo = 0): Promise<string> {
  const sessionId = randomUUID()
  await db.insert(loginNotices).values({
    sessionId,
    actorId,
    deviceName: null,
    signedInAt: sql`clock_timestamp() - make_interval(mins => ${minutesAgo})`,
  })
  return sessionId
}

function end(sessionId: string, telegramUserId: number) {
  return app.inject({
    method: 'POST',
    url: `/internal/sessions/${sessionId}/end`,
    headers: botHeaders,
    payload: { telegramUserId },
  })
}

function me(cookie: string) {
  return app.inject({ method: 'GET', url: '/actors/me', headers: { cookie } })
}

async function endedByNotice(): Promise<number> {
  return sum((await db.select().from(loginDays)).map((day) => day.endedByNotice))
}

describe('a session collected queues one notice (MOL-361)', () => {
  it('queues exactly one, on the collection only — a poll after it queues none', async () => {
    const person = await signedIn()
    expect(await queued()).toBe(1)
    expect((await person.poll()).statusCode).not.toBe(200)
    expect(await queued()).toBe(1)
  })

  it('the development seam signs in with no notice', async () => {
    const response = await app.inject({ method: 'POST', url: '/dev/login' })
    expect(response.statusCode).toBe(201)
    expect(await queued()).toBe(0)
  })

  it('a newcomer’s first session is told of too (В-3 «а»)', async () => {
    const person = await signedIn()
    const notice = onlyRow(await claim())
    expect(notice?.telegramUserId).toBe(person.telegramUserId)
    expect(notice?.sessionId).toBe(person.sessionId)
  })
})

describe('the claim hands a notice out once', () => {
  it('hands the session, the device as the browser named it and when; handed, it is not handed again; told, it goes', async () => {
    const person = await signedIn()
    const notice = onlyRow(await claim())
    expect(notice).toMatchObject({
      telegramUserId: person.telegramUserId,
      sessionId: person.sessionId,
      deviceName: 'iPhone · Safari',
    })
    expect(notice?.day).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(notice?.time).toMatch(/^\d{2}:\d{2}$/)
    expect(await claim()).toEqual([])
    expect(await queued()).toBe(1)
    expect((await told({ told: [person.sessionId], back: [] })).statusCode).toBe(204)
    expect(await queued()).toBe(0)
  })

  it('a session ended before the claim is still told of (В-1 «а»): a copy taken, then «Выйти»', async () => {
    const person = await signedIn()
    const out = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: { ...browserHeaders, cookie: person.cookie },
    })
    expect(out.statusCode).toBe(204)
    expect(onlyRow(await claim())?.sessionId).toBe(person.sessionId)
    // …and the button then finds no session: one 404, «уже завершён».
    expect((await end(person.sessionId, person.telegramUserId)).statusCode).toBe(404)
  })

  it('two claims at once never share a notice', async () => {
    const ids = [
      await queue(await insertActor(db)),
      await queue(await insertActor(db)),
      await queue(await insertActor(db)),
    ]
    const [a, b] = await Promise.all([
      createLoginNoticeRepository(first.db).claim(2),
      createLoginNoticeRepository(second.db).claim(2),
    ])
    const rest = await createLoginNoticeRepository(db).claim(10)
    const handed = [...a, ...b, ...rest].map((notice) => notice.sessionId)
    expect(sorted(handed)).toEqual(sorted(ids))
  })

  it('reads the moment in the zone of the account’s country, Yerevan’s and Belgrade’s', async () => {
    const at = new Date('2026-11-09T10:05:00Z')
    const yerevan = await insertActor(db, { country: 'AM', city: 'Гюмри' })
    const belgrade = await insertActor(db, { country: 'RS', city: 'Белград', spendCurrency: 'RSD' })
    const [inYerevan, inBelgrade] = [randomUUID(), randomUUID()]
    await db.insert(loginNotices).values([
      { sessionId: inYerevan, actorId: yerevan, deviceName: null, signedInAt: at },
      { sessionId: inBelgrade, actorId: belgrade, deviceName: null, signedInAt: at },
    ])
    const notices = await claim()
    const of = (id: string) => notices.filter((notice) => notice.sessionId === id)
    expect(of(inYerevan)).toEqual([expect.objectContaining({ day: '2026-11-09', time: '14:05' })])
    expect(of(inBelgrade)).toEqual([expect.objectContaining({ day: '2026-11-09', time: '11:05' })])
  })

  it('erasure takes a notice not handed yet with the person', async () => {
    const person = await signedIn()
    const erased = await app.inject({
      method: 'POST',
      url: '/internal/actors/erase',
      headers: botHeaders,
      payload: { telegramUserId: person.telegramUserId },
    })
    expect(erased.statusCode).toBe(204)
    expect(await queued()).toBe(0)
  })
})

describe('one person never holds another back (adversarial А1, А2)', () => {
  it('one notice an account a claim: sixty of one account and the victim’s after them — the victim’s in the first claim', async () => {
    const attacker = await insertActor(db)
    const victim = await insertActor(db)
    const oldest = await queue(attacker, 61)
    for (let minutes = 60; minutes > 0; minutes -= 1) await queue(attacker, minutes)
    const victims = await queue(victim, 0)
    expect(sorted((await claim()).map((notice) => notice.sessionId))).toEqual(
      sorted([oldest, victims]),
    )
  })

  it('the next claim hands the account’s next notice, one a claim', async () => {
    const owner = await insertActor(db)
    const older = await queue(owner, 2)
    const newer = await queue(owner, 1)
    expect(onlyRow(await claim())?.sessionId).toBe(older)
    expect(onlyRow(await claim())?.sessionId).toBe(newer)
    expect(await claim()).toEqual([])
  })

  it('given back after a try, a notice goes behind everyone else’s; untried, it keeps its place', async () => {
    const attacker = await insertActor(db)
    const victim = await insertActor(db)
    const bystander = await insertActor(db)
    const flooded = await queue(attacker, 3)
    const victims = await queue(victim, 2)
    const untried = await queue(bystander, 1)
    expect((await claim()).map((notice) => notice.sessionId)).toEqual([flooded, victims, untried])
    await told({
      told: [],
      back: [
        { sessionId: flooded, afterSeconds: 0 },
        { sessionId: victims, afterSeconds: null },
        { sessionId: untried, afterSeconds: null },
      ],
    })
    expect((await claim()).map((notice) => notice.sessionId)).toEqual([victims, untried, flooded])
  })

  it('given back after a try, its account goes behind — a stock of older notices holds nobody (adversarial Б1)', async () => {
    const a = await insertActor(db)
    const b = await insertActor(db)
    const victim = await insertActor(db)
    // Six notices of each, all older than the victim's.
    for (let minutes = 20; minutes > 14; minutes -= 1) {
      await queue(a, minutes)
      await queue(b, minutes)
    }
    const victims = await queue(victim, 1)
    const handed = await claim()
    expect(handed).toHaveLength(3)
    const [first, second] = handed
    // Both refused for now, the victim's given back untried, as two refusals in a row have it.
    await told({
      told: [],
      back: [
        { sessionId: first!.sessionId, afterSeconds: 0 },
        { sessionId: second!.sessionId, afterSeconds: 0 },
        { sessionId: victims, afterSeconds: null },
      ],
    })
    expect((await claim())[0]?.sessionId).toBe(victims)
  })

  it('given back for Telegram’s seconds, it is not handed before them', async () => {
    const owner = await insertActor(db)
    const flooded = await queue(owner)
    await claim()
    await told({ told: [], back: [{ sessionId: flooded, afterSeconds: 3_600 }] })
    expect(await claim()).toEqual([])
    expect(await queued()).toBe(1)
  })

  it('handed and never spoken of past the lease, it is let go unsent — at most once', async () => {
    const owner = await insertActor(db)
    const lost = await queue(owner, 2)
    const kept = await queue(await insertActor(db), 1)
    await claim()
    await db
      .update(loginNotices)
      .set({
        handedAt: sql`clock_timestamp() - make_interval(secs => ${LOGIN_NOTICE_LEASE_SECONDS + 1})`,
      })
      .where(eq(loginNotices.sessionId, lost))
    await createLoginNoticeRepository(db).removeLost()
    expect(
      sorted((await db.select().from(loginNotices)).map((notice) => notice.sessionId)),
    ).toEqual([kept])
    // A word that comes after the lease changes nothing; nor does one about a notice never handed.
    await told({ told: [lost], back: [{ sessionId: lost, afterSeconds: 0 }] })
    const waiting = await queue(owner)
    await told({ told: [waiting], back: [] })
    expect(await queued()).toBe(2)
  })

  it('an account an erasure holds is passed over, and its notice goes with the erasure (adversarial А3)', async () => {
    const person = await signedIn()
    const handed = await second.db.transaction(async (tx) => {
      // The locks `ErasureRepository.erase` takes before it deletes a row (MOL-58).
      await tx.execute(lockTelegramAccount(person.telegramUserId))
      await tx.execute(
        sql`select 1 from login_requests where telegram_user_id = ${person.telegramUserId} for update`,
      )
      await tx.execute(
        sql`select 1 from actors where telegram_user_id = ${person.telegramUserId} for update`,
      )
      const during = await claim()
      await tx.execute(sql`delete from actors where telegram_user_id = ${person.telegramUserId}`)
      return during
    })
    expect(handed).toEqual([])
    expect(await queued()).toBe(0)
  })
})

describe('«Это не я — завершить» ends the one session for the account that pressed', () => {
  it('the same Telegram: 204, the session is gone — its next request is 401 — and it is counted', async () => {
    const person = await signedIn()
    expect((await me(person.cookie)).statusCode).toBe(200)
    expect((await end(person.sessionId, person.telegramUserId)).statusCode).toBe(204)
    const after = await me(person.cookie)
    expect(after.statusCode).toBe(401)
    expect(after.json()).toMatchObject({ code: ERROR.NO_ACTOR })
    expect(await endedByNotice()).toBe(1)
    // Pressed again: the session is already gone — one 404, and nothing counted twice.
    expect((await end(person.sessionId, person.telegramUserId)).statusCode).toBe(404)
    expect(await endedByNotice()).toBe(1)
  })

  it('another Telegram: 404, and the session lives on', async () => {
    const person = await signedIn()
    const stranger = await signedIn()
    expect((await end(person.sessionId, stranger.telegramUserId)).statusCode).toBe(404)
    expect((await end(person.sessionId, telegramId())).statusCode).toBe(404)
    expect((await me(person.cookie)).statusCode).toBe(200)
    expect(await endedByNotice()).toBe(0)
  })

  it('an id that is no session, or no id at all, is the same 404', async () => {
    const person = await signedIn()
    expect((await end(randomUUID(), person.telegramUserId)).statusCode).toBe(404)
    expect((await end('not-a-session', person.telegramUserId)).statusCode).toBe(404)
    expect((await me(person.cookie)).statusCode).toBe(200)
  })

  it('an id in upper case is the same session — 204 (MOL-25, Р-3)', async () => {
    const person = await signedIn()
    expect((await end(person.sessionId.toUpperCase(), person.telegramUserId)).statusCode).toBe(204)
    expect((await me(person.cookie)).statusCode).toBe(401)
  })

  it('only the bot may press: without its secret the route refuses', async () => {
    const person = await signedIn()
    const response = await app.inject({
      method: 'POST',
      url: `/internal/sessions/${person.sessionId}/end`,
      payload: { telegramUserId: person.telegramUserId },
    })
    expect(response.statusCode).toBe(401)
    expect((await me(person.cookie)).statusCode).toBe(200)
  })
})
