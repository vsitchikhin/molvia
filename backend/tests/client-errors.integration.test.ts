/**
 * The phone's failures into the table (MOL-144) through a real server: taken with no session, by
 * the page's own build and platform, refused past the schema and past the limit, and the address
 * the limit counts by is written nowhere.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import {
  ERROR,
  OWNER_NOTICES_PER_CLAIM,
  PHONE_FAILURES_KEPT,
  ownerNoticesSchema,
} from '@molvia/model'
import { createFailureRepository } from '@/db/failures-repository'
import { createOwnerNoticeRepository } from '@/db/owner-notices-repository'
import { failures, ownerNotices } from '@/db/schema'
import { buildServer } from '@/server'
import {
  PHONE_NOTICES_PER_HOUR,
  PHONE_REPORTS_PER_ADDRESS,
  occurrenceOf,
  recordFailure,
} from '@/usecases/record-failure'
import { connectDrizzle } from './db'
import { clearAll } from './fixtures'

const { db, close } = connectDrizzle()
const OWNER = 4242

let recordings: Promise<void>[] = []
const lines: string[] = []

// A server a test: the limit and the hour of the phone's notices live in the process's memory, and
// one test's minute must not be the next one's.
let app: FastifyInstance

beforeEach(async () => {
  await clearAll(db)
  recordings = []
  lines.length = 0
  app = buildServer({
    db,
    owner: OWNER,
    failureRecorded: (recording) => recordings.push(recording),
    logStream: { write: (line) => lines.push(line) },
  })
  await app.ready()
})
afterEach(async () => {
  await app.close()
})
afterAll(async () => {
  await clearAll(db)
  await close()
})

/** As many reports as a phone keeps, all different. */
function buffer(prefix: string) {
  return {
    reports: Array.from({ length: PHONE_FAILURES_KEPT }, (_, index) => ({
      ...REPORT,
      errorName: `${prefix}${String(index)}`,
    })),
  }
}

const REPORT = {
  errorName: 'TypeError',
  frames: [
    'at Xe (/assets/index-BTCsHrpw.js:1:48213)',
    'at Qt (/assets/index-BTCsHrpw.js:1:51002)',
  ],
  catcher: 'screen',
  screen: 'advice',
  build: 'index-BTCsHrpw',
  platform: 'ios 18 app',
}

/** A phone behind Caddy: the peer is inside, and the address is the one Caddy names. */
function send(body: unknown, address: string, headers: Record<string, string> = {}) {
  return app.inject({
    method: 'POST',
    url: '/client-errors',
    headers: { 'x-forwarded-for': address, ...headers },
    payload: body as object,
  })
}

async function recorded() {
  await Promise.all(recordings)
  return db.select().from(failures)
}

describe('POST /client-errors — сбой телефона (MOL-144)', () => {
  it('без сессии: 204, строка phone со сборкой страницы и платформой', async () => {
    const response = await send({ reports: [REPORT] }, '198.51.100.7')
    expect(response.statusCode).toBe(204)
    expect(response.headers['cache-control']).toBe('no-store')

    const [row] = await recorded()
    expect(row).toMatchObject({
      source: 'phone',
      errorName: 'TypeError',
      route: 'screen:advice',
      build: 'index-BTCsHrpw',
      platform: 'ios 18 app',
      frames: REPORT.frames,
      count: 1,
      buildCount: 1,
    })
  })

  it('чужая cookie ничего не меняет: сбой не принадлежит человеку', async () => {
    const response = await send({ reports: [REPORT] }, '198.51.100.8', {
      cookie: '__Host-molvia_session=not-a-session',
    })
    expect(response.statusCode).toBe(204)
    expect(await recorded()).toHaveLength(1)
  })

  it('владелец слышит о новом отпечатке со сборкой и платформой телефона', async () => {
    await send({ reports: [REPORT] }, '198.51.100.9')
    await recorded()
    const notices = await db.select().from(ownerNotices)
    expect(
      notices.map((notice) => ownerNoticesSchema.shape.notices.element.parse(notice.payload)),
    ).toEqual([
      expect.objectContaining({
        kind: 'failure',
        source: 'phone',
        route: 'screen:advice',
        build: 'index-BTCsHrpw',
        platform: 'ios 18 app',
        frame: REPORT.frames[0],
      }),
    ])
  })

  it('пачка из буфера — каждый отчёт своей строкой или своим счётом', async () => {
    const other = { ...REPORT, catcher: 'vue', platform: 'android browser' }
    await send({ reports: [REPORT, REPORT, other] }, '198.51.100.10')
    const rows = await recorded()
    expect(rows.map((row) => [row.route, row.platform, row.count]).sort()).toEqual([
      ['screen:advice', 'ios 18 app', 2],
      ['vue:advice', 'android browser', 1],
    ])
  })

  it.each([
    ['message', { reports: [{ ...REPORT, message: 'Купить сыр' }] }],
    [
      'кадр с адресом страницы и запросом',
      { reports: [{ ...REPORT, frames: ['at x (/advice?q=сыр:1:2)'] }] },
    ],
    ['кадр с origin', { reports: [{ ...REPORT, frames: ['at x (https://molvia.net/a.js:1:2)'] }] }],
    ['User-Agent вместо платформы', { reports: [{ ...REPORT, platform: 'Mozilla/5.0 (iPhone)' }] }],
    ['пустая пачка', { reports: [] }],
    ['больше буфера', { reports: Array.from({ length: PHONE_FAILURES_KEPT + 1 }, () => REPORT) }],
  ])('схема отказывает — %s — и в таблицу ничего', async (_name, body) => {
    const response = await send(body, '198.51.100.11')
    expect(response.statusCode).toBe(400)
    expect(await recorded()).toEqual([])
  })

  it(`с одного адреса — ${String(PHONE_REPORTS_PER_ADDRESS)} в минуту, другой адрес — свой счёт`, async () => {
    const full = { reports: Array.from({ length: PHONE_FAILURES_KEPT }, () => REPORT) }
    for (let sent = 0; sent < PHONE_REPORTS_PER_ADDRESS; sent += PHONE_FAILURES_KEPT) {
      expect((await send(full, '203.0.113.1')).statusCode).toBe(204)
    }

    const past = await send({ reports: [REPORT] }, '203.0.113.1')
    expect(past.statusCode).toBe(429)
    expect(past.json()).toEqual({ code: ERROR.CLIENT_ERRORS_RATE_LIMITED })

    expect((await send({ reports: [REPORT] }, '203.0.113.2')).statusCode).toBe(204)
    const [row] = await recorded()
    expect(row?.count).toBe(PHONE_REPORTS_PER_ADDRESS + 1)
  })

  it('один адрес оператора — много телефонов: второй после полного буфера первого принят (А6)', async () => {
    expect((await send(buffer('A'), '100.64.12.34')).statusCode).toBe(204)
    expect((await send({ reports: [REPORT] }, '100.64.12.34')).statusCode).toBe(204)
  })

  it('IPv6 считается по /64: адреса одного подключения делят минуту (ревью №2)', async () => {
    for (let host = 1; host <= PHONE_REPORTS_PER_ADDRESS / PHONE_FAILURES_KEPT; host += 1) {
      expect(
        (await send(buffer(`H${String(host)}_`), `2001:db8:1:2::${String(host)}`)).statusCode,
      ).toBe(204)
    }
    expect((await send({ reports: [REPORT] }, '2001:db8:1:2::ff')).statusCode).toBe(429)
    expect((await send({ reports: [REPORT] }, '2001:db8:1:3::1')).statusCode).toBe(204)
  })

  it('X-Forwarded-For не от внутренней сети не верится: счёт идёт по пиру', async () => {
    const outside = (address: string) =>
      app.inject({
        method: 'POST',
        url: '/client-errors',
        remoteAddress: '192.0.2.50',
        headers: { 'x-forwarded-for': address },
        payload: { reports: Array.from({ length: PHONE_FAILURES_KEPT }, () => REPORT) },
      })
    for (let sent = 0; sent < PHONE_REPORTS_PER_ADDRESS; sent += PHONE_FAILURES_KEPT) {
      // A forged header names another address each time; the peer is the same.
      expect((await outside(`203.0.113.${String(20 + sent)}`)).statusCode).toBe(204)
    }
    expect((await outside('203.0.113.99')).statusCode).toBe(429)
  })

  it('адрес, по которому считается предел, не пишется ни в лог, ни в таблицу', async () => {
    await send({ reports: [REPORT] }, '198.51.100.77')
    const rows = await recorded()
    expect(JSON.stringify(rows)).not.toContain('198.51.100.77')
    expect(lines.join('\n')).not.toContain('198.51.100.77')
  })
})

describe('поток выдуманных сбоев не топит канал владельца (ревью №1, адверсариальный А5)', () => {
  it(`о телефоне — не больше ${String(PHONE_NOTICES_PER_HOUR)} уведомлений в час, таблица считает всё`, async () => {
    // Two buffers: past four in flight and fifty waiting, a burst of the phone's is dropped (А5).
    for (let host = 1; host <= 2; host += 1) {
      expect(
        (await send(buffer(`F${String(host)}_`), `198.51.100.${String(host)}`)).statusCode,
      ).toBe(204)
    }
    const rows = await recorded()
    expect(rows).toHaveLength(2 * PHONE_FAILURES_KEPT)
    expect(await db.select().from(ownerNotices)).toHaveLength(PHONE_NOTICES_PER_HOUR)
  })

  it('новая сборка на каждый отчёт одного отпечатка не делает каждый «новым» сверх часа', async () => {
    const builds = {
      reports: Array.from({ length: PHONE_FAILURES_KEPT }, (_, index) => ({
        ...REPORT,
        build: `index-Build${String(index).padStart(4, '0')}`,
      })),
    }
    expect((await send(builds, '198.51.100.40')).statusCode).toBe(204)
    await recorded()
    expect(await db.select().from(ownerNotices)).toHaveLength(PHONE_NOTICES_PER_HOUR)
  })

  it('сбой API после потока — в первой выдаче бота, раньше телефона', async () => {
    for (let host = 1; host <= 10; host += 1) {
      expect(
        (await send(buffer(`G${String(host)}_`), `198.51.100.${String(100 + host)}`)).statusCode,
      ).toBe(204)
    }
    await recorded()
    await recordFailure(
      { failures: createFailureRepository(db), owner: OWNER },
      occurrenceOf(
        { errorName: 'PostgresError', code: '57014' },
        { source: 'api', route: 'GET /advice' },
        'v0.2.0',
      ),
      1,
      new Date(),
    )
    const [first] = await createOwnerNoticeRepository(db).claim(OWNER_NOTICES_PER_CLAIM, new Date())
    expect(first).toMatchObject({ source: 'api', route: 'GET /advice' })
  })
})
