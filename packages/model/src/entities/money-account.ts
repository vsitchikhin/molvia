import { z } from 'zod'
import { EXCHANGE_UNDO_MINUTES, exchangeDaySchema } from '#model/entities/exchange'
import type { IncomeSource } from '#model/entities/income'
import { journalOrder } from '#model/entities/money-month'
import type { JournalKey } from '#model/entities/money-month'
import { convertAcross } from '#model/entities/trip'
import { INT8_MAX } from '#model/support/decimal'
import { ISSUE } from '#model/support/errors'
import { visibleLine } from '#model/support/text'
import { currencySchema, moneySchema, subtractMoney } from '#model/values/money'
import type { Currency, Money } from '#model/values/money'
import type { ExchangeRate } from '#model/values/rates'

/** An account's name: short enough for a row of the picker and a chip of the card (handoff 03). */
export const MONEY_ACCOUNT_NAME_MAX = 40
export const moneyAccountNameSchema = visibleLine(MONEY_ACCOUNT_NAME_MAX)

/** The same ten minutes as every removal of one's own money (MOL-73, В-4). */
export const MONEY_ACCOUNT_UNDO_MINUTES = EXCHANGE_UNDO_MINUTES

/**
 * Where money lies (MOL-115, MOL-43 В-5): «Наличные ֏», «Карта ₽», «Доллары дома». Named `money
 * account` in code, because «account» already means a Molvia account in the bot and the documents.
 * Every person has their own and nobody else ever sees them.
 *
 * The start is **what it held at the end of `startOn`** — «Старт — вечер 16.09» of the owner's
 * sheet — and may be below zero: a credit card is a name, not a kind. What the account holds now is
 * the start and every operation on it dated after that day (MOL-43, Р-3); what came before is
 * history and moves nothing. **An account made on its own start day starts at the moment it was
 * made** (MOL-250): the start typed is what it holds now, so an operation of that day the server
 * got after the account is in the balance, and one it got before is already in the start.
 * `createdOn` is the phone's day it was made on. There is no rate on an account, ever: the price of money belongs to
 * its currency (MOL-42, MOL-43 Р-2).
 *
 * `archivedAt` is «убран из выбора»: an account with operations is never erased, since its history
 * and balance are facts; it leaves the picker, keeps its rows, and can be brought back.
 */
export const moneyAccountSchema = z
  .object({
    id: z.uuid(),
    actorId: z.uuid(),
    name: moneyAccountNameSchema,
    currency: currencySchema,
    savings: z.boolean(),
    start: moneySchema,
    startOn: exchangeDaySchema,
    revision: z.int().min(1),
    createdAt: z.date(),
    createdOn: exchangeDaySchema,
    archivedAt: z.date().nullable(),
  })
  .refine(({ start, currency }) => start.currency === currency, {
    error: ISSUE.ACCOUNT_START_NOT_OF_CURRENCY,
  })
export type MoneyAccount = z.infer<typeof moneyAccountSchema>

/**
 * «Сверить с фактом» (MOL-43 В-4): what the person counted, what the server counted at that moment,
 * and when. It moves no balance — «Прочее · сверка» does, when the person asks — and it is where
 * the next check starts looking for what could have made a difference.
 */
export interface MoneyAccountCheck {
  readonly id: string
  readonly accountId: string
  readonly checkedOn: string
  readonly fact: Money
  readonly counted: Money
  readonly createdAt: Date
}

export const ACCOUNT_OPERATION_KINDS = [
  'spending',
  'income',
  'exchange',
  'trip',
  'transfer',
] as const
export type AccountOperationKind = (typeof ACCOUNT_OPERATION_KINDS)[number]

/**
 * One movement of money as an account sees it. A spending, an income, one side of an exchange, a
 * trip, or one side of a transfer between one's own accounts (MOL-253) — each written by its own route
 * and read here in one shape, so the balance, the journal, the check and «не попали» read the same
 * thing. A transfer always has its account and its account's currency, so it is never a check's
 * reason and never in «не попали»: it only moves the balance.
 *
 * `amounts` are signed, in the operation's own currencies: out is below zero. One for everything but
 * a trip, which moves a sum per currency its priced purchases were paid in, and none while nothing
 * has a price (MOL-78 will put the receipt's sum here). `debited` is what left the account exactly,
 * in the account's currency — a spending and a trip only, and only when their currency is not the
 * account's (MOL-43 В-3).
 */
export interface AccountOperation {
  readonly kind: AccountOperationKind
  readonly id: string
  /** Which half of an exchange or a transfer this is; null for every other kind. */
  readonly side: 'given' | 'received' | null
  /** A trip is dated by the day it started: the money left at the shelf (MOL-115, Р-29). */
  readonly day: string
  /** When it was written — a trip, when it was finished, or started while it is open. */
  readonly at: Date
  /**
   * When the server first had it — a trip, when it had it finished, or started while it is open:
   * the money leaves at the till. What the start of an account made on its own day is measured by
   * (MOL-250, adversarial А1). Never `seenAt`: an account given to an old spending does not make the
   * spending new.
   */
  readonly writtenAt: Date
  /**
   * The last moment the server learned something about it: written, amended, given or taken an
   * account — a trip, received as finished or given a purchase. What a check's window is measured
   * by, never the phone's clock: a trip finished offline and delivered after a check is after it
   * (adversarial Д1, Д1б).
   */
  readonly seenAt: Date
  /** Its own currency — a trip's with nothing priced yet still belongs to one (adversarial Д6). */
  readonly currency: Currency
  readonly accountId: string | null
  readonly amounts: readonly Money[]
  readonly debited: Money | null
  /**
   * A spending's snapshot of its own day (MOL-73). When it is of the pair the account needs, it is
   * the rate the account counts by too, so one spending is one number on the month and on the
   * account (MOL-115, Р-14).
   */
  readonly rate: ExchangeRate | null
  /** A trip's purchases without a price: they move nothing, and a check names them. */
  readonly unpriced: number
  /**
   * The version of the operation's own row — what its sheet amends over (MOL-123, Р-2). A trip has
   * none: its account is set whole from the summary, and its purchases have their own path.
   */
  readonly revision: number | null
  readonly details: AccountOperationDetails
}

/** What a row of the journal says beside the money: the words of the operation's own kind. */
export interface AccountOperationDetails {
  readonly categoryId: string | null
  readonly note: string | null
  /** A spending's «где», a trip's shop. */
  readonly place: string | null
  readonly source: IncomeSource | null
  /**
   * The other half of an exchange or a transfer: the account it came from or went to, and how much.
   * A transfer's fee names the account the transfer went to (MOL-253, handoff 03).
   */
  readonly counterpart: { readonly accountId: string | null; readonly amount: Money } | null
  /**
   * The transfer a spending is the fee of (MOL-253, Р-1): its row says «Комиссия за перевод» and opens
   * the transfer's sheet. Null for every other operation, and for a transfer itself, which is `id`.
   */
  readonly transferId: string | null
  /** A trip's purchases, priced or not. */
  readonly items: number | null
}

/**
 * The rate between two currencies on a day, as «Деньги» counts by it — the person's own that day,
 * else the central bank's, fresh (MOL-73, MOL-115 Р-14). Asked synchronously: the use case reads
 * every rate `conversionsNeeded` names first.
 */
export type RateBetween = (from: Currency, into: Currency, day: string) => ExchangeRate | null

/** What an operation did to an account: exactly, «≈» by a rate, or nothing to count it by. */
export interface Movement {
  /** Null when some amount had no rate that day — «не посчитано». */
  readonly amount: Money | null
  readonly approximate: boolean
}

function bounded(minor: bigint, currency: Currency): Money | null {
  return minor > INT8_MAX || minor < -INT8_MAX ? null : { minor, currency }
}

/**
 * `amount` by `rate`, with its sign kept: converted as a positive amount, since a rounding of a
 * negative one would round the other way. Null when the rate is not of its currency, or the result
 * is more than money holds.
 */
export function convertSigned(amount: Money, rate: ExchangeRate): Money | null {
  const negative = amount.minor < 0n
  const result = convertAcross(
    { minor: negative ? -amount.minor : amount.minor, currency: amount.currency },
    rate,
  )
  if (result === null) return null
  return { minor: negative ? -result.minor : result.minor, currency: result.currency }
}

/** Whether a rate is of the pair, on either side. */
function covers(rate: ExchangeRate | null, one: Currency, other: Currency): rate is ExchangeRate {
  return (
    rate !== null &&
    (rate.base === one || rate.quote === one) &&
    (rate.base === other || rate.quote === other)
  )
}

function converted(
  amount: Money,
  into: Currency,
  day: string,
  snapshot: ExchangeRate | null,
  rateOf: RateBetween,
): Money | null {
  const rate = covers(snapshot, amount.currency, into)
    ? snapshot
    : rateOf(amount.currency, into, day)
  return covers(rate, amount.currency, into) ? convertSigned(amount, rate) : null
}

/**
 * «Списано» as it counts on an account in `currency`: only while some money of the operation — its
 * own currency or a trip's purchase — is in another. A trip whose purchase in dollars was corrected
 * to drams keeps the figure in its row, and it stops counting: the trip is then exact by its sums,
 * and a check names nothing that is not wrong (adversarial Е3).
 */
export function debitedOn(operation: AccountOperation, currency: Currency): Money | null {
  const foreign =
    operation.currency !== currency ||
    operation.amounts.some((amount) => amount.currency !== currency)
  return foreign && operation.debited?.currency === currency ? operation.debited : null
}

/**
 * What `operation` did to an account in `currency`: «списано» when there is one, exactly; its own
 * amounts in that currency, exactly; any other amount converted by its day's rate and marked «≈».
 */
export function movementOf(
  operation: AccountOperation,
  currency: Currency,
  rateOf: RateBetween,
): Movement {
  const debited = debitedOn(operation, currency)
  if (debited !== null) return { amount: bounded(-debited.minor, currency), approximate: false }
  let minor = 0n
  let approximate = false
  for (const amount of operation.amounts) {
    if (amount.currency === currency) {
      minor += amount.minor
      continue
    }
    const into = converted(amount, currency, operation.day, operation.rate, rateOf)
    if (into === null) return { amount: null, approximate: true }
    minor += into.minor
    approximate = true
  }
  return { amount: bounded(minor, currency), approximate }
}

/**
 * Whether the start of an account is the moment it was made rather than the evening of its day: it
 * was made on its own start day (MOL-250). A start moved to another day is that day's evening again.
 */
function startsWhenMade(account: MoneyAccount): boolean {
  return account.startOn === account.createdOn
}

/**
 * Whether an operation stands after the start of an account: dated after its day, or — for an
 * account made on that day — of that day and written after the account.
 */
export function afterStart(
  operation: Pick<AccountOperation, 'day' | 'writtenAt'>,
  account: MoneyAccount,
): boolean {
  if (operation.day > account.startOn) return true
  return (
    startsWhenMade(account) &&
    operation.day === account.startOn &&
    operation.writtenAt > account.createdAt
  )
}

/** An account's own operations that make its balance — the ones dated after its start. */
export function operationsOf(
  account: MoneyAccount,
  operations: readonly AccountOperation[],
): AccountOperation[] {
  return operations.filter(
    (operation) => operation.accountId === account.id && afterStart(operation, account),
  )
}

export interface AccountBalance {
  readonly balance: Money
  /** Something in it was converted by a rate, or could not be counted at all. */
  readonly approximate: boolean
  /** Operations on it that no rate could count: in no balance, and in every check. */
  readonly uncounted: number
}

/** Start plus every operation on the account after its start day (MOL-115, п. 3). */
export function accountBalance(
  account: MoneyAccount,
  operations: readonly AccountOperation[],
  rateOf: RateBetween,
): AccountBalance {
  let minor = account.start.minor
  let approximate = false
  let uncounted = 0
  for (const operation of operationsOf(account, operations)) {
    const { amount, approximate: estimated } = movementOf(operation, account.currency, rateOf)
    approximate ||= estimated
    if (amount === null) {
      uncounted += 1
      continue
    }
    const sum = bounded(minor + amount.minor, account.currency)
    // A balance no money can hold is «не посчитано» for that row, never a failed screen (MOL-66).
    if (sum === null) {
      uncounted += 1
      continue
    }
    minor = sum.minor
  }
  return { balance: { minor, currency: account.currency }, approximate, uncounted }
}

/**
 * What every live account held at the end of `day` (MOL-134): its start and its operations dated up
 * to that day, as `accountBalance` counts them. An account started after the day is not in it — it
 * tells nothing of the day before it — and a removed one is in no day at all (Р-2): «Деньги» and
 * «Счета» must not disagree about which money there is.
 */
export function balancesOn(
  accounts: readonly MoneyAccount[],
  operations: readonly AccountOperation[],
  day: string,
  rateOf: RateBetween,
): { readonly account: MoneyAccount; readonly balance: Money; readonly uncounted: number }[] {
  const until = operations.filter((operation) => operation.day <= day)
  return accounts
    .filter((account) => account.archivedAt === null && account.startOn <= day)
    .map((account) => {
      const { balance, uncounted } = accountBalance(account, until, rateOf)
      return { account, balance, uncounted }
    })
}

/**
 * Where a check starts looking: the moment of the last check, or the start — the evening of its
 * day, or the moment the account was made on it (MOL-250). An
 * operation is after it when it is dated after that day, or was written after the check — one dated
 * back, typed in only now, is exactly what a difference is made of.
 */
export interface CheckMark {
  readonly day: string
  readonly at: Date | null
}

export function markOf(account: MoneyAccount, last: MoneyAccountCheck | null): CheckMark {
  return last === null
    ? { day: account.startOn, at: startsWhenMade(account) ? account.createdAt : null }
    : { day: last.checkedOn, at: last.createdAt }
}

export function isAfterMark(
  operation: Pick<AccountOperation, 'day' | 'seenAt'>,
  mark: CheckMark,
): boolean {
  return operation.day > mark.day || (mark.at !== null && operation.seenAt > mark.at)
}

function isOfCurrency(operation: AccountOperation, currency: Currency): boolean {
  return (
    operation.currency === currency ||
    operation.amounts.some((amount) => amount.currency === currency)
  )
}

export function operationKeyOf(operation: AccountOperation): JournalKey {
  return {
    day: operation.day,
    moment: operation.at.getTime(),
    // Both halves of an exchange may stand in one list — «не попали» — so each is named by its
    // currency, as a trip's line of the month is; a transfer's halves share theirs, so by the side.
    id:
      operation.side === null || operation.amounts[0] === undefined
        ? operation.id
        : operation.kind === 'transfer'
          ? `${operation.id}:${operation.side}`
          : `${operation.id}:${operation.amounts[0].currency}`,
  }
}

/** Newest first, as the journal of the month orders its rows: day, the moment written, the name. */
export function newestOperationsFirst(a: AccountOperation, b: AccountOperation): number {
  return journalOrder(operationKeyOf(a), operationKeyOf(b))
}

/**
 * What could have made the difference a check found (MOL-43 В-4, «сначала ищем причину»):
 * - `unassigned` — an operation of the account's currency written with no account;
 * - `uncounted` — one on this account that no rate could count;
 * - `noDebited` — a spending or a trip on it in another currency without «списано», counted by the
 *   rate of its day;
 * - `unpriced` — a trip on it with purchases that have no price, and so moved nothing.
 */
export const CHECK_REASONS = ['unassigned', 'uncounted', 'noDebited', 'unpriced'] as const
export type CheckReasonKind = (typeof CHECK_REASONS)[number]

export interface CheckReason {
  readonly kind: CheckReasonKind
  readonly operation: AccountOperation
}

function reasonFor(
  account: MoneyAccount,
  operation: AccountOperation,
  rateOf: RateBetween,
): CheckReasonKind | null {
  if (operation.accountId === null) {
    return isOfCurrency(operation, account.currency) ? 'unassigned' : null
  }
  if (operation.accountId !== account.id) return null
  if (movementOf(operation, account.currency, rateOf).amount === null) return 'uncounted'
  if (debitedOn(operation, account.currency) !== null) return null
  if (operation.amounts.some((amount) => amount.currency !== account.currency)) return 'noDebited'
  return operation.unpriced > 0 ? 'unpriced' : null
}

export interface AccountCheckResult {
  readonly fact: Money
  readonly counted: Money
  /** The fact less what the server counted: below zero, more was spent than written. */
  readonly difference: Money
  readonly approximate: boolean
  /** The day the reasons are looked for from: the last check's, else the start's. */
  readonly since: string
  readonly reasons: readonly CheckReason[]
}

/**
 * «Сверить» (MOL-115, п. 7): the balance as counted, the difference from the fact, and every
 * operation since the last check — or the start — that could have made it, newest first. The phone
 * computes none of it: the difference it shows and the sum «Прочее · сверка» writes are these.
 */
export function accountCheck(
  account: MoneyAccount,
  operations: readonly AccountOperation[],
  last: MoneyAccountCheck | null,
  fact: Money,
  rateOf: RateBetween,
): AccountCheckResult {
  const { balance, approximate } = accountBalance(account, operations, rateOf)
  const mark = markOf(account, last)
  const reasons = operations
    .filter((operation) => afterStart(operation, account) && isAfterMark(operation, mark))
    .map((operation) => ({ kind: reasonFor(account, operation, rateOf), operation }))
    .filter((reason): reason is CheckReason => reason.kind !== null)
    .sort((a, b) => newestOperationsFirst(a.operation, b.operation))
  return {
    fact,
    counted: balance,
    // A difference no money can hold is a fact that is not one: refused, never a 500 on the way out.
    difference: subtractMoney(fact, balance),
    approximate,
    since: mark.day,
    reasons,
  }
}

/**
 * «Не попали в остатки» (MOL-115, Р-16): operations written with no account that could still explain
 * a difference of some live account of their currency — dated after its start, and after its last
 * check. A fresh check of the card does not hide old cash spendings, since the cash account's own
 * window is still open; a currency with no live account is not asked about — there is nowhere to
 * put it.
 */
export function unassignedOperations(
  live: readonly MoneyAccount[],
  lastChecks: ReadonlyMap<string, MoneyAccountCheck>,
  operations: readonly AccountOperation[],
): AccountOperation[] {
  return operations
    .filter(
      (operation) =>
        operation.accountId === null &&
        live.some(
          (account) =>
            isOfCurrency(operation, account.currency) &&
            afterStart(operation, account) &&
            isAfterMark(operation, markOf(account, lastChecks.get(account.id) ?? null)),
        ),
    )
    .sort(newestOperationsFirst)
}

/**
 * The hint for «сколько было до обмена» (MOL-43 Р-5, MOL-115 Р-9, Р-20): what the accounts of a
 * currency held at the end of `day`, the operation being amended left out. Null when there is no
 * account of the currency, or one of them starts on that day or later — its start then already
 * holds the exchange, or tells nothing of the day before it.
 */
export function heldOn(
  accounts: readonly MoneyAccount[],
  operations: readonly AccountOperation[],
  currency: Currency,
  day: string,
  rateOf: RateBetween,
  except?: string,
): { readonly held: Money; readonly approximate: boolean } | null {
  const ofCurrency = accounts.filter((account) => account.currency === currency)
  if (ofCurrency.length === 0 || ofCurrency.some((account) => account.startOn >= day)) return null
  const until = operations.filter((operation) => operation.day <= day && operation.id !== except)
  let minor = 0n
  let approximate = false
  for (const account of ofCurrency) {
    const { balance, approximate: estimated, uncounted } = accountBalance(account, until, rateOf)
    minor += balance.minor
    approximate ||= estimated || uncounted > 0
  }
  const held = bounded(minor, currency)
  return held === null ? null : { held, approximate }
}

/**
 * Every rate the balances, the check and the hint will ask for, so the use case can read them before
 * the pure functions run: an amount on an account in another currency, with no «списано» and no
 * snapshot of the pair, on its own day.
 */
export function conversionsNeeded(
  accounts: readonly MoneyAccount[],
  operations: readonly AccountOperation[],
): { readonly from: Currency; readonly into: Currency; readonly day: string }[] {
  const byId = new Map(accounts.map((account) => [account.id, account]))
  const needs = new Map<string, { from: Currency; into: Currency; day: string }>()
  for (const operation of operations) {
    const account = operation.accountId === null ? undefined : byId.get(operation.accountId)
    if (!account || debitedOn(operation, account.currency) !== null) continue
    for (const { currency } of operation.amounts) {
      if (currency === account.currency || covers(operation.rate, currency, account.currency)) {
        continue
      }
      const key = `${currency}:${account.currency}:${operation.day}`
      needs.set(key, { from: currency, into: account.currency, day: operation.day })
    }
  }
  return [...needs.values()]
}
