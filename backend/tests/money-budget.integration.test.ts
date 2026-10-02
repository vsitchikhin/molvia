import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import {
  moneyBudgetCodec,
  moneyMonthCodec,
  monthOf,
  parseRate,
  previousMonth,
  spendingCategoriesResponseCodec,
  yerevanDate,
} from '@molvia/model'
import type { CachedRate, MoneyBudgetView, MoneyMonthView } from '@molvia/model'
import type { FastifyInstance } from 'fastify'
import { createRateRepository } from '@/db/rates-repository'
import { budgetPlans, expenses, moneyMonthRates } from '@/db/schema'
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

const DAY_MS = 24 * 60 * 60 * 1000
const daysAgo = (days: number): string => yerevanDate(new Date(Date.now() - days * DAY_MS))
const current = monthOf(yerevanDate(new Date()))
const m1 = previousMonth(current)
const m2 = previousMonth(m1)

interface Owner {
  readonly id: string
  readonly cookie: string
}

async function owner(): Promise<Owner> {
  const id = await insertActor(db)
  return { id, cookie: await signIn(db, id) }
}

async function call(me: Owner | null, method: 'GET' | 'POST' | 'PUT', url: string, body?: unknown) {
  return app.inject({
    method,
    url,
    headers: me ? { cookie: me.cookie } : {},
    ...(body === undefined ? {} : { payload: body as Record<string, unknown> }),
  })
}

async function budget(me: Owner, value: string): Promise<MoneyBudgetView> {
  const response = await call(me, 'GET', `/money/months/${value}/budget`)
  expect(response.statusCode).toBe(200)
  expect(response.headers['cache-control']).toBe('no-store')
  return moneyBudgetCodec.parse(response.json())
}

async function month(me: Owner, value: string): Promise<MoneyMonthView> {
  const response = await call(me, 'GET', `/money/months/${value}`)
  expect(response.statusCode).toBe(200)
  return moneyMonthCodec.parse(response.json())
}

async function presetId(me: Owner, preset: string): Promise<string> {
  const response = await call(me, 'GET', '/spending-categories')
  const found = spendingCategoriesResponseCodec
    .parse(response.json())
    .categories.find((category) => category.preset === preset)
  if (!found) throw new Error(`no preset ${preset}`)
  return found.id
}

async function spend(me: Owner, amount: string, spentOn: string, preset: string) {
  const response = await call(me, 'POST', '/spendings', {
    id: randomUUID(),
    spentOn,
    amount: { amount, currency: 'AMD' },
    categoryId: await presetId(me, preset),
  })
  expect(response.statusCode).toBe(201)
}

async function receive(me: Owner, amount: string, receivedOn: string) {
  const response = await call(me, 'POST', '/incomes', {
    id: randomUUID(),
    amount: { amount, currency: 'RUB' },
    receivedOn,
    source: 'salary',
  })
  expect(response.statusCode).toBe(201)
}

const sum = (amount: string) => ({ kind: 'amount', amount: { amount, currency: 'AMD' } })
const share = (percent: number) => ({ kind: 'share', percent })

async function plan(me: Owner, categoryId: string | null, from: string, value: unknown) {
  return call(me, 'PUT', '/budget/plans', { categoryId, from, plan: value })
}

/** The central bank's rouble for every day of the last hundred, steady at 4 ֏. */
async function cacheRates() {
  const rows: CachedRate[] = []
  for (let days = 100; days >= 0; days -= 1) {
    rows.push({
      provider: 'cba',
      currency: 'RUB',
      date: daysAgo(days),
      scaled: parseRate('4.0'),
      jump: false,
    })
  }
  await rates.upsert(rows)
}

const amd = (major: number) => ({ minor: BigInt(major) * 100n, currency: 'AMD' })

describe('«Бюджет» (MOL-117)', () => {
  it('факт — тот же, что у месяца «Денег», и цифра входа — «осталось»', async () => {
    const me = await owner()
    await spend(me, '52300', `${m1}-03`, 'groceries')
    await spend(me, '41200', `${m1}-04`, 'cafe')
    await spend(me, '6500', `${m1}-05`, 'transport')

    const put = await plan(me, await presetId(me, 'groceries'), m1, sum('77400'))
    expect(put.statusCode).toBe(200)
    expect(moneyBudgetCodec.parse(put.json()).rows).toHaveLength(1)
    await plan(me, await presetId(me, 'cafe'), m1, sum('38700'))

    const view = await budget(me, m1)
    const shown = await month(me, m1)
    for (const row of [...view.rows, ...view.unplanned]) {
      expect(row.spent).toEqual(
        shown.byCategory.find((entry) => entry.categoryId === row.categoryId)?.amount,
      )
    }
    expect(view.rows.map((row) => [row.left, row.used])).toEqual([
      [amd(25100), 68],
      [amd(-2500), 106],
    ])
    expect(view.unplanned).toEqual([
      { categoryId: await presetId(me, 'transport'), spent: amd(6500), spentWhole: true },
    ])
    expect(view.total).toMatchObject({ planned: amd(116100), left: amd(22600), whole: true })
    expect(shown.budget).toEqual({ planned: true, left: amd(22600) })
  })

  it('план живёт с месяца правки и дальше; правка раньше снимает поздние (В-1, Р-9)', async () => {
    const me = await owner()
    const rent = await presetId(me, 'rent')
    await plan(me, rent, m2, sum('250000'))
    await plan(me, rent, current, sum('270000'))

    const planned = async (value: string) => (await budget(me, value)).rows[0]?.planned
    expect(await planned(m2)).toEqual(amd(250000))
    expect(await planned(m1)).toEqual(amd(250000))
    expect(await planned(current)).toEqual(amd(270000))

    await plan(me, rent, m1, sum('260000'))
    expect(await planned(m2)).toEqual(amd(250000))
    expect(await planned(m1)).toEqual(amd(260000))
    expect(await planned(current)).toEqual(amd(260000))

    await plan(me, rent, current, null)
    expect((await budget(me, current)).rows).toEqual([])
    expect(await planned(m1)).toEqual(amd(260000))
    expect((await month(me, current)).budget).toEqual({ planned: false, left: null })
  })

  it('процент — от «Пришло» по курсу закрытого месяца, и чтение замораживает его, как «Деньги»', async () => {
    await cacheRates()
    const me = await owner()
    await receive(me, '100000', `${m1}-10`)
    // Set from the month before, so the write freezes that month and the read alone freezes m1.
    await plan(me, await presetId(me, 'groceries'), m2, share(10))
    const written = await db
      .select()
      .from(moneyMonthRates)
      .where(eq(moneyMonthRates.actorId, me.id))
    expect(written.map((row) => row.month)).toEqual([m2])

    const view = await budget(me, m1)
    expect(view.rows[0]).toMatchObject({
      plan: { kind: 'share', percent: 10 },
      planned: amd(40000),
      estimated: true,
      plannedWhole: true,
    })
    const frozen = await db.select().from(moneyMonthRates).where(eq(moneyMonthRates.actorId, me.id))
    expect(frozen.map((row) => row.month).sort()).toEqual([m2, m1])
  })

  it('процент — от зарплаты, перенесённой в следующий месяц, а месяц без дохода ждёт его (Р-3)', async () => {
    await cacheRates()
    const me = await owner()
    const shift = await call(me, 'PUT', '/actors/me/salary-shift', { day: 25 })
    expect(shift.statusCode).toBe(200)
    await receive(me, '100000', `${m2}-26`)
    await spend(me, '5000', `${m2}-27`, 'groceries')
    await plan(me, await presetId(me, 'groceries'), m2, share(10))

    expect((await budget(me, m1)).rows[0]).toMatchObject({
      planned: amd(40000),
      awaitingIncome: false,
    })
    const waiting = await budget(me, m2)
    expect(waiting.rows[0]).toMatchObject({
      awaitingIncome: true,
      planned: null,
      left: null,
      spent: amd(5000),
    })
    expect(waiting.total).toMatchObject({ whole: false })
    expect((await month(me, m2)).budget).toEqual({ planned: true, left: null })
  })

  it('поход — в «Продуктах»: строка плана видит его деньги, как месяц «Денег»', async () => {
    const me = await owner()
    const tripId = await insertTrip(db, {
      actorId: me.id,
      placeId: await insertPlace(db),
      startedAt: new Date(`${m1}-12T09:00:00Z`),
      finishedAt: new Date(`${m1}-12T09:30:00Z`),
      finishedOn: `${m1}-12`,
    })
    await db.insert(expenses).values({
      id: randomUUID(),
      tripId,
      itemId: await insertItem(db),
      amountMinor: 1_250_000n,
      amountCurrency: 'AMD',
    })
    await plan(me, await presetId(me, 'groceries'), m1, sum('50000'))

    const [row] = (await budget(me, m1)).rows
    expect(row).toMatchObject({ spent: amd(12500), left: amd(37500), used: 25 })
    expect((await month(me, m1)).byCategory).toEqual([
      { categoryId: await presetId(me, 'groceries'), amount: amd(12500) },
    ])
  })

  it('цель накоплений — процент против «Разницы» месяца (В-4)', async () => {
    await cacheRates()
    const me = await owner()
    await receive(me, '100000', `${m1}-10`)
    await spend(me, '100000', `${m1}-11`, 'rent')

    expect((await plan(me, null, m1, sum('1000'))).statusCode).toBe(400)
    expect((await plan(me, null, m1, share(25))).statusCode).toBe(200)
    expect((await budget(me, m1)).savings).toEqual({
      target: 25,
      income: { minor: 10_000_000n, currency: 'RUB' },
      difference: { minor: 7_500_000n, currency: 'RUB' },
      actual: 75,
    })
  })

  it('убранная категория держит план и видна, только пока в ней есть траты (Р-5)', async () => {
    const me = await owner()
    const pets = await presetId(me, 'pets')
    await plan(me, pets, m2, sum('38700'))
    await spend(me, '12000', `${m2}-05`, 'pets')
    const removed = await app.inject({
      method: 'DELETE',
      url: `/spending-categories/${pets}`,
      headers: { cookie: me.cookie },
    })
    expect(removed.statusCode).toBe(200)

    expect((await budget(me, m2)).rows.map((row) => row.categoryId)).toEqual([pets])
    expect((await budget(me, m1)).rows).toEqual([])
    expect(await db.select().from(budgetPlans).where(eq(budgetPlans.actorId, me.id))).toHaveLength(
      1,
    )
  })

  it('сумма — в валюте трат; чужая и несуществующая категория — 404, как одна', async () => {
    const me = await owner()
    const stranger = await owner()
    const theirs = await presetId(stranger, 'cafe')

    const rouble = await plan(me, await presetId(me, 'cafe'), m1, {
      kind: 'amount',
      amount: { amount: '1000', currency: 'RUB' },
    })
    expect(rouble.statusCode).toBe(400)
    expect(rouble.json()).toEqual({ code: 'error.currency_mismatch' })
    expect((await plan(me, theirs, m1, sum('1000'))).statusCode).toBe(404)
    expect((await plan(me, randomUUID(), m1, sum('1000'))).statusCode).toBe(404)
    expect((await budget(stranger, m1)).rows).toEqual([])
    expect(await db.select().from(budgetPlans)).toEqual([])
  })

  it('чужих планов не видно, а без сессии и с месяцем, которого нет, — отказ', async () => {
    const anna = await owner()
    const boris = await owner()
    await plan(anna, await presetId(anna, 'rent'), m1, sum('250000'))

    expect((await budget(boris, m1)).total).toBeNull()
    expect((await call(null, 'GET', `/money/months/${m1}/budget`)).statusCode).toBe(401)
    expect((await call(null, 'PUT', '/budget/plans', {})).statusCode).toBe(401)
    expect((await call(anna, 'GET', '/money/months/2026-13/budget')).statusCode).toBe(404)
    expect((await call(anna, 'GET', `/money/months/${m1}/budget?x=1`)).statusCode).toBe(400)
  })
})
