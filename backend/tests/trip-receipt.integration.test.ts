import { randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ERROR, tripHistoryCodec, tripViewCodec } from '@molvia/model'
import type { Money, TripView } from '@molvia/model'
import type { FastifyInstance } from 'fastify'
import { createExchangeRepository } from '@/db/exchanges-repository'
import { createMoneyAccountRepository } from '@/db/money-accounts-repository'
import { createMoneyRepository } from '@/db/money-repository'
import { expenses, trips } from '@/db/schema'
import { buildServer } from '@/server'
import { connectDrizzle } from './db'
import { insertActor, insertItem, insertPlace, insertTrip, signIn } from './fixtures'

const { db, close } = connectDrizzle()
let app: FastifyInstance

beforeAll(async () => {
  app = buildServer({ db })
  await app.ready()
})
afterAll(async () => {
  await app.close()
  await close()
})

interface Owner {
  readonly id: string
  readonly cookie: string
}

async function owner(): Promise<Owner> {
  const id = await insertActor(db)
  return { id, cookie: await signIn(db, id) }
}

function call(me: Owner, method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, body?: unknown) {
  return app.inject({
    method,
    url,
    headers: { cookie: me.cookie },
    ...(body === undefined ? {} : { payload: body as Record<string, unknown> }),
  })
}

const HOUR = 60 * 60 * 1000

const amd = (minor: bigint): Money => ({ minor, currency: 'AMD' })

/**
 * A finished trip of the owner: one purchase priced 570 ֏, and `unpriced` more with no price — the
 * shelf where nobody typed the price of the bread.
 */
async function trip(
  me: Owner,
  patch: { unpriced?: number; priced?: readonly Money[] } = {},
): Promise<string> {
  const place = await insertPlace(db, { name: `Receipt ${randomUUID()}` })
  const id = await insertTrip(db, {
    actorId: me.id,
    placeId: place,
    startedAt: new Date(Date.now() - 2 * HOUR),
    finishedAt: new Date(Date.now() - HOUR),
  })
  const priced = patch.priced ?? [amd(57_000n)]
  for (const amount of priced) {
    await db.insert(expenses).values({
      id: randomUUID(),
      tripId: id,
      itemId: await insertItem(db),
      amountMinor: amount.minor,
      amountCurrency: amount.currency,
    })
  }
  for (let n = 0; n < (patch.unpriced ?? 2); n += 1) {
    await db.insert(expenses).values({ id: randomUUID(), tripId: id, itemId: await insertItem(db) })
  }
  return id
}

async function receipt(me: Owner, id: string, amount: string | null, currency = 'AMD') {
  return call(me, 'PUT', `/trips/${id}/receipt`, {
    receipt: amount === null ? null : { amount, currency },
  })
}

const day = (offset: number) => new Date(Date.now() + offset).toISOString().slice(0, 10)

/** What every reader of a trip's money says about this one trip (MOL-78, Н-1). */
async function readers(me: Owner, id: string) {
  const view = tripViewCodec.parse((await call(me, 'GET', `/trips/${id}`)).json())
  const history = tripHistoryCodec.parse((await call(me, 'GET', '/trips/history')).json())
  const row = history.trips.find((entry) => entry.id === id)
  const month = (
    await createMoneyRepository(db).tripLines(me.id, day(-3 * 24 * HOUR), day(3 * 24 * HOUR))
  )
    .filter((line) => line.tripId === id)
    .map((line) => ({ amount: line.amount, items: line.items }))
  const operation = (await createMoneyAccountRepository(db).operations(me.id)).find(
    (entry) => entry.id === id,
  )
  const hint = await createExchangeRepository(db).spentSince(
    me.id,
    'AMD',
    new Date(Date.now() - 3 * HOUR),
  )
  return {
    view: view.total,
    history: row?.total ?? null,
    items: row?.itemCount ?? null,
    month,
    accounts:
      operation?.amounts.map(({ minor, currency }) => ({ minor: -minor, currency })) ?? null,
    unpriced: operation?.unpriced ?? null,
    hint,
  }
}

describe('PUT /trips/:id/receipt (MOL-78)', () => {
  it('кладёт сумму целиком и отвечает записью: итог — сумма, цены рядом, остаток — на покупки без цены', async () => {
    const me = await owner()
    const id = await trip(me)
    const answer = await receipt(me, id.toUpperCase(), '1400')
    expect(answer.statusCode, answer.body).toBe(200)
    expect(answer.headers['cache-control']).toBe('no-store')
    const view: TripView = tripViewCodec.parse(answer.json())
    expect(view.receipt).toEqual(amd(140_000n))
    expect(view.total).toEqual([amd(140_000n)])
    expect(view.prices).toEqual([amd(57_000n)])
    expect(view.gap).toEqual({ kind: 'unpriced', amount: amd(83_000n) })
  })

  it('повтор той же суммы — 200 и то же состояние; null — сумма снята, итог снова по ценам', async () => {
    const me = await owner()
    const id = await trip(me)
    await receipt(me, id, '1400')
    const [before] = await db.select().from(trips).where(eq(trips.id, id))
    const again = await receipt(me, id, '1400.00')
    expect(again.statusCode).toBe(200)
    const [after] = await db.select().from(trips).where(eq(trips.id, id))
    // A repeat from the queue is not a change: a check must not see the trip move again.
    expect(after?.receiptSetAt).toEqual(before?.receiptSetAt)

    const off = tripViewCodec.parse((await receipt(me, id, null)).json())
    expect(off.receipt).toBeNull()
    expect(off.total).toEqual([amd(57_000n)])
    expect(off.gap).toBeNull()
    const [cleared] = await db.select().from(trips).where(eq(trips.id, id))
    // Taking the sum off is a change a check has to see too.
    expect(cleared?.receiptSetAt?.getTime()).toBeGreaterThan(before?.receiptSetAt?.getTime() ?? 0)
  })

  it('ноль и минус — 400 invalid_amount; лишнее поле и пустое тело — 400', async () => {
    const me = await owner()
    const id = await trip(me)
    for (const amount of ['0', '-5']) {
      const refused = await receipt(me, id, amount)
      expect(refused.statusCode).toBe(400)
    }
    expect((await receipt(me, id, '0')).json()).toMatchObject({ code: ERROR.INVALID_AMOUNT })
    expect((await call(me, 'PUT', `/trips/${id}/receipt`, {})).statusCode).toBe(400)
    expect(
      (await call(me, 'PUT', `/trips/${id}/receipt`, { receipt: null, tripId: id })).statusCode,
    ).toBe(400)
  })

  it('IDOR: чужая, несуществующая, кривая и удалённая — один 404; без входа — 401', async () => {
    const me = await owner()
    const stranger = await owner()
    const id = await trip(me)
    for (const target of [id, randomUUID(), 'not-a-uuid']) {
      const answer = await receipt(stranger, target, '1400')
      expect(answer.statusCode).toBe(404)
      expect(answer.json()).toMatchObject({ code: ERROR.NOT_FOUND })
    }
    const [untouched] = await db.select().from(trips).where(eq(trips.id, id))
    expect(untouched?.receiptMinor).toBeNull()
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: `/trips/${id}/receipt`,
          payload: { receipt: null },
        })
      ).statusCode,
    ).toBe(401)
    await call(me, 'DELETE', `/trips/${id}`)
    expect((await receipt(me, id, '1400')).statusCode).toBe(404)
  })

  it('открытая запись тоже принимает сумму', async () => {
    const me = await owner()
    const place = await insertPlace(db, { name: `Open ${randomUUID()}` })
    const id = await insertTrip(db, { actorId: me.id, placeId: place })
    const view = tripViewCodec.parse((await receipt(me, id, '300')).json())
    expect(view.finishedAt).toBeNull()
    expect(view.total).toEqual([amd(30_000n)])
  })
})

describe('одно правило денег записи — все читатели (MOL-78, Н-1)', () => {
  it('без суммы, с суммой и снова без — экран, «Записаны», месяц, счета и подсказка обмена говорят одно', async () => {
    const me = await owner()
    const id = await trip(me)

    const byPrices = await readers(me, id)
    expect(byPrices).toEqual({
      view: [amd(57_000n)],
      history: [amd(57_000n)],
      items: 3,
      month: [{ amount: amd(57_000n), items: 1 }],
      accounts: [amd(57_000n)],
      unpriced: 2,
      hint: 57_000n,
    })

    await receipt(me, id, '1400')
    expect(await readers(me, id)).toEqual({
      view: [amd(140_000n)],
      history: [amd(140_000n)],
      items: 3,
      // The receipt stands for every purchase, the unpriced ones too (Р-4).
      month: [{ amount: amd(140_000n), items: 3 }],
      accounts: [amd(140_000n)],
      // The trip's money is known: a check names nothing here (Р-5).
      unpriced: 0,
      // Not the purchase and the receipt both: that would take the milk away twice (Р-6).
      hint: 140_000n,
    })

    await receipt(me, id, null)
    expect(await readers(me, id)).toEqual(byPrices)
  })

  it('ни одной цены: без суммы записи нет в «Деньгах», с суммой — есть', async () => {
    const me = await owner()
    const id = await trip(me, { priced: [], unpriced: 3 })
    expect((await readers(me, id)).month).toEqual([])
    await receipt(me, id, '2500')
    const seen = await readers(me, id)
    expect(seen.month).toEqual([{ amount: amd(250_000n), items: 3 }])
    expect(seen.accounts).toEqual([amd(250_000n)])
  })

  it('сумма в долларах при ценах в драмах и рублях — одна строка в долларах везде (В-3)', async () => {
    const me = await owner()
    const id = await trip(me, {
      priced: [amd(57_000n), { minor: 50_000n, currency: 'RUB' }],
      unpriced: 0,
    })
    await receipt(me, id, '30', 'USD')
    const seen = await readers(me, id)
    const usd = { minor: 3_000n, currency: 'USD' }
    expect(seen.view).toEqual([usd])
    expect(seen.history).toEqual([usd])
    expect(seen.month).toEqual([{ amount: usd, items: 2 }])
    expect(seen.accounts).toEqual([usd])
    // Dollars are not drams: nothing of this trip is in the dram hint any more.
    expect(seen.hint).toBe(0n)
  })

  it('сумма у записи, где все покупки удалили, остаётся и считается (В-1)', async () => {
    const me = await owner()
    const id = await trip(me, { unpriced: 0 })
    await receipt(me, id, '800')
    await db.delete(expenses).where(eq(expenses.tripId, id))
    const seen = await readers(me, id)
    expect(seen.view).toEqual([amd(80_000n)])
    expect(seen.items).toBe(0)
    expect(seen.month).toEqual([{ amount: amd(80_000n), items: 0 }])
  })

  it('подсказка обмена: сумма, записанная до обмена, или запись, законченная до него, не в счёт', async () => {
    const me = await owner()
    const id = await trip(me, { priced: [], unpriced: 1 })
    await receipt(me, id, '900')
    const hint = createExchangeRepository(db)
    // A receipt written after the exchange counts; one written before was paid with the money held.
    expect(await hint.spentSince(me.id, 'AMD', new Date(Date.now() - 3 * HOUR))).toBe(90_000n)
    expect(await hint.spentSince(me.id, 'AMD', new Date(Date.now() + HOUR))).toBe(0n)
    // A receipt typed today into a trip finished before the exchange: the sauce found at home (А4).
    await db
      .update(trips)
      .set({ finishedAt: sql`clock_timestamp() - interval '2 hours'` })
      .where(eq(trips.id, id))
    expect(await hint.spentSince(me.id, 'AMD', new Date(Date.now() - 90 * 60 * 1000))).toBe(0n)
  })

  it('сверка видит смену суммы: момент операции счёта сдвигается', async () => {
    const me = await owner()
    const id = await trip(me)
    const seenAt = async () =>
      (await createMoneyAccountRepository(db).operations(me.id)).find((entry) => entry.id === id)
        ?.seenAt
    const before = await seenAt()
    await receipt(me, id, '1400')
    const after = await seenAt()
    expect(after?.getTime()).toBeGreaterThan(before?.getTime() ?? 0)
  })
})

describe('сумма по чеку и «списано» (MOL-78, Р-3)', () => {
  async function account(me: Owner, currency: string): Promise<string> {
    const id = randomUUID()
    const answer = await call(me, 'POST', '/money/accounts', {
      id,
      name: `Карта ${id.slice(0, 4)}`,
      currency,
      savings: false,
      start: { amount: '0', currency },
      startOn: '2025-03-10',
    })
    expect(answer.statusCode, answer.body).toBe(201)
    return id
  }

  it('смена суммы снимает «списано», повтор той же суммы — нет', async () => {
    const me = await owner()
    const card = await account(me, 'USD')
    const id = await trip(me)
    const pay = () =>
      call(me, 'PUT', `/trips/${id}/payment`, {
        accountId: card,
        debited: { amount: '30', currency: 'USD' },
      })
    expect((await pay()).statusCode).toBe(200)

    const changed = tripViewCodec.parse((await receipt(me, id, '1400')).json())
    expect(changed.debited).toBeNull()
    expect(changed.accountId).toBe(card)

    expect(tripViewCodec.parse((await pay()).json()).debited).toEqual({
      minor: 3_000n,
      currency: 'USD',
    })
    const repeated = tripViewCodec.parse((await receipt(me, id, '1400')).json())
    expect(repeated.debited).toEqual({ minor: 3_000n, currency: 'USD' })
  })

  it('«списано» у записи в драмах на драмовом счёте не нужно, если и сумма в драмах; сумма в долларах — нужно', async () => {
    const me = await owner()
    const cash = await account(me, 'AMD')
    const id = await trip(me, { unpriced: 1 })
    await receipt(me, id, '30', 'USD')
    const paid = tripViewCodec.parse(
      (
        await call(me, 'PUT', `/trips/${id}/payment`, {
          accountId: cash,
          debited: { amount: '11700', currency: 'AMD' },
        })
      ).json(),
    )
    // The trip's money is dollars now: what left the dram account is worth keeping.
    expect(paid.debited).toEqual(amd(1_170_000n))
  })
})
