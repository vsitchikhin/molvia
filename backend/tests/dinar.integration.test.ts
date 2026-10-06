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

// The dinar (MOL-230): against the rouble, the dollar and the euro it is the National Bank of
// Serbia's, whose rows are dinars rather than drams; against the dram the National Bank of
// Georgia's; and the database holds the base of a row and the bank of a pair as the domain does.

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

const row = (
  currency: AmdRate['currency'],
  value: string,
  date: string,
  provider: RateProvider,
): CachedRate => ({ provider, currency, date, scaled: parseRate(value), jump: false })

/** The bank of Serbia, in dinars: 1,25 a rouble — 0,8 rouble a dinar — 100 a dollar. */
const serbian = (date: string) => [
  row('RUB', '1.25', date, 'nbs'),
  row('USD', '100', date, 'nbs'),
  row('EUR', '117.5', date, 'nbs'),
]
/** The Bank of Russia, in drams: 3,5 a dinar and 4,2 a rouble — 1,2 dinars a rouble. */
const russian = (date: string) => [row('RSD', '3.5', date, 'cbr'), row('RUB', '4.2', date, 'cbr')]
/** The bank of Georgia, in drams: 3,6 a dinar. */
const georgian = (date: string) => [row('RSD', '3.6', date, 'nbg'), row('GEL', '140', date, 'nbg')]
/** The bank of Armenia, in drams: 4,3 a rouble — and no dinar. */
const armenian = (date: string) => [row('RUB', '4.3', date, 'cba'), row('USD', '390', date, 'cba')]

async function belgrade(income: 'RUB' | 'AMD' = 'RUB'): Promise<{ id: string; cookie: string }> {
  const id = await insertActor(db, {
    country: 'RS',
    city: 'Белград',
    spendCurrency: 'RSD',
    incomeCurrency: income,
  })
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
      place: { kind: 'store', name: 'Maxi' },
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

describe('поход в динарах', () => {
  it('доход в рублях — курс НБ Сербии, официальный, хотя ЦБ РФ на день свежее', async () => {
    await rates.upsert([...serbian(daysAgo(2)), ...russian(daysAgo(1)), ...armenian(daysAgo(1))])
    const trip = await start(await belgrade())
    expect(trip.currency).toBe('RSD')
    expect(trip.rate).toMatchObject({
      base: 'RUB',
      quote: 'RSD',
      scaled: parseRate('1.25'),
      source: 'official',
    })
    expect(trip.rateProvider).toBe('nbs')
    expect(trip.rateStale).toBe(false)
  })

  it('НБ Сербии молчит больше недели — ЦБ РФ, запасным; у ЦБ РА динара нет', async () => {
    await rates.upsert([...serbian(daysAgo(9)), ...russian(daysAgo(1)), ...armenian(daysAgo(1))])
    const trip = await start(await belgrade())
    expect(trip.rate).toMatchObject({ scaled: parseRate('1.2'), source: 'fallback' })
    expect(trip.rateProvider).toBe('cbr')
  })

  it('доход в драмах — пара НБ Грузии: у НБ Сербии драма нет', async () => {
    await rates.upsert([...serbian(daysAgo(1)), ...georgian(daysAgo(2)), ...russian(daysAgo(1))])
    const trip = await start(await belgrade('AMD'))
    // 1 / 3,6 динара за драм.
    expect(trip.rate).toMatchObject({
      base: 'AMD',
      quote: 'RSD',
      scaled: parseRate('0.277778'),
      source: 'official',
    })
    expect(trip.rateProvider).toBe('nbg')
  })

  it('рубль НБ Сербии — динары: поход в драмах берёт ЦБ РА, а не 1,25 драма за рубль', async () => {
    await rates.upsert([...serbian(daysAgo(1)), ...armenian(daysAgo(2))])
    const id = await insertActor(db)
    const trip = await start({ id, cookie: await signIn(db, id) })
    expect(trip.rate).toMatchObject({ base: 'RUB', quote: 'AMD', scaled: parseRate('4.3') })
    expect(trip.rateProvider).toBe('cba')
  })

  it('ЦБ РА молчит — строки НБ Сербии пару драма всё равно не собирают', async () => {
    await rates.upsert([...serbian(daysAgo(1)), ...armenian(daysAgo(10))])
    const id = await insertActor(db)
    const trip = await start({ id, cookie: await signIn(db, id) })
    expect(trip.rateProvider).toBe('cba')
    expect(trip.rateStale).toBe(true)
  })
})

describe('динар в своём курсе', () => {
  it('обмен рублей на динары сравнивается с НБ Сербии своего дня и становится курсом похода', async () => {
    await rates.upsert(serbian(daysAgo(3)))
    const me = await belgrade()
    const response = await post(me, '/exchanges', {
      id: randomUUID(),
      given: { amount: '10000', currency: 'RUB' },
      received: { amount: '12600', currency: 'RSD' },
      exchangedOn: daysAgo(2),
    })
    const [exchange] = exchangesResponseCodec.parse(response.json()).exchanges
    // 10 000 ₽ × 1,25 = 12 500 RSD у банка; обменник дал на 100 больше.
    expect(exchange?.official).toMatchObject({
      provider: 'nbs',
      difference: { minor: 10_000n, currency: 'RSD' },
    })
    expect(exchange?.market).toBeNull()
    expect((await start(me)).rate).toMatchObject({ source: 'personal', scaled: parseRate('1.26') })
  })

  it('доход в динарах оценён по НБ Сербии своего дня, и поход берёт это число', async () => {
    await rates.upsert(serbian(daysAgo(3)))
    const me = await belgrade()
    await post(me, '/incomes', {
      id: randomUUID(),
      amount: { amount: '100000', currency: 'RSD' },
      receivedOn: daysAgo(3),
      source: 'salary',
    })
    const overview = exchangesResponseCodec.parse(
      (
        await app.inject({ method: 'GET', url: '/exchanges', headers: { cookie: me.cookie } })
      ).json(),
    )
    expect(overview.wallet).toMatchObject({ basis: 'income', estimated: true })
    expect((await start(me)).rate).toMatchObject({ source: 'personal', scaled: parseRate('1.25') })
  })
})

describe('база держит динар тем же правилом, что домен', () => {
  async function snapshot(base: 'RUB' | 'AMD') {
    return {
      actorId: await insertActor(db),
      placeId: await insertPlace(db),
      currency: 'RSD' as const,
      rateBase: base,
      rateQuote: 'RSD' as const,
      rateScaled: 1_250_000n,
      rateAsOf: new Date('2026-10-05T20:00:00Z'),
    }
  }
  const write = (values: Record<string, unknown>) =>
    db.insert(trips).values({ ...(values as typeof trips.$inferInsert), id: randomUUID() })
  const refused = { cause: { constraint_name: 'trips_rate_provider_matches_source' } }

  it('рубль с динаром: official — только НБ Сербии; ЦБ РФ — запасной', async () => {
    const pair = await snapshot('RUB')
    await expect(
      write({ ...pair, rateSource: 'official', rateProvider: 'nbs' }),
    ).resolves.toBeDefined()
    await expect(
      write({ ...pair, rateSource: 'fallback', rateProvider: 'cbr' }),
    ).resolves.toBeDefined()
    await expect(
      write({ ...pair, rateSource: 'official', rateProvider: 'nbg' }),
    ).rejects.toMatchObject(refused)
    await expect(
      write({ ...pair, rateSource: 'official', rateProvider: 'cba' }),
    ).rejects.toMatchObject(refused)
  })

  it('драм с динаром: official — НБ Грузии, НБ Сербии — нет', async () => {
    const pair = await snapshot('AMD')
    await expect(
      write({ ...pair, rateSource: 'official', rateProvider: 'nbg' }),
    ).resolves.toBeDefined()
    await expect(
      write({ ...pair, rateSource: 'official', rateProvider: 'nbs' }),
    ).rejects.toMatchObject(refused)
  })

  it('строка НБ Сербии хранит базу RSD; строка с чужой базой — отказ', async () => {
    await rates.upsert(serbian(daysAgo(1)))
    const stored = await db.select().from(officialRates)
    expect(stored.map((one) => [one.provider, one.base])).toEqual([
      ['nbs', 'RSD'],
      ['nbs', 'RSD'],
      ['nbs', 'RSD'],
    ])
    await rates.insertMissing([row('RSD', '3.6', daysAgo(2), 'nbg')])
    const [georgia] = await db
      .select()
      .from(officialRates)
      .where(sql`provider = 'nbg'`)
    expect(georgia?.base).toBe('AMD')
    // Без базы колонка — драм: для НБС это ложь, и база её не примет.
    await expect(
      db.execute(
        sql`insert into official_rates (provider, currency, rate_date, scaled) values ('nbs', 'USD', ${daysAgo(5)}, 1)`,
      ),
    ).rejects.toMatchObject({ cause: { constraint_name: 'official_rates_base_of_provider' } })
    await expect(
      db.execute(
        sql`insert into official_rates (provider, currency, base, rate_date, scaled) values ('nbs', 'RSD', 'RSD', ${daysAgo(5)}, 1)`,
      ),
    ).rejects.toMatchObject({ cause: { constraint_name: 'official_rates_currency_foreign' } })
  })

  it('человек тратит в динарах', async () => {
    await expect(insertActor(db, { spendCurrency: 'RSD' })).resolves.toBeDefined()
  })
})
