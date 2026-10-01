import { describe, expect, it } from 'vitest'
import type { Income, IncomeSource } from '#model/entities/income'
import {
  budgetMonthOf,
  lastDayOf,
  moneyMonth,
  monthOf,
  nextMonth,
  percentChange,
  previousMonth,
  shareOf,
} from '#model/entities/money-month'
import type { ConvertOn, MoneyMonthInput, MonthHeld, TripLine } from '#model/entities/money-month'
import { balancesOn, convertSigned } from '#model/entities/money-account'
import type { AccountOperation, MoneyAccount } from '#model/entities/money-account'
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
import type { Currency, Money } from '#model/values/money'
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
 * `rate('USD', 'AMD', '400')`: how much of the quote one of the base is — 0,0025 $ for a dram,
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
    accountId: null,
    debited: null,
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

function income(amount: string, on: string, source: IncomeSource = 'salary'): Income {
  return {
    id: nextId(),
    actorId: OWNER,
    amount: toMoney(amount),
    receivedOn: on,
    heldBefore: null,
    source,
    note: null,
    accountId: null,
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
    salaryShiftDay: null,
    categories: presets,
    // 5 AMD for a rouble.
    rate: rate('RUB', 'AMD', '5'),
    rateKind: 'live',
    inSpend: never,
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
        spending('11 USD', '2026-09-18', 'telecom', rate('USD', 'AMD', '400')),
        spending('1000 AMD', '2026-09-18'),
      ],
    })
    expect(result.spent).toEqual(toMoney('5400 AMD'))
    expect(result.foreign).toEqual([{ amount: toMoney('11 USD'), counted: toMoney('4400 AMD') }])
    expect(result.days[0]).toMatchObject({ total: toMoney('5400 AMD'), estimated: true })
  })

  it('counts a spending with no snapshot into the spending currency as a trip line: by its day (Р-5)', () => {
    // Drams of August after a move to dollars — the trip beside them is 10 $ and so are they (Д8).
    const byDay: ConvertOn = (amount, day) =>
      amount.currency === 'AMD' && day === '2026-09-10' ? toMoney('10 USD') : null
    const result = month({
      spendCurrency: 'USD',
      rate: null,
      spendings: [spending('4000 AMD', '2026-09-10')],
      trips: [trip('4000 AMD', '2026-09-10')],
      inSpend: byDay,
    })
    expect(result.spent).toEqual(toMoney('20 USD'))
    expect(result.uncounted).toEqual([])
  })

  it('keeps a snapshot of the pair on either side: drams for someone who counts in dollars', () => {
    const result = month({
      spendCurrency: 'USD',
      rate: null,
      spendings: [spending('3900 AMD', '2026-09-10', 'other', rate('USD', 'AMD', '390'))],
    })
    expect(result.spent).toEqual(toMoney('10 USD'))
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

  it('names the categories whose sums are short: a spending and a trip with no rate (d9 round 3, В3)', () => {
    const result = month({
      spendings: [
        spending('5 USD', '2026-09-12', 'cafe'),
        spending('900 AMD', '2026-09-12', 'clothes'),
      ],
      trips: [trip('20 EUR', '2026-09-14')],
    })
    expect(result.uncountedIn).toEqual([categoryId('cafe'), categoryId('groceries')].sort())
    expect(month({ spendings: [spending('900 AMD', '2026-09-12', 'cafe')] }).uncountedIn).toEqual(
      [],
    )
  })

  it('takes a finished trip into the groceries, one line per currency', () => {
    const result = month({
      trips: [trip('8940 AMD', '2026-09-24')],
      inSpend: (amount) => (amount.currency === 'USD' ? toMoney('3900 AMD') : null),
    })
    expect(result.byCategory).toEqual([
      { categoryId: categoryId('groceries'), amount: toMoney('8940 AMD') },
    ])
    const two = month({
      trips: [trip('8940 AMD', '2026-09-24'), trip('10 USD', '2026-09-24')],
      inSpend: (amount) => (amount.currency === 'USD' ? toMoney('3900 AMD') : null),
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

  it('counts what came in by the official rate of its day', () => {
    const result = month({
      spendings: [spending('500000 AMD', '2026-09-06', 'rent')],
      incomes: [income('99615 RUB', '2026-09-15'), income('100 USD', '2026-09-20')],
      incomeInIncome: (amount) => (amount.currency === 'USD' ? toMoney('8200 RUB') : null),
    })
    expect(result.income).toEqual(toMoney('107815 RUB'))
    expect(result.spentIncome).toEqual(toMoney('100000 RUB'))
  })

  it('no longer takes what was spent from what came in: the rest is the accounts (MOL-134, Р-5)', () => {
    const result = month({
      spendings: [spending('600000 AMD', '2026-09-06', 'rent')],
      incomes: [income('99615 RUB', '2026-09-15')],
    })
    expect(result.rest).toBeNull()
    expect(result.accountsFrom).toBeNull()
  })

  it('has no figure in the income currency without a rate — never a zero', () => {
    const result = month({ rate: null, spendings: [spending('5000 AMD', '2026-09-20')] })
    expect(result.spentIncome).toBeNull()
  })

  it('is «0» in the income currency with nothing spent, rate or none (review of MOL-74, С-7)', () => {
    const empty = month({ rate: null, incomes: [income('50000 RUB', '2026-09-10')] })
    expect(empty.spentIncome).toEqual(toMoney('0 RUB'))
    // A month spent only in what did not convert: nothing counted, nothing to convert.
    const unconverted = month({
      rate: null,
      spendings: [spending('10 EUR', '2026-09-20')],
      inSpend: () => null,
    })
    expect(unconverted.spent).toEqual(toMoney('0 AMD'))
    expect(unconverted.spentIncome).toEqual(toMoney('0 RUB'))
  })

  it('needs no rate when both currencies are one', () => {
    const result = month({
      spendCurrency: 'RUB',
      rate: null,
      spendings: [spending('400 RUB', '2026-09-01')],
      incomes: [income('1000 RUB', '2026-09-01')],
    })
    expect(result.spentIncome).toEqual(toMoney('400 RUB'))
    expect(result.rate).toBeNull()
  })

  it('leaves out what money cannot hold rather than failing the month (Д5)', () => {
    const huge = (on: string) => ({
      ...spending('1 AMD', on),
      amount: money(5n * 10n ** 18n, 'AMD'),
    })
    const result = month({
      spendings: [huge('2026-09-02'), huge('2026-09-01'), spending('100 AMD', '2026-09-03')],
      incomes: [
        { ...income('1 RUB', '2026-09-02'), amount: money(5n * 10n ** 18n, 'RUB') },
        { ...income('1 RUB', '2026-09-03'), amount: money(5n * 10n ** 18n, 'RUB') },
      ],
      rate: null,
    })
    // Newest first: the spending of the 2nd is counted, the 1st would carry the sum past int8.
    expect(result.spent).toEqual(money(5n * 10n ** 18n + 10000n, 'AMD'))
    expect(result.uncounted).toEqual([money(5n * 10n ** 18n, 'AMD')])
    expect(result.days.find((day) => day.day === '2026-09-01')?.entries[0]?.counted).toBeNull()
    expect(result.income).toEqual(money(5n * 10n ** 18n, 'RUB'))
    expect(result.incomeUncounted).toEqual([money(5n * 10n ** 18n, 'RUB')])
  })

  it('has no figure in the income currency when the month comes to more than money holds', () => {
    const result = month({
      spendings: [{ ...spending('1 AMD', '2026-09-02'), amount: money(9n * 10n ** 18n, 'AMD') }],
      rate: rate('AMD', 'RUB', '10'),
    })
    expect(result.spentIncome).toBeNull()
  })

  it('is an empty month, not a failure, with nothing in it', () => {
    const result = month({})
    expect(result.spent).toEqual(toMoney('0 AMD'))
    expect(result.days).toEqual([])
    expect(result.byCategory).toEqual([])
  })
})

describe('зарплата с N-го — в «Пришло» следующего месяца (MOL-134, В-2, В-3)', () => {
  const salary = (on: string) => income('100 RUB', on)

  it('moves a salary from the day on, and not a day before', () => {
    expect(budgetMonthOf(salary('2026-08-24'), 25)).toBe('2026-08')
    expect(budgetMonthOf(salary('2026-08-25'), 25)).toBe('2026-09')
    expect(budgetMonthOf(salary('2026-08-31'), 25)).toBe('2026-09')
    expect(budgetMonthOf(salary('2026-09-01'), 25)).toBe('2026-09')
  })

  it('moves December into January of the next year', () => {
    expect(budgetMonthOf(salary('2026-12-28'), 25)).toBe('2027-01')
    expect(nextMonth('2026-12')).toBe('2027-01')
    expect(nextMonth('2026-09')).toBe('2026-10')
  })

  it('moves nothing with the setting off, nothing but a salary, and nothing past the month end (Н-7)', () => {
    expect(budgetMonthOf(salary('2026-08-31'), null)).toBe('2026-08')
    for (const source of ['bonus', 'gift', 'brought'] as const) {
      expect(budgetMonthOf(income('100 RUB', '2026-08-31', source), 25), source).toBe('2026-08')
    }
    expect(budgetMonthOf(salary('2026-09-30'), 31)).toBe('2026-09')
    expect(budgetMonthOf(salary('2026-08-31'), 31)).toBe('2026-09')
    expect(budgetMonthOf(salary('2026-08-01'), 1)).toBe('2026-09')
  })

  it('counts the salary of the 31st in September and not in August, and names both days', () => {
    const incomes = [
      salary('2026-08-15'),
      income('102345 RUB', '2026-08-31'),
      income('99615 RUB', '2026-09-15'),
      income('500 RUB', '2026-09-26', 'bonus'),
      income('101000 RUB', '2026-09-26'),
    ]
    const september = month({ incomes, salaryShiftDay: 25 })
    expect(september.income).toEqual(toMoney('202460 RUB'))
    expect(september.shiftedIn).toEqual(['2026-08-31'])
    expect(september.shiftedOut).toEqual(['2026-09-26'])

    const august = month({ month: '2026-08', incomes, salaryShiftDay: 25 })
    expect(august.income).toEqual(toMoney('100 RUB'))
    expect(august.shiftedIn).toEqual([])
    expect(august.shiftedOut).toEqual(['2026-08-31'])
  })

  it('keeps every income in its own month, and names none, with the setting off', () => {
    const incomes = [income('102345 RUB', '2026-08-31'), income('99615 RUB', '2026-09-15')]
    const september = month({ incomes })
    expect(september.income).toEqual(toMoney('99615 RUB'))
    expect(september).toMatchObject({ shiftedIn: [], shiftedOut: [] })
  })

  it('counts the incomes of «Пришло»: one moved in, not one moved out, and one with no rate (MOL-159)', () => {
    const incomes = [
      income('102345 RUB', '2026-08-31'),
      income('99615 RUB', '2026-09-15'),
      income('500 USD', '2026-09-20', 'bonus'),
      income('101000 RUB', '2026-09-26'),
    ]
    const september = month({ incomes, salaryShiftDay: 25 })
    expect(september.incomeUncounted).toEqual([toMoney('500 USD')])
    expect(september.incomeCount).toBe(3)
    expect(month({ incomes }).incomeCount).toBe(3)
    expect(month({}).incomeCount).toBe(0)
  })

  it('names a day once, however many salaries came on it', () => {
    const incomes = [income('1 RUB', '2026-08-31'), income('2 RUB', '2026-08-31')]
    expect(month({ incomes, salaryShiftDay: 25 }).shiftedIn).toEqual(['2026-08-31'])
  })

  it('counts a moved salary in another currency by the official rate of its own day', () => {
    const days: string[] = []
    const result = month({
      incomes: [income('1000 USD', '2026-08-31')],
      salaryShiftDay: 25,
      incomeInIncome: (amount, day) => {
        days.push(`${amount.currency} ${day}`)
        return toMoney('86000 RUB')
      },
    })
    expect(result.income).toEqual(toMoney('86000 RUB'))
    expect(days).toEqual(['USD 2026-08-31'])
  })
})

describe('«Остаток» — деньги на счетах на конец месяца (MOL-134)', () => {
  // 5 AMD for a rouble, as the month's rate above; 86 RUB for a dollar by the day's rule.
  const inIncome = (balance: Money): Money | null =>
    balance.currency === 'RUB'
      ? balance
      : balance.currency === 'AMD'
        ? convertSigned(balance, rate('RUB', 'AMD', '5'))
        : balance.currency === 'USD'
          ? convertSigned(balance, rate('USD', 'RUB', '86'))
          : null
  const held = (
    balances: {
      balance: string
      savings?: boolean
      minor?: bigint
      uncounted?: number
      name?: string
    }[],
    accountsFrom: string | null = '2026-09-16',
    accountsRemoved = false,
  ): MonthHeld => ({
    balances: balances.map(({ balance, savings = false, minor, uncounted = 0, name }) => ({
      name: name ?? `Счёт ${balance}`,
      balance: minor === undefined ? toMoney(balance) : money(minor, toMoney(balance).currency),
      savings,
      uncounted,
    })),
    accountsFrom,
    accountsRemoved,
    inIncome,
  })

  it('sums every account into the income currency, and without the savings apart (В-1)', () => {
    const result = month({
      held: held([
        { balance: '230000 AMD' },
        { balance: '405 RUB' },
        { balance: '8570 USD', savings: true },
      ]),
    })
    expect(result.rest).toEqual({
      total: toMoney('783425 RUB'),
      spendable: toMoney('46405 RUB'),
      uncounted: { total: [], spendable: [] },
      operationsUncounted: { total: 0, spendable: 0 },
    })
    expect(result.accountsFrom).toBe('2026-09-16')
  })

  it('takes a card in debt away, and may be below zero', () => {
    const result = month({
      held: held([{ balance: '100 RUB' }, { balance: '1 RUB', minor: -50000n }]),
    })
    expect(result.rest).toMatchObject({
      total: { minor: -40000n, currency: 'RUB' },
      spendable: { minor: -40000n, currency: 'RUB' },
    })
  })

  it('says a balance nothing converts apart in its own currency, never as a zero (п. 5)', () => {
    const result = month({
      held: held([
        { balance: '100 RUB' },
        { balance: '8470 EUR', savings: true, name: 'Евро дома' },
      ]),
    })
    expect(result.rest).toEqual({
      total: toMoney('100 RUB'),
      spendable: toMoney('100 RUB'),
      // Savings: missing from «всего» only (adversarial А, З).
      uncounted: { total: [{ name: 'Евро дома', balance: toMoney('8470 EUR') }], spendable: [] },
      operationsUncounted: { total: 0, spendable: 0 },
    })
  })

  it('names every account nothing converts on its own: savings and a debt never cancel out (А)', () => {
    const result = month({
      held: held([
        { balance: '1000 RUB' },
        { balance: '100 EUR', savings: true, name: 'Евро дома' },
        { balance: '1 EUR', minor: -10000n, name: 'Евро-карта' },
      ]),
    })
    // «Всего» is whole — the euros come to nothing — and «без сбережений» misses the card alone.
    expect(result.rest).toMatchObject({
      total: toMoney('1000 RUB'),
      spendable: toMoney('1000 RUB'),
      uncounted: {
        total: [],
        spendable: [{ name: 'Евро-карта', balance: money(-10000n, 'EUR') }],
      },
    })
  })

  it('names under a figure only what that figure misses (adversarial З)', () => {
    // Two cards of ±100 € and a safe of 50 €: «без сбережений» is whole, «всего» misses the safe…
    const cards = month({
      held: held([
        { balance: '1000 RUB' },
        { balance: '100 EUR', name: 'Карта 1 €' },
        { balance: '1 EUR', minor: -10000n, name: 'Карта 2 €' },
        { balance: '50 EUR', savings: true, name: 'Сейф €' },
      ]),
    })
    expect(cards.rest?.uncounted).toEqual({
      total: [
        { name: 'Карта 1 €', balance: toMoney('100 EUR') },
        { name: 'Карта 2 €', balance: money(-10000n, 'EUR') },
        { name: 'Сейф €', balance: toMoney('50 EUR') },
      ],
      spendable: [],
    })
    // …and a safe of +100 € beside a card of −100 €: «всего» is whole.
    const safe = month({
      held: held([
        { balance: '100 EUR', savings: true, name: 'Сейф €' },
        { balance: '1 EUR', minor: -10000n, name: 'Карта €' },
      ]),
    })
    expect(safe.rest?.uncounted.total).toEqual([])
  })

  it('counts the operations no rate counted for each figure: the savings miss «всего» only (Б, Е)', () => {
    const result = month({
      held: held([
        { balance: '100 RUB', uncounted: 1 },
        { balance: '5 RUB', uncounted: 2, savings: true },
      ]),
    })
    expect(result.rest?.operationsUncounted).toEqual({ total: 3, spendable: 1 })
  })

  it('needs no rate for an empty account, and never names one as «не посчитано: 0 €» (Д)', () => {
    const result = month({
      held: held([{ balance: '1000 RUB' }, { balance: '0 EUR', name: 'Евро-кошелёк' }]),
    })
    expect(result.rest).toMatchObject({
      total: toMoney('1000 RUB'),
      uncounted: { total: [], spendable: [] },
    })
    // A currency that cannot be counted names its accounts with money, not the empty ones.
    const mixed = month({
      held: held([
        { balance: '0 EUR', name: 'Пустой' },
        { balance: '50 EUR', name: 'Кошелёк' },
      ]),
    })
    expect(mixed.rest?.uncounted.total.map((entry) => entry.name)).toEqual(['Кошелёк'])
  })

  it('converts one sum per currency: the same money on one account or two is the same rest (В)', () => {
    // 2,02 ֏ is 0,404 ₽ — rounded per account, two of them made 0,80 ₽ where 4,04 ֏ is 0,81 ₽.
    const two = month({ held: held([{ balance: '2.02 AMD' }, { balance: '2.02 AMD' }]) })
    const one = month({ held: held([{ balance: '4.04 AMD' }]) })
    expect(two.rest?.total).toEqual(one.rest?.total)
    expect(one.rest?.total).toEqual(toMoney('0.81 RUB'))
  })

  it('leaves out a currency whose sum money cannot hold, account by account', () => {
    const result = month({
      held: held([
        { balance: '1 RUB', minor: 5n * 10n ** 18n },
        { balance: '1 RUB', minor: 5n * 10n ** 18n },
        { balance: '100 AMD' },
      ]),
    })
    expect(result.rest?.total).toEqual(toMoney('20 RUB'))
    expect(result.rest?.uncounted.total.map((entry) => entry.balance)).toEqual([
      money(5n * 10n ** 18n, 'RUB'),
      money(5n * 10n ** 18n, 'RUB'),
    ])
  })

  it('has no rest before the first account, and says when the accounts begin (В-4)', () => {
    const august = month({ month: '2026-08', held: held([], '2026-09-16') })
    expect(august.rest).toBeNull()
    expect(august.accountsFrom).toBe('2026-09-16')
    const none = month({ held: held([], null) })
    expect(none).toMatchObject({ rest: null, accountsFrom: null, accountsRemoved: false })
    const removed = month({ held: held([], null, true) })
    expect(removed).toMatchObject({ rest: null, accountsFrom: null, accountsRemoved: true })
  })
})

describe('what the accounts held at the end of a day (MOL-134)', () => {
  const account = (patch: Partial<MoneyAccount> = {}): MoneyAccount => ({
    id: nextId(),
    actorId: OWNER,
    name: 'Наличные',
    currency: 'AMD',
    savings: false,
    start: toMoney('1000 AMD'),
    startOn: '2026-09-16',
    revision: 1,
    createdAt: new Date('2026-09-16T10:00:00Z'),
    archivedAt: null,
    ...patch,
  })
  const spent = (on: MoneyAccount, amount: string, day: string): AccountOperation => ({
    kind: 'spending',
    id: nextId(),
    side: null,
    day,
    at: new Date(`${day}T10:00:00Z`),
    seenAt: new Date(`${day}T10:00:00Z`),
    currency: toMoney(amount).currency,
    accountId: on.id,
    amounts: [{ ...toMoney(amount), minor: -toMoney(amount).minor }],
    debited: null,
    rate: null,
    unpriced: 0,
    revision: 1,
    details: {
      categoryId: null,
      note: null,
      place: null,
      source: null,
      counterpart: null,
      items: null,
    },
  })

  it('counts the start and the operations up to the day, not the day after', () => {
    const cash = account()
    const operations = [
      spent(cash, '100 AMD', '2026-09-16'),
      spent(cash, '200 AMD', '2026-09-30'),
      spent(cash, '400 AMD', '2026-10-01'),
    ]
    expect(balancesOn([cash], operations, '2026-09-30', () => null)).toEqual([
      { account: cash, balance: toMoney('800 AMD'), uncounted: 0 },
    ])
  })

  it('takes an account started on the day, never one started after it or one removed (Р-2)', () => {
    const lastDay = account({ startOn: '2026-09-30' })
    const later = account({ startOn: '2026-10-01' })
    const removed = account({ archivedAt: new Date('2026-09-20T10:00:00Z') })
    expect(
      balancesOn([lastDay, later, removed], [], '2026-09-30', () => null).map(
        ({ account: a }) => a,
      ),
    ).toEqual([lastDay])
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
    const wrong = { ...spending('11 USD', '2026-09-18'), rate: rate('EUR', 'AMD', '430') }
    const parsed = spendingSchema.safeParse(wrong)
    expect(parsed.error?.issues[0]?.message).toBe(ISSUE.RATE_NOT_OF_SPENDING_CURRENCY)
  })

  it('is counted by its snapshot only into the pair it is of — a move is not a rate', () => {
    const dollars = spending('11 USD', '2026-09-18', 'other', rate('USD', 'AMD', '400'))
    expect(spendingIn(dollars, 'AMD')).toEqual(toMoney('4400 AMD'))
    expect(spendingIn(dollars, 'RUB')).toBeNull()
  })

  it('takes a snapshot on either side of the pair, and converts from either', () => {
    const drams = spending('3900 AMD', '2026-09-18', 'other', rate('USD', 'AMD', '390'))
    expect(spendingSchema.safeParse(drams).success).toBe(true)
    expect(spendingIn(drams, 'USD')).toEqual(toMoney('10 USD'))
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

describe('the figures the card prints beside the server’s sums (MOL-82)', () => {
  const amd = (minor: bigint) => ({ minor, currency: 'AMD' as const })

  it.each([
    [317_800n, 345_620n, -8],
    [345_620n, 335_560n, 3],
    [100n, 100n, 0],
    // Half away from zero, both ways.
    [1_050n, 1_000n, 5],
    [950n, 1_000n, -5],
    [1_049n, 1_000n, 5],
    [951n, 1_000n, -5],
    [300n, 100n, 200],
  ])('%s against %s is %s %', (current, previous, percent) => {
    expect(percentChange(amd(current), amd(previous))).toBe(percent)
  })

  it('has nothing to say without a month before, or across a move of currency', () => {
    expect(percentChange(amd(100n), amd(0n))).toBeNull()
    expect(percentChange(amd(100n), { minor: 100n, currency: 'RUB' })).toBeNull()
  })

  it('names a share in whole percent, and one under a percent as tiny', () => {
    expect(shareOf(amd(160_000n), amd(317_800n))).toEqual({ percent: 50, tiny: false })
    expect(shareOf(amd(3_150n), amd(317_800n))).toEqual({ percent: 1, tiny: true })
    expect(shareOf(amd(3_300n), amd(317_800n))).toEqual({ percent: 1, tiny: false })
    expect(shareOf(amd(317_800n), amd(317_800n))).toEqual({ percent: 100, tiny: false })
    expect(shareOf(amd(0n), amd(0n))).toBeNull()
  })
})
