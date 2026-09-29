import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  moneyChartsCodec,
  moneyMonthCodec,
  monthOf,
  parseRate,
  previousMonth,
  spendingCategoriesResponseCodec,
  yerevanDate,
} from '@molvia/model'
import type { CachedRate, MoneyChartsView, MoneyMonthView } from '@molvia/model'
import type { FastifyInstance } from 'fastify'
import { createRateRepository } from '@/db/rates-repository'
import { moneyMonthRates } from '@/db/schema'
import { tripRepositories } from '@/db/unit-of-work'
import { buildServer } from '@/server'
import { moneyChartsOf } from '@/usecases/money-charts'
import { moneyMonthOf } from '@/usecases/money-month'
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
const [m1, m2, m3] = [
  previousMonth(current),
  previousMonth(previousMonth(current)),
  previousMonth(previousMonth(previousMonth(current))),
]

interface Owner {
  readonly id: string
  readonly cookie: string
}

async function owner(patch: Parameters<typeof insertActor>[1] = {}): Promise<Owner> {
  const id = await insertActor(db, patch)
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

async function charts(me: Owner, period: 6 | 12 = 6): Promise<MoneyChartsView> {
  const response = await call(me, 'GET', `/money/charts?period=${String(period)}`)
  expect(response.statusCode).toBe(200)
  expect(response.headers['cache-control']).toBe('no-store')
  return moneyChartsCodec.parse(response.json())
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

async function receive(me: Owner, amount: string, receivedOn: string, source = 'salary') {
  const response = await call(me, 'POST', '/incomes', {
    id: randomUUID(),
    amount: { amount, currency: 'RUB' },
    receivedOn,
    source,
  })
  expect(response.statusCode).toBe(201)
}

async function exchange(
  me: Owner,
  given: [string, string],
  received: [string, string],
  exchangedOn: string,
  note: string | null = null,
): Promise<string> {
  const id = randomUUID()
  const response = await call(me, 'POST', '/exchanges', {
    id,
    given: { amount: given[0], currency: given[1] },
    received: { amount: received[0], currency: received[1] },
    exchangedOn,
    ...(note === null ? {} : { note }),
  })
  expect(response.statusCode).toBe(201)
  return id
}

/** The central bank's rouble and dollar for every day of the last two hundred, steady. */
async function cacheRates(from = 200, to = 0, rub = '4.0', usd = '390') {
  const rows: CachedRate[] = []
  for (let days = from; days >= to; days -= 1) {
    const date = daysAgo(days)
    rows.push({ provider: 'cba', currency: 'RUB', date, scaled: parseRate(rub), jump: false })
    rows.push({ provider: 'cba', currency: 'USD', date, scaled: parseRate(usd), jump: false })
  }
  await rates.upsert(rows)
}

/**
 * The cases heavy with writes — every bar beside its month, freezing, five exchanges that each walk
 * the wallet: 1–2 s on a quiet machine, past the default five under a loaded one.
 */
const MONTH_BY_MONTH_MS = 30_000

describe('«Графики» (MOL-74)', () => {
  it(
    'каждый столбец — тот же месяц, что на «Деньгах»: траты, «≈», «Пришло», категории',
    async () => {
      await cacheRates()
      const me = await owner()
      await call(me, 'PUT', '/actors/me/salary-shift', { day: 25 })
      await spend(me, '317800', 'AMD', today, 'groceries')
      await spend(me, '120000', 'AMD', `${m1}-05`, 'cafe')
      await spend(me, '11', 'USD', `${m1}-12`, 'cafe')
      await spend(me, '50000', 'AMD', `${m3}-20`, 'groceries')
      await receive(me, '100000', `${m1}-10`)
      // The salary of the 26th counts in the month after (MOL-134).
      await receive(me, '51000', `${m2}-26`)
      await exchange(me, ['20000', 'RUB'], ['81000', 'AMD'], `${m2}-15`, 'Обменник')

      const view = await charts(me)
      expect(view.months.map((one) => one.month)).toHaveLength(6)
      expect(view.months.at(-1)?.month).toBe(current)
      for (const bar of view.months) {
        const shown = await month(me, bar.month)
        expect(bar.spent, bar.month).toEqual(shown.spent)
        expect(bar.spentIncome, bar.month).toEqual(shown.spentIncome)
        expect(bar.income, bar.month).toEqual(shown.income)
        expect(bar.uncounted, bar.month).toEqual(shown.uncounted)
        for (const row of shown.byCategory) {
          const series = view.categories.find((one) => one.category.id === row.categoryId)
          expect(series?.points.find((point) => point.month === bar.month)?.amount).toEqual(
            row.amount,
          )
        }
      }
      expect(view.months.find((one) => one.month === m1)?.income.minor).toBe(15_100_000n)
      expect(view.since).toBe(m3)
    },
    MONTH_BY_MONTH_MS,
  )

  it(
    'первое чтение замораживает закрытые месяцы, сегодняшний обмен их не двигает, а обмен их дня — двигает, как на «Деньгах»',
    async () => {
      await cacheRates()
      const me = await owner()
      await spend(me, '100000', 'AMD', `${m1}-10`, 'cafe')
      await exchange(me, ['10000', 'RUB'], ['40000', 'AMD'], `${m2}-10`)

      const before = await charts(me)
      const frozen = await db.select().from(moneyMonthRates)
      // Every closed month of the period with a rate on its last day: five of six.
      expect(frozen).toHaveLength(5)
      const august = before.months.find((one) => one.month === m1)

      await exchange(me, ['10000', 'RUB'], ['50000', 'AMD'], today)
      expect((await charts(me)).months.find((one) => one.month === m1)).toEqual(august)

      await exchange(me, ['10000', 'RUB'], ['30000', 'AMD'], `${m1}-01`)
      const after = await charts(me)
      const moved = after.months.find((one) => one.month === m1)
      expect(moved?.spentIncome).not.toEqual(august?.spentIncome)
      expect(moved?.spentIncome).toEqual((await month(me, m1)).spentIncome)
    },
    MONTH_BY_MONTH_MS,
  )

  it(
    'потери на обменах — по обменникам, в валюте трат, худшие сверху, неизмеренное названо',
    async () => {
      await cacheRates()
      const me = await owner()
      // 390 ֏ за $ у ЦБ: 800 $ по 372 — на 14 400 ֏ меньше.
      await exchange(me, ['800', 'USD'], ['297600', 'AMD'], daysAgo(40), 'Аэропорт')
      await exchange(me, ['100', 'USD'], ['38000', 'AMD'], daysAgo(30), ' аэропорт ')
      await exchange(me, ['100', 'USD'], ['39500', 'AMD'], daysAgo(20), 'Fast Bank')
      // Roubles into dollars: the difference is in dollars and comes into drams by the bank's day.
      await exchange(me, ['9750', 'RUB'], ['100', 'USD'], daysAgo(10), 'ВТБ')
      // Before the cache: no comparison — named, not summed.
      await exchange(me, ['100', 'USD'], ['39000', 'AMD'], daysAgo(300), 'Старый')
      // More than twelve months back: not in the card at all.
      await exchange(me, ['100', 'USD'], ['39000', 'AMD'], daysAgo(400), 'Давний')

      const losses = (await charts(me)).exchanges
      expect(losses?.groups.map((group) => [group.place, group.count])).toEqual([
        ['аэропорт', 2],
        ['ВТБ', 1],
        ['Fast Bank', 1],
      ])
      const airport = losses?.groups[0]
      // −14 400 − 1 000 of 312 000 + 39 000.
      expect(airport?.difference).toEqual({ minor: -1_540_000n, currency: 'AMD' })
      expect(airport?.percent).toBe(-439)
      expect(losses?.groups[1]?.difference.currency).toBe('AMD')
      expect(losses?.groups[1]).toMatchObject({ place: 'ВТБ', percent: 0 })
      expect(losses?.groups[2]).toMatchObject({ place: 'Fast Bank', percent: 128 })
      expect(losses?.uncounted).toBe(1)
    },
    MONTH_BY_MONTH_MS,
  )

  it('курс ₽ и ֏ по неделям, с разрывом там, где курса нет, и моими обменами пары точками', async () => {
    await cacheRates(200, 60)
    const me = await owner()
    await exchange(me, ['20000', 'RUB'], ['79000', 'AMD'], daysAgo(70))
    await exchange(me, ['100000', 'AMD'], ['24000', 'RUB'], daysAgo(65))
    await exchange(me, ['100', 'USD'], ['39000', 'AMD'], daysAgo(64))

    const line = (await charts(me)).rate
    const known = line?.points.filter((point) => point.rate !== null) ?? []
    expect(known.length).toBeGreaterThan(0)
    expect(known.every((point) => point.rate?.base === 'RUB' && point.rate.quote === 'AMD')).toBe(
      true,
    )
    // The cache stops sixty days ago: the last weeks are gaps, never zeros.
    expect(line?.points.at(-1)).toMatchObject({ day: today, rate: null, level: null })
    // Both exchanges of the pair, either way; the dollar one is another pair.
    expect(line?.exchanges.map((one) => [one.day, one.rate.base])).toEqual([
      [daysAgo(70), 'RUB'],
      [daysAgo(65), 'RUB'],
    ])
  })

  it('двенадцать месяцев по просьбе; одна валюта на всё — курса пары нет; новичку — ничего', async () => {
    const me = await owner({ incomeCurrency: 'AMD' })
    const year = await charts(me, 12)
    expect(year.period).toBe(12)
    expect(year.months).toHaveLength(12)
    expect(year.since).toBeNull()
    // Every category of the owner is offered, as twelve months of nothing.
    expect(year.categories.every((one) => one.points.every((point) => point.level === 0))).toBe(
      true,
    )
    expect(year.exchanges).toBeNull()
    expect(year.rate).toBeNull()
    expect(year.spentAverage).toBeNull()
  })

  it('чужие траты не видны; без сессии — 401; иной период и лишний параметр — 400', async () => {
    const me = await owner()
    const other = await owner()
    await spend(other, '5000', 'AMD', today, 'cafe')
    expect((await charts(me)).since).toBeNull()

    expect((await call(null, 'GET', '/money/charts')).statusCode).toBe(401)
    for (const query of ['?period=7', '?period=', '?period=6&actorId=x', '?period=6&period=12']) {
      expect((await call(me, 'GET', `/money/charts${query}`)).statusCode, query).toBe(400)
    }
    expect((await call(me, 'GET', '/money/charts')).statusCode).toBe(200)
  })

  it('месяц без трат посередине — ноль, а среднее — по закрытым месяцам от первого с данными', async () => {
    await cacheRates()
    const me = await owner()
    await spend(me, '300000', 'AMD', `${m3}-10`, 'cafe')
    await spend(me, '100000', 'AMD', `${m1}-10`, 'cafe')
    await spend(me, '999999', 'AMD', today, 'cafe')
    const view = await charts(me)
    expect(view.months.find((one) => one.month === m2)).toMatchObject({
      spent: { minor: 0n, currency: 'AMD' },
      spentLevel: 0,
    })
    // m3, m2, m1: 400 000 over three closed months; the running one is not averaged.
    expect(view.spentAverage).toEqual({ minor: 13_333_333n, currency: 'AMD' })
  })
})

/** The rouble alone, every day of the last two hundred: a dollar income has no rate of its day. */
async function cacheRoubles() {
  const rows: CachedRate[] = []
  for (let days = 200; days >= 0; days -= 1) {
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

describe('«Графики» — по ревью PR #77', () => {
  it('months each fine on «Деньгах» are fine on the charts too, however much a category adds up to (adversarial d9 А)', async () => {
    await cacheRates()
    const me = await owner()
    // 5·10¹⁶ ֏ twice: each under what money holds, together over it.
    await spend(me, '50000000000000000', 'AMD', `${m1}-10`, 'groceries')
    await spend(me, '50000000000000000', 'AMD', today, 'groceries')
    const view = await charts(me)
    expect(view.categories[0]?.points.at(-1)?.amount.minor).toBe(5_000_000_000_000_000_000n)
  })

  it('«к августу» past what a number holds is left unsaid, not a 500 (adversarial d9 А)', async () => {
    await cacheRates()
    const me = await owner()
    await spend(me, '0.01', 'AMD', `${m1}-10`, 'groceries')
    await spend(me, '100000000000000', 'AMD', today, 'groceries')
    expect((await charts(me)).months.at(-1)?.change).toBeNull()
  })

  it('a salary in dollars on a day with no dollar: no «Разница» for the month, and the average stands on the counted one (adversarial d9 В)', async () => {
    await cacheRoubles()
    const me = await owner()
    await spend(me, '100000', 'AMD', `${m2}-10`, 'groceries')
    await receive(me, '30000', `${m2}-05`)
    await spend(me, '100000', 'AMD', `${m1}-10`, 'groceries')
    const salary = await call(me, 'POST', '/incomes', {
      id: randomUUID(),
      amount: { amount: '300', currency: 'USD' },
      receivedOn: `${m1}-05`,
      source: 'salary',
    })
    expect(salary.statusCode).toBe(201)
    const view = await charts(me)
    const august = view.months.find((one) => one.month === m1)
    expect(august?.incomeUncounted).toEqual([{ minor: 30_000n, currency: 'USD' }])
    expect(august?.difference).toBeNull()
    expect(view.differenceAverage).toEqual({ minor: 500_000n, currency: 'RUB' })
  })

  it('a category spent only before the period is offered as months of nothing, not swapped for another (adversarial А, d9 Г)', async () => {
    await cacheRates()
    const me = await owner()
    const old = previousMonth(previousMonth(previousMonth(previousMonth(m3))))
    await spend(me, '25000', 'AMD', `${old}-12`, 'clothes')
    await spend(me, '10000', 'AMD', today, 'groceries')
    const clothes = await presetId(me, 'clothes')
    const view = await charts(me)
    expect(view.categories[0]?.category.preset).toBe('groceries')
    const series = view.categories.find((one) => one.category.id === clothes)
    expect(series?.points.every((point) => point.amount.minor === 0n)).toBe(true)
  })

  it('an exchange the bank has no rate of its day for is named, never measured by an old one (adversarial Е)', async () => {
    await cacheRates(200, 40)
    const me = await owner()
    await exchange(me, ['10000', 'RUB'], ['38000', 'AMD'], daysAgo(5), 'Рынок')
    await exchange(me, ['10000', 'RUB'], ['38000', 'AMD'], daysAgo(60), 'Рынок')
    const losses = (await charts(me)).exchanges
    expect(losses?.uncounted).toBe(1)
    expect(losses?.groups).toMatchObject([{ place: 'Рынок', count: 1 }])
  })

  it(
    'an exchange written while the months are being frozen still moves them after (adversarial Ж)',
    async () => {
      await cacheRates()
      const me = await owner()
      await spend(me, '100000', 'AMD', `${m1}-10`, 'cafe')
      await exchange(me, ['10000', 'RUB'], ['40000', 'AMD'], daysAgo(150))
      const repositories = tripRepositories(db)
      const freeze = repositories.money.freeze.bind(repositories.money)
      let written = false
      const racing = {
        ...repositories,
        money: {
          ...repositories.money,
          async freeze(...args: Parameters<typeof freeze>) {
            if (!written) {
              written = true
              // Amended back to the first of last month, while this read is freezing.
              await exchange(me, ['10000', 'RUB'], ['30000', 'AMD'], `${m1}-01`)
            }
            return freeze(...args)
          },
        },
      }
      const read = await moneyChartsOf(
        racing,
        { id: me.id, incomeCurrency: 'RUB', spendCurrency: 'AMD' },
        6,
      )
      expect(written).toBe(true)
      const stale = read.months.find((one) => one.month === m1)?.spentIncome
      const after = await month(me, m1)
      expect(after.spentIncome).not.toEqual(stale)
      expect((await charts(me)).months.find((one) => one.month === m1)?.spentIncome).toEqual(
        after.spentIncome,
      )
    },
    MONTH_BY_MONTH_MS,
  )
})

describe('«Графики» — второй заход ревью PR #77', () => {
  /** Last month spent 100 000 ֏; the own rate 4,0 ֏ a rouble, and 3,0 from the first of last month. */
  async function scene(): Promise<{ me: Owner; late: string }> {
    await cacheRates()
    const me = await owner()
    await spend(me, '100000', 'AMD', `${m1}-10`, 'cafe')
    await exchange(me, ['10000', 'RUB'], ['40000', 'AMD'], daysAgo(150))
    const late = await exchange(me, ['10000', 'RUB'], ['30000', 'AMD'], `${m1}-01`)
    return { me, late }
  }
  const takeOut = async (me: Owner, id: string) => {
    expect((await call(me, 'DELETE', `/exchanges/${id}`)).statusCode).toBeLessThan(300)
  }
  const bringBack = async (me: Owner, id: string) => {
    expect((await call(me, 'POST', `/exchanges/${id}/restore`)).statusCode).toBeLessThan(300)
  }

  it(
    '«Удалить» and «Вернуть» inside one read still let the month go after it (d9 round 2 Ж2)',
    async () => {
      const { me, late } = await scene()
      const withIt = (await month(me, m1)).spentIncome
      // Let the month go, so the read below is the one that freezes it.
      await takeOut(me, late)
      await bringBack(me, late)
      const repositories = tripRepositories(db)
      const list = repositories.exchanges.list.bind(repositories.exchanges)
      const freeze = repositories.money.freeze.bind(repositories.money)
      let lists = 0
      let restored = false
      const racing = {
        ...repositories,
        exchanges: {
          ...repositories.exchanges,
          // The first read is the rates': «Удалить» lands just before it.
          async list(...args: Parameters<typeof list>) {
            lists += 1
            if (lists === 1) await takeOut(me, late)
            return list(...args)
          },
        },
        money: {
          ...repositories.money,
          // «Вернуть» lands after the rates are worked out, before the first month is frozen.
          async freeze(...args: Parameters<typeof freeze>) {
            if (!restored) {
              restored = true
              await bringBack(me, late)
            }
            return freeze(...args)
          },
        },
      }
      await moneyChartsOf(racing, { id: me.id, incomeCurrency: 'RUB', spendCurrency: 'AMD' }, 6)
      expect(restored).toBe(true)
      expect((await month(me, m1)).spentIncome).toEqual(withIt)
    },
    MONTH_BY_MONTH_MS,
  )

  it(
    'a closed month of «Деньги» frozen while an exchange lands still counts it after (review С-9)',
    async () => {
      const { me, late } = await scene()
      const withIt = (await month(me, m1)).spentIncome
      await takeOut(me, late)
      const repositories = tripRepositories(db)
      const freeze = repositories.money.freeze.bind(repositories.money)
      let restored = false
      const racing = {
        ...repositories,
        money: {
          ...repositories.money,
          async freeze(...args: Parameters<typeof freeze>) {
            if (!restored) {
              restored = true
              await bringBack(me, late)
            }
            return freeze(...args)
          },
        },
      }
      const owner = { id: me.id, incomeCurrency: 'RUB', spendCurrency: 'AMD' } as const
      await moneyMonthOf(racing, owner, m1)
      expect(restored).toBe(true)
      expect((await month(me, m1)).spentIncome).toEqual(withIt)
    },
    MONTH_BY_MONTH_MS,
  )

  it('must not fire: the running month of «Деньги» freezes nothing and reads the receipts once more for nothing (review С-9)', async () => {
    const { me } = await scene()
    const repositories = tripRepositories(db)
    const list = repositories.exchanges.list.bind(repositories.exchanges)
    let lists = 0
    const counting = {
      ...repositories,
      exchanges: {
        ...repositories.exchanges,
        async list(...args: Parameters<typeof list>) {
          lists += 1
          return list(...args)
        },
      },
    }
    const owner = { id: me.id, incomeCurrency: 'RUB', spendCurrency: 'AMD' } as const
    await moneyMonthOf(counting, owner, current)
    const running = lists
    lists = 0
    await moneyMonthOf(counting, owner, m1)
    // A closed month reads the receipts once more, after freezing; the running one does not.
    expect(lists).toBe(running + 1)
  })

  it('a month with nothing spent and no rate is «ушло 0», and «Разница» is what came in (review С-7)', async () => {
    const me = await owner()
    await receive(me, '50000', `${m2}-10`)
    const view = await charts(me)
    const bar = view.months.find((one) => one.month === m2)
    expect(bar?.spentIncome).toEqual({ minor: 0n, currency: 'RUB' })
    expect(bar?.spentIncomeLevel).toBe(0)
    expect(bar?.difference).toEqual({ minor: 5_000_000n, currency: 'RUB' })
    expect((await month(me, m2)).spentIncome).toEqual({ minor: 0n, currency: 'RUB' })
  })
})
