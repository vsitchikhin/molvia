import { randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  ERROR,
  SPENDING_PRESETS,
  moneyMonthCodec,
  parseRate,
  spendingCategoriesResponseCodec,
  spendingViewCodec,
  yerevanDate,
} from '@molvia/model'
import type { CachedRate, MoneyMonthView, SpendingCategoriesResponse } from '@molvia/model'
import type { FastifyInstance } from 'fastify'
import { createRateRepository } from '@/db/rates-repository'
import { expenses, moneyMonthRates, spendings } from '@/db/schema'
import { buildServer } from '@/server'
import { connectDrizzle } from './db'
import { clearAll, insertActor, insertItem, insertPlace, insertTrip, signIn } from './fixtures'

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
const official = (currency: 'RUB' | 'USD' | 'EUR', value: string, date: string): CachedRate => ({
  provider: 'cba',
  currency,
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

async function categories(me: Owner): Promise<SpendingCategoriesResponse> {
  const response = await call(me, 'GET', '/spending-categories')
  expect(response.statusCode).toBe(200)
  return spendingCategoriesResponseCodec.parse(response.json())
}

async function presetId(me: Owner, preset: string): Promise<string> {
  const found = (await categories(me)).categories.find((category) => category.preset === preset)
  if (!found) throw new Error(`no preset ${preset}`)
  return found.id
}

async function spend(me: Owner, patch: Record<string, unknown> = {}) {
  return call(me, 'POST', '/spendings', {
    id: randomUUID(),
    spentOn: today,
    amount: { amount: '5000', currency: 'AMD' },
    categoryId: await presetId(me, 'beauty'),
    note: 'барбер',
    ...patch,
  })
}

async function month(me: Owner, value: string, cursor?: number): Promise<MoneyMonthView> {
  const query = cursor === undefined ? '' : `?cursor=${String(cursor)}`
  const response = await call(me, 'GET', `/money/months/${value}${query}`)
  expect(response.statusCode).toBe(200)
  expect(response.headers['cache-control']).toBe('no-store')
  return moneyMonthCodec.parse(response.json())
}

describe('категории трат (MOL-73, В-3)', () => {
  it('новый аккаунт получает тринадцать предустановок — один раз, даже если спросили дважды разом', async () => {
    const me = await owner()
    await Promise.all([categories(me), categories(me)])
    const { categories: list } = await categories(me)
    expect(list.map((category) => category.preset)).toEqual([...SPENDING_PRESETS])
    expect(list.every((category) => !category.archived)).toBe(true)
  })

  it('своя категория: 201, повтор — 200, чужое имя под тем же id — 409, занятое имя — 409', async () => {
    const me = await owner()
    const id = randomUUID()
    const first = await call(me, 'POST', '/spending-categories', { id, name: 'Такси' })
    expect(first.statusCode).toBe(201)
    const own = spendingCategoriesResponseCodec.parse(first.json()).categories.at(-1)
    expect(own).toMatchObject({ id, preset: null, name: 'Такси', colour: 0, archived: false })

    expect((await call(me, 'POST', '/spending-categories', { id, name: 'Такси' })).statusCode).toBe(
      200,
    )
    expect((await call(me, 'POST', '/spending-categories', { id, name: 'Такса' })).statusCode).toBe(
      409,
    )
    const taken = await call(me, 'POST', '/spending-categories', {
      id: randomUUID(),
      name: ' такси ',
    })
    expect(taken.statusCode).toBe(409)
    expect(taken.json()).toMatchObject({ code: ERROR.SPENDING_CATEGORY_TAKEN })
  })

  it('«удалить» убирает из выбора и ничего не стирает; вернуть можно; чужую — 404', async () => {
    const me = await owner()
    const stranger = await owner()
    const cafe = await presetId(me, 'cafe')
    await spend(me, { categoryId: cafe, amount: { amount: '10780', currency: 'AMD' } })

    const archived = await call(me, 'DELETE', `/spending-categories/${cafe}`)
    expect(archived.statusCode).toBe(200)
    const listed = spendingCategoriesResponseCodec.parse(archived.json()).categories
    expect(listed.find((category) => category.id === cafe)).toMatchObject({ archived: true })
    // The month still counts it under its category.
    const counted = await month(me, today.slice(0, 7))
    expect(counted.byCategory).toEqual([
      { categoryId: cafe, amount: { minor: 1078000n, currency: 'AMD' } },
    ])

    expect((await call(stranger, 'DELETE', `/spending-categories/${cafe}`)).statusCode).toBe(404)
    expect((await call(me, 'POST', `/spending-categories/${cafe}/restore`)).statusCode).toBe(200)
    expect((await categories(me)).categories.find((c) => c.id === cafe)).toMatchObject({
      archived: false,
    })
  })
})

describe('трата вне похода (MOL-73)', () => {
  it('201 и одна строка; повтор из очереди — 200 и всё ещё одна; другое под тем же id — 409', async () => {
    const me = await owner()
    const id = randomUUID()
    const body = {
      id,
      spentOn: daysAgo(6),
      amount: { amount: '5000', currency: 'AMD' },
      categoryId: await presetId(me, 'beauty'),
      note: 'барбер',
    }
    const created = await call(me, 'POST', '/spendings', body)
    expect(created.statusCode).toBe(201)
    expect(spendingViewCodec.parse(created.json())).toMatchObject({
      id,
      note: 'барбер',
      rate: null,
    })
    expect((await call(me, 'POST', '/spendings', body)).statusCode).toBe(200)
    expect(await db.select().from(spendings)).toHaveLength(1)
    const other = await call(me, 'POST', '/spendings', {
      ...body,
      amount: { amount: '6000', currency: 'AMD' },
    })
    expect(other.statusCode).toBe(409)
  })

  it('завтрашний день — отказ; категория чужого — отказ; убранная из выбора своя — принимается', async () => {
    const me = await owner()
    const stranger = await owner()
    const tomorrow = yerevanDate(new Date(Date.now() + 36 * 60 * 60 * 1000))
    const future = await spend(me, { spentOn: tomorrow })
    expect(future.statusCode).toBe(400)
    expect(future.json()).toMatchObject({ code: ERROR.SPENDING_IN_FUTURE })

    const foreign = await spend(me, { categoryId: await presetId(stranger, 'cafe') })
    expect(foreign.statusCode).toBe(400)
    expect(foreign.json()).toMatchObject({ code: ERROR.SPENDING_CATEGORY_UNKNOWN })

    const home = await presetId(me, 'home')
    await call(me, 'DELETE', `/spending-categories/${home}`)
    // Queued offline before the category left the choice on another phone: not lost.
    expect((await spend(me, { categoryId: home })).statusCode).toBe(201)
  })

  it('в другой валюте хранит курс своего дня, а не сегодняшний', async () => {
    const me = await owner()
    const day = daysAgo(3)
    await rates.upsert([official('USD', '390', day), official('USD', '400', today)])
    const response = await spend(me, { spentOn: day, amount: { amount: '11', currency: 'USD' } })
    expect(response.statusCode).toBe(201)
    const view = spendingViewCodec.parse(response.json())
    // «390 ֏ за $», the orientation whose number keeps its digits — not «0,002564 $ за ֏».
    expect(view.rate).toMatchObject({ base: 'USD', quote: 'AMD', source: 'official' })
    expect(view.rate?.scaled).toBe(parseRate('390'))
    const counted = await month(me, day.slice(0, 7))
    expect(counted.foreign).toEqual([
      {
        amount: { minor: 1100n, currency: 'USD' },
        counted: { minor: 429000n, currency: 'AMD' },
      },
    ])
  })

  it('правка: верная версия — 200 и версия растёт; старая — 409; чужая — 404', async () => {
    const me = await owner()
    const stranger = await owner()
    const view = spendingViewCodec.parse((await spend(me)).json())
    const body = {
      revision: view.revision,
      spentOn: view.spentOn,
      amount: { amount: '5500', currency: 'AMD' },
      categoryId: view.categoryId,
      note: 'барбер и чаевые',
    }
    const amended = await call(me, 'PUT', `/spendings/${view.id}`, body)
    expect(amended.statusCode).toBe(200)
    expect(spendingViewCodec.parse(amended.json()).revision).toBe(2)
    expect(
      (await call(me, 'PUT', `/spendings/${view.id}`, { ...body, note: 'иначе' })).statusCode,
    ).toBe(409)
    expect((await call(stranger, 'PUT', `/spendings/${view.id}`, body)).statusCode).toBe(404)
  })

  it('удаление — 204 и нет в месяце; «Вернуть» — тот же id; через десять минут — 404', async () => {
    const me = await owner()
    const view = spendingViewCodec.parse((await spend(me)).json())
    expect((await call(me, 'DELETE', `/spendings/${view.id}`)).statusCode).toBe(204)
    expect((await month(me, today.slice(0, 7))).days).toEqual([])
    const back = await call(me, 'POST', `/spendings/${view.id}/restore`)
    expect(back.statusCode).toBe(200)
    expect(spendingViewCodec.parse(back.json()).id).toBe(view.id)

    await call(me, 'DELETE', `/spendings/${view.id}`)
    await db
      .update(spendings)
      .set({ deletedAt: sql`clock_timestamp() - interval '11 minutes'` })
      .where(eq(spendings.id, view.id))
    expect((await call(me, 'POST', `/spendings/${view.id}/restore`)).statusCode).toBe(404)
  })
})

describe('месяц «Денег» (MOL-73)', () => {
  it('поход — когда завершён, строкой на валюту, в «Продукты»; незавершённый не виден', async () => {
    const me = await owner()
    await rates.upsert([official('USD', '400', daysAgo(2))])
    const place = await insertPlace(db, { name: 'Ереван Сити' })
    const item = await insertItem(db)
    const finished = await insertTrip(db, {
      actorId: me.id,
      placeId: place,
      startedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000 - 60_000),
      finishedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
    })
    const open = await insertTrip(db, { actorId: me.id, placeId: place })
    await db.insert(expenses).values([
      {
        id: randomUUID(),
        tripId: finished,
        itemId: item,
        amountMinor: 894000n,
        amountCurrency: 'AMD',
      },
      {
        id: randomUUID(),
        tripId: finished,
        itemId: item,
        amountMinor: 1000n,
        amountCurrency: 'USD',
      },
      { id: randomUUID(), tripId: finished, itemId: item, amountMinor: null, amountCurrency: null },
      { id: randomUUID(), tripId: open, itemId: item, amountMinor: 50000n, amountCurrency: 'AMD' },
    ])
    const counted = await month(me, daysAgo(2).slice(0, 7))
    const lines = counted.days.flatMap((day) => day.entries)
    expect(lines).toHaveLength(2)
    expect(lines.every((line) => line.kind === 'trip' && line.items === 3)).toBe(true)
    expect(counted.byCategory).toEqual([
      { categoryId: await presetId(me, 'groceries'), amount: counted.spent },
    ])
    expect(counted.spent).toEqual({ minor: 894000n + 400000n, currency: 'AMD' })
  })

  it('поход, завершённый 31 августа в 23:30 по Еревану, — в августе, а не в сентябре', async () => {
    const me = await owner()
    const place = await insertPlace(db)
    const item = await insertItem(db)
    const trip = await insertTrip(db, {
      actorId: me.id,
      placeId: place,
      startedAt: new Date('2026-08-31T18:00:00Z'),
      // 23:30 in Yerevan is 19:30 UTC: a UTC date would be the same day, the next hour not.
      finishedAt: new Date('2026-08-31T19:30:00Z'),
    })
    await db.insert(expenses).values({
      id: randomUUID(),
      tripId: trip,
      itemId: item,
      amountMinor: 100000n,
      amountCurrency: 'AMD',
    })
    expect((await month(me, '2026-08')).days.map((day) => day.day)).toEqual(['2026-08-31'])
    expect((await month(me, '2026-09')).days).toEqual([])
  })

  it('закрытый месяц замораживает курс при первом чтении — новый обмен сегодня его не двигает', async () => {
    const me = await owner()
    await rates.upsert([official('RUB', '4.10', '2026-08-31'), official('RUB', '4.50', today)])
    await spend(me, { spentOn: '2026-08-20', amount: { amount: '41000', currency: 'AMD' } })
    const before = await month(me, '2026-08')
    expect(before.rateKind).toBe('frozen')
    expect(before.spentIncome).toEqual({ minor: 1000000n, currency: 'RUB' })

    // Today's exchange at a very different rate: August must not move.
    await call(me, 'POST', '/exchanges', {
      id: randomUUID(),
      given: { amount: '10000', currency: 'RUB' },
      received: { amount: '60000', currency: 'AMD' },
      exchangedOn: today,
    })
    const after = await month(me, '2026-08')
    expect(after.spentIncome).toEqual(before.spentIncome)
    expect(await db.select().from(moneyMonthRates)).toHaveLength(1)
  })

  it('пришло — доходы месяца, остаток — со знаком; прошлый месяц для сравнения', async () => {
    const me = await owner()
    await rates.upsert([official('RUB', '5', '2026-09-01')])
    await spend(me, { spentOn: '2026-08-10', amount: { amount: '1000', currency: 'AMD' } })
    await spend(me, { spentOn: '2026-09-06', amount: { amount: '600000', currency: 'AMD' } })
    await call(me, 'POST', '/incomes', {
      id: randomUUID(),
      amount: { amount: '99615', currency: 'RUB' },
      receivedOn: '2026-09-15',
      source: 'salary',
    })
    const september = await month(me, '2026-09')
    expect(september.income).toEqual({ minor: 9961500n, currency: 'RUB' })
    expect(september.previousSpent).toEqual({ minor: 100000n, currency: 'AMD' })
    expect(september.rest?.minor).toBeLessThan(0n)
  })

  it('чужие траты не видны; месяц, который не месяц, — 404', async () => {
    const me = await owner()
    const stranger = await owner()
    await spend(stranger)
    expect((await month(me, today.slice(0, 7))).days).toEqual([])
    expect((await call(me, 'GET', '/money/months/2026-13')).statusCode).toBe(404)
    expect((await call(me, 'GET', '/money/months/сентябрь')).statusCode).toBe(404)
  })

  it('журнал страницами по сорок: курсор ведёт дальше, итог дня — целиком', async () => {
    const me = await owner()
    const beauty = await presetId(me, 'beauty')
    for (let index = 0; index < 45; index += 1) {
      await call(me, 'POST', '/spendings', {
        id: randomUUID(),
        spentOn: today,
        amount: { amount: '100', currency: 'AMD' },
        categoryId: beauty,
      })
    }
    const first = await month(me, today.slice(0, 7))
    expect(first.days[0]?.entries).toHaveLength(40)
    expect(first.days[0]?.total).toEqual({ minor: 450000n, currency: 'AMD' })
    expect(first.remaining).toBe(5)
    const next = await month(me, today.slice(0, 7), first.cursor ?? 0)
    expect(next.days[0]?.entries).toHaveLength(5)
    expect(next.cursor).toBeNull()
  })
})
