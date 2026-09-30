import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { exchangesResponseCodec, parseRate, yerevanDate } from '@molvia/model'
import type { CachedRate, ExchangesResponse, MarketRate } from '@molvia/model'
import type { FastifyInstance } from 'fastify'
import { createMarketRateRepository } from '@/db/market-rates-repository'
import { createRateRepository } from '@/db/rates-repository'
import { exchangeRevisions, marketRates } from '@/db/schema'
import { buildServer } from '@/server'
import { connectDrizzle } from './db'
import { clearAll, insertActor, signIn } from './fixtures'

const { db, close } = connectDrizzle()
const market = createMarketRateRepository(db)
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

function figure(
  channel: MarketRate['channel'],
  value: string,
  date: string,
  side: MarketRate['side'] = 'bankBuys',
  currency: MarketRate['currency'] = 'RUB',
): MarketRate {
  return { channel, currency, date, side, scaled: parseRate(value) }
}

const official = (
  value: string,
  date: string,
  currency: CachedRate['currency'] = 'RUB',
): CachedRate => ({
  provider: 'cba',
  currency,
  date,
  scaled: parseRate(value),
  jump: false,
})

describe('курсы рынка в базе (MOL-137)', () => {
  it('файл пишется целиком, тот же день второй раз — новое число: таблица зеркалит источник', async () => {
    await market.upsert([figure('bankCash', '4.11', '2026-09-29')])
    await market.upsert([figure('bankCash', '4.12', '2026-09-29')])
    const stored = await db.select().from(marketRates)
    expect(stored).toHaveLength(1)
    expect(stored[0]?.scaled).toBe(4_120_000n)
  })

  it('отдаёт по каналу, валюте и стороне последний день окна — не позже дня и не раньше начала', async () => {
    await market.upsert([
      figure('bankCash', '4.10', '2026-09-21'),
      figure('bankCash', '4.11', '2026-09-28'),
      figure('bankCash', '4.12', '2026-09-30'),
      figure('bankCash', '4.30', '2026-09-28', 'bankSells'),
      figure('banksAll', '4.20', '2026-09-28'),
    ])
    const read = await market.between(['RUB'], '2026-09-22', '2026-09-29')
    expect(
      [...read].sort((a, b) => a.channel.localeCompare(b.channel) || a.side.localeCompare(b.side)),
    ).toEqual([
      figure('bankCash', '4.11', '2026-09-28'),
      figure('bankCash', '4.30', '2026-09-28', 'bankSells'),
      figure('banksAll', '4.20', '2026-09-28'),
    ])
    expect(await market.between(['RUB'], '2026-09-10', '2026-09-20')).toEqual([])
    expect(await market.between([], '2026-09-10', '2026-09-30')).toEqual([])
  })

  it('знает, докуда дошли обменники, и отдаёт последнее каждого ряда', async () => {
    expect(await market.through('exchanger')).toBeNull()
    await market.upsert([
      figure('exchanger', '4.15', '2026-09-14'),
      figure('exchanger', '4.16', '2026-09-20'),
    ])
    expect(await market.through('exchanger')).toBe('2026-09-20')
    expect(await market.latest()).toEqual([figure('exchanger', '4.16', '2026-09-20')])
  })

  it('база не пускает канал, сторону и валюту, которых нет, драм и ноль', async () => {
    const insert = (row: Record<string, unknown>) =>
      db.insert(marketRates).values({
        channel: 'bankCash',
        currency: 'RUB',
        rateDate: '2026-09-29',
        side: 'bankBuys',
        scaled: 1n,
        ...row,
      } as typeof marketRates.$inferInsert)
    await expect(insert({ channel: 'interbank' })).rejects.toThrow()
    await expect(insert({ side: 'buy' })).rejects.toThrow()
    await expect(insert({ currency: 'AMD' })).rejects.toThrow()
    await expect(insert({ currency: 'GEL' })).rejects.toThrow()
    await expect(insert({ scaled: 0n })).rejects.toThrow()
  })
})

describe('история официального курса в кеше (MOL-137)', () => {
  it('дописывает только недостающие дни и не трогает записанный', async () => {
    await rates.upsert([{ ...official('4.3000', '2026-09-14'), jump: true }])
    const written = await rates.insertMissing([
      official('4.2999', '2026-09-14'),
      official('4.3100', '2026-09-15'),
    ])
    expect(written).toBe(1)
    expect(await rates.between('cba', '2026-09-01', '2026-09-30')).toEqual([
      { ...official('4.3000', '2026-09-14'), jump: true },
      official('4.3100', '2026-09-15'),
    ])
  })
})

async function owner(): Promise<{ id: string; cookie: string }> {
  const id = await insertActor(db)
  return { id, cookie: await signIn(db, id) }
}

function overviewOf(json: unknown): ExchangesResponse {
  return exchangesResponseCodec.parse(json)
}

async function record(cookie: string, patch: Record<string, unknown>) {
  return app.inject({
    method: 'POST',
    url: '/exchanges',
    headers: { cookie },
    payload: {
      id: randomUUID(),
      given: { amount: '20000', currency: 'RUB' },
      received: { amount: '83200', currency: 'AMD' },
      exchangedOn: daysAgo(1),
      ...patch,
    },
  })
}

describe('«Обмен денег» против рынка (MOL-137)', () => {
  const day = daysAgo(1)

  beforeEach(async () => {
    await rates.upsert([official('4.3187', day)])
    await market.upsert([
      figure('bankCash', '4.110180', day),
      figure('bankNoncash', '4.221606', day),
      figure('bankCash', '4.347948', day, 'bankSells'),
      figure('bankNoncash', '4.361759', day, 'bankSells'),
    ])
  })

  it('сдал рубли — сравнение с лучшим, что давали банки за рубли в тот день, и ЦБ как было', async () => {
    const { cookie } = await owner()
    const [exchange] = overviewOf((await record(cookie, {})).json()).exchanges
    // Non-cash bought roubles dearer: 20 000 × 4.221606 = 84 432.12 ֏; the exchange gave 83 200.
    expect(exchange?.market).toMatchObject({
      best: {
        channel: 'bankNoncash',
        basis: 'bankNoncash',
        rate: { base: 'RUB', quote: 'AMD', scaled: 4_221_606n },
        difference: { minor: -123_212n, currency: 'AMD' },
      },
      own: null,
      exchangersPending: true,
    })
    expect(exchange?.official?.difference).toEqual({ minor: -317_400n, currency: 'AMD' })
  })

  it('свой канал, не лучший, — второй строкой: за наличные тот же обмен вышел лучше банков', async () => {
    const { cookie } = await owner()
    const [exchange] = overviewOf((await record(cookie, { channel: 'bankCash' })).json()).exchanges
    expect(exchange?.channel).toBe('bankCash')
    // 20 000 × 4.110180 = 82 203.60 ֏ in a bank for cash; the exchange gave 996.40 more.
    expect(exchange?.market?.own).toMatchObject({
      channel: 'bankCash',
      difference: { minor: 99_640n, currency: 'AMD' },
    })
  })

  it('купил доллары за драмы — сторона продажи, и лучший — дешевле всех', async () => {
    await market.upsert([
      figure('bankCash', '364.43', day, 'bankSells', 'USD'),
      figure('bankNoncash', '364.54', day, 'bankSells', 'USD'),
    ])
    const { cookie } = await owner()
    const response = await record(cookie, {
      given: { amount: '364800', currency: 'AMD' },
      received: { amount: '1000', currency: 'USD' },
    })
    const [exchange] = overviewOf(response.json()).exchanges
    // 364 800 ֏ at 364.43 buys 1 001.02 $; the exchange gave 1 000.
    expect(exchange?.market?.best).toMatchObject({
      channel: 'bankCash',
      difference: { minor: -102n, currency: 'USD' },
    })
  })

  it('у пары без драма рынка нет (В-4)', async () => {
    const { cookie } = await owner()
    const response = await record(cookie, {
      given: { amount: '251000', currency: 'RUB' },
      received: { amount: '2900', currency: 'USD' },
      channel: 'exchanger',
    })
    expect(overviewOf(response.json()).exchanges[0]?.market).toBeNull()
  })

  it('обменники дня пришли — строка пересчитана сама, и ждать больше нечего (В-3)', async () => {
    const { cookie } = await owner()
    await record(cookie, { channel: 'exchanger' })
    await market.upsert([figure('exchanger', '4.157339', day)])
    const read = await app.inject({ method: 'GET', url: '/exchanges', headers: { cookie } })
    expect(overviewOf(read.json()).exchanges[0]?.market).toMatchObject({
      best: { channel: 'bankNoncash' },
      own: { channel: 'exchanger', difference: { minor: 5_322n, currency: 'AMD' } },
      exchangersPending: false,
    })
  })

  it('до начала сбора безнал — это «все клиенты банков», а нал не подменяется (В-2)', async () => {
    const early = daysAgo(20)
    await market.upsert([figure('banksAll', '4.2095', early)])
    const { cookie } = await owner()
    const [exchange] = overviewOf(
      (await record(cookie, { exchangedOn: early, channel: 'bankCash' })).json(),
    ).exchanges
    expect(exchange?.market).toMatchObject({
      best: { channel: 'bankNoncash', basis: 'banksAll' },
      own: null,
    })
  })

  it('блок «Курсы по данным ЦБ РА»: ЦБ, каналы с датами, лучшее отмечено', async () => {
    const { cookie } = await owner()
    const read = await app.inject({ method: 'GET', url: '/exchanges', headers: { cookie } })
    const rouble = overviewOf(read.json()).marketToday.find((row) => row.currency === 'RUB')
    expect(rouble?.official?.scaled).toBe(4_318_700n)
    expect(rouble?.quotes.map((quote) => [quote.channel, quote.bestBuys, quote.bestSells])).toEqual(
      [
        ['bankCash', false, true],
        ['bankNoncash', true, false],
      ],
    )
  })

  it('канал: повтор без него — тот же обмен, правка без него его хранит, смена — новая версия', async () => {
    const { cookie } = await owner()
    const id = randomUUID()
    // As a screen older than the field sends it: no channel at all.
    const fields = {
      given: { amount: '20000', currency: 'RUB' },
      received: { amount: '83200', currency: 'AMD' },
      exchangedOn: day,
    }
    const older = { id, ...fields }
    const body = { ...older, channel: 'bankCash' }
    expect(
      (await app.inject({ method: 'POST', url: '/exchanges', headers: { cookie }, payload: body }))
        .statusCode,
    ).toBe(201)
    expect(
      (await app.inject({ method: 'POST', url: '/exchanges', headers: { cookie }, payload: older }))
        .statusCode,
    ).toBe(200)
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/exchanges',
          headers: { cookie },
          payload: { ...body, channel: 'exchanger' },
        })
      ).statusCode,
    ).toBe(409)

    const kept = await app.inject({
      method: 'PUT',
      url: `/exchanges/${id}`,
      headers: { cookie },
      payload: { ...fields, revision: 1 },
    })
    expect(kept.statusCode).toBe(200)
    expect(overviewOf(kept.json()).exchanges[0]).toMatchObject({ channel: 'bankCash', revision: 1 })

    const moved = await app.inject({
      method: 'PUT',
      url: `/exchanges/${id}`,
      headers: { cookie },
      payload: { ...fields, channel: null, revision: 1 },
    })
    const [amended] = overviewOf(moved.json()).exchanges
    expect(amended).toMatchObject({ channel: null, revision: 2 })
    expect(amended?.history).toMatchObject([{ channel: 'bankCash' }])
    expect(await db.select({ channel: exchangeRevisions.channel }).from(exchangeRevisions)).toEqual(
      [{ channel: 'bankCash' }],
    )
  })

  it('канал, которого нет, — отказ по полю', async () => {
    const { cookie } = await owner()
    const response = await record(cookie, { channel: 'interbank' })
    expect(response.statusCode).toBe(400)
  })
})
