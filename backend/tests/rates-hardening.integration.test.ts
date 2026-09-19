/**
 * The adversarial pass on MOL-39 (`.scratch/tasks/selftests/MOL-39-adversarial.md`), kept with the
 * answers the owner decided: each section is an attack that used to succeed, now held.
 */
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { parseRate, pickOfficialRate, tripViewCodec, yerevanDate } from '@molvia/model'
import type { AmdRate, CachedRate, RateProvider, TripView } from '@molvia/model'
import type { FastifyInstance } from 'fastify'
import { createRateRepository } from '@/db/rates-repository'
import { officialRates } from '@/db/schema'
import { parseCba } from '@/rates/cba'
import { parseErapi } from '@/rates/erapi'
import type { Published, RateFeed } from '@/rates/feed'
import { buildServer } from '@/server'
import { FALLBACK_AFTER_FAILURES, officialRatesRefresh } from '@/usecases/refresh-official-rates'
import { connectDrizzle } from './db'
import { clearAll, insertActor, insertItem } from './fixtures'

const { db, close } = connectDrizzle()
const rates = createRateRepository(db)
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

const cbaXml = readFileSync(
  new URL('./fixtures/rates/cba-latest-2026-09-19.xml', import.meta.url),
  'utf8',
)
const erapiJson = readFileSync(
  new URL('./fixtures/rates/erapi-latest-2026-09-19.json', import.meta.url),
  'utf8',
)

const DAY_MS = 24 * 60 * 60 * 1000
const daysAgo = (days: number): string => yerevanDate(new Date(Date.now() - days * DAY_MS))

async function call(method: 'GET' | 'POST' | 'PUT', url: string, actor: string, body?: unknown) {
  const response = await app.inject({
    method,
    url,
    headers: { 'x-molvia-actor': actor },
    ...(body === undefined ? {} : { payload: body as Record<string, unknown> }),
  })
  return {
    status: response.statusCode,
    body: response.body === '' ? undefined : (JSON.parse(response.body) as unknown),
  }
}

const start = (actor: string, id: string = randomUUID()) =>
  call('POST', '/trips', actor, { id, place: { kind: 'store', name: 'Ереван Сити' } })
const view = (reply: { body: unknown }): TripView => tripViewCodec.parse(reply.body)

/** A CBA answer from the recorded fixture, re-dated and with RUB replaced. */
function cbaAnswer(date: string, rub = '4.3123'): string {
  return cbaXml
    .replace('<CurrentDate>2026-09-18T', `<CurrentDate>${date}T`)
    .replace('<Rate>4.3123</Rate>', `<Rate>${rub}</Rate>`)
}

function answer(provider: RateProvider, date: string, rub = 4_312_300n): Published {
  const rows: AmdRate[] = [
    { provider, currency: 'RUB', date, scaled: rub },
    { provider, currency: 'USD', date, scaled: 363_440_000n },
    { provider, currency: 'EUR', date, scaled: 417_050_000n },
  ]
  return { provider, date, rates: rows }
}

function counting(provider: RateProvider, fetch: () => Promise<Published>) {
  const state = { asked: 0 }
  const feed: RateFeed = {
    provider,
    fetchLatest() {
      state.asked += 1
      return fetch()
    },
  }
  return { feed, state }
}

const quiet = { warn: () => undefined }

describe('А. ЦБ РА отвечает, но курс стоит (Р-18)', () => {
  it('ответ ЦБ РА за 60 дней назад — запасной спрошен с первого же обновления, поход берёт его', async () => {
    const cba = counting('cba', () => Promise.resolve(parseCba(cbaAnswer(daysAgo(60)))))
    const cbr = counting('cbr', () => Promise.resolve(answer('cbr', daysAgo(0), 4_316_500n)))
    const run = officialRatesRefresh({
      primary: cba.feed,
      fallbacks: [cbr.feed],
      rates,
      log: quiet,
    })

    await run()

    expect(cbr.state.asked).toBe(1)
    const actor = await insertActor(db)
    expect(view(await start(actor))).toMatchObject({
      rate: { scaled: 4_316_500n, source: 'fallback' },
      rateStale: false,
    })
  })

  it('запасные молчат — поход получает старый курс ЦБ РА с признаком «устарел»', async () => {
    const run = officialRatesRefresh({
      primary: {
        provider: 'cba',
        fetchLatest: () => Promise.resolve(parseCba(cbaAnswer(daysAgo(60)))),
      },
      fallbacks: [{ provider: 'cbr', fetchLatest: () => Promise.reject(new Error('down')) }],
      rates,
      log: quiet,
    })

    await run()

    const actor = await insertActor(db)
    const trip = view(await start(actor))
    expect(trip).toMatchObject({ rate: { source: 'official' }, rateStale: true })
    expect(yerevanDate(trip.rate?.asOf ?? new Date())).toBe(daysAgo(60))
  })

  it('контроль: пятничный курс ЦБ РА в выходные — запасные не спрошены', async () => {
    const cba = counting('cba', () => Promise.resolve(parseCba(cbaAnswer(daysAgo(2)))))
    const cbr = counting('cbr', () => Promise.resolve(answer('cbr', daysAgo(0))))
    const run = officialRatesRefresh({
      primary: cba.feed,
      fallbacks: [cbr.feed],
      rates,
      log: quiet,
    })

    await run()

    expect(cbr.state.asked).toBe(0)
  })
})

describe('Б. Курс, сдвинутый в 100 раз, — скачок и выбор (Р-19)', () => {
  it('рубль по 431.23 после недели 4.30 — пишется с меткой, поход предлагает прежний', async () => {
    await rates.upsert(
      [5, 4, 3, 2].map((days): CachedRate => ({
        provider: 'cba',
        currency: 'RUB',
        date: daysAgo(days),
        scaled: 4_312_300n,
        jump: false,
      })),
    )
    const run = officialRatesRefresh({
      primary: {
        provider: 'cba',
        fetchLatest: () => Promise.resolve(parseCba(cbaAnswer(daysAgo(1), '431.23'))),
      },
      fallbacks: [],
      rates,
      log: quiet,
    })
    await run()

    const actor = await insertActor(db)
    const started = view(await start(actor))
    const itemId = await insertItem(db)
    await call('POST', `/trips/${started.id}/expenses`, actor, {
      id: randomUUID(),
      itemId,
      amount: { amount: '10000', currency: 'AMD' },
    })
    const chosen = await call('PUT', `/trips/${started.id}/rate-choice`, actor, {
      choice: 'previous',
    })

    expect(started.rateJump).toMatchObject({
      jumped: { scaled: 431_230_000n },
      previous: { scaled: 4_312_300n },
      choice: null,
    })
    expect(chosen.body).toMatchObject({ converted: { amount: '2318.95', currency: 'RUB' } })
  })

  it('скачок у open.er-api — тоже метка: RUB 0.0023 за драм вместо 0.2317', async () => {
    const steady = parseErapi(erapiJson)
    const earlier = (days: number) =>
      steady.rates.map((rate): CachedRate => ({ ...rate, date: daysAgo(days), jump: false }))
    // Three days of its own in the last week: judged by its own history (Р-22, Р-23).
    await rates.upsert([...earlier(4), ...earlier(3), ...earlier(2)])
    const shifted = parseErapi(erapiJson.replace(/"RUB":[0-9.]+/, '"RUB":0.0023'))
    const run = officialRatesRefresh({
      primary: {
        provider: 'cba',
        fetchLatest: () => Promise.resolve(parseCba(cbaAnswer(daysAgo(30)))),
      },
      fallbacks: [
        {
          provider: 'erapi',
          fetchLatest: () =>
            Promise.resolve({
              ...shifted,
              date: daysAgo(1),
              rates: shifted.rates.map((rate) => ({ ...rate, date: daysAgo(1) })),
            }),
        },
      ],
      rates,
      log: quiet,
    })

    await run()

    const [rub] = await rates
      .latestOnOrBefore(['RUB'], daysAgo(0))
      .then((rows) => rows.filter((row) => row.provider === 'erapi' && row.date === daysAgo(1)))
    expect(rub).toMatchObject({ scaled: 434_782_609n, jump: true })
  })

  it('первый курс поставщика меряться не с чем — принят без метки: цена правила, названная вслух', async () => {
    const run = officialRatesRefresh({
      primary: {
        provider: 'cba',
        fetchLatest: () => Promise.resolve(parseCba(cbaAnswer(daysAgo(1), '431.23'))),
      },
      fallbacks: [],
      rates,
      log: quiet,
    })
    await run()

    const stored = await db.select().from(officialRates)
    expect(stored.find((row) => row.currency === 'RUB')).toMatchObject({ jump: false })
  })

  it('контроль: ноль и отрицательный курс отвергнуты целиком', () => {
    expect(() => parseCba(cbaAnswer('2026-09-18', '0'))).toThrow('cba: implausible RUB')
    expect(() => parseCba(cbaAnswer('2026-09-18', '-4.3123'))).toThrow('cba: implausible RUB')
  })
})

describe('В. Дата, которую снимок не примет, в кеш не попадает', () => {
  it('open.er-api с нулевым временем обновления и ЦБ РА с 0001-01-01 — отказ всего ответа', () => {
    const zero = erapiJson.replace(/"time_last_update_unix":\d+/, '"time_last_update_unix":0')
    expect(() => parseErapi(zero)).toThrow('erapi: unreadable date "1970-01-01"')
    expect(() => parseCba(cbaAnswer('0001-01-01'))).toThrow('cba: unreadable date')
  })

  it('строка 1970 года, записанная в обход разбора, — поход начинается без курса, а не 500', async () => {
    await rates.upsert([
      { provider: 'erapi', currency: 'RUB', date: '1970-01-01', scaled: 4_314_800n, jump: false },
    ])
    const actor = await insertActor(db)
    const id = randomUUID()

    const first = await start(actor, id)
    const repeat = await start(actor, id)

    expect(first.status).toBe(201)
    expect(view(first).rate).toBeNull()
    expect(repeat.status).toBe(200)
  })

  it('pickOfficialRate не отдаёт курс, который отверг бы снимок', () => {
    const rows: CachedRate[] = [
      {
        provider: 'erapi',
        currency: 'RUB',
        date: '1970-01-01',
        scaled: parseRate('4.3148'),
        jump: false,
      },
    ]
    expect(pickOfficialRate('RUB', 'AMD', rows, '2026-09-19')).toBeNull()
  })
})

describe('Г. Сбой базы — не сбой ЦБ РА', () => {
  it('ЦБ РА отвечает, база не пишет: запасные не спрошены, в логе — сбой записи', async () => {
    const cbr = counting('cbr', () => Promise.resolve(answer('cbr', daysAgo(0))))
    const warnings: { details: object; message: string }[] = []
    const run = officialRatesRefresh({
      primary: { provider: 'cba', fetchLatest: () => Promise.resolve(answer('cba', daysAgo(0))) },
      fallbacks: [cbr.feed],
      rates: {
        upsert: () => Promise.reject(new Error('connection terminated')),
        latestOnOrBefore: () => Promise.resolve([]),
        history: () => Promise.resolve(new Map()),
      },
      log: { warn: (details, message) => warnings.push({ details, message }) },
    })

    for (let index = 0; index <= FALLBACK_AFTER_FAILURES; index += 1) await run()

    expect(cbr.state.asked).toBe(0)
    expect(warnings[0]).toMatchObject({
      message: 'official rate cache write failed',
      details: { provider: 'cba' },
    })
  })
})

describe('Д. В предупреждении — дата последнего курса ЦБ РА и причина', () => {
  it('warn несёт ошибку и lastKnown из кеша', async () => {
    await rates.upsert(
      answer('cba', daysAgo(3)).rates.map((rate): CachedRate => ({ ...rate, jump: false })),
    )
    const warnings: Record<string, unknown>[] = []
    const run = officialRatesRefresh({
      primary: { provider: 'cba', fetchLatest: () => Promise.reject(new Error('down')) },
      fallbacks: [],
      rates,
      log: { warn: (details) => warnings.push(details as Record<string, unknown>) },
    })

    await run()

    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatchObject({ provider: 'cba', lastKnown: daysAgo(3) })
    expect(warnings[0]?.err).toBeInstanceOf(Error)
  })
})

describe('Контроль: правило выбора держит то, что обещает', () => {
  const rub = (provider: RateProvider, date: string, value: string): CachedRate => ({
    provider,
    currency: 'RUB',
    date,
    scaled: parseRate(value),
    jump: false,
  })

  it('Р-17: ЦБ РФ и open.er-api с одной датой — берётся ЦБ РФ', () => {
    const rows = [
      rub('cba', '2026-09-01', '4.3000'),
      rub('erapi', '2026-09-18', '4.3148'),
      rub('cbr', '2026-09-18', '4.3165'),
    ]
    expect(pickOfficialRate('RUB', 'AMD', rows, '2026-09-19')?.rate.scaled).toBe(4_316_500n)
  })

  it('пара не собирается из двух поставщиков: RUB у ЦБ РА, USD только у ЦБ РФ — null', () => {
    const rows: CachedRate[] = [
      rub('cba', '2026-09-18', '4.3123'),
      {
        provider: 'cbr',
        currency: 'USD',
        date: '2026-09-18',
        scaled: parseRate('363.44'),
        jump: false,
      },
    ]
    expect(pickOfficialRate('RUB', 'USD', rows, '2026-09-19')).toBeNull()
  })
})
