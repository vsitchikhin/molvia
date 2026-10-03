/**
 * The phone's failures into the table (MOL-144) through a real server: taken with no session, by
 * the page's own build and platform, refused past the schema and past the limit, and the address
 * the limit counts by is written nowhere.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { ERROR, PHONE_FAILURES_KEPT, ownerNoticesSchema } from '@molvia/model'
import { failures, ownerNotices } from '@/db/schema'
import { buildServer } from '@/server'
import { PHONE_REPORTS_PER_ADDRESS } from '@/usecases/record-failure'
import { connectDrizzle } from './db'
import { clearAll } from './fixtures'

const { db, close } = connectDrizzle()
const OWNER = 4242

let recordings: Promise<void>[] = []
const lines: string[] = []

const app = buildServer({
  db,
  owner: OWNER,
  failureRecorded: (recording) => recordings.push(recording),
  logStream: { write: (line) => lines.push(line) },
})

beforeAll(async () => {
  await app.ready()
})
beforeEach(async () => {
  await clearAll(db)
  recordings = []
  lines.length = 0
})
afterAll(async () => {
  await app.close()
  await clearAll(db)
  await close()
})

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
    const full = { reports: Array.from({ length: PHONE_REPORTS_PER_ADDRESS }, () => REPORT) }
    expect((await send(full, '203.0.113.1')).statusCode).toBe(204)

    const past = await send({ reports: [REPORT] }, '203.0.113.1')
    expect(past.statusCode).toBe(429)
    expect(past.json()).toEqual({ code: ERROR.CLIENT_ERRORS_RATE_LIMITED })

    expect((await send({ reports: [REPORT] }, '203.0.113.2')).statusCode).toBe(204)
    const [row] = await recorded()
    expect(row?.count).toBe(PHONE_REPORTS_PER_ADDRESS + 1)
  })

  it('X-Forwarded-For не от внутренней сети не верится: счёт идёт по пиру', async () => {
    const outside = (address: string) =>
      app.inject({
        method: 'POST',
        url: '/client-errors',
        remoteAddress: '192.0.2.50',
        headers: { 'x-forwarded-for': address },
        payload: { reports: Array.from({ length: PHONE_REPORTS_PER_ADDRESS }, () => REPORT) },
      })
    expect((await outside('203.0.113.20')).statusCode).toBe(204)
    // A forged header names another address each time; the peer is the same, and its minute is full.
    expect((await outside('203.0.113.21')).statusCode).toBe(429)
  })

  it('адрес, по которому считается предел, не пишется ни в лог, ни в таблицу', async () => {
    await send({ reports: [REPORT] }, '198.51.100.77')
    const rows = await recorded()
    expect(JSON.stringify(rows)).not.toContain('198.51.100.77')
    expect(lines.join('\n')).not.toContain('198.51.100.77')
  })
})
