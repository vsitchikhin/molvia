import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  ERROR,
  exchangesResponseCodec,
  incomesResponseCodec,
  money,
  parseRate,
  tripViewCodec,
  yerevanDate,
} from '@molvia/model'
import type { CachedRate, IncomesResponse } from '@molvia/model'
import type { FastifyInstance } from 'fastify'
import { createRateRepository } from '@/db/rates-repository'
import { events } from '@/db/schema'
import { buildServer } from '@/server'
import { connectDrizzle } from './db'
import { clearAll, insertActor, signIn, tripContext } from './fixtures'

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

interface Owner {
  readonly id: string
  readonly cookie: string
}

async function owner(): Promise<Owner> {
  const id = await insertActor(db)
  return { id, cookie: await signIn(db, id) }
}

function payload(patch: Record<string, unknown> = {}) {
  return {
    id: randomUUID(),
    amount: { amount: '99615', currency: 'RUB' },
    receivedOn: daysAgo(10),
    source: 'salary',
    ...patch,
  }
}

async function call(
  me: Owner,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  url: string,
  body?: unknown,
) {
  return app.inject({
    method,
    url,
    headers: { cookie: me.cookie },
    ...(body === undefined ? {} : { payload: body as Record<string, unknown> }),
  })
}

async function record(me: Owner, patch: Record<string, unknown> = {}): Promise<IncomesResponse> {
  const response = await call(me, 'POST', '/incomes', payload(patch))
  expect(response.statusCode).toBe(201)
  return incomesResponseCodec.parse(response.json())
}

describe('«Доходы» через API (MOL-66)', () => {
  it('без доходов: пусто, валюта пересчёта из настроек, ответ не кешируется', async () => {
    const me = await owner()
    const response = await call(me, 'GET', '/incomes')
    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.json()).toEqual({
      base: 'RUB',
      baseSince: null,
      months: [],
      receipts: [],
      heldEstimates: [],
    })
  })

  it('записывает: 201, повтор — 200 и тот же доход, другое тело под тем же именем — 409 (В-6)', async () => {
    const me = await owner()
    const body = payload({ note: 'Викаса' })
    const first = await call(me, 'POST', '/incomes', body)
    expect(first.statusCode).toBe(201)
    const again = await call(me, 'POST', '/incomes', body)
    expect(again.statusCode).toBe(200)
    expect(again.json()).toEqual(first.json())

    const other = await call(me, 'POST', '/incomes', { ...body, source: 'bonus' })
    expect(other.statusCode).toBe(409)
    expect(other.json()).toEqual({ code: ERROR.CONFLICT })
  })

  it('день после сегодняшнего — отказ своим кодом, сегодня — можно', async () => {
    const me = await owner()
    const tomorrow = yerevanDate(new Date(Date.now() + 24 * 60 * 60 * 1000))
    const future = await call(me, 'POST', '/incomes', payload({ receivedOn: tomorrow }))
    expect(future.statusCode).toBe(400)
    expect(future.json()).toEqual({ code: ERROR.INCOME_IN_FUTURE })
    expect((await call(me, 'POST', '/incomes', payload({ receivedOn: today }))).statusCode).toBe(
      201,
    )
  })

  it('источник обязателен и из списка; лишнее поле — отказ', async () => {
    const me = await owner()
    for (const body of [
      payload({ source: undefined }),
      payload({ source: 'Зарплата' }),
      payload({ rate: '4.3' }),
    ]) {
      expect((await call(me, 'POST', '/incomes', body)).statusCode).toBe(400)
    }
  })

  it('месяцы — новые сверху, сумма по каждой валюте отдельно, без пересчёта (В-2)', async () => {
    const me = await owner()
    await record(me, {
      amount: { amount: '35195', currency: 'RUB' },
      receivedOn: '2026-08-25',
      source: 'brought',
    })
    await record(me, {
      amount: { amount: '500', currency: 'USD' },
      receivedOn: '2026-08-26',
      source: 'freelance',
    })
    await record(me, { amount: { amount: '102345', currency: 'RUB' }, receivedOn: '2026-08-31' })
    const overview = await record(me, { receivedOn: '2026-09-15' })

    expect(overview.months.map(({ month, sums }) => [month, sums])).toEqual([
      ['2026-09', [money(9_961_500n, 'RUB')]],
      ['2026-08', [money(13_754_000n, 'RUB'), money(50_000n, 'USD')]],
    ])
    expect(overview.months[1]?.incomes.map(({ receivedOn }) => receivedOn)).toEqual([
      '2026-08-31',
      '2026-08-26',
      '2026-08-25',
    ])
  })

  it('правка на месте с историей; повтор — тот же успех, поверх чужой — 409, чужой доход — 404', async () => {
    const me = await owner()
    const stranger = await owner()
    const body = payload()
    await record(me, body)
    const fields = { amount: body.amount, receivedOn: body.receivedOn, source: body.source }
    const amended = await call(me, 'PUT', `/incomes/${body.id}`, {
      ...fields,
      revision: 1,
      amount: { amount: '102345', currency: 'RUB' },
    })
    expect(amended.statusCode).toBe(200)
    const [row] = incomesResponseCodec.parse(amended.json()).months[0]?.incomes ?? []
    expect(row).toMatchObject({ revision: 2, amount: money(10_234_500n, 'RUB') })
    expect(row?.amendedAt).not.toBeNull()
    expect(row?.history).toEqual([
      expect.objectContaining({ amount: money(9_961_500n, 'RUB'), source: 'salary' }),
    ])

    const repeat = await call(me, 'PUT', `/incomes/${body.id}`, {
      ...fields,
      revision: 1,
      amount: { amount: '102345', currency: 'RUB' },
    })
    expect(repeat.statusCode).toBe(200)
    const stale = await call(me, 'PUT', `/incomes/${body.id}`, {
      ...fields,
      revision: 1,
      note: 'x',
    })
    expect(stale.statusCode).toBe(409)
    const theirs = await call(stranger, 'PUT', `/incomes/${body.id}`, { ...fields, revision: 2 })
    expect(theirs.statusCode).toBe(404)
    expect(theirs.json()).toEqual({ code: ERROR.NOT_FOUND })
  })

  it('удаление — пометка, «Вернуть» возвращает; чужой доход не удалить и не вернуть', async () => {
    const me = await owner()
    const stranger = await owner()
    const body = payload()
    await record(me, body)

    const theirs = await call(stranger, 'DELETE', `/incomes/${body.id}`)
    expect(theirs.statusCode).toBe(200)
    expect(incomesResponseCodec.parse(theirs.json()).months).toEqual([])
    expect((await call(stranger, 'POST', `/incomes/${body.id}/restore`)).statusCode).toBe(404)

    const removed = await call(me, 'DELETE', `/incomes/${body.id}`)
    expect(incomesResponseCodec.parse(removed.json()).months).toEqual([])
    // Again after a lost answer: the same, and the removal is not made final by it.
    expect((await call(me, 'DELETE', `/incomes/${body.id}`)).statusCode).toBe(200)
    const back = await call(me, 'POST', `/incomes/${body.id}/restore`)
    expect(back.statusCode).toBe(200)
    expect(incomesResponseCodec.parse(back.json()).months).toHaveLength(1)
  })

  it('открытие экрана делает удаление окончательным', async () => {
    const me = await owner()
    const body = payload()
    await record(me, body)
    await call(me, 'DELETE', `/incomes/${body.id}`)
    await call(me, 'GET', '/incomes')
    expect((await call(me, 'POST', `/incomes/${body.id}/restore`)).statusCode).toBe(404)
  })

  it('журнал событий доход не пишет', async () => {
    const me = await owner()
    const body = payload()
    await record(me, body)
    await call(me, 'GET', '/incomes')
    await call(me, 'DELETE', `/incomes/${body.id}`)
    expect(await db.select().from(events)).toEqual([])
  })
})

describe('доход в «моём курсе» (MOL-66, В-1)', () => {
  async function exchange(me: Owner, patch: Record<string, unknown> = {}) {
    const response = await call(me, 'POST', '/exchanges', {
      id: randomUUID(),
      given: { amount: '20000', currency: 'RUB' },
      received: { amount: '100000', currency: 'AMD' },
      exchangedOn: daysAgo(10),
      ...patch,
    })
    expect(response.statusCode).toBe(201)
  }

  async function exchanges(me: Owner) {
    return exchangesResponseCodec.parse((await call(me, 'GET', '/exchanges')).json())
  }

  async function start(me: Owner) {
    const response = await call(me, 'POST', '/trips', {
      id: randomUUID(),
      context: await tripContext(db, me.id),
      place: { kind: 'store', name: 'Ереван Сити' },
    })
    expect(response.statusCode).toBe(201)
    return tripViewCodec.parse(response.json())
  }

  it('драмы дохода — по ЦБ своего дня, с остатком взвешены, и поход берёт это число', async () => {
    await rates.upsert([rub('4.3', daysAgo(3))])
    const me = await owner()
    await exchange(me)
    // 100 000 ֏ for 20 000 ₽ and 200 000 ֏ worth 46 511.63 ₽: 300 000 ֏ for 66 511.63 ₽.
    const overview = await record(me, {
      amount: { amount: '200000', currency: 'AMD' },
      heldBefore: { amount: '100000', currency: 'AMD' },
      receivedOn: daysAgo(3),
    })
    expect(overview.receipts[0]).toMatchObject({ currency: 'AMD', on: daysAgo(3), priced: true })

    const wallet = (await exchanges(me)).wallet
    expect(wallet).toMatchObject({ basis: 'weighted', estimated: true })
    expect(wallet?.rate.scaled).toBe(4_510_490n)
    expect((await start(me)).rate).toMatchObject({ source: 'personal', scaled: 4_510_490n })
  })

  it('без остатка — курс по этому поступлению, и так и названо', async () => {
    await rates.upsert([rub('4.3', daysAgo(3))])
    const me = await owner()
    await exchange(me)
    await record(me, { amount: { amount: '200000', currency: 'AMD' }, receivedOn: daysAgo(3) })
    expect((await exchanges(me)).wallet).toMatchObject({
      basis: 'income',
      estimated: true,
      rate: { scaled: parseRate('4.3') },
    })
  })

  it('рубли при пересчёте в рублях кошелёк не трогают', async () => {
    await rates.upsert([rub('4.3', daysAgo(3))])
    const me = await owner()
    await exchange(me)
    await record(me, { receivedOn: daysAgo(3) })
    expect((await exchanges(me)).wallet).toMatchObject({
      basis: 'last',
      estimated: false,
      rate: { scaled: parseRate('5') },
    })
  })

  it('без курса ЦБ на день поступления — стоимость неизвестна, названо поступление, поход по ЦБ', async () => {
    await rates.upsert([rub('4.3123', daysAgo(1))])
    const me = await owner()
    await exchange(me)
    await record(me, { amount: { amount: '200000', currency: 'AMD' }, receivedOn: daysAgo(5) })
    const overview = await exchanges(me)
    expect(overview.wallet).toBeNull()
    expect(overview.walletUnknown).toEqual({ on: daysAgo(5), given: null, reason: 'noRate' })
    expect((await start(me)).rate?.source).toBe('official')
  })

  it('подсказка остатка начинается с поступления, когда оно последнее, и так и названа (Р-8)', async () => {
    await rates.upsert([rub('4.3', daysAgo(3))])
    const me = await owner()
    await exchange(me)
    const incomes = await record(me, {
      amount: { amount: '200000', currency: 'AMD' },
      receivedOn: daysAgo(3),
    })
    // The latest money into drams is the income, which did not say what was held before it: the
    // hint is about its own 200 000 ֏, on both screens.
    const hint = { held: { minor: 20_000_000n, currency: 'AMD' }, whole: false, from: 'income' }
    expect(incomes.heldEstimates).toEqual([hint])
    expect((await exchanges(me)).heldEstimates).toEqual([hint])
  })
})

describe('доход без обменов (MOL-66, адверсариальный Д1)', () => {
  async function start(me: Owner) {
    const response = await call(me, 'POST', '/trips', {
      id: randomUUID(),
      context: await tripContext(db, me.id),
      place: { kind: 'store', name: 'Ереван Сити' },
    })
    expect(response.statusCode).toBe(201)
    return tripViewCodec.parse(response.json())
  }

  it('драмы дохода без единого обмена — кошелёк, и «Обмен денег» его отдаёт; поход берёт его', async () => {
    // The bank: 4.3 on the day of the income, 4.0 today.
    await rates.upsert([rub('4.3', daysAgo(20)), rub('4.0', today)])
    const me = await owner()
    await record(me, { amount: { amount: '150000', currency: 'AMD' }, receivedOn: daysAgo(20) })

    const overview = exchangesResponseCodec.parse((await call(me, 'GET', '/exchanges')).json())
    expect(overview.exchanges).toEqual([])
    // What the screen draws its card from — the reason it is not «no exchanges» any more.
    expect(overview.wallet).toMatchObject({
      basis: 'income',
      estimated: true,
      rate: { scaled: parseRate('4.3') },
    })
    expect((await start(me)).rate).toMatchObject({ source: 'personal', scaled: parseRate('4.3') })
  })

  it('без доходов и обменов, и с доходом в рублях — поход по ЦБ РА сегодняшнего дня', async () => {
    await rates.upsert([rub('4.3', daysAgo(20)), rub('4.0', today)])
    const nothing = await owner()
    expect((await start(nothing)).rate).toMatchObject({
      source: 'official',
      scaled: parseRate('4.0'),
    })
    const roubles = await owner()
    await record(roubles, { receivedOn: daysAgo(20) })
    const overview = exchangesResponseCodec.parse((await call(roubles, 'GET', '/exchanges')).json())
    expect(overview).toMatchObject({ wallet: null, walletUnknown: null, costs: [] })
    expect((await start(roubles)).rate).toMatchObject({
      source: 'official',
      scaled: parseRate('4.0'),
    })
  })
})
