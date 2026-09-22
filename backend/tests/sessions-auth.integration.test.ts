/**
 * Чем запрос доказывает личность, через живой сервер: cookie, четыре неразличимых отказа,
 * границы скользящего срока и правило «ответ с `Set-Cookie` не кешируется» (MOL-53).
 *
 * Репозиторий эти же свойства проверяет у себя (`sessions.integration`), и это не дубль: там
 * проверяется `WHERE`, здесь — то, что до него доезжает заголовок и что уезжает обратно.
 */
import { execFileSync } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import {
  ERROR,
  SESSION_COOKIE,
  SESSION_LIFETIME_DAYS,
  SESSION_TOUCH_AFTER_HOURS,
} from '@molvia/model'
import type { FastifyInstance } from 'fastify'
import { sessions } from '@/db/schema'
import { createSessionRepository } from '@/db/sessions-repository'
import { buildServer } from '@/server'
import { connectDrizzle } from './db'
import { aStrangersCookie, anHourFromNow, clearAll, insertActor } from './fixtures'

const { db, close } = connectDrizzle()
const repository = createSessionRepository(db)

let app: FastifyInstance

beforeAll(async () => {
  app = buildServer({ db })
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

function aToken(): string {
  return randomBytes(32).toString('base64url')
}

/** «Кто я» с тем заголовком `Cookie`, который дали, — или вовсе без него. */
async function whoAmI(cookie?: string) {
  const response = await app.inject({
    method: 'GET',
    url: '/actors/me',
    ...(cookie === undefined ? {} : { headers: { cookie } }),
  })
  return {
    status: response.statusCode,
    raw: response.body,
    headers: response.headers,
  }
}

/** Владелец с сессией, о которой известно, когда ею пользовались в последний раз. */
async function signedIn(lastSeenHoursAgo = 0) {
  const actorId = await insertActor(db)
  const token = aToken()
  const id = randomUUID()
  await repository.create(id, actorId, token, null, anHourFromNow())
  if (lastSeenHoursAgo > 0) {
    await db
      .update(sessions)
      .set({ lastSeenAt: new Date(Date.now() - lastSeenHoursAgo * HOUR) })
      .where(eq(sessions.id, id))
  }
  return { actorId, id, cookie: `${SESSION_COOKIE}=${token}` }
}

describe('четыре отказа — один ответ', () => {
  it('нет cookie, чужая, отозванная и истёкшая отвечают байт в байт одинаково', async () => {
    const { id, cookie } = await signedIn()
    // Отозванная: отзыв — это удаление строки (Р-4 MOL-52), поэтому её и не отличить.
    await db.delete(sessions).where(eq(sessions.id, id))

    const expired = await signedIn()
    await db
      .update(sessions)
      .set({
        createdAt: new Date(Date.now() - 2 * HOUR),
        expiresAt: new Date(Date.now() - HOUR),
      })
      .where(eq(sessions.id, expired.id))

    const answers = [
      await whoAmI(),
      await whoAmI(aStrangersCookie()),
      await whoAmI(cookie),
      await whoAmI(expired.cookie),
    ]

    expect(answers[0]?.status).toBe(401)
    expect(JSON.parse(answers[0]?.raw ?? '')).toEqual({ code: ERROR.NO_ACTOR })
    expect(new Set(answers.map((answer) => answer.status)).size).toBe(1)
    expect(new Set(answers.map((answer) => answer.raw)).size).toBe(1)
    expect(new Set(answers.map((answer) => answer.headers['www-authenticate'])).size).toBe(1)
  })

  it('отвечает тем же на всё, чего этот сервер не мог выпустить', async () => {
    // Негодная форма отсекается до Postgres: иначе `22P02` пришёл бы пятисоткой, то есть
    // третьим различимым ответом там, где их должно быть ровно два — «да» и «нет».
    const nonsense = [
      `${SESSION_COOKIE}=`,
      `${SESSION_COOKIE}=abc`,
      `${SESSION_COOKIE}=${'ы'.repeat(50)}`,
      `${SESSION_COOKIE}=${randomUUID()}`,
      `${SESSION_COOKIE}="${aToken()}"`,
      `${SESSION_COOKIE}_x=${aToken()}`,
      `${SESSION_COOKIE.toUpperCase()}=${aToken()}`,
      'nonsense',
      'x'.repeat(10_000),
    ]

    const answers = await Promise.all(nonsense.map((cookie) => whoAmI(cookie)))

    expect(answers.every((answer) => answer.status === 401)).toBe(true)
    expect(new Set(answers.map((answer) => answer.raw)).size).toBe(1)
  })

  it('гасит присланную cookie, и только присланную', async () => {
    // Мёртвый секрет перестаёт ездить в каждом запросе и лежать на диске (Р-4, В-5). Гасить
    // нечего, когда её не присылали, — и лишний `Set-Cookie` на каждом чужом запросе был бы
    // лишней причиной не кешировать ответ.
    const refused = await whoAmI(aStrangersCookie())
    const bare = await whoAmI()

    expect(String(refused.headers['set-cookie'])).toContain('Max-Age=0')
    expect(String(refused.headers['set-cookie'])).toContain('HttpOnly')
    expect(refused.headers['cache-control']).toBe('no-store')
    expect(bare.headers['set-cookie']).toBeUndefined()
  })

  it('живую сессию не гасит и cookie зря не переставляет', async () => {
    const { cookie } = await signedIn()

    const mine = await whoAmI(cookie)

    expect(mine.status).toBe(200)
    expect(mine.headers['set-cookie']).toBeUndefined()
  })
})

describe('скользящий срок через сервер', () => {
  it('продлевает и переставляет cookie, когда сутки прошли', async () => {
    const { id, cookie } = await signedIn(SESSION_TOUCH_AFTER_HOURS + 1)

    const mine = await whoAmI(cookie)

    const set = String(mine.headers['set-cookie'])
    expect(mine.status).toBe(200)
    expect(set).toContain(`${SESSION_COOKIE}=${cookie.split('=')[1] ?? ''}`)
    expect(set).toContain('HttpOnly')
    // Браузер выбросил бы cookie на 180-й день от выдачи, сколько бы человек ни ходил, — а в
    // базе сессия была бы живой. Поэтому срок в cookie движется вместе со строкой.
    const maxAge = Number(/Max-Age=(\d+)/.exec(set)?.[1] ?? '0')
    expect(maxAge).toBeGreaterThan((SESSION_LIFETIME_DAYS - 1) * 24 * 3600)
    // Ответ, который выставляет cookie, не кешируется — на любой ручке (Р-6).
    expect(mine.headers['cache-control']).toBe('no-store')

    const [row] = await db.select().from(sessions).where(eq(sessions.id, id))
    expect(row?.lastSeenAt.getTime()).toBeGreaterThan(Date.now() - HOUR)
  })

  it('на границе суток минус секунда не пишет ничего', async () => {
    const { id, cookie } = await signedIn(SESSION_TOUCH_AFTER_HOURS - 1)
    const [before] = await db.select().from(sessions).where(eq(sessions.id, id))

    const mine = await whoAmI(cookie)

    const [after] = await db.select().from(sessions).where(eq(sessions.id, id))
    expect(mine.headers['set-cookie']).toBeUndefined()
    expect(after?.lastSeenAt).toEqual(before?.lastSeenAt)
    expect(after?.expiresAt).toEqual(before?.expiresAt)
  })

  it('два запроса подряд в те же сутки продлевают один раз', async () => {
    const { id, cookie } = await signedIn(SESSION_TOUCH_AFTER_HOURS + 1)

    const first = await whoAmI(cookie)
    const second = await whoAmI(cookie)

    expect(first.headers['set-cookie']).toBeDefined()
    // Второй уже не «засиделся»: строка только что сдвинулась, и `UPDATE` не отправляется.
    expect(second.headers['set-cookie']).toBeUndefined()
    const [row] = await db.select().from(sessions).where(eq(sessions.id, id))
    expect(row?.lastSeenAt.getTime()).toBeGreaterThan(Date.now() - HOUR)
  })

  it('не воскрешает истёкшую и не выдаёт ей cookie', async () => {
    const { id, cookie } = await signedIn(SESSION_TOUCH_AFTER_HOURS + 1)
    await db
      .update(sessions)
      .set({
        createdAt: new Date(Date.now() - 2 * HOUR),
        expiresAt: new Date(Date.now() - HOUR),
      })
      .where(eq(sessions.id, id))

    const mine = await whoAmI(cookie)

    expect(mine.status).toBe(401)
    expect(String(mine.headers['set-cookie'])).toContain('Max-Age=0')
  })
})

describe('две сессии одного человека', () => {
  it('открывают одни и те же данные, и одна не мешает другой', async () => {
    const actorId = await insertActor(db)
    const phone = aToken()
    const laptop = aToken()
    const phoneId = randomUUID()
    await repository.create(phoneId, actorId, phone, 'iPhone · Safari', anHourFromNow())
    await repository.create(randomUUID(), actorId, laptop, 'MacBook · Chrome', anHourFromNow())

    const fromPhone = await whoAmI(`${SESSION_COOKIE}=${phone}`)
    const fromLaptop = await whoAmI(`${SESSION_COOKIE}=${laptop}`)
    expect(fromPhone.raw).toBe(fromLaptop.raw)

    // Отозвали телефон — ноутбук цел. Это и есть «выход с одного устройства» из MOL-57.
    await db.delete(sessions).where(eq(sessions.id, phoneId))

    expect((await whoAmI(`${SESSION_COOKIE}=${phone}`)).status).toBe(401)
    expect((await whoAmI(`${SESSION_COOKIE}=${laptop}`)).status).toBe(200)
  })
})

describe('ни один ответ с cookie не кешируется', () => {
  it('держится тем, что выставить её может ровно один модуль', () => {
    // Проверка Р-6 в той форме, в какой она и держится: `set-cookie` пишется в одном файле,
    // и там же ставится `no-store`. Список ручек устарел бы на следующей задаче — а это нет.
    const backend = fileURLToPath(new URL('../src', import.meta.url))
    const writers = execFileSync('grep', ['-rl', "'set-cookie'", backend], { encoding: 'utf8' })
      .trim()
      .split('\n')
      .map((path) => path.slice(backend.length + 1))
      .filter((path) => !path.endsWith('.test.ts'))

    expect(writers).toEqual(['cookie.ts'])
  })

  it('и видно это на первой же ручке, которая продлевает сессию', async () => {
    const { cookie } = await signedIn(SESSION_TOUCH_AFTER_HOURS + 1)

    const seen: string[] = []
    for (const url of ['/actors/me', '/advice', '/trips/current', '/places/recent']) {
      const response = await app.inject({ method: 'GET', url, headers: { cookie } })
      if (response.headers['set-cookie'] !== undefined) {
        seen.push(url)
        expect(response.headers['cache-control']).toBe('no-store')
      }
    }

    // И сама проверка должна что-то поймать: продление случается на первой же ручке.
    expect(seen).not.toHaveLength(0)
  })
})

describe('токен не только url-safe', () => {
  it('сессия с обычным base64 живёт и продлевается, а не падает на вторые сутки', async () => {
    // Репозиторий принимает любой печатный ASCII (MOL-52, Р4), а cookie — алфавит RFC 6265.
    // Пока эти два правила расходились, такая сессия прекрасно читалась и падала пятисоткой
    // ровно в тот день, когда приходил срок её продлить.
    const actorId = await insertActor(db)
    const padded = randomBytes(32).toString('base64')
    expect(padded.endsWith('=')).toBe(true)
    const id = randomUUID()
    await repository.create(id, actorId, padded, null, anHourFromNow())
    await db
      .update(sessions)
      .set({ lastSeenAt: new Date(Date.now() - (SESSION_TOUCH_AFTER_HOURS + 1) * HOUR) })
      .where(eq(sessions.id, id))

    const mine = await whoAmI(`${SESSION_COOKIE}=${padded}`)

    expect(mine.status).toBe(200)
    expect(String(mine.headers['set-cookie'])).toContain(`${SESSION_COOKIE}=${padded}`)
  })
})
