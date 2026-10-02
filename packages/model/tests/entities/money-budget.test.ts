import { describe, expect, it } from 'vitest'
import { budgetFigure, monthBudget, planIn } from '#model/entities/money-budget'
import type { BudgetPlan, BudgetPlanValue } from '#model/entities/money-budget'
import type { MoneyMonth } from '#model/entities/money-month'
import { SPENDING_PRESETS } from '#model/entities/spending-category'
import type { SpendingCategory } from '#model/entities/spending-category'
import { money } from '#model/values/money'
import type { Currency, Money } from '#model/values/money'
import { parseRate, yerevanMidnight } from '#model/values/rates'
import type { ExchangeRate } from '#model/values/rates'

const OWNER = '3f2b1c6e-9a4d-4c1b-8f7e-2d5a6b8c9e01'

/** Major units: `'5000 AMD'`. */
function cash(text: string): Money {
  const [amount = '', currency = ''] = text.split(' ')
  const negative = amount.startsWith('-')
  const [whole = '', cents = ''] = amount.replace('-', '').split('.')
  const minor = BigInt(whole) * 100n + BigInt(cents.padEnd(2, '0'))
  return money(negative ? -minor : minor, currency as Currency)
}

/** 4,30 ֏ for a rouble: the month's rate between the income currency and the spending one. */
function rate(value: string): ExchangeRate {
  return {
    base: 'RUB',
    quote: 'AMD',
    scaled: parseRate(value),
    source: 'official',
    asOf: yerevanMidnight('2026-10-01'),
  }
}

const categories: SpendingCategory[] = SPENDING_PRESETS.map((preset, index) => ({
  id: `00000000-0000-4000-9000-${String(index + 1).padStart(12, '0')}`,
  actorId: OWNER,
  preset,
  name: null,
  colour: null,
  archivedAt: null,
  createdAt: new Date('2026-09-01T00:00:00Z'),
}))
const id = (preset: string) => categories.find((category) => category.preset === preset)!.id

function month(overrides: Partial<MoneyMonth> = {}): MoneyMonth {
  return {
    month: '2026-10',
    spendCurrency: 'AMD',
    incomeCurrency: 'RUB',
    spent: cash('0 AMD'),
    uncounted: [],
    uncountedIn: [],
    foreign: [],
    spentIncome: cash('0 RUB'),
    income: cash('180000 RUB'),
    incomeUncounted: [],
    incomeCount: 1,
    shiftedIn: [],
    shiftedOut: [],
    rest: null,
    accountsFrom: null,
    accountsRemoved: false,
    rate: rate('4.3'),
    rateKind: 'live',
    byCategory: [],
    days: [],
    ...overrides,
  }
}

function spentIn(entries: Record<string, string>): MoneyMonth['byCategory'] {
  return Object.entries(entries).map(([preset, amount]) => ({
    categoryId: id(preset),
    amount: cash(amount),
  }))
}

const amount = (text: string): BudgetPlanValue => ({ kind: 'amount', amount: cash(text) })
const share = (percent: number): BudgetPlanValue => ({ kind: 'share', percent })
const plan = (preset: string | null, from: string, value: BudgetPlanValue | null): BudgetPlan => ({
  categoryId: preset === null ? null : id(preset),
  from,
  plan: value,
})

describe('planIn — which plan holds in a month (В-1)', () => {
  const rent = [
    plan('rent', '2026-09', amount('250000 AMD')),
    plan('rent', '2026-11', amount('270000 AMD')),
  ]

  it('carries a plan over to every month after it', () => {
    expect(planIn(rent, id('rent'), '2026-10')).toEqual(amount('250000 AMD'))
    expect(planIn(rent, id('rent'), '2027-03')).toEqual(amount('270000 AMD'))
  })

  it('leaves the months before a change as they were', () => {
    expect(planIn(rent, id('rent'), '2026-09')).toEqual(amount('250000 AMD'))
    expect(planIn(rent, id('rent'), '2026-11')).toEqual(amount('270000 AMD'))
  })

  it('has no plan before the first one, and none after «no plan from here»', () => {
    expect(planIn(rent, id('rent'), '2026-08')).toBeNull()
    const ended = [...rent, plan('rent', '2027-01', null)]
    expect(planIn(ended, id('rent'), '2027-01')).toBeNull()
    expect(planIn(ended, id('rent'), '2026-12')).toEqual(amount('270000 AMD'))
  })

  it('keeps the savings target apart from every category', () => {
    const plans = [plan(null, '2026-10', share(25)), plan('rent', '2026-10', amount('1 AMD'))]
    expect(planIn(plans, null, '2026-10')).toEqual(share(25))
    expect(planIn(plans, id('cafe'), '2026-10')).toBeNull()
  })
})

describe('monthBudget — the rows', () => {
  it('counts a sum in the spending currency against what was spent', () => {
    const budget = monthBudget(
      month({ byCategory: spentIn({ groceries: '52300 AMD' }) }),
      [plan('groceries', '2026-10', amount('77400 AMD'))],
      categories,
    )
    expect(budget.rows).toEqual([
      {
        categoryId: id('groceries'),
        plan: amount('77400 AMD'),
        planned: cash('77400 AMD'),
        estimated: false,
        plannedWhole: true,
        spent: cash('52300 AMD'),
        spentWhole: true,
        left: cash('25100 AMD'),
        used: 68,
      },
    ])
  })

  it('makes a share of «Пришло» a sum by the month rate — 10 % of 180 000 ₽ at 4,30', () => {
    const [row] = monthBudget(month(), [plan('groceries', '2026-10', share(10))], categories).rows
    expect(row?.planned).toEqual(cash('77400 AMD'))
    expect(row?.estimated).toBe(true)
    expect(row?.plannedWhole).toBe(true)
  })

  it('takes a share of «Пришло» as it is when it is in the spending currency', () => {
    const budget = monthBudget(
      month({ incomeCurrency: 'AMD', income: cash('500000 AMD'), rate: null }),
      [plan('cafe', '2026-10', share(5))],
      categories,
    )
    expect(budget.rows[0]?.planned).toEqual(cash('25000 AMD'))
    expect(budget.rows[0]?.estimated).toBe(false)
  })

  it('rounds a share once, half up, to the minor unit', () => {
    const [row] = monthBudget(
      month({ income: cash('0.03 RUB'), rate: rate('1') }),
      [plan('cafe', '2026-10', share(50))],
      categories,
    ).rows
    expect(row?.planned).toEqual(cash('0.02 AMD'))
  })

  it('plans nothing of nothing: «Пришло» empty is a plan of zero, never a failure', () => {
    const [row] = monthBudget(
      month({ income: cash('0 RUB'), byCategory: spentIn({ cafe: '1000 AMD' }) }),
      [plan('cafe', '2026-10', share(5))],
      categories,
    ).rows
    expect(row?.planned).toEqual(cash('0 AMD'))
    expect(row?.left).toEqual(cash('-1000 AMD'))
    expect(row?.used).toBeNull()
  })

  it('plans nothing of nothing with no rate of the month either', () => {
    const [row] = monthBudget(
      month({ income: cash('0 RUB'), rate: null }),
      [plan('cafe', '2026-10', share(5))],
      categories,
    ).rows
    expect(row).toMatchObject({ planned: cash('0 AMD'), plannedWhole: true })
  })

  it('cannot count a share with no rate of the month — no plan, never a zero', () => {
    const budget = monthBudget(
      month({ rate: null, byCategory: spentIn({ cafe: '1000 AMD' }) }),
      [plan('cafe', '2026-10', share(5)), plan('rent', '2026-10', amount('250000 AMD'))],
      categories,
    )
    expect(budget.rows).toMatchObject([
      { categoryId: id('cafe'), planned: null, left: null, used: null },
      { categoryId: id('rent'), planned: cash('250000 AMD') },
    ])
    expect(budget.total).toMatchObject({ planned: cash('250000 AMD'), whole: false })
  })

  it('says a share is short when some of «Пришло» had no rate', () => {
    const budget = monthBudget(
      month({ incomeUncounted: [cash('100 USD')] }),
      [plan('groceries', '2026-10', share(10))],
      categories,
    )
    expect(budget.rows[0]).toMatchObject({ plannedWhole: false, used: null })
    expect(budget.total?.whole).toBe(false)
    expect(budgetFigure(budget)).toEqual({ planned: true, left: null })
  })

  it('converts a sum kept in another currency after a move, marked «≈» (Р-4)', () => {
    const [row] = monthBudget(
      month(),
      [plan('rent', '2026-10', amount('1000 RUB'))],
      categories,
    ).rows
    expect(row).toMatchObject({ planned: cash('4300 AMD'), estimated: true })
    const none = monthBudget(month(), [plan('rent', '2026-10', amount('10 USD'))], categories)
    expect(none.rows[0]).toMatchObject({ planned: null, estimated: true })
  })

  it.each([
    ['exactly the plan', '250000 AMD', '0 AMD', 100],
    ['a dram short of it', '249999 AMD', '1 AMD', 100],
    ['a dram past it', '250001 AMD', '-1 AMD', 100],
    ['a tenth past it', '275000 AMD', '-25000 AMD', 110],
  ])('%s', (_, spent, left, used) => {
    const [row] = monthBudget(
      month({ byCategory: spentIn({ rent: spent }) }),
      [plan('rent', '2026-10', amount('250000 AMD'))],
      categories,
    ).rows
    expect(row?.left).toEqual(cash(left))
    expect(row?.used).toBe(used)
  })

  it('says no share of a plan of zero', () => {
    const [row] = monthBudget(
      month({ byCategory: spentIn({ pets: '100 AMD' }) }),
      [plan('pets', '2026-10', amount('0 AMD'))],
      categories,
    ).rows
    expect(row).toMatchObject({ left: cash('-100 AMD'), used: null })
  })

  it('says no share where something of the category had no rate', () => {
    const [row] = monthBudget(
      month({ byCategory: spentIn({ cafe: '1000 AMD' }), uncountedIn: [id('cafe')] }),
      [plan('cafe', '2026-10', amount('5000 AMD'))],
      categories,
    ).rows
    expect(row).toMatchObject({ spentWhole: false, used: null, left: cash('4000 AMD') })
  })

  it('lists the rows in the order of the chips, never by how far they went', () => {
    const budget = monthBudget(
      month({ byCategory: spentIn({ cafe: '90000 AMD', groceries: '10 AMD' }) }),
      [
        plan('leisure', '2026-10', amount('1 AMD')),
        plan('cafe', '2026-10', amount('1000 AMD')),
        plan('groceries', '2026-10', amount('1000 AMD')),
      ],
      categories,
    )
    expect(budget.rows.map((row) => row.categoryId)).toEqual([
      id('groceries'),
      id('cafe'),
      id('leisure'),
    ])
  })
})

describe('monthBudget — without a plan, removed categories (Р-5, Р-6)', () => {
  it('puts what was spent with no plan apart, and only what was spent', () => {
    const budget = monthBudget(
      month({ byCategory: spentIn({ transport: '6500 AMD', rent: '250000 AMD' }) }),
      [plan('rent', '2026-10', amount('250000 AMD'))],
      categories,
    )
    expect(budget.unplanned).toEqual([
      { categoryId: id('transport'), spent: cash('6500 AMD'), spentWhole: true },
    ])
    expect(budget.total).toMatchObject({
      planned: cash('250000 AMD'),
      spent: cash('250000 AMD'),
      left: cash('0 AMD'),
      unplanned: cash('6500 AMD'),
    })
  })

  it('names a category of no counted spending but one with no rate, with no plan', () => {
    const budget = monthBudget(month({ uncountedIn: [id('cafe')] }), [], categories)
    expect(budget.unplanned).toEqual([
      { categoryId: id('cafe'), spent: cash('0 AMD'), spentWhole: false },
    ])
  })

  it('lists a category with a plan and nothing spent yet', () => {
    const budget = monthBudget(month(), [plan('pets', '2026-10', amount('38700 AMD'))], categories)
    expect(budget.rows[0]).toMatchObject({ spent: cash('0 AMD'), left: cash('38700 AMD'), used: 0 })
  })

  it('keeps a removed category with its plan where something was spent in it', () => {
    const removed = categories.map((category) =>
      category.preset === 'pets' ? { ...category, archivedAt: new Date('2026-10-05') } : category,
    )
    const plans = [plan('pets', '2026-09', amount('38700 AMD'))]
    const spent = monthBudget(month({ byCategory: spentIn({ pets: '12000 AMD' }) }), plans, removed)
    expect(spent.rows.map((row) => row.categoryId)).toEqual([id('pets')])
    const quiet = monthBudget(month(), plans, removed)
    expect(quiet.rows).toEqual([])
    expect(quiet.total).toBeNull()
  })

  it('has no total while nothing has a plan', () => {
    const budget = monthBudget(month({ byCategory: spentIn({ cafe: '100 AMD' }) }), [], categories)
    expect(budget.total).toBeNull()
    expect(budgetFigure(budget)).toEqual({ planned: false, left: null })
  })
})

describe('monthBudget — the total', () => {
  const plans = [
    plan('groceries', '2026-09', share(10)),
    plan('cafe', '2026-09', share(5)),
    plan('rent', '2026-09', amount('250000 AMD')),
    plan('pets', '2026-09', share(5)),
    plan('leisure', '2026-09', share(10)),
  ]
  const october = month({
    byCategory: spentIn({
      rent: '250000 AMD',
      groceries: '52300 AMD',
      cafe: '41200 AMD',
      pets: '12000 AMD',
      leisure: '8000 AMD',
      transport: '6500 AMD',
      health: '3200 AMD',
    }),
  })

  it('is the screen of the plan artifact: 482 200 planned, 118 700 left, 9 700 apart', () => {
    const budget = monthBudget(october, plans, categories)
    expect(budget.total).toEqual({
      planned: cash('482200 AMD'),
      spent: cash('363500 AMD'),
      left: cash('118700 AMD'),
      unplanned: cash('9700 AMD'),
      leftIncome: cash('27604.65 RUB'),
      whole: true,
    })
    expect(budget.rows.find((row) => row.categoryId === id('cafe'))?.left).toEqual(
      cash('-2500 AMD'),
    )
    expect(budgetFigure(budget)).toEqual({ planned: true, left: cash('118700 AMD') })
  })

  it('says what is over the plan below zero, in the income currency too', () => {
    const budget = monthBudget(
      month({ byCategory: spentIn({ rent: '260000 AMD' }) }),
      [plan('rent', '2026-10', amount('250000 AMD'))],
      categories,
    )
    expect(budget.total?.left).toEqual(cash('-10000 AMD'))
    expect(budget.total?.leftIncome).toEqual(cash('-2325.58 RUB'))
  })

  it('has no figure in the income currency with no rate of the month', () => {
    const budget = monthBudget(
      month({ rate: null, byCategory: spentIn({ rent: '1 AMD' }) }),
      [plan('rent', '2026-10', amount('250000 AMD'))],
      categories,
    )
    expect(budget.total).toMatchObject({ left: cash('249999 AMD'), leftIncome: null, whole: true })
  })
})

describe('monthBudget — savings (В-4)', () => {
  it('sets «Разница» of «Пришло» beside the target', () => {
    const budget = monthBudget(
      month({ spentIncome: cash('86800 RUB') }),
      [plan(null, '2026-09', share(25))],
      categories,
    )
    expect(budget.savings).toEqual({
      target: 25,
      income: cash('180000 RUB'),
      difference: cash('93200 RUB'),
      actual: 52,
    })
  })

  it('says a month spent past what came in, below zero', () => {
    const budget = monthBudget(month({ spentIncome: cash('200000 RUB') }), [], categories)
    expect(budget.savings).toMatchObject({
      target: null,
      difference: cash('-20000 RUB'),
      actual: -11,
    })
  })

  it.each([
    ['nothing came in', { income: cash('0 RUB') }],
    ['no rate of the month', { spentIncome: null }],
    ['a spending with no rate', { uncounted: [cash('10 USD')] }],
    ['an income with no rate', { incomeUncounted: [cash('10 USD')] }],
  ])('compares nothing when %s', (_, overrides) => {
    const budget = monthBudget(month(overrides), [plan(null, '2026-10', share(25))], categories)
    expect(budget.savings).toMatchObject({ target: 25, difference: null, actual: null })
  })
})
