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

export function nextMonth(month: Month): Month {
  const [year, number] = month.split('-').map(Number) as [number, number]
  return number === 12
    ? `${String(year + 1)}-01`
    : `${String(year)}-${String(number + 1).padStart(2, '0')}`
}

/**
 * The month an income counts in «Пришло» (MOL-134, В-2): with «зарплата с … числа» on, a salary
 * received on that day of its month or later counts in the next one, as the owner's sheet has it —
 * the salary of the 25th pays for the month after. Every other source, and every salary with the
 * setting off, counts in its own month. The day of the income itself is never moved: the journal of
 * «Доходы», the balances and the person's own rate go by it. A day the month does not have moves
 * nothing — «с 31-го» in September (Н-7).
 */
export function budgetMonthOf(
  income: Pick<Income, 'receivedOn' | 'source'>,
  salaryShiftDay: number | null,
): Month {
  const month = monthOf(income.receivedOn)
  if (salaryShiftDay === null || income.source !== 'salary') return month
  return Number(income.receivedOn.slice(8, 10)) >= salaryShiftDay ? nextMonth(month) : month
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

/** The category a line of the month is counted in: its own, or a trip's «Продукты» (handoff 06). */
export function categoryOfEntry(
  entry: MonthEntry,
  groceries: string | undefined,
): string | undefined {
  return entry.kind === 'manual' ? entry.spending.categoryId : groceries
}

export interface MonthDay {
  readonly day: string
  /** The day's spending in the spending currency — what could be counted. */
  readonly total: Money
  /**
   * Something counted in the day was converted: the screen prints «≈» before `total`. What could not
   * be is `uncounted`, said beside it in its own currency (MOL-184) — not a «≈» over drams that are
   * exact.
   */
  readonly estimated: boolean
  /**
   * What of the day could not be counted, by currency (MOL-184, В-1): the day's sum is `total` and
   * these, so a day of one $50 with no rate is «50 $», not «≈ 0 ֏». Whole like `total`, whatever page
   * the day's rows come on.
   */
  readonly uncounted: readonly Money[]
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
  /**
   * The categories something of `uncounted` belongs to: only their sums are short (adversarial d9
   * round 3, В3) — a coffee in dollars leaves «Кафе» of the month incomplete, not «Продукты».
   */
  readonly uncountedIn: readonly string[]
  /** What was spent in other currencies, and what it came to in the spending one («Включая 11 $…»). */
  readonly foreign: readonly { readonly amount: Money; readonly counted: Money }[]
  /** `spent` in the income currency by the month's rate — null when there is none. */
  readonly spentIncome: Money | null
  /** What came in, in the income currency, each income by the official rate of its own day (MOL-66). */
  readonly income: Money
  readonly incomeUncounted: readonly Money[]
  /** Some income in another currency was counted into `income` by a rate: it is «≈» (MOL-184, Г2). */
  readonly incomeConverted: boolean
  /**
   * How many incomes «Пришло» is of — counted or not, a salary moved in by `budgetMonthOf` and not
   * one moved out: the figure beside «Доходы» on «Деньгах» speaks of the same money (MOL-159, Р-2).
   */
  readonly incomeCount: number
  /** Days of the salaries of the month before that count in this one («с зарплатой 31 авг.»). */
  readonly shiftedIn: readonly string[]
  /** Days of this month's salaries that count in the next one («зарплата 26 сент. — в октябре»). */
  readonly shiftedOut: readonly string[]
  /**
   * «Остаток» (MOL-134): what the accounts held at the end of the month, in the income currency —
   * null where no account had started by then. `accountsFrom` is the earliest start of a live
   * account, null when there is none: «Счета начинаются 16 сент.»; with none, «Завести счёт» — unless
   * every account there is was removed (`accountsRemoved`), when the way is «Вернуть» (self-review 4).
   */
  readonly rest: MonthRest | null
  readonly accountsFrom: string | null
  readonly accountsRemoved: boolean
  readonly rate: ExchangeRate | null
  readonly rateKind: 'live' | 'frozen'
  /** The spending currency's sum per category, largest first; categories with nothing left out. */
  readonly byCategory: readonly { readonly categoryId: string; readonly amount: Money }[]
  /** Every day with anything spent, newest first, each newest first within. */
  readonly days: readonly MonthDay[]
}

/**
 * The money on the accounts at the end of a month (MOL-134, В-1): everything, and everything but the
 * savings — the words of «Счета», «всего» and «можно тратить». Signed: a card in debt takes away.
 */
export interface MonthRest {
  readonly total: Money
  readonly spendable: Money
  /**
   * The accounts nothing converts, for each figure, each on its own, by name and in its own
   * currency, never a zero (п. 5). Summed into one figure per currency, savings and a card in debt
   * cancelled out and «не посчитано: 0 €» stood under both (adversarial А); marked «savings» on one
   * list, a figure the currency came to nothing in was still told it missed them (adversarial З).
   * So each figure is decided on its own and names only what it misses. An empty account is in no
   * figure, and so in none of these (adversarial Д).
   */
  readonly uncounted: {
    readonly total: readonly MonthRestUncounted[]
    readonly spendable: readonly MonthRestUncounted[]
  }
  /**
   * Operations no rate counted, for each figure: in no balance, which «Счета» says of each account
   * and the month must say too — the figure looked whole in this month and every one after
   * (adversarial Б). Two numbers, as the figures are two: one of the savings is missing from «всего»
   * alone (adversarial Е).
   */
  readonly operationsUncounted: { readonly total: number; readonly spendable: number }
}

export interface MonthRestUncounted {
  readonly name: string
  readonly balance: Money
}

/**
 * What the accounts held at the end of a month, for its «Остаток»: each live account started by then,
 * in its own currency, and how a balance comes into the income currency — the month's rate for the
 * spending currency, the rule of «Деньги» on the day for any other. Converted with its sign kept.
 */
export interface MonthHeld {
  readonly balances: readonly {
    readonly name: string
    readonly balance: Money
    readonly savings: boolean
    /** Its operations no rate counted (`accountBalance`). */
    readonly uncounted: number
  }[]
  readonly accountsFrom: string | null
  readonly accountsRemoved: boolean
  /** A sum of one currency into the income one, sign kept; null — nothing to count it by. */
  readonly inIncome: (balance: Money) => Money | null
}

/** Converts an amount of another currency on a day, or says it cannot (no rate that day). */
export type ConvertOn = (amount: Money, day: string) => Money | null

export interface MoneyMonthInput {
  readonly month: Month
  readonly spendCurrency: Currency
  readonly incomeCurrency: Currency
  readonly spendings: readonly Spending[]
  readonly trips: readonly TripLine[]
  /** Every income of the owner: which count in this month is `budgetMonthOf`'s to say. */
  readonly incomes: readonly Income[]
  /** «Зарплата с … числа — в следующий месяц» (MOL-134); null — off. */
  readonly salaryShiftDay: number | null
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
  /** The accounts at the end of the month; left out where the rest is not asked (the month before). */
  readonly held?: MonthHeld
}

function add(sums: Map<Currency, bigint>, { minor, currency }: Money): void {
  sums.set(currency, (sums.get(currency) ?? 0n) + minor)
}

/** What of these rows was not counted, summed by currency. */
function uncountedOf(entries: readonly MonthEntry[]): Money[] {
  const sums = new Map<Currency, bigint>()
  for (const entry of entries) if (entry.counted === null) add(sums, amountOf(entry))
  return listOf(sums)
}

/** The days incomes came in on, each once, earliest first. */
function daysOf(incomes: readonly Income[]): string[] {
  return [...new Set(incomes.map((income) => income.receivedOn))].sort()
}

function holds(minor: bigint): boolean {
  return minor <= INT8_MAX && minor >= -INT8_MAX
}

/**
 * «Остаток»: the balances of one currency summed exactly and converted once — each account rounded on
 * its own made two accounts of 2,02 ֏ a kopeck short of one of 4,04 ֏, and «Rounding happens on output
 * only» (adversarial В). A currency nothing converts, or no money can hold, is said apart account by
 * account (MOL-66).
 */
function restOf(held: MonthHeld | undefined, currency: Currency): MonthRest | null {
  if (!held || held.balances.length === 0) return null
  const byCurrency = new Map<Currency, MonthHeld['balances'][number][]>()
  for (const entry of held.balances) {
    const code = entry.balance.currency
    byCurrency.set(code, [...(byCurrency.get(code) ?? []), entry])
  }
  let total = 0n
  let spendable = 0n
  const missing = { total: [] as MonthRestUncounted[], spendable: [] as MonthRestUncounted[] }
  const named = (accounts: readonly MonthHeld['balances'][number][]) =>
    accounts
      .filter(({ balance }) => balance.minor !== 0n)
      .map(({ name, balance }) => ({ name, balance }))
  for (const code of [...byCurrency.keys()].sort()) {
    const accounts = byCurrency.get(code) ?? []
    const sum = (pick: (entry: MonthHeld['balances'][number]) => boolean) =>
      accounts.filter(pick).reduce((minor, entry) => minor + entry.balance.minor, 0n)
    // Nothing is nothing in any currency, and needs no rate (adversarial Д).
    const into = (minor: bigint): bigint | null =>
      minor === 0n
        ? 0n
        : holds(minor)
          ? (held.inIncome({ minor, currency: code })?.minor ?? null)
          : null
    // Each figure on its own: one the currency came to nothing in is whole whatever the other.
    const all = into(sum(() => true))
    if (all === null || !holds(total + all)) missing.total.push(...named(accounts))
    else total += all
    const own = into(sum((entry) => !entry.savings))
    if (own === null || !holds(spendable + own)) {
      missing.spendable.push(...named(accounts.filter((entry) => !entry.savings)))
    } else spendable += own
  }
  const operations = (pick: (entry: MonthHeld['balances'][number]) => boolean) =>
    held.balances.filter(pick).reduce((count, entry) => count + entry.uncounted, 0)
  return {
    total: { minor: total, currency },
    spendable: { minor: spendable, currency },
    uncounted: missing,
    operationsUncounted: {
      total: operations(() => true),
      spendable: operations((entry) => !entry.savings),
    },
  }
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
  const uncountedIn = new Set<string>()
  const entries = counted.map((entry): MonthEntry => {
    const amount = amountOf(entry)
    const value = entry.counted
    const held = foreign.get(amount.currency) ?? { amount: 0n, counted: 0n }
    const categoryId = categoryOfEntry(entry, groceries?.id)
    if (
      value === null ||
      spentMinor + value.minor > INT8_MAX ||
      (amount.currency !== spend && held.amount + amount.minor > INT8_MAX)
    ) {
      add(uncounted, amount)
      if (categoryId !== undefined) uncountedIn.add(categoryId)
      return { ...entry, counted: null }
    }
    spentMinor += value.minor
    if (amount.currency !== spend) {
      foreign.set(amount.currency, {
        amount: held.amount + amount.minor,
        counted: held.counted + value.minor,
      })
    }
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

  const ofMonth = input.incomes.filter(
    (income) => budgetMonthOf(income, input.salaryShiftDay) === input.month,
  )
  const shiftedOut = input.incomes.filter(
    (income) =>
      monthOf(income.receivedOn) === input.month &&
      budgetMonthOf(income, input.salaryShiftDay) !== input.month,
  )
  let incomeMinor = 0n
  let incomeConverted = false
  const incomeUncounted = new Map<Currency, bigint>()
  for (const income of ofMonth) {
    const counted =
      income.amount.currency === incomeCurrency
        ? income.amount
        : input.incomeInIncome(income.amount, income.receivedOn)
    if (counted === null || incomeMinor + counted.minor > INT8_MAX)
      add(incomeUncounted, income.amount)
    else {
      incomeMinor += counted.minor
      if (income.amount.currency !== incomeCurrency) incomeConverted = true
    }
  }

  const spent: Money = { minor: spentMinor, currency: spend }
  // Nothing spent is nothing in any currency, with or without a rate (review of MOL-74, С-7): a
  // month of no spending and no rate was «нет курса» on «Деньгах» and a bar of «not known» on the
  // charts, taller than any month that had one.
  const spentIncome =
    spend === incomeCurrency || spentMinor === 0n
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
    uncountedIn: [...uncountedIn].sort(),
    foreign: [...foreign]
      .map(([currency, sums]) => ({
        amount: { minor: sums.amount, currency },
        counted: { minor: sums.counted, currency: spend },
      }))
      .sort((a, b) => (a.amount.currency < b.amount.currency ? -1 : 1)),
    spentIncome,
    income,
    incomeUncounted: listOf(incomeUncounted),
    incomeConverted,
    incomeCount: ofMonth.length,
    shiftedIn: daysOf(ofMonth.filter((income) => monthOf(income.receivedOn) !== input.month)),
    shiftedOut: daysOf(shiftedOut),
    rest: restOf(input.held, incomeCurrency),
    accountsFrom: input.held?.accountsFrom ?? null,
    accountsRemoved: input.held?.accountsRemoved ?? false,
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
      estimated: list.some((entry) => entry.counted !== null && amountOf(entry).currency !== spend),
      uncounted: uncountedOf(list),
      entries: list,
    })),
  }
}

/**
 * How a month's spending compares with the one before, in whole percent — «−8 % к августу»
 * (handoff 01). Rounded half away from zero, as a person rounds; null where there is nothing to
 * compare with: no spending the month before, or two different currencies after a move.
 */
export function percentChange(current: Money, previous: Money): number | null {
  if (current.currency !== previous.currency || previous.minor <= 0n) return null
  const delta = (current.minor - previous.minor) * 200n
  const doubled = delta / previous.minor
  const rounded = doubled >= 0n ? (doubled + 1n) / 2n : (doubled - 1n) / 2n
  return Number(rounded)
}

/**
 * A category's share of the month in whole percent, and whether it is under one — «<1 %» rather
 * than a «0 %» beside money that was spent (handoff 01). Null where the whole is nothing.
 */
export function shareOf(part: Money, whole: Money): { percent: number; tiny: boolean } | null {
  if (part.currency !== whole.currency || whole.minor <= 0n) return null
  const hundredths = (part.minor * 10_000n) / whole.minor
  return { percent: Number((hundredths + 50n) / 100n), tiny: part.minor > 0n && hundredths < 100n }
}
