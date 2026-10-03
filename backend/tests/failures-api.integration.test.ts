/**
 * Failures of the API into the table (MOL-143) through a real server: an answer of 500 is
 * recorded by the route's template and nothing a person typed, a refusal is not a failure, and the
 * owner's notice is queued once a build. The failing routes are the test's own, added to the
 * server it builds: the error handler of the root covers every route registered on it.
 */
import { randomBytes } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { DomainError, ERROR, ISSUE, ownerNoticesSchema } from '@molvia/model'
import { failures, ownerNotices } from '@/db/schema'
import { buildServer } from '@/server'
import { connectDrizzle } from './db'
import { clearAll } from './fixtures'

const { db, close } = connectDrizzle()

/** A review of the kind MOL-27 allows, one line of it written as a frame. */
const REVIEW = 'Сыр так себе\n    at Аня, ул. Ширакаци 12'
const PERSON_ID = '1f0e2c4a-5b6d-4e7f-8a9b-0c1d2e3f4a5b'
const OWNER = 4242
const botSecret = randomBytes(32).toString('base64url')
const asBot = { authorization: `Bearer ${botSecret}` }

let recordings: Promise<void>[] = []
const lines: string[] = []

function serverFor(owner: number | null) {
  const app = buildServer({
    db,
    owner,
    login: { username: 'molvia_bot', botSecret },
    failureRecorded: (recording) => recordings.push(recording),
    logStream: { write: (line) => lines.push(line) },
  })
  app.get('/test/boom/:itemId', () => {
    throw new TypeError('boom')
  })
  // The driver writes the value it refused into its message: a person's review, here.
  app.post('/test/driver', async () => db.execute(sql`select ${REVIEW}::int`))
  app.get('/test/refused', () => {
    throw new DomainError(ERROR.NOT_FOUND)
  })
  app.post('/test/body', () => 'never')
  return app
}

const app = serverFor(OWNER)
const quiet = serverFor(null)

beforeAll(async () => {
  await app.ready()
  await quiet.ready()
})
beforeEach(async () => {
  await clearAll(db)
  recordings = []
  lines.length = 0
})
afterAll(async () => {
  await app.close()
  await quiet.close()
  await clearAll(db)
  await close()
})

async function recorded() {
  await Promise.all(recordings)
  return db.select().from(failures)
}

describe('сбой API — в таблицу (MOL-143)', () => {
  it('500 пишется шаблоном маршрута, а не адресом', async () => {
    const response = await app.inject({ method: 'GET', url: `/test/boom/${PERSON_ID}?q=сыр` })
    expect(response.statusCode).toBe(500)

    const [row] = await recorded()
    expect(row).toMatchObject({
      source: 'api',
      errorName: 'TypeError',
      route: 'GET /test/boom/:itemId',
      count: 1,
      buildCount: 1,
    })
    expect(JSON.stringify(row)).not.toMatch(new RegExp(`${PERSON_ID}|сыр`))
  })

  it('текст человека из сообщения драйвера не попадает ни в одну строку', async () => {
    const response = await app.inject({ method: 'POST', url: '/test/driver' })
    expect(response.statusCode).toBe(500)
    await recorded()

    const everything = await db.execute(sql`
      select f::text as row from ${failures} f
      union all select n::text from ${ownerNotices} n`)
    expect(everything.length).toBeGreaterThan(0)
    expect(JSON.stringify([...everything])).not.toMatch(/Сыр|Ширакаци|Аня/)
    const [row] = await recorded()
    expect(row?.code).toBe('22P02')
  })

  it('отказ из реестра и кривое тело — не сбой', async () => {
    expect((await app.inject({ method: 'GET', url: '/test/refused' })).statusCode).toBe(404)
    const body = await app.inject({
      method: 'POST',
      url: '/test/body',
      headers: { 'content-type': 'application/json' },
      payload: '{"not json',
    })
    expect(body.statusCode).toBe(400)
    expect((await app.inject({ method: 'GET', url: '/no/such/route' })).statusCode).toBe(404)

    expect(recordings).toEqual([])
    expect(await recorded()).toEqual([])
  })

  it('владельцу — одно уведомление на отпечаток в сборке, повтор копит счёт', async () => {
    await app.inject({ method: 'GET', url: `/test/boom/${PERSON_ID}` })
    await app.inject({ method: 'GET', url: '/test/boom/another' })
    const [row] = await recorded()
    expect(row?.count).toBe(2)

    const queued = await db.select().from(ownerNotices)
    expect(queued).toHaveLength(1)
    expect(queued[0]?.payload).toMatchObject({
      kind: 'failure',
      route: 'GET /test/boom/:itemId',
      errorName: 'TypeError',
    })
  })

  it('без владельца сбой пишется, а уведомлений нет', async () => {
    await quiet.inject({ method: 'GET', url: '/test/boom/x' })
    expect(await recorded()).toHaveLength(1)
    expect(await db.select().from(ownerNotices)).toEqual([])
  })

  it('лог по-прежнему по виду, и сбой в нём тот же', async () => {
    await app.inject({ method: 'GET', url: `/test/boom/${PERSON_ID}` })
    await recorded()
    const logged = lines.join('\n')
    expect(logged).toContain('"errorName":"TypeError"')
    expect(logged).not.toContain('boom"')
  })
})

describe('бот и канал владельцу — /internal (MOL-143)', () => {
  const report = { errorName: 'GrammyError', code: 'ETIMEDOUT', handler: 'callback:rate' }

  it('сбой бота ложится его обработчиком и сборкой API', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/failures',
      headers: asBot,
      payload: report,
    })
    expect(response.statusCode).toBe(204)
    // Answered at once and written behind the answer: the row is waited for, never raced (№13).
    const [row] = await recorded()
    expect(row).toMatchObject({ source: 'bot', route: 'callback:rate', errorName: 'GrammyError' })
  })

  it('отчёт с лишним полем — 400, без секрета — 401, и ничего не пишется', async () => {
    const extra = await app.inject({
      method: 'POST',
      url: '/internal/failures',
      headers: asBot,
      payload: { ...report, from: { id: 777, first_name: 'Аня' } },
    })
    expect(extra.statusCode).toBe(400)
    expect(extra.json()).toMatchObject({ code: ISSUE.BODY_INVALID })
    const stranger = await app.inject({
      method: 'POST',
      url: '/internal/failures',
      payload: report,
    })
    expect(stranger.statusCode).toBe(401)
    expect(await db.select().from(failures)).toEqual([])
  })

  it('claim отдаёт уведомление владельцу один раз', async () => {
    await app.inject({ method: 'POST', url: '/internal/failures', headers: asBot, payload: report })
    await recorded()
    const claim = () => app.inject({ method: 'POST', url: '/internal/owner/claim', headers: asBot })

    const first = ownerNoticesSchema.parse((await claim()).json())
    expect(first).toMatchObject({
      to: OWNER,
      notices: [{ kind: 'failure', route: 'callback:rate' }],
    })
    expect(ownerNoticesSchema.parse((await claim()).json())).toEqual({ to: OWNER, notices: [] })
  })

  it('без владельца claim пуст и говорит, что писать некому', async () => {
    const response = await quiet.inject({
      method: 'POST',
      url: '/internal/owner/claim',
      headers: asBot,
    })
    expect(response.json()).toEqual({ to: null, notices: [] })
  })
})
