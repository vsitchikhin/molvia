import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { ERROR, exchangesResponseCodec, parseRate, tripViewCodec, yerevanDate } from '@molvia/model'
import type { CachedRate, ExchangesResponse } from '@molvia/model'
import type { FastifyInstance } from 'fastify'
import { createRateRepository } from '@/db/rates-repository'
import { exchanges, expenses } from '@/db/schema'
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
      exchanges: [],
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
      heldEstimates: [{ held: { amount: '115000.00', currency: 'AMD' }, whole: true }],
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
    expect(overview.costs.map(({ rate }) => [rate.quote, rate.scaled])).toEqual([['USD', 11_232n]])
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
    expect((await start(me)).rate?.source).toBe('official')
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
      { held: { minor: 9_000_000n, currency: 'AMD' }, whole: false },
    ])
  })

  it('смена валюты пересчёта действует вперёд: прошлые обмены в новый курс не входят (В-2)', async () => {
    const me = await owner()
    await record(me, {})
    const before = await tripContext(db, me.id)
    const settings = await app.inject({
      method: 'PUT',
      url: '/actors/me/settings',
      headers: { cookie: me.cookie },
      payload: { previous: before, settings: { ...before, incomeCurrency: 'USD' } },
    })
    expect(settings.statusCode).toBe(200)

    // A dollar exchange dated before the change belongs to the old reckoning too.
    const earlier = await record(me, {
      given: { amount: '100', currency: 'USD' },
      received: { amount: '38000', currency: 'AMD' },
      exchangedOn: daysAgo(3),
    })
    expect(earlier).toMatchObject({ pair: { base: 'USD', quote: 'AMD' }, baseSince: today })
    expect(earlier.wallet).toBeNull()
    expect(earlier.exchanges).toHaveLength(2)

    const after = await record(me, {
      given: { amount: '100', currency: 'USD' },
      received: { amount: '36150', currency: 'AMD' },
      heldBefore: { amount: '100000', currency: 'AMD' },
      exchangedOn: today,
    })
    // The drams held were bought with roubles: no cost in dollars to weigh them by.
    expect(after.wallet).toMatchObject({ basis: 'last', estimated: false })
    expect(after.wallet?.rate.scaled).toBe(parseRate('361.5'))
    expect((await start(me)).rate).toMatchObject({ source: 'personal', base: 'USD' })
  })
})
