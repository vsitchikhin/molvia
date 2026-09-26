import { spendingIn } from '#model/entities/spending'
import type { Spending } from '#model/entities/spending'
import { TRIP_CATEGORY } from '#model/entities/spending-category'
import type { SpendingCategory } from '#model/entities/spending-category'
import { convertAcross } from '#model/entities/trip'
import type { Income } from '#model/entities/income'
import { INT8_MAX } from '#model/support/decimal'
import type { Currency, Money } from '#model/values/money'
import type { ExchangeRate } from '#model/values/rates'

/** A calendar month as `YYYY-MM`, of days in Yerevan. */
export type Month = string

/** The month a Yerevan day belongs to. */
export function monthOf(day: string): Month {
  return day.slice(0, 7)
}

/** The month before, and the last day of a month — the day its rate is frozen on (handoff 06). */
export function previousMonth(month: Month): Month {
  const [year, number] = month.split('-').map(Number) as [number, number]
  return number === 1
    ? `${String(year - 1)}-12`
    : `${String(year)}-${String(number - 1).padStart(2, '0')}`
}

export function lastDayOf(month: Month): string {
  const [year, number] = month.split('-').map(Number) as [number, number]
  const days = new Date(Date.UTC(year, number, 0)).getUTCDate()
  return `${month}-${String(days).padStart(2, '0')}`
}

/**
 * One finished trip's purchases in one currency (handoff 06): a trip enters the month when it is
 * finished, on the day it was finished on the device, one line per currency, in the groceries. Its
 * sum is read from the purchases each time — nothing is copied, so amending a purchase, the trip's
 * receipt sum of MOL-78 or its removal of MOL-76 move the month by themselves.
 */
export interface TripLine {
  readonly tripId: string
  readonly placeName: string
  /**
   * The purchases behind this line's sum — of its currency, with a price (owner's decision В-7):
   * with the trip's count on each, a trip of one purchase in drams and one in dollars read «2
   * покупки» twice. A purchase with no price is in no line, as it is in no sum.
   */
  readonly items: number
  readonly finishedOn: string
  readonly finishedAt: Date
  readonly amount: Money
}

export type MonthEntry =
  | { readonly kind: 'manual'; readonly spending: Spending; readonly counted: Money | null }
  | { readonly kind: 'trip'; readonly trip: TripLine; readonly counted: Money | null }

export interface MonthDay {
  readonly day: string
  /** The day's spending in the spending currency — what could be counted. */
  readonly total: Money
  /** Something of the day was converted, or could not be: the screen prints «≈». */
  readonly estimated: boolean
  readonly entries: readonly MonthEntry[]
}

export interface MoneyMonth {
  readonly month: Month
  readonly spendCurrency: Currency
  readonly incomeCurrency: Currency
  /** Everything spent, in the spending currency, what could be counted. */
  readonly spent: Money
  /** What had no rate to the spending currency on its day, by currency — never guessed. */
  readonly uncounted: readonly Money[]
  /** What was spent in other currencies, and what it came to in the spending one («Включая 11 $…»). */
  readonly foreign: readonly { readonly amount: Money; readonly counted: Money }[]
  /** `spent` in the income currency by the month's rate — null when there is none. */
  readonly spentIncome: Money | null
  /** What came in, in the income currency, each income by the official rate of its own day (MOL-66). */
  readonly income: Money
  readonly incomeUncounted: readonly Money[]
  /** What came in less what was spent, in the income currency; signed. Null without a rate. */
  readonly rest: Money | null
  readonly rate: ExchangeRate | null
  readonly rateKind: 'live' | 'frozen'
  /** The spending currency's sum per category, largest first; categories with nothing left out. */
  readonly byCategory: readonly { readonly categoryId: string; readonly amount: Money }[]
  /** Every day with anything spent, newest first, each newest first within. */
  readonly days: readonly MonthDay[]
}

/** Converts an amount of another currency on a day, or says it cannot (no rate that day). */
export type ConvertOn = (amount: Money, day: string) => Money | null

export interface MoneyMonthInput {
  readonly month: Month
  readonly spendCurrency: Currency
  readonly incomeCurrency: Currency
  readonly spendings: readonly Spending[]
  readonly trips: readonly TripLine[]
  readonly incomes: readonly Income[]
  readonly categories: readonly SpendingCategory[]
  /** The month's rate between the spending currency and the income one, on either side. */
  readonly rate: ExchangeRate | null
  readonly rateKind: 'live' | 'frozen'
  /**
   * Into the spending currency, by the rule of the day a spending's snapshot is taken by — the
   * person's own rate, else the central bank's: a trip's line in another currency, and a spending
   * with no snapshot into the spending currency of now (review Р-3, Р-5). Ten dollars at the shop and
   * ten at the barber's on one day come to the same.
   */
  readonly inSpend: ConvertOn
  /**
   * An income in another currency, into the income one — the official rate of its day only (MOL-66,
   * В-1): never what the money already held cost, which is a price of other money.
   */
  readonly incomeInIncome: ConvertOn
}

function add(sums: Map<Currency, bigint>, { minor, currency }: Money): void {
  sums.set(currency, (sums.get(currency) ?? 0n) + minor)
}

function listOf(sums: Map<Currency, bigint>): Money[] {
  return [...sums]
    .filter(([, minor]) => minor <= INT8_MAX)
    .map(([currency, minor]) => ({ minor, currency }))
    .sort((a, b) => (a.currency < b.currency ? -1 : a.currency > b.currency ? 1 : 0))
}

/**
 * Where a row of the journal stands: its day, its moment — when the spending was written, when the
 * trip was finished — and its name. The journal is newest first by these three, and the next page
 * starts after the key of the last row shown (adversarial Д3): an offset moved under a page every
 * time something was written above it, and a spending saved while the month was being read came
 * twice, one removed made another come never.
 */
export interface JournalKey {
  readonly day: string
  readonly moment: number
  readonly id: string
}

export function journalKeyOf(entry: MonthEntry): JournalKey {
  return entry.kind === 'manual'
    ? {
        day: entry.spending.spentOn,
        moment: entry.spending.createdAt.getTime(),
        id: entry.spending.id,
      }
    : {
        day: entry.trip.finishedOn,
        moment: entry.trip.finishedAt.getTime(),
        id: `${entry.trip.tripId}:${entry.trip.amount.currency}`,
      }
}

/** Below zero when `a` comes first in the journal — the newer — and above when `b` does. */
export function journalOrder(a: JournalKey, b: JournalKey): number {
  if (a.day !== b.day) return a.day < b.day ? 1 : -1
  if (a.moment !== b.moment) return b.moment - a.moment
  return a.id === b.id ? 0 : a.id < b.id ? 1 : -1
}

function newestFirst(a: MonthEntry, b: MonthEntry): number {
  return journalOrder(journalKeyOf(a), journalKeyOf(b))
}

function amountOf(entry: MonthEntry): Money {
  return entry.kind === 'manual' ? entry.spending.amount : entry.trip.amount
}

/**
 * The month of «Деньги» whole (MOL-73, handoff 01 and 06), counted here and not on the phone: the
 * screen adds nothing up. Spendings of the month and its finished trips, what they came to in the
 * spending currency — each by its own day — the categories, the days of the journal, what came in,
 * and the month in the income currency by one rate: today's for the running month, the one frozen
 * on its last day for a closed one, so a new exchange today never moves August.
 */
export function moneyMonth(input: MoneyMonthInput): MoneyMonth {
  const { spendCurrency: spend, incomeCurrency: incomeCurrency } = input
  const groceries = input.categories.find((category) => category.preset === TRIP_CATEGORY)

  const inSpend = (amount: Money, day: string) =>
    amount.currency === spend ? amount : input.inSpend(amount, day)
  const counted: MonthEntry[] = [
    ...input.spendings.map((spending): MonthEntry => ({
      kind: 'manual',
      spending,
      counted: spendingIn(spending, spend) ?? inSpend(spending.amount, spending.spentOn),
    })),
    ...input.trips.map((trip): MonthEntry => ({
      kind: 'trip',
      trip,
      counted: inSpend(trip.amount, trip.finishedOn),
    })),
  ].sort(newestFirst)

  // Every sum below is at most `spent`, and `spent` is held within what money holds: a row that
  // would carry it past is «не посчитано», so the month is read and the row can be found and
  // removed — the rule MOL-66 set for an income no money can hold (adversarial Д5).
  let spentMinor = 0n
  const uncounted = new Map<Currency, bigint>()
  const foreign = new Map<Currency, { amount: bigint; counted: bigint }>()
  const byCategory = new Map<string, bigint>()
  const entries = counted.map((entry): MonthEntry => {
    const amount = amountOf(entry)
    const value = entry.counted
    const held = foreign.get(amount.currency) ?? { amount: 0n, counted: 0n }
    if (
      value === null ||
      spentMinor + value.minor > INT8_MAX ||
      (amount.currency !== spend && held.amount + amount.minor > INT8_MAX)
    ) {
      add(uncounted, amount)
      return { ...entry, counted: null }
    }
    spentMinor += value.minor
    if (amount.currency !== spend) {
      foreign.set(amount.currency, {
        amount: held.amount + amount.minor,
        counted: held.counted + value.minor,
      })
    }
    const categoryId = entry.kind === 'manual' ? entry.spending.categoryId : groceries?.id
    if (categoryId !== undefined) {
      byCategory.set(categoryId, (byCategory.get(categoryId) ?? 0n) + value.minor)
    }
    return entry
  })

  const days = new Map<string, MonthEntry[]>()
  for (const entry of entries) {
    const day = entry.kind === 'manual' ? entry.spending.spentOn : entry.trip.finishedOn
    days.set(day, [...(days.get(day) ?? []), entry])
  }

  let incomeMinor = 0n
  const incomeUncounted = new Map<Currency, bigint>()
  for (const income of input.incomes) {
    const counted =
      income.amount.currency === incomeCurrency
        ? income.amount
        : input.incomeInIncome(income.amount, income.receivedOn)
    if (counted === null || incomeMinor + counted.minor > INT8_MAX)
      add(incomeUncounted, income.amount)
    else incomeMinor += counted.minor
  }

  const spent: Money = { minor: spentMinor, currency: spend }
  const spentIncome =
    spend === incomeCurrency
      ? { minor: spentMinor, currency: incomeCurrency }
      : input.rate === null
        ? null
        : convertAcross(spent, input.rate)
  const income: Money = { minor: incomeMinor, currency: incomeCurrency }

  return {
    month: input.month,
    spendCurrency: spend,
    incomeCurrency,
    spent,
    uncounted: listOf(uncounted),
    foreign: [...foreign]
      .map(([currency, sums]) => ({
        amount: { minor: sums.amount, currency },
        counted: { minor: sums.counted, currency: spend },
      }))
      .sort((a, b) => (a.amount.currency < b.amount.currency ? -1 : 1)),
    spentIncome,
    income,
    incomeUncounted: listOf(incomeUncounted),
    rest:
      spentIncome === null
        ? null
        : { minor: income.minor - spentIncome.minor, currency: incomeCurrency },
    rate: spend === incomeCurrency ? null : input.rate,
    rateKind: input.rateKind,
    byCategory: [...byCategory]
      .map(([categoryId, minor]) => ({ categoryId, amount: { minor, currency: spend } }))
      .sort((a, b) =>
        a.amount.minor === b.amount.minor
          ? a.categoryId < b.categoryId
            ? -1
            : 1
          : a.amount.minor > b.amount.minor
            ? -1
            : 1,
      ),
    days: [...days].map(([day, list]) => ({
      day,
      total: {
        minor: list.reduce((sum, entry) => sum + (entry.counted?.minor ?? 0n), 0n),
        currency: spend,
      },
      estimated: list.some((entry) => amountOf(entry).currency !== spend),
      entries: list,
    })),
  }
}
