import {
  balancesOn,
  budgetMonthOf,
  convertAcross,
  convertSigned,
  lastDayOf,
  monthOf,
  moneyMonth,
  moneyMonthViewOf,
  previousMonth,
  spendingIn,
  yerevanDate,
} from '@molvia/model'
import type {
  Actor,
  ConvertOn,
  Currency,
  Exchange,
  ExchangeRate,
  Income,
  JournalKey,
  Money,
  MoneyMonth,
  MoneyMonthView,
  MonthHeld,
  SalaryShift,
  Spending,
  SpendingCategory,
  TripLine,
} from '@molvia/model'
import { accountsCounted } from './money-accounts'
import { dayRates } from './money-rates'
import type { DayRates } from './money-rates'
import type { TripRepositories } from '@/db/unit-of-work'

type Repositories = Pick<
  TripRepositories,
  'spendings' | 'spendingCategories' | 'money' | 'exchanges' | 'incomes' | 'rates' | 'moneyAccounts'
>
type Owner = Pick<Actor, 'id' | 'incomeCurrency' | 'spendCurrency'>

/**
 * The rates a month needs, read before it is counted: the pure function asks synchronously, so every
 * day an amount in another currency falls on is looked up first — by `rateOf`, which is the trip's
 * rule for what was spent and the central bank's alone for what came in.
 */
async function converter(
  rateOf: DayRates['between'],
  into: Currency,
  needs: readonly { amount: Money; day: string }[],
): Promise<ConvertOn> {
  const known = new Map<string, ExchangeRate | null>()
  for (const { amount, day } of needs) {
    const key = `${amount.currency}:${day}`
    if (known.has(key) || amount.currency === into) continue
    known.set(key, await rateOf(amount.currency, into, day))
  }
  return (amount, day) => {
    const rate = known.get(`${amount.currency}:${day}`)
    return rate ? convertAcross(amount, rate) : null
  }
}

/** What months are counted from: the spendings and trip lines of a span of days, and every income. */
export interface MonthRows {
  readonly spendings: readonly Spending[]
  readonly trips: readonly TripLine[]
  readonly incomes: readonly Income[]
}

/** The rows of the months `first` to `last`, read once however many months are counted of them. */
export async function monthRows(
  repositories: Pick<Repositories, 'spendings' | 'money' | 'incomes'>,
  owner: Pick<Owner, 'id'>,
  first: string,
  last: string,
): Promise<MonthRows> {
  const from = `${first}-01`
  const to = lastDayOf(last)
  const [spendings, trips, incomes] = await Promise.all([
    repositories.spendings.between(owner.id, from, to),
    repositories.money.tripLines(owner.id, from, to),
    repositories.incomes.list(owner.id),
  ])
  return { spendings, trips, incomes }
}

/** One month counted from rows already read — `moneyMonth` with the rates it asks for looked up. */
export async function countMonth(
  owner: Owner,
  rates: DayRates,
  month: string,
  rows: MonthRows,
  categories: readonly SpendingCategory[],
  rate: ExchangeRate | null,
  rateKind: 'live' | 'frozen',
  salaryShiftDay: number | null,
  held?: MonthHeld,
): Promise<MoneyMonth> {
  const spendings = rows.spendings.filter((spending) => monthOf(spending.spentOn) === month)
  const trips = rows.trips.filter((trip) => monthOf(trip.finishedOn) === month)
  const { incomes } = rows
  const ofMonth = incomes.filter((income) => budgetMonthOf(income, salaryShiftDay) === month)
  const [inSpend, incomeInIncome] = await Promise.all([
    converter((one, other, day) => rates.between(one, other, day), owner.spendCurrency, [
      ...trips.map((trip) => ({ amount: trip.amount, day: trip.finishedOn })),
      // A spending whose snapshot is not of the spending currency now — none was known that day,
      // or it was written before a move — is counted as a trip line is (review Р-5).
      ...spendings
        .filter((spending) => spendingIn(spending, owner.spendCurrency) === null)
        .map((spending) => ({ amount: spending.amount, day: spending.spentOn })),
    ]),
    converter(
      (one, other, day) => rates.official(one, other, day),
      owner.incomeCurrency,
      ofMonth.map((income) => ({ amount: income.amount, day: income.receivedOn })),
    ),
  ])
  return moneyMonth({
    month,
    spendCurrency: owner.spendCurrency,
    incomeCurrency: owner.incomeCurrency,
    spendings,
    trips,
    incomes,
    salaryShiftDay,
    categories,
    rate,
    rateKind,
    inSpend,
    incomeInIncome,
    ...(held && { held }),
  })
}

/** One month read and counted — what `moneyMonthOf` asks of this month and the one before. */
async function count(
  repositories: Repositories,
  owner: Owner,
  rates: DayRates,
  month: string,
  categories: readonly SpendingCategory[],
  rate: ExchangeRate | null,
  rateKind: 'live' | 'frozen',
  salaryShiftDay: number | null,
  held?: MonthHeld,
): Promise<MoneyMonth> {
  const rows = await monthRows(repositories, owner, month, month)
  return countMonth(owner, rates, month, rows, categories, rate, rateKind, salaryShiftDay, held)
}

/**
 * «Остаток» (MOL-134): what every live account held on the evening of the month's last day — the
 * running month's too, since an operation may be dated tomorrow and «Потрачено» already counts it
 * (Н-3) — in the income currency. The spending currency comes by the month's own rate, the one
 * «≈ потрачено» is counted by, frozen for a closed month; any other by the rule of «Деньги» on the
 * last day, or today for the running month, when nothing later is known. Not frozen itself (Р-3):
 * an amended spending of August moves August's rest as it moves its «Потрачено».
 */
async function heldAt(
  repositories: Repositories,
  owner: Owner,
  rates: DayRates,
  month: string,
  today: string,
  rate: ExchangeRate | null,
): Promise<MonthHeld> {
  const last = lastDayOf(month)
  const on = last < today ? last : today
  const income = owner.incomeCurrency
  const foreign = (currency: Currency) => currency !== income && currency !== owner.spendCurrency
  const { accounts, operations, rateOf } = await accountsCounted(
    repositories,
    owner,
    rates,
    (all) =>
      all
        .filter((account) => foreign(account.currency))
        .map((account) => ({ from: account.currency, into: income, day: on })),
  )
  const live = accounts.filter((account) => account.archivedAt === null)
  const starts = live.map((account) => account.startOn).sort()
  return {
    balances: balancesOn(live, operations, last, rateOf).map(({ account, balance, uncounted }) => ({
      name: account.name,
      balance,
      savings: account.savings,
      uncounted,
    })),
    accountsFrom: starts[0] ?? null,
    accountsRemoved: live.length === 0 && accounts.length > 0,
    inIncome: (balance) => {
      if (balance.currency === income) return balance
      const by = foreign(balance.currency) ? rateOf(balance.currency, income, on) : rate
      return by === null ? null : convertSigned(balance, by)
    },
  }
}

/**
 * The month's rate between the spending currency and the income one: today's for the running month,
 * and for a closed one the rate of its last day, frozen the first time it is read — a new exchange
 * today does not rewrite August (handoff 06). A fact of August amended later does: writing, amending,
 * removing or bringing back an exchange or an income of a day lets go of the months from that day on
 * (owner's decision В-6). Nothing known that day, and nothing is frozen: the next read tries again
 * rather than locking an empty answer in.
 */
export async function monthRate(
  repositories: Pick<Repositories, 'money'>,
  owner: Owner,
  rates: DayRates,
  month: string,
  today: string,
): Promise<{ rate: ExchangeRate | null; kind: 'live' | 'frozen' }> {
  const base = owner.incomeCurrency
  const quote = owner.spendCurrency
  if (base === quote) return { rate: null, kind: 'live' }
  if (month >= monthOf(today))
    return { rate: await rates.between(base, quote, today), kind: 'live' }

  const frozen = await repositories.money.frozenRate(owner.id, month, base, quote)
  if (frozen) return { rate: frozen, kind: 'frozen' }
  const closing = await rates.between(base, quote, lastDayOf(month))
  if (!closing) return { rate: null, kind: 'frozen' }
  return { rate: await repositories.money.freeze(owner.id, month, closing), kind: 'frozen' }
}

/**
 * What a read froze its months by, held against the receipts after it (adversarial Ж, Ж2): the
 * exchanges and incomes are read once, by `dayRates`, and the months are frozen one by one after. A
 * write landing between the two lets go of nothing — nothing is frozen yet — and the month froze
 * without it, for good. So once the read has frozen what it froze, anything written, amended, removed
 * or brought back since the rates were worked out lets the months go from its day, as the write
 * itself would have; a changed rule lets go of all. **Against the very rows the rates came from**, not
 * a snapshot of its own: a removal and a «Вернуть» both inside the read left the row as it was before
 * and after, with the rates worked out while it was away. A write that lands later lets go by itself.
 */
export async function settleThaws(
  repositories: Pick<Repositories, 'exchanges' | 'incomes' | 'money'>,
  owner: Pick<Owner, 'id'>,
  basis: DayRates['basis'],
): Promise<void> {
  const [exchanges, incomes, rule] = await Promise.all([
    repositories.exchanges.list(owner.id),
    repositories.incomes.list(owner.id),
    repositories.exchanges.rateSettings(owner.id),
  ])
  const ruleOf = (preference: string, since: Date | null) =>
    `${preference}:${String(since?.getTime() ?? null)}`
  if (ruleOf(rule.preference, rule.since) !== ruleOf(basis.preference, basis.since)) {
    await repositories.money.thaw(owner.id)
    return
  }
  const daysOf = (
    exchanges: readonly Pick<Exchange, 'id' | 'revision' | 'exchangedOn'>[],
    incomes: readonly Pick<Income, 'id' | 'revision' | 'receivedOn'>[],
  ) =>
    new Map([
      ...exchanges.map(
        (one) => [one.id, { revision: one.revision, day: one.exchangedOn }] as const,
      ),
      ...incomes.map((one) => [one.id, { revision: one.revision, day: one.receivedOn }] as const),
    ])
  const before = daysOf(basis.exchanges, basis.incomes)
  const after = daysOf(exchanges, incomes)
  const moved: string[] = []
  for (const [id, was] of before) {
    const now = after.get(id)
    if (!now) moved.push(was.day)
    else if (now.revision !== was.revision) moved.push(was.day, now.day)
  }
  for (const [id, now] of after) if (!before.has(id)) moved.push(now.day)
  const from = moved.sort()[0]
  if (from !== undefined) await repositories.money.thaw(owner.id, from)
}

/** `GET /money/months/:month` (MOL-73): the month counted, a page of its journal after `cursor`. */
export async function moneyMonthOf(
  repositories: Repositories,
  owner: Owner,
  month: string,
  cursor?: JournalKey,
  now: Date = new Date(),
): Promise<MoneyMonthView> {
  const today = yerevanDate(now)
  const [rates, categories, salaryShiftDay] = await Promise.all([
    dayRates(repositories, owner),
    repositories.spendingCategories.list(owner.id),
    repositories.money.salaryShift(owner.id),
  ])
  let frozen: Awaited<ReturnType<typeof monthRate>>
  try {
    frozen = await monthRate(repositories, owner, rates, month, today)
  } finally {
    // Only a closed month is frozen by a read, so only it is held against what landed meanwhile.
    if (month < monthOf(today)) await settleThaws(repositories, owner, rates.basis)
  }
  const { rate, kind } = frozen
  // The next page of the journal carries no rest: the phone keeps the first page's figures, and every
  // account with its whole history was read for nothing on each «Показать ещё» (self-review 3).
  const held =
    cursor === undefined
      ? heldAt(repositories, owner, rates, month, today, rate)
      : Promise.resolve(undefined)
  const [counted, before] = await Promise.all([
    held.then((accounts) =>
      count(repositories, owner, rates, month, categories, rate, kind, salaryShiftDay, accounts),
    ),
    count(repositories, owner, rates, previousMonth(month), categories, null, 'frozen', null),
  ])
  // «−8 % к августу» needs an August: a month with nothing in it is no month to compare with.
  const previousSpent = before.days.length > 0 ? before.spent : null
  return moneyMonthViewOf(counted, previousSpent, categories, cursor)
}

/** `GET /actors/me/salary-shift` (MOL-134, В-3): from which day a salary counts in the next month. */
export async function salaryShiftOf(
  repositories: Pick<Repositories, 'money'>,
  owner: Pick<Actor, 'id'>,
): Promise<SalaryShift> {
  return { day: await repositories.money.salaryShift(owner.id) }
}

/**
 * `PUT /actors/me/salary-shift`, saved on the tap (В-5). It lets no month go: a frozen month holds a
 * rate, and «Пришло» is counted on every read, so the next read already moves the salary.
 */
export async function chooseSalaryShift(
  repositories: Pick<Repositories, 'money'>,
  owner: Pick<Actor, 'id'>,
  { day }: SalaryShift,
): Promise<SalaryShift> {
  return { day: await repositories.money.setSalaryShift(owner.id, day) }
}
