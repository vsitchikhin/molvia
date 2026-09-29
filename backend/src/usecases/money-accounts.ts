import {
  ACCOUNT_JOURNAL_PAGE,
  DomainError,
  ERROR,
  INT8_MAX,
  accountBalance,
  accountCheck,
  accountOperationViewOf,
  afterStart,
  conversionsNeeded,
  convertSigned,
  heldOn,
  journalOrder,
  latestDay,
  movementOf,
  newestOperationsFirst,
  operationKeyOf,
  resourceIdOf,
  unassignedOperations,
} from '@molvia/model'
import type {
  AccountCheckBody,
  AccountCheckResponse,
  AccountJournalResponse,
  AccountOperation,
  AccountsHeldQuery,
  AccountsHeldResponse,
  Actor,
  Currency,
  ExchangeRate,
  JournalKey,
  Money,
  MoneyAccount,
  MoneyAccountAmendBody,
  MoneyAccountBody,
  MoneyAccountCheck,
  MoneyAccountView,
  MoneyAccountsResponse,
  RateBetween,
  TripPaymentBody,
  TripView,
  UnassignedOperationsResponse,
} from '@molvia/model'
import { knownAccounts, paymentOf } from './account-of'
import { dayRates } from './money-rates'
import { tripViewFor } from './trip-view'
import type { TripViewDeps } from './trip-view'
import type { DayRates } from './money-rates'
import type { TripRepositories } from '@/db/unit-of-work'
import { todayOf } from './today'
import type { Today } from './today'

type Repositories = Pick<TripRepositories, 'moneyAccounts' | 'exchanges' | 'incomes' | 'rates'>
type Owner = Pick<Actor, 'id' | 'incomeCurrency' | 'spendCurrency'> & Today

/** Everything an account is counted from, read once for a request. */
interface Counting {
  readonly today: string
  readonly accounts: readonly MoneyAccount[]
  readonly operations: readonly AccountOperation[]
  readonly rateOf: RateBetween
}

/** A rate the counting will ask for: an amount of `from` into `into`, on `day`. */
export interface RateNeed {
  readonly from: Currency
  readonly into: Currency
  readonly day: string
}

/**
 * The owner's accounts, their operations and every rate their balances ask for — read before the
 * pure functions run, as the month of «Деньги» reads its rates (MOL-73). An amount in another
 * currency is counted by the rule of «Деньги» on its own day (Р-14); `extra` names what else the
 * caller will convert: «Счета» every balance into the spending currency today, the month of «Деньги»
 * its balances into the income one (MOL-134).
 */
export async function accountsCounted(
  repositories: Pick<Repositories, 'moneyAccounts'>,
  owner: Pick<Owner, 'id'>,
  rates: DayRates | Promise<DayRates>,
  extra: (accounts: readonly MoneyAccount[]) => readonly RateNeed[] = () => [],
): Promise<Omit<Counting, 'today'>> {
  const [accounts, operations, day] = await Promise.all([
    repositories.moneyAccounts.list(owner.id),
    repositories.moneyAccounts.operations(owner.id),
    rates,
  ])
  const known = new Map<string, ExchangeRate | null>()
  for (const { from, into, day: on } of [
    ...conversionsNeeded(accounts, operations),
    ...extra(accounts),
  ]) {
    const key = `${from}:${into}:${on}`
    if (!known.has(key)) known.set(key, await day.between(from, into, on))
  }
  return {
    accounts,
    operations,
    rateOf: (from, into, on) => known.get(`${from}:${into}:${on}`) ?? null,
  }
}

async function counting(repositories: Repositories, owner: Owner, now: Date): Promise<Counting> {
  const today = todayOf(owner, now)
  const counted = await accountsCounted(repositories, owner, dayRates(repositories, owner), (all) =>
    all
      .filter((account) => account.currency !== owner.spendCurrency)
      .map((account) => ({ from: account.currency, into: owner.spendCurrency, day: today })),
  )
  return { today, ...counted }
}

function accountViewOf(
  account: MoneyAccount,
  { operations, rateOf, today }: Counting,
  spendCurrency: Currency,
  lastCheck: MoneyAccountCheck | undefined,
): MoneyAccountView {
  const { balance, approximate, uncounted } = accountBalance(account, operations, rateOf)
  const rate =
    account.currency === spendCurrency ? null : rateOf(account.currency, spendCurrency, today)
  return {
    id: account.id,
    name: account.name,
    currency: account.currency,
    savings: account.savings,
    start: account.start,
    startOn: account.startOn,
    balance,
    approximate,
    uncounted,
    inSpend: rate === null ? null : convertSigned(balance, rate),
    rate,
    lastCheckedOn: lastCheck?.checkedOn ?? null,
    hasOperations: operations.some((operation) => operation.accountId === account.id),
    archivedAt: account.archivedAt,
    revision: account.revision,
  }
}

/**
 * «Счета» whole (handoff 01, 02): every account with its balance, and the totals of the live ones
 * in the spending currency — «всего», «можно тратить» without the savings, «сбережения». A removed
 * account is in no total (Р-22). One nothing converts today is left out and counted as such.
 */
export async function moneyAccountsOf(
  repositories: Repositories,
  owner: Owner,
  now: Date = new Date(),
): Promise<MoneyAccountsResponse> {
  const [counted, lastChecks, matched] = await Promise.all([
    counting(repositories, owner, now),
    repositories.moneyAccounts.lastChecks(owner.id, false),
    repositories.moneyAccounts.lastChecks(owner.id, true),
  ])
  const views = counted.accounts.map((account) =>
    accountViewOf(account, counted, owner.spendCurrency, lastChecks.get(account.id)),
  )
  let spendable = 0n
  let savings = 0n
  let uncounted = 0
  for (const view of views) {
    if (view.archivedAt !== null) continue
    const inSpend = view.currency === owner.spendCurrency ? view.balance : view.inSpend
    const nextSpendable = view.savings ? spendable : spendable + (inSpend?.minor ?? 0n)
    const nextSavings = view.savings ? savings + (inSpend?.minor ?? 0n) : savings
    // One no money can hold is left out, never a failed page — the one way to amend it (MOL-66).
    if (
      inSpend === null ||
      !holds(nextSpendable) ||
      !holds(nextSavings) ||
      !holds(nextSavings + nextSpendable)
    ) {
      uncounted += 1
      continue
    }
    spendable = nextSpendable
    savings = nextSavings
  }
  const live = counted.accounts.filter((account) => account.archivedAt === null)
  const money = (minor: bigint): Money => ({ minor, currency: owner.spendCurrency })
  return {
    spendCurrency: owner.spendCurrency,
    accounts: views,
    totals: {
      total: money(spendable + savings),
      spendable: money(spendable),
      savings: money(savings),
      uncounted,
    },
    unassigned: unassignedOperations(live, matched, counted.operations).length,
    countedAt: now,
  }
}

function holds(minor: bigint): boolean {
  return minor <= INT8_MAX && minor >= -INT8_MAX
}

/** The owner's account by an address in either case; a removed one too, a marked one never. */
function accountAt(accounts: readonly MoneyAccount[], id: string): MoneyAccount {
  const own = resourceIdOf(id)
  const account = accounts.find((candidate) => candidate.id === own)
  if (!account) throw new DomainError(ERROR.NOT_FOUND)
  return account
}

/** An account's journal, newest first, a page after `cursor` (handoff 04, Р-23). */
export async function accountJournal(
  repositories: Repositories,
  owner: Owner,
  id: string,
  cursor?: JournalKey,
  now: Date = new Date(),
): Promise<AccountJournalResponse> {
  const [counted, last] = await Promise.all([
    counting(repositories, owner, now),
    repositories.moneyAccounts.lastChecks(owner.id, false),
  ])
  const account = accountAt(counted.accounts, id)
  const rows = counted.operations
    .filter((operation) => operation.accountId === account.id)
    .sort(newestOperationsFirst)
    .filter(
      (operation) => cursor === undefined || journalOrder(cursor, operationKeyOf(operation)) < 0,
    )
  const page = rows.slice(0, ACCOUNT_JOURNAL_PAGE)
  const lastShown = page.at(-1)
  return {
    account: accountViewOf(account, counted, owner.spendCurrency, last.get(account.id)),
    rows: page.map((operation) =>
      accountOperationViewOf(
        operation,
        movementOf(operation, account.currency, counted.rateOf),
        afterStart(operation, account),
      ),
    ),
    cursor: rows.length > page.length && lastShown ? operationKeyOf(lastShown) : null,
  }
}

/** «Не попали в остатки» (Р-16): operations with no account that could explain a difference. */
export async function unassignedOf(
  repositories: Repositories,
  owner: Owner,
  now: Date = new Date(),
): Promise<UnassignedOperationsResponse> {
  const [counted, matched] = await Promise.all([
    counting(repositories, owner, now),
    repositories.moneyAccounts.lastChecks(owner.id, true),
  ])
  const live = counted.accounts.filter((account) => account.archivedAt === null)
  return {
    rows: unassignedOperations(live, matched, counted.operations).map((operation) =>
      accountOperationViewOf(operation, null, true),
    ),
  }
}

/**
 * «Сверить» (MOL-43 В-4, Р-19): the balance counted, the difference from the fact, and what could
 * have made it since the check before this one. Written, so the next check starts from here; the
 * same check sent again after a reason was put right is counted again under its own name.
 */
export async function checkAccount(
  repositories: Repositories,
  owner: Owner,
  id: string,
  body: AccountCheckBody,
  now: Date = new Date(),
): Promise<AccountCheckResponse> {
  const counted = await counting(repositories, owner, now)
  const account = accountAt(counted.accounts, id)
  if (body.fact.currency !== account.currency) throw new DomainError(ERROR.MONEY_ACCOUNT_CURRENCY)
  // Where to look from: the last check that came out even — one with a difference named its
  // reasons, and they stay reasons until one does (owner's decision В-4 of the review, Д7).
  const before = await repositories.moneyAccounts.lastMatched(owner.id, account.id, body.id)
  const result = accountCheck(account, counted.operations, before, body.fact, counted.rateOf)
  const saved = await repositories.moneyAccounts.saveCheck(owner.id, {
    id: body.id,
    accountId: account.id,
    checkedOn: counted.today,
    fact: body.fact,
    counted: result.counted,
  })
  return {
    id: saved.id,
    checkedOn: saved.checkedOn,
    fact: result.fact,
    counted: result.counted,
    difference: result.difference,
    approximate: result.approximate,
    since: result.since,
    reasons: result.reasons.map(({ kind, operation }) => ({
      kind,
      operation: accountOperationViewOf(
        operation,
        operation.accountId === account.id
          ? movementOf(operation, account.currency, counted.rateOf)
          : null,
        true,
      ),
    })),
  }
}

/** The hint of «сколько было до обмена» from the accounts (Р-20): a suggestion, never a fact. */
export async function accountsHeld(
  repositories: Repositories,
  owner: Owner,
  query: AccountsHeldQuery,
  now: Date = new Date(),
): Promise<AccountsHeldResponse> {
  const counted = await counting(repositories, owner, now)
  const held = heldOn(
    counted.accounts,
    counted.operations,
    query.currency,
    query.day,
    counted.rateOf,
    query.except,
  )
  return { held: held?.held ?? null, approximate: held?.approximate ?? false }
}

/** «Добавить счёт»: 201 for a new one, 200 for the same one sent again; the page whole either way. */
export async function addMoneyAccount(
  repositories: Repositories,
  owner: Owner,
  body: MoneyAccountBody,
  now: Date = new Date(),
): Promise<{ overview: MoneyAccountsResponse; created: boolean }> {
  if (body.startOn > latestDay(now)) throw new DomainError(ERROR.MONEY_ACCOUNT_IN_FUTURE)
  const { created } = await repositories.moneyAccounts.add(owner.id, body)
  return { overview: await moneyAccountsOf(repositories, owner, now), created }
}

/** «Сохранить» an amended account: a new start moves the balance, the history stays as it was. */
export async function amendMoneyAccount(
  repositories: Repositories,
  owner: Owner,
  id: string,
  body: MoneyAccountAmendBody,
  now: Date = new Date(),
): Promise<MoneyAccountsResponse> {
  if (body.startOn > latestDay(now)) throw new DomainError(ERROR.MONEY_ACCOUNT_IN_FUTURE)
  await repositories.moneyAccounts.amend(owner.id, id, body)
  return moneyAccountsOf(repositories, owner, now)
}

/**
 * «Удалить» / «Убрать из выбора»: which one it was is the server's to decide, by whether anything
 * was ever written on the account (handoff 03). 404 for an account that is not the owner's.
 */
export async function removeMoneyAccount(
  repositories: Repositories,
  owner: Owner,
  id: string,
  now: Date = new Date(),
): Promise<MoneyAccountsResponse> {
  if ((await repositories.moneyAccounts.remove(owner.id, id)) === null) {
    throw new DomainError(ERROR.NOT_FOUND)
  }
  return moneyAccountsOf(repositories, owner, now)
}

/** «Вернуть»: a deleted one within its ten minutes, or a removed one; 404 when there is none. */
export async function restoreMoneyAccount(
  repositories: Repositories,
  owner: Owner,
  id: string,
  now: Date = new Date(),
): Promise<MoneyAccountsResponse> {
  if (!(await repositories.moneyAccounts.restore(owner.id, id))) {
    throw new DomainError(ERROR.NOT_FOUND)
  }
  return moneyAccountsOf(repositories, owner, now)
}

/**
 * The account a trip was paid from, and «списано» (MOL-115, п. 6, Р-18) — from its summary, at any
 * time, a finished trip too. Written whole each time, so the queue sending it twice is one state.
 * Answers with the trip, as every write to a trip does.
 */
export async function payTrip(
  repositories: TripViewDeps & Pick<TripRepositories, 'trips' | 'moneyAccounts'>,
  owner: Pick<Actor, 'id'>,
  tripId: string,
  body: TripPaymentBody,
): Promise<TripView> {
  const trip = await repositories.trips.byId(tripId, owner.id)
  if (!trip) throw new DomainError(ERROR.NOT_FOUND)
  // «Списано» stands for the trip whole: its own currency and every purchase's (adversarial Д2).
  const purchases = await repositories.expenses.forTrip(trip.id, owner.id)
  const { accountId, debited } = paymentOf(
    await knownAccounts(repositories, owner),
    null,
    { accountId: body.accountId, debited: body.debited ?? null },
    [trip.currency, ...purchases.flatMap(({ amount }) => (amount ? [amount.currency] : []))],
  )
  await repositories.moneyAccounts.setTripPayment(owner.id, trip.id, accountId, debited)
  return tripViewFor(repositories, { ...trip, accountId, debited })
}
