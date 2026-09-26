import { describe, expect, it } from 'vitest'
import type { Income } from '#model/entities/income'
import { lastDayOf, moneyMonth, monthOf, previousMonth } from '#model/entities/money-month'
import type { ConvertOn, MoneyMonthInput, TripLine } from '#model/entities/money-month'
import { spendingIn, spendingSchema } from '#model/entities/spending'
import type { Spending } from '#model/entities/spending'
import {
  SPENDING_PRESETS,
  categoryOrder,
  nextCategoryColour,
  spendingCategorySchema,
} from '#model/entities/spending-category'
import type { SpendingCategory } from '#model/entities/spending-category'
import { ISSUE } from '#model/support/errors'
import { money } from '#model/values/money'
import type { Currency } from '#model/values/money'
import { parseRate, yerevanMidnight } from '#model/values/rates'
import type { ExchangeRate } from '#model/values/rates'

const OWNER = '3f2b1c6e-9a4d-4c1b-8f7e-2d5a6b8c9e01'
let sequence = 0

function nextId(): string {
  sequence += 1
  return `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`
}

/** Major units: `'5000 AMD'`. */
function toMoney(text: string) {
  const [amount = '', currency = ''] = text.split(' ')
  const [whole = '', cents = ''] = amount.split('.')
  return money(BigInt(whole) * 100n + BigInt(cents.padEnd(2, '0')), currency as Currency)
}

/**
 * `rate('AMD', 'USD', '0.0025')`: how much of the quote one of the base is — 0,0025 $ for a dram,
 * 400 ֏ for a dollar. Converts the quote into the base.
 */
function rate(base: Currency, quote: Currency, value: string, day = '2026-09-01'): ExchangeRate {
  return { base, quote, scaled: parseRate(value), source: 'personal', asOf: yerevanMidnight(day) }
}

const presets: SpendingCategory[] = SPENDING_PRESETS.map((preset, index) => ({
  id: `00000000-0000-4000-9000-${String(index + 1).padStart(12, '0')}`,
  actorId: OWNER,
  preset,
  name: null,
  colour: null,
  archivedAt: null,
  createdAt: new Date('2026-09-01T00:00:00Z'),
}))
const categoryId = (preset: string) => presets.find((category) => category.preset === preset)!.id

function spending(
  amount: string,
  on: string,
  category = 'other',
  snapshot: ExchangeRate | null = null,
  at = `${on}T10:00:00Z`,
): Spending {
  return {
    id: nextId(),
    actorId: OWNER,
    spentOn: on,
    amount: toMoney(amount),
    categoryId: categoryId(category),
    note: null,
    place: null,
    rate: snapshot,
    revision: 1,
    createdAt: new Date(at),
    amendedAt: null,
  }
}

function trip(amount: string, on: string, at = `${on}T15:00:00Z`): TripLine {
  return {
    tripId: nextId(),
    placeName: 'Ереван Сити',
    items: 7,
    finishedOn: on,
    finishedAt: new Date(at),
    amount: toMoney(amount),
  }
}

function income(amount: string, on: string): Income {
  return {
    id: nextId(),
    actorId: OWNER,
    amount: toMoney(amount),
    receivedOn: on,
    heldBefore: null,
    source: 'salary',
    note: null,
    revision: 1,
    createdAt: new Date(`${on}T09:00:00Z`),
    amendedAt: null,
  }
}

const never: ConvertOn = () => null

function month(input: Partial<MoneyMonthInput>) {
  return moneyMonth({
    month: '2026-09',
    spendCurrency: 'AMD',
    incomeCurrency: 'RUB',
    spendings: [],
    trips: [],
    incomes: [],
    categories: presets,
    // 5 AMD for a rouble.
    rate: rate('RUB', 'AMD', '5'),
    rateKind: 'live',
    tripInSpend: never,
    incomeInIncome: never,
    ...input,
  })
}

describe('the month of «Деньги»', () => {
  it('sums the spending currency, and says it in the income one by the month rate', () => {
    const result = month({
      spendings: [
        spending('5000 AMD', '2026-09-20', 'beauty'),
        spending('160000 AMD', '2026-09-01', 'rent'),
      ],
    })
    expect(result.spent).toEqual(toMoney('165000 AMD'))
    expect(result.spentIncome).toEqual(toMoney('33000 RUB'))
    expect(result.byCategory.map(({ categoryId: id }) => id)).toEqual([
      categoryId('rent'),
      categoryId('beauty'),
    ])
  })

  it('counts a spending in dollars by the rate of its own day, and lists it under «Включая»', () => {
    const result = month({
      spendings: [
        spending('11 USD', '2026-09-18', 'telecom', rate('AMD', 'USD', '0.0025')),
        spending('1000 AMD', '2026-09-18'),
      ],
    })
    expect(result.spent).toEqual(toMoney('5400 AMD'))
    expect(result.foreign).toEqual([{ amount: toMoney('11 USD'), counted: toMoney('4400 AMD') }])
    expect(result.days[0]).toMatchObject({ total: toMoney('5400 AMD'), estimated: true })
  })

  it('never guesses a spending with no rate of its day: it stays out of the sum and is said apart', () => {
    const result = month({
      spendings: [spending('5.50 EUR', '2026-09-26'), spending('900 AMD', '2026-09-26')],
    })
    expect(result.spent).toEqual(toMoney('900 AMD'))
    expect(result.uncounted).toEqual([toMoney('5.50 EUR')])
    // «Must not fire»: an uncounted spending is not a category's either.
    expect(result.byCategory).toEqual([
      { categoryId: categoryId('other'), amount: toMoney('900 AMD') },
    ])
  })

  it('takes a finished trip into the groceries, one line per currency', () => {
    const result = month({
      trips: [trip('8940 AMD', '2026-09-24')],
      tripInSpend: (amount) => (amount.currency === 'USD' ? toMoney('3900 AMD') : null),
    })
    expect(result.byCategory).toEqual([
      { categoryId: categoryId('groceries'), amount: toMoney('8940 AMD') },
    ])
    const two = month({
      trips: [trip('8940 AMD', '2026-09-24'), trip('10 USD', '2026-09-24')],
      tripInSpend: (amount) => (amount.currency === 'USD' ? toMoney('3900 AMD') : null),
    })
    expect(two.days[0]?.entries).toHaveLength(2)
    expect(two.spent).toEqual(toMoney('12840 AMD'))
  })

  it('counts a trip into the groceries even when «Продукты» was taken out of the choice', () => {
    const archived = presets.map((category) =>
      category.preset === 'groceries' ? { ...category, archivedAt: new Date() } : category,
    )
    const result = month({ categories: archived, trips: [trip('500 AMD', '2026-09-02')] })
    expect(result.byCategory[0]?.categoryId).toBe(categoryId('groceries'))
  })

  it('orders the journal newest day first, and newest first within a day', () => {
    const early = spending('100 AMD', '2026-09-10', 'other', null, '2026-09-10T08:00:00Z')
    const late = spending('200 AMD', '2026-09-10', 'other', null, '2026-09-10T20:00:00Z')
    const newer = spending('300 AMD', '2026-09-11')
    const result = month({ spendings: [early, newer, late] })
    expect(result.days.map((day) => day.day)).toEqual(['2026-09-11', '2026-09-10'])
    expect(
      result.days[1]?.entries.map((entry) => (entry.kind === 'manual' ? entry.spending.id : '')),
    ).toEqual([late.id, early.id])
  })

  it('counts what came in by the official rate of its day, and the rest is signed', () => {
    const result = month({
      spendings: [spending('500000 AMD', '2026-09-06', 'rent')],
      incomes: [income('99615 RUB', '2026-09-15'), income('100 USD', '2026-09-20')],
      incomeInIncome: (amount) => (amount.currency === 'USD' ? toMoney('8200 RUB') : null),
    })
    expect(result.income).toEqual(toMoney('107815 RUB'))
    expect(result.spentIncome).toEqual(toMoney('100000 RUB'))
    expect(result.rest).toEqual(toMoney('7815 RUB'))
  })

  it('says a month that spent more than came in as a negative rest', () => {
    const result = month({
      spendings: [spending('600000 AMD', '2026-09-06', 'rent')],
      incomes: [income('99615 RUB', '2026-09-15')],
    })
    expect(result.rest).toEqual({ minor: -2038500n, currency: 'RUB' })
  })

  it('has no rest and no figure in the income currency without a rate — never a zero', () => {
    const result = month({ rate: null, spendings: [spending('5000 AMD', '2026-09-20')] })
    expect(result.spentIncome).toBeNull()
    expect(result.rest).toBeNull()
  })

  it('needs no rate when both currencies are one', () => {
    const result = month({
      spendCurrency: 'RUB',
      rate: null,
      spendings: [spending('400 RUB', '2026-09-01')],
      incomes: [income('1000 RUB', '2026-09-01')],
    })
    expect(result.spentIncome).toEqual(toMoney('400 RUB'))
    expect(result.rest).toEqual(toMoney('600 RUB'))
    expect(result.rate).toBeNull()
  })

  it('is an empty month, not a failure, with nothing in it', () => {
    const result = month({})
    expect(result.spent).toEqual(toMoney('0 AMD'))
    expect(result.days).toEqual([])
    expect(result.byCategory).toEqual([])
  })
})

describe('months and their days', () => {
  it('knows the month of a day, the month before and the last day — February and December too', () => {
    expect(monthOf('2026-09-30')).toBe('2026-09')
    expect(previousMonth('2026-01')).toBe('2025-12')
    expect(previousMonth('2026-09')).toBe('2026-08')
    expect(lastDayOf('2026-02')).toBe('2026-02-28')
    expect(lastDayOf('2028-02')).toBe('2028-02-29')
    expect(lastDayOf('2026-12')).toBe('2026-12-31')
  })
})

describe('a spending', () => {
  it('refuses a rate snapshot of another currency than its own', () => {
    const wrong = { ...spending('11 USD', '2026-09-18'), rate: rate('AMD', 'EUR', '0.0023') }
    const parsed = spendingSchema.safeParse(wrong)
    expect(parsed.error?.issues[0]?.message).toBe(ISSUE.RATE_NOT_OF_SPENDING_CURRENCY)
  })

  it('is not guessed into a currency its snapshot is not of — a move is not a rate', () => {
    const dollars = spending('11 USD', '2026-09-18', 'other', rate('AMD', 'USD', '0.0025'))
    expect(spendingIn(dollars, 'AMD')).toEqual(toMoney('4400 AMD'))
    expect(spendingIn(dollars, 'RUB')).toBeNull()
  })
})

describe('categories', () => {
  it("stands the presets in their order, then one's own as made", () => {
    const own: SpendingCategory = {
      id: nextId(),
      actorId: OWNER,
      preset: null,
      name: 'Такси',
      colour: 0,
      archivedAt: null,
      createdAt: new Date('2026-09-02T00:00:00Z'),
    }
    const ordered = categoryOrder([own, ...[...presets].reverse()])
    expect(ordered.map((category) => category.preset ?? category.name)).toEqual([
      ...SPENDING_PRESETS,
      'Такси',
    ])
  })

  it("gives one's own the palette by turn", () => {
    const own = (index: number): SpendingCategory => ({
      id: nextId(),
      actorId: OWNER,
      preset: null,
      name: `Своя ${String(index)}`,
      colour: index,
      archivedAt: null,
      createdAt: new Date(),
    })
    expect(nextCategoryColour(presets)).toBe(0)
    expect(nextCategoryColour([...presets, own(0), own(1)])).toBe(2)
    expect(nextCategoryColour(Array.from({ length: 8 }, (_, index) => own(index)))).toBe(0)
  })

  it("is a preset by its key or one's own by name and colour — never both, never neither", () => {
    const base = { id: nextId(), actorId: OWNER, archivedAt: null, createdAt: new Date() }
    expect(
      spendingCategorySchema.safeParse({ ...base, preset: 'cafe', name: null, colour: null })
        .success,
    ).toBe(true)
    expect(
      spendingCategorySchema.safeParse({ ...base, preset: null, name: 'Такси', colour: 3 }).success,
    ).toBe(true)
    expect(
      spendingCategorySchema.safeParse({ ...base, preset: 'cafe', name: 'Кафе', colour: null })
        .success,
    ).toBe(false)
    expect(
      spendingCategorySchema.safeParse({ ...base, preset: null, name: null, colour: null }).success,
    ).toBe(false)
    expect(
      spendingCategorySchema.safeParse({ ...base, preset: null, name: '   ', colour: 1 }).success,
    ).toBe(false)
  })
})
