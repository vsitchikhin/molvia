import { randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  ERROR,
  SPENDING_PRESETS,
  journalCursorCodec,
  moneyMonthCodec,
  parseRate,
  spendingCategoriesResponseCodec,
  spendingViewCodec,
  yerevanDate,
} from '@molvia/model'
import type {
  CachedRate,
  JournalKey,
  MoneyMonthView,
  SpendingCategoriesResponse,
} from '@molvia/model'
import type { FastifyInstance } from 'fastify'
import { createRateRepository } from '@/db/rates-repository'
import { actors, expenses, moneyMonthRates, spendings } from '@/db/schema'
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

async function month(me: Owner, value: string, cursor?: JournalKey): Promise<MoneyMonthView> {
  const query =
    cursor === undefined
      ? ''
      : `?cursor=${encodeURIComponent(z.encode(journalCursorCodec, cursor))}`
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
    // Each line counts the purchases behind its own sum (В-7): the unpriced one is in neither.
    expect(lines.map((line) => (line.kind === 'trip' ? line.items : -1))).toEqual([1, 1])
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
    // The running month counts by today's rate, and only a fresh one counts (review Р-4).
    await rates.upsert([official('RUB', '5', today)])
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
    const next = await month(me, today.slice(0, 7), first.cursor ?? undefined)
    expect(next.days[0]?.entries).toHaveLength(5)
    expect(next.cursor).toBeNull()
  })
})

async function exchange(me: Owner, given: string, received: string, on: string): Promise<string> {
  const [givenAmount = '', gave = ''] = given.split(' ')
  const [receivedAmount = '', got = ''] = received.split(' ')
  const id = randomUUID()
  const response = await call(me, 'POST', '/exchanges', {
    id,
    given: { amount: givenAmount, currency: gave },
    received: { amount: receivedAmount, currency: got },
    exchangedOn: on,
  })
  expect(response.statusCode).toBe(201)
  return id
}

async function finishedTrip(me: Owner, on: string, minor: bigint, currency: 'AMD' | 'USD') {
  const trip = await insertTrip(db, {
    actorId: me.id,
    placeId: await insertPlace(db),
    startedAt: new Date(`${on}T08:00:00Z`),
    finishedAt: new Date(`${on}T09:00:00Z`),
  })
  await db.insert(expenses).values({
    id: randomUUID(),
    tripId: trip,
    itemId: await insertItem(db),
    amountMinor: minor,
    amountCurrency: currency,
  })
}

function idsOf(view: MoneyMonthView): string[] {
  return view.days.flatMap((day) =>
    day.entries.map((entry) => (entry.kind === 'manual' ? entry.spending.id : entry.tripId)),
  )
}

describe('курсы «Денег» (ревью MOL-73: Р-1…Р-5, адверсариальный Д1, Д2, Д8)', () => {
  it('пришло — доход в ֏ по ЦБ своего дня, а не по цене кошелька, и без потери знаков (Р-2, Д1, Д2б)', async () => {
    const me = await owner()
    await rates.upsert([
      official('RUB', '4.10', '2026-08-05'),
      official('RUB', '4.30', '2026-08-20'),
    ])
    await exchange(me, '100000 RUB', '410000 AMD', '2026-08-05')
    const income = await call(me, 'POST', '/incomes', {
      id: randomUUID(),
      amount: { amount: '150000', currency: 'AMD' },
      receivedOn: '2026-08-20',
      source: 'freelance',
      heldBefore: { amount: '410000', currency: 'AMD' },
    })
    expect(income.statusCode).toBe(201)
    // 150 000 / 4,3 = 34 883,7209…: «₽ за ֏» (0,232558) gave 34 883,70.
    expect((await month(me, '2026-08')).income).toEqual({ minor: 3488372n, currency: 'RUB' })
  })

  it('трата в $ при цепочке ₽ → $ → ֏ — кросс из одной цепочки, округлённый раз (Р-1, Д2)', async () => {
    const me = await owner()
    await exchange(me, '89011.50 RUB', '1000 USD', '2026-08-05')
    await exchange(me, '100000 RUB', '410000 AMD', '2026-08-05')
    const response = await spend(me, {
      spentOn: '2026-08-10',
      amount: { amount: '1500', currency: 'USD' },
      categoryId: await presetId(me, 'rent'),
    })
    expect(response.statusCode).toBe(201)
    expect(spendingViewCodec.parse(response.json()).rate).toMatchObject({
      base: 'USD',
      quote: 'AMD',
      source: 'personal',
      scaled: parseRate('364.94715'),
    })
    // 1 500 × 364,94715 = 547 420,73 ֏, not the 547 396,53 two rounded wallets gave.
    expect((await month(me, '2026-08')).foreign[0]?.counted).toEqual({
      minor: 54742073n,
      currency: 'AMD',
    })
  })

  it('покупка похода в $ — тем же правилом, что трата в $ того же дня (Р-3, Д1)', async () => {
    const me = await owner()
    await rates.upsert([official('USD', '390', '2026-08-20')])
    await exchange(me, '89040 RUB', '1000 USD', '2026-08-05')
    await exchange(me, '100000 RUB', '410000 AMD', '2026-08-05')
    await finishedTrip(me, '2026-08-20', 1000n, 'USD')
    await spend(me, { spentOn: '2026-08-20', amount: { amount: '10', currency: 'USD' } })
    const august = await month(me, '2026-08')
    // 89,04 × 4,1 = 365,064 ֏ за $ — the person's own dollars, not the bank's 390.
    expect(august.days[0]?.entries.map((entry) => entry.counted)).toEqual([
      { minor: 365064n, currency: 'AMD' },
      { minor: 365064n, currency: 'AMD' },
    ])
  })

  it('официальный курс — только свежий: трата в $ с курсом трёхнедельной давности не посчитана (Р-4)', async () => {
    const me = await owner()
    await rates.upsert([official('USD', '390', daysAgo(25))])
    const response = await spend(me, {
      spentOn: daysAgo(3),
      amount: { amount: '11', currency: 'USD' },
    })
    expect(response.statusCode).toBe(201)
    expect(spendingViewCodec.parse(response.json()).rate).toBeNull()
    expect((await month(me, daysAgo(3).slice(0, 7))).uncounted).toEqual([
      { minor: 1100n, currency: 'USD' },
    ])
  })

  it('правка заметки у траты без курса берёт курс заново, если он появился (Р-5)', async () => {
    const me = await owner()
    const day = daysAgo(3)
    const view = spendingViewCodec.parse(
      (await spend(me, { spentOn: day, amount: { amount: '11', currency: 'USD' } })).json(),
    )
    expect(view.rate).toBeNull()
    await rates.upsert([official('USD', '390', day)])
    const amended = await call(me, 'PUT', `/spendings/${view.id}`, {
      revision: view.revision,
      spentOn: day,
      amount: { amount: '11', currency: 'USD' },
      categoryId: view.categoryId,
      note: 'домен',
    })
    expect(amended.statusCode).toBe(200)
    expect(spendingViewCodec.parse(amended.json()).rate?.scaled).toBe(parseRate('390'))
  })

  it('правка заметки у траты с курсом его сохраняет, даже если курс дня с тех пор другой', async () => {
    const me = await owner()
    const day = daysAgo(3)
    await rates.upsert([official('USD', '390', day)])
    const view = spendingViewCodec.parse(
      (await spend(me, { spentOn: day, amount: { amount: '11', currency: 'USD' } })).json(),
    )
    // The bank corrected the day since: a corrected note is the same fact at the same rate.
    await rates.upsert([official('USD', '395', day)])
    const amended = await call(me, 'PUT', `/spendings/${view.id}`, {
      revision: view.revision,
      spentOn: day,
      amount: { amount: '11', currency: 'USD' },
      categoryId: view.categoryId,
      note: 'домен',
    })
    expect(spendingViewCodec.parse(amended.json()).rate?.scaled).toBe(parseRate('390'))
  })

  it('после смены валюты трат ֏ похода и те же ֏ ручной траты считаются одинаково (Р-5, Д8)', async () => {
    const me = await owner()
    await rates.upsert([official('USD', '400', '2026-08-10')])
    await spend(me, { spentOn: '2026-08-10', amount: { amount: '4000', currency: 'AMD' } })
    await finishedTrip(me, '2026-08-10', 400000n, 'AMD')
    await db.update(actors).set({ spendCurrency: 'USD' }).where(eq(actors.id, me.id))
    const august = await month(me, '2026-08')
    expect(august.spent).toEqual({ minor: 2000n, currency: 'USD' })
    expect(august.uncounted).toEqual([])
  })
})

describe('месяц «Денег» — края (адверсариальный Д3–Д7, В-6)', () => {
  async function fortyFive(me: Owner): Promise<void> {
    const beauty = await presetId(me, 'beauty')
    for (let index = 0; index < 45; index += 1) {
      const response = await call(me, 'POST', '/spendings', {
        id: randomUUID(),
        spentOn: today,
        amount: { amount: '100', currency: 'AMD' },
        categoryId: beauty,
      })
      expect(response.statusCode).toBe(201)
    }
  }

  it('трата, записанная между страницами, не повторяется; удалённая не прячет соседнюю (Д3)', async () => {
    const me = await owner()
    await fortyFive(me)
    const first = await month(me, today.slice(0, 7))
    await spend(me)
    const second = await month(me, today.slice(0, 7), first.cursor ?? undefined)
    expect(idsOf(second).filter((id) => idsOf(first).includes(id))).toEqual([])
    expect(idsOf(second)).toHaveLength(5)

    expect((await call(me, 'DELETE', `/spendings/${idsOf(first)[3] ?? ''}`)).statusCode).toBe(204)
    const again = await month(me, today.slice(0, 7), first.cursor ?? undefined)
    expect(idsOf(again)).toEqual(idsOf(second))
  })

  it('курсор, который не ключ строки, — отказ, а не первая страница', async () => {
    const me = await owner()
    const response = await call(me, 'GET', `/money/months/${today.slice(0, 7)}?cursor=40`)
    expect(response.statusCode).toBe(400)
  })

  it('0000-01 и 0001-01 — 404, как любой не месяц, а не 500 из Postgres (Д4)', async () => {
    const me = await owner()
    expect((await call(me, 'GET', '/money/months/0000-01')).statusCode).toBe(404)
    expect((await call(me, 'GET', '/money/months/0001-01')).statusCode).toBe(404)
    expect((await call(me, 'GET', '/money/months/2000-01')).statusCode).toBe(200)
  })

  it('сумма, которую не держат деньги, уходит в «не посчитано», а месяц читается (Д5)', async () => {
    const me = await owner()
    for (let index = 0; index < 2; index += 1) {
      expect(
        (await spend(me, { amount: { amount: '50000000000000000', currency: 'AMD' } })).statusCode,
      ).toBe(201)
    }
    await rates.upsert([official('USD', '390', today)])
    expect(
      (await spend(me, { amount: { amount: '90000000000000000', currency: 'USD' } })).statusCode,
    ).toBe(201)
    const counted = await month(me, today.slice(0, 7))
    expect(counted.spent).toEqual({ minor: 5_000_000_000_000_000_000n, currency: 'AMD' })
    // Newest first: the later of the two drams is counted, the earlier would carry the sum past.
    expect(counted.uncounted).toEqual([
      { minor: 5_000_000_000_000_000_000n, currency: 'AMD' },
      { minor: 9_000_000_000_000_000_000n, currency: 'USD' },
    ])
    expect(idsOf(counted)).toHaveLength(3)
  })

  it('удалённая трата: повтор POST — 409, «Вернуть» живёт десять минут, что бы ни писалось (Д6)', async () => {
    const me = await owner()
    const body = {
      id: randomUUID(),
      spentOn: today,
      amount: { amount: '5000', currency: 'AMD' },
      categoryId: await presetId(me, 'beauty'),
    }
    expect((await call(me, 'POST', '/spendings', body)).statusCode).toBe(201)
    expect((await call(me, 'DELETE', `/spendings/${body.id}`)).statusCode).toBe(204)
    expect((await call(me, 'POST', '/spendings', body)).statusCode).toBe(409)
    expect((await month(me, today.slice(0, 7))).days).toEqual([])

    const b = spendingViewCodec.parse((await spend(me)).json())
    expect((await call(me, 'DELETE', `/spendings/${b.id}`)).statusCode).toBe(204)
    expect((await spend(me, { amount: { amount: '700', currency: 'AMD' } })).statusCode).toBe(201)
    expect((await call(me, 'POST', `/spendings/${body.id}/restore`)).statusCode).toBe(200)
    expect((await call(me, 'POST', `/spendings/${b.id}/restore`)).statusCode).toBe(200)
  })

  it('два «Такси» с двух телефонов разом — одна категория (Д7)', async () => {
    const me = await owner()
    await categories(me)
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const name = `Такси ${String(attempt)}`
      const answers = await Promise.all([
        call(me, 'POST', '/spending-categories', { id: randomUUID(), name }),
        call(me, 'POST', '/spending-categories', { id: randomUUID(), name }),
      ])
      expect(answers.map((answer) => answer.statusCode).sort()).toEqual([201, 409])
    }
  })

  it('своя категория, названная в верхнем регистре, — своя (по коду)', async () => {
    const me = await owner()
    const beauty = await presetId(me, 'beauty')
    const response = await spend(me, { categoryId: beauty.toUpperCase() })
    expect(response.statusCode).toBe(201)
    expect(spendingViewCodec.parse(response.json()).categoryId).toBe(beauty)
  })

  it('обмен задним числом размораживает месяцы от своего дня; сегодняшний — нет (В-6)', async () => {
    const me = await owner()
    await rates.upsert([official('RUB', '4.10', '2026-08-31')])
    await spend(me, { spentOn: '2026-08-20', amount: { amount: '41000', currency: 'AMD' } })
    expect((await month(me, '2026-08')).spentIncome).toEqual({ minor: 1000000n, currency: 'RUB' })

    // Remembered on the 3rd of September: an exchange of the 28th of August at 5 ֏ за ₽.
    const late = await exchange(me, '10000 RUB', '50000 AMD', '2026-08-28')
    const amended = await month(me, '2026-08')
    expect(amended.rate).toMatchObject({ source: 'personal', scaled: parseRate('5') })
    expect(amended.spentIncome).toEqual({ minor: 820000n, currency: 'RUB' })

    await exchange(me, '10000 RUB', '60000 AMD', today)
    expect((await month(me, '2026-08')).spentIncome).toEqual(amended.spentIncome)

    // Removing the late one lets August go again.
    expect((await call(me, 'DELETE', `/exchanges/${late}`)).statusCode).toBe(200)
    expect((await month(me, '2026-08')).spentIncome).toEqual({ minor: 1000000n, currency: 'RUB' })
  })
})

describe('второй раунд (адверсариальный Е1, Е2)', () => {
  it('удалённая больше десяти минут назад трата пишется заново, не дожидаясь таймера (Е2)', async () => {
    const me = await owner()
    const body = {
      id: randomUUID(),
      spentOn: today,
      amount: { amount: '5000', currency: 'AMD' },
      categoryId: await presetId(me, 'beauty'),
    }
    await call(me, 'POST', '/spendings', body)
    await call(me, 'DELETE', `/spendings/${body.id}`)
    await db
      .update(spendings)
      .set({ deletedAt: sql`clock_timestamp() - interval '11 minutes'` })
      .where(eq(spendings.id, body.id))
    expect((await call(me, 'POST', `/spendings/${body.id}/restore`)).statusCode).toBe(404)
    expect((await call(me, 'POST', '/spendings', body)).statusCode).toBe(201)
    expect(idsOf(await month(me, today.slice(0, 7)))).toEqual([body.id])
  })

  it('«мой курс → ЦБ РА» размораживает прошлые месяцы: все по одному правилу (В-8, Е1)', async () => {
    const me = await owner()
    await rates.upsert([official('RUB', '4.50', '2026-08-31')])
    await exchange(me, '10000 RUB', '41000 AMD', '2026-08-05')
    await spend(me, { spentOn: '2026-08-20', amount: { amount: '45000', currency: 'AMD' } })
    expect((await month(me, '2026-08')).rate).toMatchObject({ source: 'personal' })
    const switched = await call(me, 'PUT', '/actors/me/rate-preference', { preference: 'official' })
    expect(switched.statusCode).toBe(200)
    const august = await month(me, '2026-08')
    expect(august.rate).toMatchObject({ source: 'official', scaled: parseRate('4.5') })
    expect(august.spentIncome).toEqual({ minor: 1000000n, currency: 'RUB' })
  })

  it('смена валюты пересчёта размораживает прошлые месяцы; смена города — нет (В-8)', async () => {
    const me = await owner()
    await rates.upsert([official('RUB', '4.10', '2026-08-31')])
    await spend(me, { spentOn: '2026-08-20', amount: { amount: '41000', currency: 'AMD' } })
    await month(me, '2026-08')
    const before = await tripContext(db, me.id)
    const put = (settings: typeof before, previous: typeof before) =>
      call(me, 'PUT', '/actors/me/settings', { previous, settings })

    expect((await put({ ...before, city: 'Ереван' }, before)).statusCode).toBe(200)
    expect(await db.select().from(moneyMonthRates)).toHaveLength(1)

    const moved = { ...before, city: 'Ереван' }
    expect((await put({ ...moved, incomeCurrency: 'USD' }, moved)).statusCode).toBe(200)
    expect(await db.select().from(moneyMonthRates)).toEqual([])
  })

  it('смена валюты трат тоже размораживает прошлые месяцы (В-8)', async () => {
    const me = await owner()
    await rates.upsert([official('RUB', '4.10', '2026-08-31')])
    await spend(me, { spentOn: '2026-08-20', amount: { amount: '41000', currency: 'AMD' } })
    await month(me, '2026-08')
    expect(await db.select().from(moneyMonthRates)).toHaveLength(1)
    const before = await tripContext(db, me.id)
    const put = await call(me, 'PUT', '/actors/me/settings', {
      previous: before,
      settings: { ...before, spendCurrency: 'USD' },
    })
    expect(put.statusCode).toBe(200)
    expect(await db.select().from(moneyMonthRates)).toEqual([])
  })
})
