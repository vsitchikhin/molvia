import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { exchangesResponseCodec, parseRate, tripViewCodec, yerevanDate } from '@molvia/model'
import type { AmdRate, CachedRate, RateProvider } from '@molvia/model'
import type { FastifyInstance } from 'fastify'
import { createRateRepository } from '@/db/rates-repository'
import { officialRates, trips } from '@/db/schema'
import { buildServer } from '@/server'
import { connectDrizzle } from './db'
import { clearAll, insertActor, insertPlace, signIn, tripContext } from './fixtures'

// The lari (MOL-110): its pairs are the National Bank of Georgia's, everything else stays the
// Central Bank of Armenia's, and the database holds the two to the same rule as the domain.

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

const daysAgo = (days: number): string =>
  yerevanDate(new Date(Date.now() - days * 24 * 60 * 60 * 1000))

const amd = (
  currency: AmdRate['currency'],
  value: string,
  date: string,
  provider: RateProvider,
): CachedRate => ({ provider, currency, date, scaled: parseRate(value), jump: false })

/** The bank of Georgia: 140 ֏ a lari and 4.2 ֏ a rouble — 0.03 lari a rouble, exactly. */
const georgian = (date: string) => [amd('GEL', '140', date, 'nbg'), amd('RUB', '4.2', date, 'nbg')]
/** The bank of Armenia a day fresher: 0.030935 lari a rouble. */
const armenian = (date: string) => [amd('GEL', '139', date, 'cba'), amd('RUB', '4.3', date, 'cba')]

async function tbilisi(): Promise<{ id: string; cookie: string }> {
  const id = await insertActor(db, { country: 'GE', city: 'Тбилиси', spendCurrency: 'GEL' })
  return { id, cookie: await signIn(db, id) }
}

async function start(me: { id: string; cookie: string }) {
  const response = await app.inject({
    method: 'POST',
    url: '/trips',
    headers: { cookie: me.cookie },
    payload: {
      id: randomUUID(),
      context: await tripContext(db, me.id),
      place: { kind: 'store', name: 'Carrefour' },
    },
  })
  expect(response.statusCode).toBe(201)
  return tripViewCodec.parse(response.json())
}

async function post(me: { cookie: string }, url: string, payload: Record<string, unknown>) {
  const response = await app.inject({
    method: 'POST',
    url,
    headers: { cookie: me.cookie },
    payload,
  })
  expect(response.statusCode).toBe(201)
  return response
}

describe('поход в лари', () => {
  it('берёт курс НБ Грузии как официальный, даже когда ЦБ РА на день свежее', async () => {
    await rates.upsert([...georgian(daysAgo(2)), ...armenian(daysAgo(1))])
    const trip = await start(await tbilisi())
    expect(trip.currency).toBe('GEL')
    expect(trip.rate).toMatchObject({
      base: 'RUB',
      quote: 'GEL',
      scaled: parseRate('0.03'),
      source: 'official',
    })
    expect(trip.rateProvider).toBe('nbg')
    expect(trip.rateStale).toBe(false)
  })

  it('НБ Грузии молчит больше недели — ЦБ РА, но запасным', async () => {
    await rates.upsert([...georgian(daysAgo(9)), ...armenian(daysAgo(1))])
    const trip = await start(await tbilisi())
    expect(trip.rate).toMatchObject({ scaled: parseRate('0.030935'), source: 'fallback' })
    expect(trip.rateProvider).toBe('cba')
  })

  it('поход в драмах строки НБ Грузии не трогают — ЦБ РА, официальный', async () => {
    await rates.upsert([...georgian(daysAgo(1)), ...armenian(daysAgo(2))])
    const id = await insertActor(db)
    const trip = await start({ id, cookie: await signIn(db, id) })
    expect(trip.rate).toMatchObject({ base: 'RUB', quote: 'AMD', source: 'official' })
    expect(trip.rateProvider).toBe('cba')
  })
})

describe('лари в своём курсе', () => {
  it('обмен рублей на лари сравнивается с НБ Грузии своего дня и становится курсом похода', async () => {
    await rates.upsert(georgian(daysAgo(3)))
    const me = await tbilisi()
    const response = await post(me, '/exchanges', {
      id: randomUUID(),
      given: { amount: '10000', currency: 'RUB' },
      received: { amount: '310', currency: 'GEL' },
      exchangedOn: daysAgo(2),
    })
    const [exchange] = exchangesResponseCodec.parse(response.json()).exchanges
    // 10 000 ₽ × 0.03 = 300 ₾ at the bank; the exchanger gave 10 ₾ more.
    expect(exchange?.official).toMatchObject({
      provider: 'nbg',
      difference: { minor: 1_000n, currency: 'GEL' },
    })
    expect(exchange?.market).toBeNull()
    expect((await start(me)).rate).toMatchObject({ source: 'personal', scaled: parseRate('0.031') })
  })

  it('доход в лари оценён по НБ Грузии своего дня, и поход берёт это число', async () => {
    await rates.upsert(georgian(daysAgo(3)))
    const me = await tbilisi()
    await post(me, '/incomes', {
      id: randomUUID(),
      amount: { amount: '1000', currency: 'GEL' },
      receivedOn: daysAgo(3),
      source: 'salary',
    })
    const overview = exchangesResponseCodec.parse(
      (
        await app.inject({ method: 'GET', url: '/exchanges', headers: { cookie: me.cookie } })
      ).json(),
    )
    // On the side of at least one, as the wallet always comes (MOL-81): 33,33 ₽ a lari.
    expect(overview.wallet).toMatchObject({
      basis: 'income',
      estimated: true,
      rate: { base: 'GEL', quote: 'RUB', scaled: parseRate('33.333333') },
    })
    expect((await start(me)).rate).toMatchObject({ source: 'personal', scaled: parseRate('0.03') })
  })
})

describe('база держит лари тем же правилом, что домен', () => {
  async function snapshot(quote: 'AMD' | 'GEL') {
    return {
      actorId: await insertActor(db),
      placeId: await insertPlace(db),
      currency: quote,
      rateBase: 'RUB' as const,
      rateQuote: quote,
      rateScaled: 30_000n,
      rateAsOf: new Date('2026-09-18T20:00:00Z'),
    }
  }
  const write = (values: Record<string, unknown>) =>
    db.insert(trips).values({ ...(values as typeof trips.$inferInsert), id: randomUUID() })

  it('у пары с лари official — только НБ Грузии, ЦБ РА — только запасной', async () => {
    const lari = await snapshot('GEL')
    await expect(
      write({ ...lari, rateSource: 'official', rateProvider: 'nbg' }),
    ).resolves.toBeDefined()
    await expect(
      write({ ...lari, rateSource: 'fallback', rateProvider: 'cba' }),
    ).resolves.toBeDefined()
    await expect(
      write({ ...lari, rateSource: 'official', rateProvider: 'cba' }),
    ).rejects.toMatchObject({
      cause: { constraint_name: 'trips_rate_provider_matches_source' },
    })
    await expect(
      write({ ...lari, rateSource: 'fallback', rateProvider: 'nbg' }),
    ).rejects.toMatchObject({
      cause: { constraint_name: 'trips_rate_provider_matches_source' },
    })
  })

  it('у пары драма НБ Грузии — запасной, как ЦБ РФ', async () => {
    const dram = await snapshot('AMD')
    await expect(
      write({ ...dram, rateSource: 'fallback', rateProvider: 'nbg' }),
    ).resolves.toBeDefined()
    await expect(
      write({ ...dram, rateSource: 'official', rateProvider: 'nbg' }),
    ).rejects.toMatchObject({
      cause: { constraint_name: 'trips_rate_provider_matches_source' },
    })
  })

  it('кеш берёт лари и НБ Грузии, а валюты не из списка — нет', async () => {
    await rates.upsert([amd('GEL', '140', daysAgo(1), 'nbg')])
    expect(await db.select().from(officialRates)).toHaveLength(1)
    await expect(
      db.execute(
        sql`insert into official_rates (provider, currency, rate_date, scaled) values ('nbg', 'GBP', ${daysAgo(1)}, 1)`,
      ),
    ).rejects.toThrow()
  })

  it('человек тратит в лари; фунт — отказ', async () => {
    await expect(insertActor(db, { spendCurrency: 'GEL' })).resolves.toBeDefined()
    await expect(
      db.execute(sql`update actors set income_currency = 'GBP' where spend_currency = 'GEL'`),
    ).rejects.toThrow()
  })
})
