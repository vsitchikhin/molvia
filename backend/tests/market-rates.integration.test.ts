import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { exchangesResponseCodec, parseRate, ratePeriodFrom, yerevanDate } from '@molvia/model'
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

describe('«Обмены против рынка» на «Обмене денег» (MOL-152, в MOL-159)', () => {
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

  const read = async (cookie: string) =>
    overviewOf((await app.inject({ method: 'GET', url: '/exchanges', headers: { cookie } })).json())

  it('рубли за наличные в банке — плюс против рынка, хотя против ЦБ РА был минус', async () => {
    const { cookie } = await owner()
    const answer = overviewOf(
      (await record(cookie, { channel: 'bankCash', note: 'Ардшинбанк' })).json(),
    )
    expect(answer.exchanges[0]?.official?.difference).toEqual({ minor: -317_400n, currency: 'AMD' })
    // 20 000 × 4.110180 = 82 203.60 ֏ for cash in a bank; the exchange gave 996.40 more.
    expect(answer.losses).toMatchObject({
      total: { minor: 99_640n, currency: 'AMD' },
      uncounted: 0,
      groups: [{ place: 'Ардшинбанк', count: 1, difference: { minor: 99_640n }, percent: 121 }],
    })
  })

  it('канал не назван — против лучшего курса дня; назван — против своего (В-3)', async () => {
    const { cookie } = await owner()
    await record(cookie, { note: 'ВТБ' })
    await record(cookie, { note: 'Ардшинбанк', channel: 'bankCash' })
    const { losses } = await read(cookie)
    // Non-cash bought roubles dearer: 84 432.12 ֏ against the 83 200 given — −1 232.12 ֏.
    expect(losses?.groups.map(({ place, difference }) => [place, difference.minor])).toEqual([
      ['ВТБ', -123_212n],
      ['Ардшинбанк', 99_640n],
    ])
    expect(losses?.total).toEqual({ minor: -23_572n, currency: 'AMD' })
  })

  it('пара без драма и день без цифр рынка — «без сравнения», ЦБ РА вместо рынка не встаёт', async () => {
    const { cookie } = await owner()
    await rates.upsert([official('4.3', daysAgo(40)), official('86', day, 'USD')])
    await record(cookie, {
      given: { amount: '251000', currency: 'RUB' },
      received: { amount: '2900', currency: 'USD' },
    })
    await record(cookie, { exchangedOn: daysAgo(40) })
    expect((await read(cookie)).losses).toBeNull()
    await record(cookie, {})
    expect((await read(cookie)).losses).toMatchObject({
      total: { minor: -123_212n },
      uncounted: 2,
    })
  })

  it('разница в рублях — в драмы по ЦБ своего дня; без свежего курса — «без сравнения»', async () => {
    const { cookie } = await owner()
    // 43 000 ֏ at the lowest the banks sold for, 4.347948, buy 9 889.72 ₽; the exchange gave 9 900.
    await record(cookie, {
      given: { amount: '43000', currency: 'AMD' },
      received: { amount: '9900', currency: 'RUB' },
    })
    const counted = (await read(cookie)).losses
    expect(counted?.uncounted).toBe(0)
    expect(counted?.total.currency).toBe('AMD')
    // 10.28 ₽ more, at 4.3187 ֏ a rouble.
    expect(counted?.total.minor).toBe(4_440n)

    const early = daysAgo(30)
    await market.upsert([figure('bankCash', '4.30', early, 'bankSells')])
    await record(cookie, {
      given: { amount: '43000', currency: 'AMD' },
      received: { amount: '9900', currency: 'RUB' },
      exchangedOn: early,
    })
    expect((await read(cookie)).losses?.uncounted).toBe(1)
  })

  it('обменники ещё не пришли — итог по банкам; пришли — пересчитан сам (Р-14)', async () => {
    const { cookie } = await owner()
    await record(cookie, { channel: 'exchanger' })
    expect((await read(cookie)).losses?.total.minor).toBe(-123_212n)
    await market.upsert([figure('exchanger', '4.157339', day)])
    expect((await read(cookie)).losses?.total.minor).toBe(5_322n)
  })

  it('обмен старше двенадцати месяцев в итог не входит и не назван', async () => {
    const { cookie } = await owner()
    const old = daysAgo(400)
    await rates.upsert([official('4.3', old)])
    await market.upsert([figure('bankCash', '4.11', old)])
    await record(cookie, { exchangedOn: old })
    expect((await read(cookie)).losses).toBeNull()
  })

  it('окно — тот же день год назад: первый день в итоге и на графике года, день до него — нигде (MOL-168, В-1 «б»)', async () => {
    const first = ratePeriodFrom(yerevanDate(new Date()), 12)
    const before = yerevanDate(
      new Date(Date.parse(`${first}T12:00:00+04:00`) - 24 * 60 * 60 * 1000),
    )
    await rates.upsert([official('4.3', first), official('4.3', before)])
    await market.upsert([
      figure('bankCash', '4.11', first),
      figure('bankCash', '4.11', before),
      figure('banksAll', '4.23', first),
    ])
    const { cookie } = await owner()
    await record(cookie, { exchangedOn: before, note: 'Вчера год назад' })
    expect((await read(cookie)).losses).toBeNull()
    await record(cookie, { exchangedOn: first, note: 'Год назад' })
    const answer = await read(cookie)
    expect(answer.losses?.groups.map(({ place }) => place)).toEqual(['Год назад'])
    const [point, ...rest] = answer.rateCharts?.pairs[0]?.periods[12].exchanges ?? []
    expect(rest).toEqual([])
    expect(point).toMatchObject({ day: first, percent: answer.losses?.groups[0]?.percent })
  })

  it('правка канала отдаёт новый итог: не назван — лучший курс, наличные в банке — свой (В-3)', async () => {
    const { cookie } = await owner()
    const id = randomUUID()
    await record(cookie, { id })
    expect((await read(cookie)).losses?.total.minor).toBe(-123_212n)
    const amended = await app.inject({
      method: 'PUT',
      url: `/exchanges/${id}`,
      headers: { cookie },
      payload: {
        given: { amount: '20000', currency: 'RUB' },
        received: { amount: '83200', currency: 'AMD' },
        exchangedOn: day,
        channel: 'bankCash',
        revision: 1,
      },
    })
    expect(amended.statusCode).toBe(200)
    expect(overviewOf(amended.json()).losses?.total.minor).toBe(99_640n)
  })

  it('удаление и «Вернуть» отдают новый итог; чужие обмены не видны', async () => {
    const { cookie } = await owner()
    const stranger = await owner()
    const id = randomUUID()
    await record(cookie, { id })
    const removed = await app.inject({
      method: 'DELETE',
      url: `/exchanges/${id}`,
      headers: { cookie },
    })
    expect(overviewOf(removed.json()).losses).toBeNull()
    const back = await app.inject({
      method: 'POST',
      url: `/exchanges/${id}/restore`,
      headers: { cookie },
    })
    expect(overviewOf(back.json()).losses?.total.minor).toBe(-123_212n)
    expect((await read(stranger.cookie)).losses).toBeNull()
  })
})

describe('«Курс рубля за 12 месяцев» на «Обмене денег» (MOL-161)', () => {
  const day = daysAgo(1)
  const weekAgo = daysAgo(8)

  beforeEach(async () => {
    await rates.upsert([official('4.3187', day)])
    await market.upsert([
      figure('bankCash', '4.110180', day),
      figure('bankNoncash', '4.221606', day),
      figure('banksAll', '4.230000', day),
      figure('banksAll', '4.250000', weekAgo),
      figure('banksAll', '4.600000', day, 'bankSells'),
    ])
  })

  const read = async (cookie: string) =>
    overviewOf((await app.inject({ method: 'GET', url: '/exchanges', headers: { cookie } })).json())

  it('линия — «все клиенты банков» своей стороны, нал и безнал на неё не попадают (Р-3)', async () => {
    const { cookie } = await owner()
    const { rateCharts } = await read(cookie)
    // No exchanges yet: the currency of conversion alone, a line with no points (Р-5).
    expect(rateCharts?.pairs.map(({ currency, side }) => [currency, side])).toEqual([
      ['RUB', 'bankBuys'],
    ])
    const [pair] = rateCharts?.pairs ?? []
    const figures = pair?.periods[12].steps.flatMap(({ rate }) => (rate ? [rate.scaled] : []))
    expect(new Set(figures)).toEqual(new Set([parseRate('4.25'), parseRate('4.23')]))
    expect(pair?.periods[12].steps.at(-1)?.day).toBe(yerevanDate(new Date()))
    expect(pair?.periods[12].exchanges).toEqual([])
  })

  it('точка в ответе записи сразу, и её процент — тот же, что в «Обменах против рынка» (В-1)', async () => {
    const { cookie } = await owner()
    const answer = overviewOf(
      (await record(cookie, { channel: 'bankCash', note: 'Ардшинбанк' })).json(),
    )
    const point = answer.rateCharts?.pairs[0]?.periods[12].exchanges[0]
    expect(point).toMatchObject({
      day,
      place: 'Ардшинбанк',
      percent: answer.losses?.groups[0]?.percent,
      market: { basis: 'bankCash' },
    })
    expect(point?.percent).toBe(121)
    expect(point?.rate.scaled).toBe(parseRate('4.16'))
    expect(point?.market?.rate.scaled).toBe(parseRate('4.11018'))
    // The mark ends under the point: cash bought cheaper than the exchange gave.
    expect(point?.market?.level).toBeLessThan(point?.level ?? 0)
  })

  it('месяц днями, полгода и год неделями — из одного ответа, процент точки везде тот же (MOL-168)', async () => {
    const { cookie } = await owner()
    const answer = overviewOf(
      (await record(cookie, { channel: 'bankCash', note: 'Ардшинбанк' })).json(),
    )
    const periods = answer.rateCharts?.pairs[0]?.periods
    expect([periods?.[1]?.step, periods?.[6]?.step, periods?.[12].step]).toEqual([
      'day',
      'week',
      'week',
    ])
    const today = yerevanDate(new Date())
    expect(periods?.[1]?.steps[0]?.day).toBe(ratePeriodFrom(today, 1))
    expect(periods?.[1]?.steps.at(-1)?.day).toBe(today)
    const percent = answer.losses?.groups[0]?.percent
    for (const period of [periods?.[1], periods?.[6], periods?.[12]]) {
      expect(period?.exchanges.map((point) => [point.day, point.percent])).toEqual([[day, percent]])
    }
  })

  it('купил рубли за драмы последним — линия стороны продажи, сданные рубли не рисуются (В-2)', async () => {
    const { cookie } = await owner()
    await record(cookie, { exchangedOn: weekAgo })
    await record(cookie, {
      given: { amount: '46000', currency: 'AMD' },
      received: { amount: '10000', currency: 'RUB' },
    })
    const [pair] = (await read(cookie)).rateCharts?.pairs ?? []
    expect(pair?.side).toBe('bankSells')
    expect(pair?.periods[12].exchanges.map(({ rate }) => rate.scaled)).toEqual([parseRate('4.6')])
  })

  it('купил рубли за драмы — процент точки тот же, что у места в «Обменах против рынка» (adversarial В)', async () => {
    await market.upsert([figure('bankCash', '4.350000', day, 'bankSells')])
    const { cookie } = await owner()
    const answer = overviewOf(
      (
        await record(cookie, {
          given: { amount: '437.91', currency: 'AMD' },
          received: { amount: '100', currency: 'RUB' },
          note: 'Ардшинбанк',
        })
      ).json(),
    )
    // −0,67 ₽ of 100,67 ₽ is −0,6655 %; in drams by the bank of the day, −2,89 ֏ of 434,76 ֏ — −0,66 %.
    expect(answer.exchanges[0]?.market?.best.difference).toEqual({ minor: -67n, currency: 'RUB' })
    const [group] = answer.losses?.groups ?? []
    const [point] = answer.rateCharts?.pairs[0]?.periods[12].exchanges ?? []
    expect(group?.percent).toBe(-66)
    expect(point?.percent).toBe(group?.percent)
  })

  it('чужие обмены не видны; удалённый уходит с графика, «Вернуть» его возвращает', async () => {
    const { cookie } = await owner()
    const stranger = await owner()
    const id = randomUUID()
    await record(cookie, { id })
    expect((await read(stranger.cookie)).rateCharts?.pairs[0]?.periods[12].exchanges).toEqual([])
    const removed = await app.inject({
      method: 'DELETE',
      url: `/exchanges/${id}`,
      headers: { cookie },
    })
    expect(overviewOf(removed.json()).rateCharts?.pairs[0]?.periods[12].exchanges).toEqual([])
    const back = await app.inject({
      method: 'POST',
      url: `/exchanges/${id}/restore`,
      headers: { cookie },
    })
    expect(
      overviewOf(back.json()).rateCharts?.pairs[0]?.periods[12].exchanges.map((one) => one.id),
    ).toEqual([id])
  })

  it('рынка за окно нет или считать не в чем — графика нет', async () => {
    const { cookie } = await owner()
    await db.delete(marketRates)
    expect((await read(cookie)).rateCharts).toBeNull()
    const dram = await insertActor(db, { incomeCurrency: 'AMD' })
    const answer = await app.inject({
      method: 'GET',
      url: '/exchanges',
      headers: { cookie: await signIn(db, dram) },
    })
    expect(overviewOf(answer.json()).rateCharts).toBeNull()
  })
})
