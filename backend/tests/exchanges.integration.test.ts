import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { ERROR, exchangesResponseCodec, parseRate, tripViewCodec, yerevanDate } from '@molvia/model'
import type { CachedRate, ExchangesResponse } from '@molvia/model'
import type { FastifyInstance } from 'fastify'
import { createRateRepository } from '@/db/rates-repository'
import { exchangeRevisions, exchanges, expenses } from '@/db/schema'
import { buildServer } from '@/server'
import { connectDrizzle } from './db'
import {
  clearAll,
  insertActor,
  insertItem,
  insertPlace,
  insertTrip,
  signIn,
  tripContext,
} from './fixtures'

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

const today = yerevanDate(new Date())
const daysAgo = (days: number): string =>
  yerevanDate(new Date(Date.now() - days * 24 * 60 * 60 * 1000))
const rub = (value: string, date: string): CachedRate => ({
  provider: 'cba',
  currency: 'RUB',
  date,
  scaled: parseRate(value),
  jump: false,
})

function payload(patch: Record<string, unknown> = {}) {
  return {
    id: randomUUID(),
    given: { amount: '20000', currency: 'RUB' },
    received: { amount: '100000', currency: 'AMD' },
    exchangedOn: daysAgo(10),
    ...patch,
  }
}

function overviewOf(json: unknown): ExchangesResponse {
  return exchangesResponseCodec.parse(json)
}

async function owner(): Promise<{ id: string; cookie: string }> {
  const id = await insertActor(db)
  return { id, cookie: await signIn(db, id) }
}

describe('«Обмен денег» через API (MOL-40)', () => {
  it('без обменов: свой источник, пара из настроек, кошелька и подсказки нет', async () => {
    const { cookie } = await owner()
    const response = await app.inject({ method: 'GET', url: '/exchanges', headers: { cookie } })

    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.json()).toEqual({
      preference: 'personal',
      pair: { base: 'RUB', quote: 'AMD' },
      wallet: null,
      costs: [],
      heldEstimates: [],
      baseSince: null,
      walletUnknown: null,
      exchanges: [],
      receipts: [],
    })
  })

  it('пример владельца: 20 000 → 100 000, потом 20 000 → 95 000 при остатке 20 000', async () => {
    const { cookie } = await owner()
    const first = await app.inject({
      method: 'POST',
      url: '/exchanges',
      headers: { cookie },
      payload: payload({ exchangedOn: daysAgo(10) }),
    })
    expect(first.statusCode).toBe(201)
    expect(first.json()).toMatchObject({ wallet: { rate: { rate: '5.000000' }, basis: 'last' } })

    const second = await app.inject({
      method: 'POST',
      url: '/exchanges',
      headers: { cookie },
      payload: payload({
        received: { amount: '95000', currency: 'AMD' },
        heldBefore: { amount: '20000', currency: 'AMD' },
        exchangedOn: daysAgo(2),
      }),
    })
    expect(second.statusCode).toBe(201)
    expect(second.json()).toMatchObject({
      wallet: {
        rate: { base: 'RUB', quote: 'AMD', rate: '4.791667', source: 'personal' },
        basis: 'weighted',
        estimated: false,
      },
      costs: [],
      // Nothing spent since: what the last exchange left, and nothing else is known.
      heldEstimates: [
        { held: { amount: '115000.00', currency: 'AMD' }, whole: true, from: 'exchange' },
      ],
    })
    const list = overviewOf(second.json()).exchanges
    expect(list.map((exchange) => exchange.exchangedOn)).toEqual([daysAgo(2), daysAgo(10)])
  })

  it('сравнивает каждый обмен с ЦБ РА на его день, со знаком', async () => {
    await rates.upsert([rub('4.3123', daysAgo(11)), rub('5.5000', daysAgo(3))])
    const { cookie } = await owner()
    await app.inject({ method: 'POST', url: '/exchanges', headers: { cookie }, payload: payload() })
    const response = await app.inject({
      method: 'POST',
      url: '/exchanges',
      headers: { cookie },
      payload: payload({ exchangedOn: daysAgo(2) }),
    })

    const { exchanges: list } = overviewOf(response.json())
    // 20 000 × 5.5 = 110 000 ֏ at the bank; the exchanger gave 100 000.
    expect(list[0]?.official).toMatchObject({
      provider: 'cba',
      difference: { minor: -1_000_000n, currency: 'AMD' },
    })
    // 20 000 × 4.3123 = 86 246 ֏; the exchanger gave 13 754 more.
    expect(list[1]?.official?.difference).toEqual({ minor: 1_375_400n, currency: 'AMD' })
    expect(list[1]?.official?.rate.scaled).toBe(parseRate('4.3123'))
  })

  it('без курса ЦБ на тот день обмен записан, но без сравнения', async () => {
    await rates.upsert([rub('4.3123', daysAgo(1))])
    const { cookie } = await owner()
    const response = await app.inject({
      method: 'POST',
      url: '/exchanges',
      headers: { cookie },
      payload: payload(),
    })
    expect(response.statusCode).toBe(201)
    expect(overviewOf(response.json()).exchanges[0]?.official).toBeNull()
  })

  it('повтор тем же id — 200 и один обмен', async () => {
    const { cookie } = await owner()
    const body = payload()
    await app.inject({ method: 'POST', url: '/exchanges', headers: { cookie }, payload: body })
    const again = await app.inject({
      method: 'POST',
      url: '/exchanges',
      headers: { cookie },
      payload: body,
    })
    expect(again.statusCode).toBe(200)
    expect(await db.select().from(exchanges)).toHaveLength(1)
  })

  it('тот же id с исправленной суммой — 409, а не «сохранено» с прежней (В-6, А2)', async () => {
    const { cookie } = await owner()
    const typo = payload({ received: { amount: '1000000', currency: 'AMD' } })
    await app.inject({ method: 'POST', url: '/exchanges', headers: { cookie }, payload: typo })
    const corrected = await app.inject({
      method: 'POST',
      url: '/exchanges',
      headers: { cookie },
      payload: { ...typo, received: { amount: '100000', currency: 'AMD' } },
    })
    expect(corrected.statusCode).toBe(409)
    expect(corrected.json()).toEqual({ code: ERROR.CONFLICT })
  })

  it('завтрашний день — отказ; сегодняшний — можно', async () => {
    const { cookie } = await owner()
    const tomorrow = yerevanDate(new Date(Date.now() + 24 * 60 * 60 * 1000))
    const future = await app.inject({
      method: 'POST',
      url: '/exchanges',
      headers: { cookie },
      payload: payload({ exchangedOn: tomorrow }),
    })
    expect(future.statusCode).toBe(400)
    expect(future.json()).toEqual({ code: ERROR.EXCHANGE_IN_FUTURE })

    const now = await app.inject({
      method: 'POST',
      url: '/exchanges',
      headers: { cookie },
      payload: payload({ exchangedOn: today }),
    })
    expect(now.statusCode).toBe(201)
  })

  it('тело чужого формата — 400 до записи', async () => {
    const { cookie } = await owner()
    for (const bad of [
      payload({ actorId: randomUUID() }),
      payload({ received: { amount: '5', currency: 'RUB' } }),
      payload({ given: { amount: '0', currency: 'RUB' } }),
      payload({ exchangedOn: '2026-02-31' }),
    ]) {
      const response = await app.inject({
        method: 'POST',
        url: '/exchanges',
        headers: { cookie },
        payload: bad,
      })
      expect(response.statusCode).toBe(400)
    }
    expect(await db.select().from(exchanges)).toEqual([])
  })

  it('чужой обмен: не виден, не удаляется, и его id не занять', async () => {
    const stranger = await owner()
    const me = await owner()
    const body = payload()
    await app.inject({
      method: 'POST',
      url: '/exchanges',
      headers: { cookie: stranger.cookie },
      payload: body,
    })

    const mine = await app.inject({
      method: 'GET',
      url: '/exchanges',
      headers: { cookie: me.cookie },
    })
    expect(mine.json()).toMatchObject({ exchanges: [] })

    const taken = await app.inject({
      method: 'POST',
      url: '/exchanges',
      headers: { cookie: me.cookie },
      payload: body,
    })
    expect(taken.statusCode).toBe(409)

    for (const id of [body.id, randomUUID(), 'not-a-uuid']) {
      const removed = await app.inject({
        method: 'DELETE',
        url: `/exchanges/${id}`,
        headers: { cookie: me.cookie },
      })
      expect(removed.statusCode, id).toBe(200)
    }
    expect(await db.select().from(exchanges)).toHaveLength(1)
  })

  it('удаление своего пересчитывает кошелёк', async () => {
    const { cookie } = await owner()
    await app.inject({ method: 'POST', url: '/exchanges', headers: { cookie }, payload: payload() })
    const second = payload({
      received: { amount: '95000', currency: 'AMD' },
      heldBefore: { amount: '20000', currency: 'AMD' },
      exchangedOn: daysAgo(2),
    })
    await app.inject({ method: 'POST', url: '/exchanges', headers: { cookie }, payload: second })

    const response = await app.inject({
      method: 'DELETE',
      url: `/exchanges/${second.id.toUpperCase()}`,
      headers: { cookie },
    })
    expect(response.json()).toMatchObject({ wallet: { rate: { rate: '5.000000' }, basis: 'last' } })
  })

  it('источник переключается и держится', async () => {
    const { cookie } = await owner()
    const response = await app.inject({
      method: 'PUT',
      url: '/actors/me/rate-preference',
      headers: { cookie },
      payload: { preference: 'official' },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ preference: 'official' })
    const read = await app.inject({ method: 'GET', url: '/exchanges', headers: { cookie } })
    expect(read.json()).toMatchObject({ preference: 'official' })

    const bad = await app.inject({
      method: 'PUT',
      url: '/actors/me/rate-preference',
      headers: { cookie },
      payload: { preference: 'fallback' },
    })
    expect(bad.statusCode).toBe(400)
  })

  it('без сессии — 401 на каждой ручке', async () => {
    for (const [method, url] of [
      ['GET', '/exchanges'],
      ['POST', '/exchanges'],
      ['DELETE', `/exchanges/${randomUUID()}`],
      ['PUT', '/actors/me/rate-preference'],
    ] as const) {
      const response = await app.inject({ method, url, payload: {} })
      expect(response.statusCode, url).toBe(401)
    }
  })

  it('одна валюта в настройках — пары нет, но обмены показываются', async () => {
    const id = await insertActor(db, { incomeCurrency: 'AMD' })
    const cookie = await signIn(db, id)
    const response = await app.inject({
      method: 'POST',
      url: '/exchanges',
      headers: { cookie },
      payload: payload(),
    })
    expect(response.json()).toMatchObject({ pair: null, wallet: null, costs: [] })
    expect(overviewOf(response.json()).exchanges).toHaveLength(1)
  })
})

describe('«Обмен денег»: правки ревью', () => {
  it('А1: остаток у предела int8 — обмен записан, экран отвечает 200, подсказки нет', async () => {
    const { cookie } = await owner()
    await app.inject({ method: 'POST', url: '/exchanges', headers: { cookie }, payload: payload() })
    const absurd = await app.inject({
      method: 'POST',
      url: '/exchanges',
      headers: { cookie },
      payload: payload({
        exchangedOn: daysAgo(2),
        heldBefore: { amount: '92233720368547758.07', currency: 'AMD' },
      }),
    })
    expect(absurd.statusCode).toBe(201)
    expect(overviewOf(absurd.json()).heldEstimates).toEqual([])
    const read = await app.inject({ method: 'GET', url: '/exchanges', headers: { cookie } })
    expect(read.statusCode).toBe(200)
  })

  it('А3: обмен, чей курс вне полосы, отклоняется и не записывается', async () => {
    const { cookie } = await owner()
    const response = await app.inject({
      method: 'POST',
      url: '/exchanges',
      headers: { cookie },
      payload: payload({
        given: { amount: '1', currency: 'RUB' },
        received: { amount: '5000000', currency: 'AMD' },
      }),
    })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ code: ERROR.INVALID_RATE, details: 'received' })
    expect(await db.select().from(exchanges)).toEqual([])
  })

  it('А4: покупка, дописанная в поход, закрытый до обмена, остаток не уменьшает', async () => {
    const me = await owner()
    const item = await insertItem(db)
    const place = await insertPlace(db)
    const closed = await insertTrip(db, {
      actorId: me.id,
      placeId: place,
      startedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
      finishedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
    })
    const open = await insertTrip(db, { actorId: me.id, placeId: place })
    await app.inject({
      method: 'POST',
      url: '/exchanges',
      headers: { cookie: me.cookie },
      payload: payload({ exchangedOn: today, heldBefore: { amount: '20000', currency: 'AMD' } }),
    })
    const later = new Date(Date.now() + 1000)
    await db.insert(expenses).values([
      // The sauce found at home, written into last week's trip after the exchange.
      {
        id: randomUUID(),
        tripId: closed,
        itemId: item,
        amountMinor: 3_000_000n,
        amountCurrency: 'AMD',
        createdAt: later,
      },
      // A purchase in the trip open across the exchange: paid from what is at hand.
      {
        id: randomUUID(),
        tripId: open,
        itemId: item,
        amountMinor: 1_000_000n,
        amountCurrency: 'AMD',
        createdAt: later,
      },
    ])
    const read = await app.inject({
      method: 'GET',
      url: '/exchanges',
      headers: { cookie: me.cookie },
    })
    expect(overviewOf(read.json()).heldEstimates[0]?.held).toEqual({
      minor: 11_000_000n,
      currency: 'AMD',
    })
  })

  it('С-5: курс ЦБ со скачком — сравнение с прежним, если он есть', async () => {
    await rates.upsert([
      rub('4.3000', daysAgo(15)),
      rub('4.3100', daysAgo(14)),
      rub('4.3200', daysAgo(13)),
      { ...rub('431.23', daysAgo(11)), jump: true },
    ])
    const { cookie } = await owner()
    const response = await app.inject({
      method: 'POST',
      url: '/exchanges',
      headers: { cookie },
      payload: payload(),
    })
    const [row] = overviewOf(response.json()).exchanges
    expect(row?.official?.rate.scaled).toBe(parseRate('4.32'))
    expect(row?.officialDoubtful).toBe(false)
  })

  it('С-5: курс ЦБ со скачком и без прежнего — сравнения нет, «под сомнением»', async () => {
    await rates.upsert([
      rub('4.3000', daysAgo(22)),
      rub('4.3100', daysAgo(21)),
      rub('4.3200', daysAgo(20)),
      { ...rub('431.23', daysAgo(11)), jump: true },
    ])
    const { cookie } = await owner()
    const response = await app.inject({
      method: 'POST',
      url: '/exchanges',
      headers: { cookie },
      payload: payload(),
    })
    const [row] = overviewOf(response.json()).exchanges
    expect(row?.official).toBeNull()
    expect(row?.officialDoubtful).toBe(true)
  })
})

describe('«Обмен денег»: правки второго захода', () => {
  it('В1: «Вернуть» возвращает обмен на его место в дне — и курс тоже', async () => {
    const { cookie } = await owner()
    const morning = payload({ exchangedOn: daysAgo(1) })
    await app.inject({ method: 'POST', url: '/exchanges', headers: { cookie }, payload: morning })
    await app.inject({
      method: 'POST',
      url: '/exchanges',
      headers: { cookie },
      payload: payload({
        exchangedOn: daysAgo(1),
        received: { amount: '95000', currency: 'AMD' },
        heldBefore: { amount: '20000', currency: 'AMD' },
      }),
    })
    await app.inject({ method: 'DELETE', url: `/exchanges/${morning.id}`, headers: { cookie } })
    const back = await app.inject({
      method: 'POST',
      url: `/exchanges/${morning.id}/restore`,
      headers: { cookie },
    })
    expect(back.statusCode).toBe(200)
    expect(back.json()).toMatchObject({
      wallet: { rate: { rate: '4.791667' }, basis: 'weighted' },
    })
  })

  it('«Вернуть» после любого другого запроса — 404: удаление стало окончательным', async () => {
    const { cookie } = await owner()
    const one = payload()
    await app.inject({ method: 'POST', url: '/exchanges', headers: { cookie }, payload: one })
    await app.inject({ method: 'DELETE', url: `/exchanges/${one.id}`, headers: { cookie } })
    await app.inject({ method: 'GET', url: '/exchanges', headers: { cookie } })
    const late = await app.inject({
      method: 'POST',
      url: `/exchanges/${one.id}/restore`,
      headers: { cookie },
    })
    expect(late.statusCode).toBe(404)
    expect(await db.select().from(exchanges)).toEqual([])
  })

  it('чужой обмен «Вернуть» нельзя — 404, как отсутствующий', async () => {
    const stranger = await owner()
    const me = await owner()
    const theirs = payload()
    await app.inject({
      method: 'POST',
      url: '/exchanges',
      headers: { cookie: stranger.cookie },
      payload: theirs,
    })
    await app.inject({
      method: 'DELETE',
      url: `/exchanges/${theirs.id}`,
      headers: { cookie: stranger.cookie },
    })
    const response = await app.inject({
      method: 'POST',
      url: `/exchanges/${theirs.id}/restore`,
      headers: { cookie: me.cookie },
    })
    expect(response.statusCode).toBe(404)
  })

  it('В3: обмен, записанный задним числом, видит траты после своего дня', async () => {
    const me = await owner()
    const item = await insertItem(db)
    const place = await insertPlace(db)
    const trip = await insertTrip(db, {
      actorId: me.id,
      placeId: place,
      startedAt: new Date(Date.now() - 60 * 60 * 1000),
    })
    // Bought this morning, and the exchange of three days ago written only after it.
    await db.insert(expenses).values({
      id: randomUUID(),
      tripId: trip,
      itemId: item,
      amountMinor: 3_000_000n,
      amountCurrency: 'AMD',
      createdAt: new Date(Date.now() - 30 * 60 * 1000),
    })
    const response = await app.inject({
      method: 'POST',
      url: '/exchanges',
      headers: { cookie: me.cookie },
      payload: payload({ exchangedOn: daysAgo(3) }),
    })
    expect(overviewOf(response.json()).heldEstimates[0]?.held).toEqual({
      minor: 7_000_000n,
      currency: 'AMD',
    })
  })
})

describe('«Обмен денег»: правки третьего захода', () => {
  it('Д1: «Вернуть» ещё раз после потерянного ответа — снова 200, обмен на месте', async () => {
    const { cookie } = await owner()
    const one = payload()
    await app.inject({ method: 'POST', url: '/exchanges', headers: { cookie }, payload: one })
    await app.inject({ method: 'DELETE', url: `/exchanges/${one.id}`, headers: { cookie } })
    const url = `/exchanges/${one.id}/restore`
    expect((await app.inject({ method: 'POST', url, headers: { cookie } })).statusCode).toBe(200)
    const again = await app.inject({ method: 'POST', url, headers: { cookie } })
    expect(again.statusCode).toBe(200)
    expect(overviewOf(again.json()).exchanges.map((row) => row.id)).toEqual([one.id])
  })

  it('Д2: удаление ещё раз после потерянного ответа не делает обмен окончательным', async () => {
    const { cookie } = await owner()
    const one = payload()
    await app.inject({ method: 'POST', url: '/exchanges', headers: { cookie }, payload: one })
    await app.inject({ method: 'DELETE', url: `/exchanges/${one.id}`, headers: { cookie } })
    await app.inject({ method: 'DELETE', url: `/exchanges/${one.id}`, headers: { cookie } })
    const back = await app.inject({
      method: 'POST',
      url: `/exchanges/${one.id}/restore`,
      headers: { cookie },
    })
    expect(back.statusCode).toBe(200)
  })
})

describe('свой курс в походе (MOL-40)', () => {
  async function start(owner: { id: string; cookie: string }, id = randomUUID()) {
    const response = await app.inject({
      method: 'POST',
      url: '/trips',
      headers: { cookie: owner.cookie },
      payload: {
        id,
        context: await tripContext(db, owner.id),
        place: { kind: 'store', name: 'Ереван Сити' },
      },
    })
    return { status: response.statusCode, trip: tripViewCodec.parse(response.json()) }
  }

  it('новый поход берёт курс кошелька: source personal, без издателя и без «устарел»', async () => {
    await rates.upsert([rub('4.3123', daysAgo(1))])
    const me = await owner()
    await app.inject({
      method: 'POST',
      url: '/exchanges',
      headers: { cookie: me.cookie },
      payload: payload({ received: { amount: '95000', currency: 'AMD' } }),
    })

    const { status, trip } = await start(me)
    expect(status).toBe(201)
    expect(trip.rate).toMatchObject({ base: 'RUB', quote: 'AMD', scaled: parseRate('4.75') })
    expect(trip.rate?.source).toBe('personal')
    expect(trip.rateProvider).toBeNull()
    expect(trip.rateStale).toBe(false)
    expect(trip.rateJump).toBeNull()
  })

  it('«официальный» — и поход берёт ЦБ РА при любых обменах', async () => {
    await rates.upsert([rub('4.3123', daysAgo(1))])
    const me = await owner()
    await app.inject({
      method: 'POST',
      url: '/exchanges',
      headers: { cookie: me.cookie },
      payload: payload(),
    })
    await app.inject({
      method: 'PUT',
      url: '/actors/me/rate-preference',
      headers: { cookie: me.cookie },
      payload: { preference: 'official' },
    })

    const { trip } = await start(me)
    expect(trip.rate?.source).toBe('official')
    expect(trip.rateProvider).toBe('cba')
  })

  it('обмен после старта не трогает открытый поход, и повтор старта — прежний снимок', async () => {
    const me = await owner()
    await app.inject({
      method: 'POST',
      url: '/exchanges',
      headers: { cookie: me.cookie },
      payload: payload(),
    })
    const id = randomUUID()
    const first = await start(me, id)
    expect(first.trip.rate?.scaled).toBe(parseRate('5'))

    await app.inject({
      method: 'POST',
      url: '/exchanges',
      headers: { cookie: me.cookie },
      payload: payload({ received: { amount: '80000', currency: 'AMD' }, exchangedOn: today }),
    })
    const repeat = await start(me, id)
    expect(repeat.status).toBe(200)
    expect(repeat.trip.rate?.scaled).toBe(parseRate('5'))

    const current = await app.inject({
      method: 'GET',
      url: '/trips/current',
      headers: { cookie: me.cookie },
    })
    expect(current.json()).toMatchObject({
      trip: { rate: { rate: '5.000000', source: 'personal' } },
    })
  })
})

describe('стоимость валют (MOL-42)', () => {
  const usd = (value: string, date: string): CachedRate => ({
    ...rub(value, date),
    currency: 'USD',
  })

  async function record(me: { cookie: string }, patch: Record<string, unknown>) {
    const response = await app.inject({
      method: 'POST',
      url: '/exchanges',
      headers: { cookie: me.cookie },
      payload: payload(patch),
    })
    expect(response.statusCode).toBe(201)
    return overviewOf(response.json())
  }

  async function start(me: { id: string; cookie: string }) {
    const response = await app.inject({
      method: 'POST',
      url: '/trips',
      headers: { cookie: me.cookie },
      payload: {
        id: randomUUID(),
        context: await tripContext(db, me.id),
        place: { kind: 'store', name: 'Ереван Сити' },
      },
    })
    expect(response.statusCode).toBe(201)
    return tripViewCodec.parse(response.json())
  }

  it('цепочка RUB → USD → AMD: цена долларов переходит в драмы, и поход её берёт', async () => {
    const me = await owner()
    await record(me, {
      received: { amount: '224.63', currency: 'USD' },
      exchangedOn: daysAgo(10),
    })
    const overview = await record(me, {
      given: { amount: '100', currency: 'USD' },
      received: { amount: '36150', currency: 'AMD' },
      exchangedOn: daysAgo(5),
    })

    expect(overview.wallet).toMatchObject({ basis: 'last', estimated: false })
    expect(overview.wallet?.rate.scaled).toBe(4_060_187n)
    // One dollar cost 20000 / 224.63 roubles.
    expect(overview.costs.map(({ rate }) => [rate.base, rate.quote, rate.scaled])).toEqual([
      ['USD', 'RUB', 89_035_302n],
    ])
    // Handing 100 $ over for drams leaves 124.63 $; the drams are all still held.
    expect(overview.heldEstimates.map(({ held }) => held)).toEqual(
      expect.arrayContaining([
        { minor: 12_463n, currency: 'USD' },
        { minor: 3_615_000n, currency: 'AMD' },
      ]),
    )

    const trip = await start(me)
    expect(trip.rate).toMatchObject({ source: 'personal', scaled: 4_060_187n })
  })

  it('привезённые доллары — по ЦБ РА на день обмена, с пометкой; поход берёт то же число', async () => {
    await rates.upsert([rub('4.3123', daysAgo(6)), usd('363.44', daysAgo(6))])
    const me = await owner()
    const overview = await record(me, {
      given: { amount: '600', currency: 'USD' },
      received: { amount: '217200', currency: 'AMD' },
      exchangedOn: daysAgo(5),
    })
    expect(overview.wallet).toMatchObject({ basis: 'last', estimated: true })
    expect(overview.wallet?.rate.scaled).toBe(4_295_130n)
    // The dollars themselves were never bought: they have no cost of their own to list.
    expect(overview.costs).toEqual([])

    const trip = await start(me)
    expect(trip.rate).toMatchObject({ source: 'personal', scaled: 4_295_130n })
  })

  it('без курса ЦБ на тот день стоимость неизвестна, и поход берёт официальный', async () => {
    await rates.upsert([rub('4.3123', daysAgo(1))])
    const me = await owner()
    const overview = await record(me, {
      given: { amount: '600', currency: 'USD' },
      received: { amount: '217200', currency: 'AMD' },
      exchangedOn: daysAgo(5),
    })
    expect(overview.wallet).toBeNull()
    // Said as it is, not «no exchanges yet» above the list (С-4).
    expect(overview.walletUnknown).toEqual({
      on: daysAgo(5),
      given: 'USD',
      reason: 'noRate',
    })
    expect((await start(me)).rate?.source).toBe('official')
  })

  it('курс ЦБ давностью больше недели оценкой не служит: стоимость неизвестна (Ж3)', async () => {
    await rates.upsert([rub('4.3123', daysAgo(70)), usd('363.44', daysAgo(70))])
    const me = await owner()
    const overview = await record(me, {
      given: { amount: '600', currency: 'USD' },
      received: { amount: '217200', currency: 'AMD' },
      exchangedOn: daysAgo(5),
    })
    expect(overview.wallet).toBeNull()
    expect(overview.walletUnknown).toMatchObject({ given: 'USD' })
    const trip = await start(me)
    expect(trip.rate?.source).toBe('official')
    expect(trip.rateStale).toBe(true)
  })

  it('обратный обмен курс не двигает и уменьшает подсказку остатка', async () => {
    const me = await owner()
    await record(me, {})
    const overview = await record(me, {
      given: { amount: '10000', currency: 'AMD' },
      received: { amount: '2250', currency: 'RUB' },
      exchangedOn: daysAgo(3),
    })
    expect(overview.wallet?.rate.scaled).toBe(parseRate('5'))
    expect(overview.heldEstimates).toEqual([
      { held: { minor: 9_000_000n, currency: 'AMD' }, whole: false, from: 'exchange' },
    ])
  })

  it('смена валюты действует вперёд: прошлые рубли в долларовый курс не входят, прошлые доллары входят (В-2, Л1)', async () => {
    // A rate to value the roubles by is there: they are left out by the change, not by its absence.
    await rates.upsert([rub('4.3123', daysAgo(11)), usd('363.44', daysAgo(11))])
    const me = await owner()
    // The default RUB, one exchange of roubles left over from home, then dollars.
    await record(me, { exchangedOn: daysAgo(10) })
    await record(me, {
      given: { amount: '100', currency: 'USD' },
      received: { amount: '38000', currency: 'AMD' },
      heldBefore: { amount: '100000', currency: 'AMD' },
      exchangedOn: daysAgo(3),
    })
    const before = await tripContext(db, me.id)
    const settings = await app.inject({
      method: 'PUT',
      url: '/actors/me/settings',
      headers: { cookie: me.cookie },
      payload: { previous: before, settings: { ...before, incomeCurrency: 'USD' } },
    })
    expect(settings.statusCode).toBe(200)

    const read = await app.inject({
      method: 'GET',
      url: '/exchanges',
      headers: { cookie: me.cookie },
    })
    const overview = overviewOf(read.json())
    expect(overview).toMatchObject({ pair: { base: 'USD', quote: 'AMD' }, baseSince: today })
    // The dollars count as they were paid; the roubles do not come back valued by the bank, so
    // the drams held before the dollar exchange have no cost to weigh by.
    expect(overview.wallet).toMatchObject({ basis: 'last', estimated: false })
    expect(overview.wallet?.rate.scaled).toBe(parseRate('380'))
    expect(overview.exchanges).toHaveLength(2)

    const after = await record(me, {
      given: { amount: '100', currency: 'USD' },
      received: { amount: '36150', currency: 'AMD' },
      heldBefore: { amount: '38000', currency: 'AMD' },
      exchangedOn: today,
    })
    expect(after.wallet).toMatchObject({ basis: 'weighted', estimated: false })
    expect(after.wallet?.rate.scaled).toBe(parseRate('370.75'))
    expect((await start(me)).rate).toMatchObject({ source: 'personal', base: 'USD' })
  })
})

describe('смена валюты пересчёта: старый счёт и цепочки (MOL-42, раунд 3)', () => {
  async function record(me: { cookie: string }, patch: Record<string, unknown>) {
    const response = await app.inject({
      method: 'POST',
      url: '/exchanges',
      headers: { cookie: me.cookie },
      payload: payload(patch),
    })
    expect(response.statusCode).toBe(201)
    return overviewOf(response.json())
  }

  async function choose(me: { id: string; cookie: string }, incomeCurrency: 'USD' | 'EUR') {
    const before = await tripContext(db, me.id)
    const response = await app.inject({
      method: 'PUT',
      url: '/actors/me/settings',
      headers: { cookie: me.cookie },
      payload: { previous: before, settings: { ...before, incomeCurrency } },
    })
    expect(response.statusCode).toBe(200)
  }

  it('драмы за рубли до смены не взвешиваются по цене долларовых, и шторке сказано не спрашивать (М1)', async () => {
    const me = await owner()
    await record(me, {
      given: { amount: '100', currency: 'USD' },
      received: { amount: '38000', currency: 'AMD' },
      exchangedOn: daysAgo(12),
    })
    await record(me, {
      heldBefore: { amount: '38000', currency: 'AMD' },
      exchangedOn: daysAgo(10),
    })
    await choose(me, 'USD')

    // The rouble drams have no price in dollars: said as the old reckoning, not «no exchanges»
    // and not «no bank rate» (Н1). The dollar exchange before them does not make the sheet ask
    // for what is held: the rouble one after it took the price away (Н2).
    const read = await app.inject({
      method: 'GET',
      url: '/exchanges',
      headers: { cookie: me.cookie },
    })
    expect(overviewOf(read.json())).toMatchObject({
      wallet: null,
      walletUnknown: { on: daysAgo(10), given: 'RUB', reason: 'oldReckoning' },
    })

    // Everything held, the rouble drams too — what the sheet's hint says.
    const overview = await record(me, {
      given: { amount: '100', currency: 'USD' },
      received: { amount: '36150', currency: 'AMD' },
      heldBefore: { amount: '138000', currency: 'AMD' },
      exchangedOn: today,
    })
    expect(overview.wallet).toMatchObject({ basis: 'last', rate: { scaled: parseRate('361.5') } })
    const byDay = new Map(overview.receipts.map((row) => [row.on, row.priced]))
    expect(byDay).toEqual(
      new Map([
        [today, true],
        [daysAgo(10), false],
        [daysAgo(12), true],
      ]),
    )
  })

  it('цепочка EUR → USD → AMD до смены входит целиком: пересчитывать в ней нечего (П-1)', async () => {
    const me = await owner()
    await record(me, {
      given: { amount: '1000', currency: 'EUR' },
      received: { amount: '1080', currency: 'USD' },
      exchangedOn: daysAgo(20),
    })
    await record(me, {
      given: { amount: '500', currency: 'USD' },
      received: { amount: '190000', currency: 'AMD' },
      exchangedOn: daysAgo(19),
    })
    await choose(me, 'EUR')
    const read = await app.inject({
      method: 'GET',
      url: '/exchanges',
      headers: { cookie: me.cookie },
    })
    const overview = overviewOf(read.json())
    expect(overview.wallet).toMatchObject({ estimated: false, rate: { scaled: 410_400_000n } })
    expect(overview.receipts.every((row) => row.priced)).toBe(true)
  })
})

describe('правка обмена с историей (MOL-42)', () => {
  async function recorded(me: { cookie: string }, patch: Record<string, unknown> = {}) {
    const body = payload(patch)
    const response = await app.inject({
      method: 'POST',
      url: '/exchanges',
      headers: { cookie: me.cookie },
      payload: body,
    })
    expect(response.statusCode).toBe(201)
    return body
  }

  function amend(cookie: string, id: string, patch: Record<string, unknown>) {
    return app.inject({
      method: 'PUT',
      url: `/exchanges/${id}`,
      headers: { cookie },
      payload: {
        given: { amount: '20000', currency: 'RUB' },
        received: { amount: '100000', currency: 'AMD' },
        exchangedOn: daysAgo(10),
        revision: 1,
        ...patch,
      },
    })
  }

  it('правит на месте, прежняя версия — в истории, место в дне и курс — по новой', async () => {
    const me = await owner()
    const { id } = await recorded(me, { note: 'ВТБ банкомат' })
    const [before] = await db.select().from(exchanges)

    const response = await amend(me.cookie, id, {
      received: { amount: '95000', currency: 'AMD' },
      note: 'ВТБ банкомат (озон)',
    })
    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store')
    const overview = overviewOf(response.json())
    const [row] = overview.exchanges
    expect(row).toMatchObject({
      received: { minor: 9_500_000n, currency: 'AMD' },
      note: 'ВТБ банкомат (озон)',
      revision: 2,
    })
    expect(row?.amendedAt).toBeInstanceOf(Date)
    expect(row?.history).toEqual([
      {
        given: { minor: 2_000_000n, currency: 'RUB' },
        received: { minor: 10_000_000n, currency: 'AMD' },
        exchangedOn: daysAgo(10),
        heldBefore: null,
        note: 'ВТБ банкомат',
        replacedAt: row?.amendedAt,
      },
    ])
    expect(overview.wallet?.rate.scaled).toBe(parseRate('4.75'))
    const [after] = await db.select().from(exchanges)
    expect(after?.createdAt).toEqual(before?.createdAt)
  })

  it('повтор той же правки после потерянного ответа — 200 и ни одной лишней версии', async () => {
    const me = await owner()
    const { id } = await recorded(me)
    const patch = { received: { amount: '95000', currency: 'AMD' } }
    expect((await amend(me.cookie, id, patch)).statusCode).toBe(200)
    const again = await amend(me.cookie, id, patch)
    expect(again.statusCode).toBe(200)
    expect(overviewOf(again.json()).exchanges[0]).toMatchObject({ revision: 2 })
    expect(overviewOf(again.json()).exchanges[0]?.history).toHaveLength(1)
    // Nothing changed at all: no version is kept for it either.
    const same = await amend(me.cookie, id, { ...patch, revision: 2 })
    expect(overviewOf(same.json()).exchanges[0]?.history).toHaveLength(1)
  })

  it('два телефона правят одну версию — второй получает 409, а не молча затирает', async () => {
    const me = await owner()
    const second = await signIn(db, me.id)
    const { id } = await recorded(me)
    const replies = await Promise.all([
      amend(me.cookie, id, { received: { amount: '95000', currency: 'AMD' } }),
      amend(second, id, { received: { amount: '96000', currency: 'AMD' } }),
    ])
    expect(replies.map((reply) => reply.statusCode).sort()).toEqual([200, 409])
    expect(replies.find((reply) => reply.statusCode === 409)?.json()).toMatchObject({
      code: ERROR.CONFLICT,
    })
  })

  it('чужой, удалённый, несуществующий и кривой адрес — один ответ, 404', async () => {
    const me = await owner()
    const other = await owner()
    const { id } = await recorded(me)
    expect((await amend(other.cookie, id, {})).statusCode).toBe(404)
    expect((await amend(me.cookie, randomUUID(), {})).statusCode).toBe(404)
    expect((await amend(me.cookie, 'not-a-uuid', {})).statusCode).toBe(404)
    await app.inject({ method: 'DELETE', url: `/exchanges/${id}`, headers: { cookie: me.cookie } })
    expect((await amend(me.cookie, id, { note: 'x' })).statusCode).toBe(404)
  })

  it('правит и день: цепочка перестраивается, и день из будущего не проходит', async () => {
    const me = await owner()
    const first = await recorded(me, { exchangedOn: daysAgo(10) })
    await recorded(me, {
      received: { amount: '95000', currency: 'AMD' },
      heldBefore: { amount: '20000', currency: 'AMD' },
      exchangedOn: daysAgo(5),
    })
    // Moved after the second, the first is now the last link: taken alone.
    const moved = await amend(me.cookie, first.id, { exchangedOn: daysAgo(2) })
    expect(overviewOf(moved.json()).wallet).toMatchObject({ basis: 'last' })
    expect(overviewOf(moved.json()).wallet?.rate.scaled).toBe(parseRate('5'))

    const future = await amend(me.cookie, first.id, { exchangedOn: '2999-01-01', revision: 2 })
    expect(future.statusCode).toBe(400)
  })

  it('окончательное удаление уносит историю', async () => {
    const me = await owner()
    const { id } = await recorded(me)
    await amend(me.cookie, id, { received: { amount: '95000', currency: 'AMD' } })
    await app.inject({ method: 'DELETE', url: `/exchanges/${id}`, headers: { cookie: me.cookie } })
    await app.inject({ method: 'GET', url: '/exchanges', headers: { cookie: me.cookie } })
    expect(await db.select().from(exchangeRevisions)).toEqual([])
  })

  it('заметка — часть повтора: тот же id с другой заметкой — 409 (В-6)', async () => {
    const me = await owner()
    const body = await recorded(me, { note: 'аэропорт' })
    const other = await app.inject({
      method: 'POST',
      url: '/exchanges',
      headers: { cookie: me.cookie },
      payload: { ...body, note: 'обменник' },
    })
    expect(other.statusCode).toBe(409)
  })
})
