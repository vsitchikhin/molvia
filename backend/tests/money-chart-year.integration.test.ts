import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  moneyChartYearCodec,
  moneyMonthCodec,
  monthOf,
  parseRate,
  previousMonth,
  spendingCategoriesResponseCodec,
  yerevanDate,
} from '@molvia/model'
import type { CachedRate, MoneyChartYearView, MoneyMonthView } from '@molvia/model'
import type { FastifyInstance } from 'fastify'
import { createRateRepository } from '@/db/rates-repository'
import { moneyMonthRates } from '@/db/schema'
import { buildServer } from '@/server'
import { connectDrizzle } from './db'
import { clearAll, insertActor, signIn } from './fixtures'

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
const today = yerevanDate(new Date())
const daysAgo = (days: number): string => yerevanDate(new Date(Date.now() - days * DAY_MS))
const current = monthOf(today)
const thisYear = current.slice(0, 4)
const m1 = previousMonth(current)
const m2 = previousMonth(m1)
const m3 = previousMonth(m2)
/** A year back: always in the usual's window of this year, never a month of it. */
const yearAgo = Array.from({ length: 11 }).reduce<string>((month) => previousMonth(month), m1)

interface Owner {
  readonly id: string
  readonly cookie: string
}

async function owner(): Promise<Owner> {
  const id = await insertActor(db)
  return { id, cookie: await signIn(db, id) }
}

async function call(me: Owner, method: 'GET' | 'POST' | 'DELETE', url: string, body?: unknown) {
  return app.inject({
    method,
    url,
    headers: { cookie: me.cookie },
    ...(body === undefined ? {} : { payload: body as Record<string, unknown> }),
  })
}

async function chartYear(me: Owner, value: string): Promise<MoneyChartYearView> {
  const response = await call(me, 'GET', `/money/years/${value}/charts`)
  expect(response.statusCode).toBe(200)
  expect(response.headers['cache-control']).toBe('no-store')
  return moneyChartYearCodec.parse(response.json())
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

async function spend(
  me: Owner,
  amount: string,
  currency: string,
  spentOn: string,
  preset: string,
): Promise<string> {
  const id = randomUUID()
  const response = await call(me, 'POST', '/spendings', {
    id,
    spentOn,
    amount: { amount, currency },
    categoryId: await presetId(me, preset),
  })
  expect(response.statusCode).toBe(201)
  return id
}

/** The central bank's rouble and dollar for every day of the last two hundred, steady. */
async function cacheRates() {
  const rows: CachedRate[] = []
  for (let days = 200; days >= 0; days -= 1) {
    const date = daysAgo(days)
    rows.push({ provider: 'cba', currency: 'RUB', date, scaled: parseRate('4.0'), jump: false })
    rows.push({ provider: 'cba', currency: 'USD', date, scaled: parseRate('390'), jump: false })
  }
  await rates.upsert(rows)
}

async function frozen(me: Owner, value: string): Promise<boolean> {
  const rows = await db
    .select()
    .from(moneyMonthRates)
    .where(and(eq(moneyMonthRates.actorId, me.id), eq(moneyMonthRates.month, value)))
  return rows.length > 0
}

/** Heavy with writes and months counted one by one; a loaded machine needs more than five seconds. */
const HEAVY_MS = 30_000

describe('«Графики → Год» (MOL-160)', () => {
  it(
    'каждый месяц года — его месяц на «Деньгах», а год — их сумма',
    async () => {
      await cacheRates()
      const me = await owner()
      const year = m1.slice(0, 4)
      await spend(me, '5000', 'AMD', `${m1}-03`, 'groceries')
      await spend(me, '2000', 'AMD', `${m1}-04`, 'cafe')
      await spend(me, '11', 'USD', `${m1}-05`, 'cafe')
      if (m2.startsWith(year)) await spend(me, '3000', 'AMD', `${m2}-06`, 'rent')

      const charts = await chartYear(me, year)
      expect(charts.months).toHaveLength(12)
      let sum = 0n
      for (const one of charts.months.filter((each) => each.kind === 'data')) {
        const seen = await month(me, one.month)
        expect(one.spent).toEqual(seen.spent)
        expect(one.spentIncome).toEqual(seen.spentIncome)
        expect(one.income).toEqual(seen.income)
        sum += one.spent.minor
      }
      expect(charts.spent?.minor).toBe(sum)
      expect(charts.slices.reduce((all, slice) => all + slice.amount.minor, 0n)).toBe(sum)
      expect(charts.firstMonth).toBe(m2.startsWith(year) ? m2 : m1)
    },
    HEAVY_MS,
  )

  it(
    'закрытые месяцы года замораживает, месяцы обычного до года — нет (Р-2)',
    async () => {
      await cacheRates()
      const me = await owner()
      await spend(me, '1000', 'AMD', `${yearAgo}-10`, 'other')
      await spend(me, '1000', 'AMD', `${m1}-10`, 'other')

      await chartYear(me, thisYear)
      expect(await frozen(me, yearAgo)).toBe(false)
      if (m1.startsWith(thisYear)) expect(await frozen(me, m1)).toBe(true)
      expect(await frozen(me, current)).toBe(false)
    },
    HEAVY_MS,
  )

  it(
    'среднее — от трёх закрытых месяцев, идущий в него не входит (В-1)',
    async () => {
      const me = await owner()
      await spend(me, '3000', 'AMD', `${m2}-10`, 'other')
      await spend(me, '3000', 'AMD', `${m1}-10`, 'other')
      await spend(me, '90000', 'AMD', today, 'other')

      const two = await chartYear(me, thisYear)
      expect(two.average).toBeNull()
      expect(two.closedCount).toBe(2)

      await spend(me, '3000', 'AMD', `${m3}-10`, 'other')
      const three = await chartYear(me, thisYear)
      expect(three.average).toMatchObject({
        amount: { minor: 300_000n, currency: 'AMD' },
        from: m3,
        to: m1,
        months: 3,
      })
    },
    HEAVY_MS,
  )

  it('удалённая трата в год не входит', async () => {
    const me = await owner()
    await spend(me, '1000', 'AMD', today, 'other')
    const removed = await spend(me, '7000', 'AMD', today, 'other')
    expect((await call(me, 'DELETE', `/spendings/${removed}`)).statusCode).toBe(204)
    expect((await chartYear(me, thisYear)).spent).toEqual({ minor: 100_000n, currency: 'AMD' })
  })

  it('чужие траты не видны', async () => {
    const me = await owner()
    const other = await owner()
    await spend(other, '1000', 'AMD', today, 'other')
    const charts = await chartYear(me, thisYear)
    expect(charts.spent).toEqual({ minor: 0n, currency: 'AMD' })
    expect(charts.firstMonth).toBeNull()
  })

  it('год, который не наступил, и не год — 404; лишний параметр — отказ по имени', async () => {
    const me = await owner()
    const next = String(Number(thisYear) + 1)
    for (const value of [next, 'abcd', '0000', '26']) {
      expect((await call(me, 'GET', `/money/years/${value}/charts`)).statusCode).toBe(404)
    }
    const extra = await call(me, 'GET', `/money/years/${thisYear}/charts?period=12`)
    expect(extra.statusCode).toBe(400)
    expect(JSON.stringify(extra.json())).toContain('period')
  })
})
