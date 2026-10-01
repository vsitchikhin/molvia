import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  moneyChartMonthCodec,
  lastDayOf,
  moneyMonthCodec,
  monthOf,
  nextMonth,
  parseRate,
  previousMonth,
  spendingCategoriesResponseCodec,
  yerevanDate,
} from '@molvia/model'
import type { CachedRate, MoneyChartMonthView, MoneyMonthView } from '@molvia/model'
import type { FastifyInstance } from 'fastify'
import { createRateRepository } from '@/db/rates-repository'
import { expenses, moneyMonthRates } from '@/db/schema'
import { tripRepositories } from '@/db/unit-of-work'
import { buildServer } from '@/server'
import { moneyChartMonthOf } from '@/usecases/money-chart-month'
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
const today = yerevanDate(new Date())
const daysAgo = (days: number): string => yerevanDate(new Date(Date.now() - days * DAY_MS))
const current = monthOf(today)
const m1 = previousMonth(current)
const m2 = previousMonth(m1)
const m3 = previousMonth(m2)
const m4 = previousMonth(m3)

interface Owner {
  readonly id: string
  readonly cookie: string
}

async function owner(): Promise<Owner> {
  const id = await insertActor(db)
  return { id, cookie: await signIn(db, id) }
}

async function call(
  me: Owner | null,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  url: string,
  body?: unknown,
) {
  return app.inject({
    method,
    url,
    headers: me ? { cookie: me.cookie } : {},
    ...(body === undefined ? {} : { payload: body as Record<string, unknown> }),
  })
}

async function chartMonth(me: Owner, value: string): Promise<MoneyChartMonthView> {
  const response = await call(me, 'GET', `/money/months/${value}/charts`)
  expect(response.statusCode).toBe(200)
  expect(response.headers['cache-control']).toBe('no-store')
  return moneyChartMonthCodec.parse(response.json())
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

async function spend(me: Owner, amount: string, currency: string, spentOn: string, preset: string) {
  const response = await call(me, 'POST', '/spendings', {
    id: randomUUID(),
    spentOn,
    amount: { amount, currency },
    categoryId: await presetId(me, preset),
  })
  expect(response.statusCode).toBe(201)
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

const amd = (major: number) => ({ minor: BigInt(major) * 100n, currency: 'AMD' })

/** Heavy with writes and months counted one by one; a loaded machine needs more than five seconds. */
const HEAVY_MS = 30_000

describe('«Графики → Месяц» (MOL-158)', () => {
  it(
    'месяц — тот же, что на «Деньгах»: итог, «≈», не посчитанное и сектора',
    async () => {
      await cacheRates()
      const me = await owner()
      const presets = [
        'groceries',
        'cafe',
        'rent',
        'home',
        'beauty',
        'transport',
        'telecom',
        'pets',
      ]
      for (const [index, preset] of presets.entries()) {
        await spend(me, String((index + 1) * 1000), 'AMD', `${m1}-0${String(index + 1)}`, preset)
      }
      // Dollars by the bank's rate of their day; a euro no rate knows is «не посчитано».
      await spend(me, '11', 'USD', `${m1}-12`, 'cafe')
      await spend(me, '5', 'EUR', `${m1}-13`, 'cafe')

      const view = await chartMonth(me, m1)
      const shown = await month(me, m1)
      expect(view.running).toBe(false)
      expect(view.spent).toEqual(shown.spent)
      expect(view.spentIncome).toEqual(shown.spentIncome)
      expect(view.uncounted).toEqual(shown.uncounted)
      expect(
        view.slices.map(({ categoryId, amount, count, level }) => ({
          categoryId,
          amount,
          count,
          level,
        })),
      ).toEqual(shown.slices)
      const rest = view.slices.at(-1)
      expect(rest?.categoryId).toBeNull()
      // Eight categories: the café is 2 000 ֏ and 11 $, past transport; rent and groceries are the rest.
      expect(rest?.members).toEqual([await presetId(me, 'rent'), await presetId(me, 'groceries')])
      expect(view.pace.days).toHaveLength(Number(lastDayOf(m1).slice(8, 10)))
      expect(view.pace.days.at(-1)?.cumulative).toEqual(shown.spent)
      expect(view.categories.map((one) => one.id)).toEqual(shown.categories.map((one) => one.id))
    },
    HEAVY_MS,
  )

  it(
    'чтение замораживает выбранный закрытый месяц, а месяцы «обычного» — нет',
    async () => {
      await cacheRates()
      const me = await owner()
      for (const one of [m4, m3, m2, m1]) await spend(me, '10000', 'AMD', `${one}-10`, 'cafe')
      await chartMonth(me, m1)
      const frozen = await db.select().from(moneyMonthRates)
      expect(frozen.map((row) => row.month)).toEqual([m1])
      // The running month is never frozen.
      await chartMonth(me, current)
      expect(await db.select().from(moneyMonthRates)).toHaveLength(1)
    },
    HEAVY_MS,
  )

  it(
    'обычное — от трёх закрытых месяцев, от первого с данными; меньше — первый месяц со сравнением',
    async () => {
      const me = await owner()
      await spend(me, '20000', 'AMD', `${m3}-10`, 'groceries')
      await spend(me, '40000', 'AMD', `${m2}-10`, 'groceries')
      const few = await chartMonth(me, m1)
      // Data from m3: before m1 only m3 and m2 are closed; the first month with three is this one.
      expect(few).toMatchObject({ usual: null, comparedFrom: current, closed: [m3, m2] })
      expect(few.deviations).toEqual([])
      expect(few.pace.usual).toBeNull()

      await spend(me, '30000', 'AMD', `${m1}-10`, 'groceries')
      const view = await chartMonth(me, current)
      expect(view.usual).toEqual({ from: m3, to: m1, months: 3 })
      expect(view.comparedFrom).toBeNull()
      expect(view.running).toBe(true)
      expect(view.pace.days).toHaveLength(Number(today.slice(8, 10)))
    },
    HEAVY_MS,
  )

  it(
    'идущий месяц — против обычного к тому же дню, закрытый — против целого, в любой день запуска',
    async () => {
      const me = await owner()
      const groceries = await presetId(me, 'groceries')
      for (const one of [m4, m3, m2]) {
        await spend(me, '10000', 'AMD', `${one}-10`, 'groceries')
        await spend(me, '50000', 'AMD', `${one}-20`, 'groceries')
      }
      await spend(me, '15000', 'AMD', `${m1}-05`, 'groceries')
      const asOwner = { id: me.id, incomeCurrency: 'RUB' as const, spendCurrency: 'AMD' as const }
      // «Today» is the 12th of m1 — noon in Yerevan: the use case is asked as of then.
      const twelfth = new Date(`${m1}-12T08:00:00Z`)
      const running = await moneyChartMonthOf(tripRepositories(db), asOwner, m1, twelfth)
      expect(running.running).toBe(true)
      // To the 12th: the 10th of each closed month, never its 20th.
      expect(running.deviations[0]).toMatchObject({
        categoryId: groceries,
        amount: amd(15_000),
        average: amd(10_000),
        change: 50,
      })
      // Read whole once m1 is closed: everything of each month.
      const closed = await chartMonth(me, m1)
      expect(closed.running).toBe(false)
      expect(closed.deviations[0]).toMatchObject({ average: amd(60_000), change: -75 })
    },
    HEAVY_MS,
  )

  it(
    'обычное смотрит не дальше двенадцати месяцев назад (В-2)',
    async () => {
      const me = await owner()
      const back = (months: number) => {
        let at = current
        for (let step = 0; step < months; step += 1) at = previousMonth(at)
        return at
      }
      for (const months of [13, 12, 11, 10])
        await spend(me, '1000', 'AMD', `${back(months)}-05`, 'cafe')
      const view = await chartMonth(me, current)
      // Thirteen months back is outside; twelve is the first month of the usual.
      expect(view.usual).toEqual({ from: back(12), to: m1, months: 12 })
      expect(view.firstMonth).toBe(back(13))
    },
    HEAVY_MS,
  )

  it(
    'месяц раньше первых данных — пустой месяц человека с данными, а не приглашение новичку (адверсариальное К)',
    async () => {
      const me = await owner()
      await spend(me, '1000', 'AMD', `${m1}-05`, 'cafe')
      const view = await chartMonth(me, m3)
      expect(view).toMatchObject({ firstMonth: m1, closed: [], spent: amd(0) })
      // The first month with three closed before it is three after m1.
      let first = m1
      for (let step = 0; step < 3; step += 1) first = nextMonth(first)
      expect(view.comparedFrom).toBe(first)
      expect((await chartMonth(await owner(), m3)).firstMonth).toBeNull()
    },
    HEAVY_MS,
  )

  it('поход без цен — не данные, поход с ценой — данные, как на «Деньгах» (адверсариальное Н3)', async () => {
    const placeId = await insertPlace(db)
    const trip = async (me: Owner, amountMinor: bigint | null) => {
      const tripId = await insertTrip(db, {
        actorId: me.id,
        placeId,
        startedAt: new Date(Date.now() - 60_000),
        finishedAt: new Date(),
        finishedOn: today,
      })
      await db.insert(expenses).values({
        id: randomUUID(),
        tripId,
        itemId: await insertItem(db),
        amountMinor,
        amountCurrency: amountMinor === null ? null : 'AMD',
      })
    }
    const rated = await owner()
    await trip(rated, null)
    expect((await month(rated, current)).days).toEqual([])
    expect((await chartMonth(rated, current)).firstMonth).toBeNull()

    const priced = await owner()
    await trip(priced, 50_000n)
    expect((await month(priced, current)).spent.minor).toBe(50_000n)
    expect((await chartMonth(priced, current)).firstMonth).toBe(current)
  })

  it(
    'месяцы обычного — со сдвигом зарплаты, как на «Деньгах» (адверсариальное Е)',
    async () => {
      const me = await owner()
      expect((await call(me, 'PUT', '/actors/me/salary-shift', { day: 25 })).statusCode).toBe(200)
      // The salary of the 26th of m4 is m3's «Пришло»: m4 holds nothing on «Деньгах».
      const income = await call(me, 'POST', '/incomes', {
        id: randomUUID(),
        amount: { amount: '100000', currency: 'RUB' },
        receivedOn: `${m4}-26`,
        source: 'salary',
      })
      expect(income.statusCode).toBe(201)
      for (const one of [m3, m2, m1]) await spend(me, '30000', 'AMD', `${one}-10`, 'groceries')
      const monthOfIncome = await month(me, m4)
      expect(monthOfIncome.income.minor).toBe(0n)
      const view = await chartMonth(me, current)
      expect(view.closed).toEqual([m3, m2, m1])
      expect(view.usual).toEqual({ from: m3, to: m1, months: 3 })
      expect(view.firstMonth).toBe(m3)
    },
    HEAVY_MS,
  )

  it('убранная категория без трат в месяце в «Против обычного» не попадает', async () => {
    const me = await owner()
    for (const one of [m4, m3, m2]) await spend(me, '50000', 'AMD', `${one}-01`, 'rent')
    await spend(me, '1000', 'AMD', `${m1}-01`, 'cafe')
    const before = await chartMonth(me, m1)
    expect(before.deviations.map((row) => row.change)).toEqual([-100, null])
    expect(
      (await call(me, 'DELETE', `/spending-categories/${await presetId(me, 'rent')}`)).statusCode,
    ).toBe(200)
    const after = await chartMonth(me, m1)
    expect(after.deviations.map((row) => row.categoryId)).toEqual([await presetId(me, 'cafe')])
  })

  it('чужие траты не видны; без сессии — 401; не месяц — 404; лишний параметр — 400', async () => {
    const me = await owner()
    const other = await owner()
    await spend(other, '5000', 'AMD', today, 'cafe')
    const view = await chartMonth(me, current)
    expect(view.spent.minor).toBe(0n)
    expect(view.slices).toEqual([])

    expect((await call(null, 'GET', `/money/months/${current}/charts`)).statusCode).toBe(401)
    for (const value of ['0000-01', '2026-13', '2026-9', 'x']) {
      expect((await call(me, 'GET', `/money/months/${value}/charts`)).statusCode, value).toBe(404)
    }
    expect((await call(me, 'GET', `/money/months/${current}/charts?actorId=x`)).statusCode).toBe(
      400,
    )
  })
})
