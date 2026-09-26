import {
  DomainError,
  ERROR,
  currencySchema,
  exchangeRateOf,
  heldEstimate,
  isRateFresh,
  lastReceipt,
  officialDifference,
  ownRates,
  pickOfficialRate,
  receiptDay,
  resourceIdOf,
  yerevanDate,
  yerevanMidnight,
} from '@molvia/model'
import type {
  Actor,
  AmdRate,
  CachedRate,
  Currency,
  Exchange,
  ExchangeAmendBody,
  ExchangeBody,
  ExchangeRate,
  ExchangeRevision,
  ExchangeView,
  ExchangesResponse,
  Income,
  OfficialRate,
  OfficialRateOf,
  OwnRates,
  RatePreference,
  Receipt,
  ReceiptView,
} from '@molvia/model'
import type { TripRepositories } from '@/db/unit-of-work'

type Repositories = Pick<TripRepositories, 'exchanges' | 'incomes' | 'rates'>
/** A write also lets go of the months frozen without it (MOL-73, В-6). */
type Writing = Repositories & Pick<TripRepositories, 'money'>
type Owner = Pick<Actor, 'id' | 'incomeCurrency' | 'spendCurrency'>

const FOREIGN = currencySchema.options.filter(
  (currency): currency is AmdRate['currency'] => currency !== 'AMD',
)

/** How many days of the cache are read at once: a long list must not take the whole pool (Ч-3). */
const RATE_READS_AT_ONCE = 8

/** The official rates cached on or before each of `days`, one query a day, a few at a time. */
export async function officialRatesOn(
  { rates }: Pick<Repositories, 'rates'>,
  days: Iterable<string>,
): Promise<ReadonlyMap<string, readonly CachedRate[]>> {
  const distinct = [...new Set(days)]
  const cached = new Map<string, readonly CachedRate[]>()
  for (let start = 0; start < distinct.length; start += RATE_READS_AT_ONCE) {
    const batch = distinct.slice(start, start + RATE_READS_AT_ONCE)
    const read = await Promise.all(batch.map((day) => rates.latestOnOrBefore(FOREIGN, day)))
    batch.forEach((day, index) => cached.set(day, read[index] ?? []))
  }
  return cached
}

/**
 * A rate that jumped when it arrived is not a fact to measure by — it may be a comma in the wrong
 * place at the bank (MOL-39, Р-19): the rate before the jump is used when there is one, and
 * otherwise none (review С-5).
 */
function steadyOf(official: OfficialRate | null): ExchangeRate | null {
  return official?.jumped ? official.previous : (official?.rate ?? null)
}

/**
 * The official rate of `base` into a currency on an exchange's day, by the rule a trip started
 * that day would have used — what money of no known cost is valued at (MOL-42, В-1). Only a rate
 * fresh for that day, as a trip's is (a Friday rate on Sunday): the rule for a trip falls back to
 * the freshest it has and says `rateStale`, and here nothing would say it — an old number would
 * turn an honest «unknown» into a confident «valued» (adversarial Ж3).
 */
export function officialRateOf(
  cached: ReadonlyMap<string, readonly CachedRate[]>,
  base: Currency,
): OfficialRateOf {
  return (currency, day) => freshOfficialRate(base, currency, cached.get(day) ?? [], day)
}

/** The official rate of the pair on `day`, judged as above and fresh for that day — or null. */
export function freshOfficialRate(
  base: Currency,
  quote: Currency,
  rows: readonly CachedRate[],
  day: string,
): ExchangeRate | null {
  const rate = steadyOf(pickOfficialRate(base, quote, rows, day))
  return rate && isRateFresh(yerevanDate(rate.asOf), day) ? rate : null
}

/** The Yerevan day the currency of conversion changed on, or null when it never did. */
export function sinceDay(since: Date | null): string | null {
  return since ? yerevanDate(since) : null
}

/**
 * One exchange as the list shows it, compared with the official rate of its own day — the rate a
 * trip started that day would have taken, by the same rule (`pickOfficialRate`). A jumped rate is
 * measured by the one before it, and without one the comparison is withheld and the row says why.
 */
function viewsOf(
  exchanges: readonly Exchange[],
  cached: ReadonlyMap<string, readonly CachedRate[]>,
  history: ReadonlyMap<string, readonly ExchangeRevision[]>,
): ExchangeView[] {
  return [...exchanges].reverse().map((exchange): ExchangeView => {
    const { given, received, exchangedOn } = exchange
    const official = pickOfficialRate(
      given.currency,
      received.currency,
      cached.get(exchangedOn) ?? [],
      exchangedOn,
    )
    const measure = steadyOf(official)
    const difference = measure ? officialDifference(exchange, measure) : null
    return {
      id: exchange.id,
      exchangedOn,
      given,
      received,
      heldBefore: exchange.heldBefore,
      note: exchange.note,
      revision: exchange.revision,
      amendedAt: exchange.amendedAt,
      history: (history.get(exchange.id) ?? []).map(
        ({ given, received, exchangedOn, heldBefore, note, replacedAt }) => ({
          given,
          received,
          exchangedOn,
          heldBefore,
          note,
          replacedAt,
        }),
      ),
      rate: exchangeRateOf(exchange),
      official:
        official && measure && difference
          ? { rate: measure, provider: official.provider, difference }
          : null,
      officialDoubtful: !!official?.jumped && !measure,
    }
  })
}

/**
 * Every exchange and income, newest first, with whether it gave its currency a price — what the
 * sheets ask «сколько было до» by (MOL-66). The order is the walk's, turned round.
 */
export function receiptsOf(
  receipts: readonly Receipt[],
  priced: ReadonlySet<string>,
): ReceiptView[] {
  return [...receipts]
    .sort((a, b) => {
      const [dayA, dayB] = [receiptDay(a), receiptDay(b)]
      if (dayA !== dayB) return dayA < dayB ? 1 : -1
      const time = b.createdAt.getTime() - a.createdAt.getTime()
      // The walk breaks a tie by the name, and this is its order turned round (self-review).
      return time !== 0 ? time : a.id < b.id ? 1 : a.id > b.id ? -1 : 0
    })
    .map((receipt) => ({
      id: receipt.id,
      currency: 'given' in receipt ? receipt.received.currency : receipt.amount.currency,
      on: receiptDay(receipt),
      priced: priced.has(receipt.id),
    }))
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * From when the purchases count against the money of an exchange. From the moment it was written
 * when that was on its own day: a purchase that morning was paid with the money held before, which
 * `heldBefore` already names (А4). An exchange written later, under an earlier day, counts from the
 * end of that day — what was bought between the exchange and its record was bought with its money,
 * and counting only from the record lost all of it (round 2, В3). What was bought later on the day
 * of such an exchange is lost instead: the day has no hours to tell before from after.
 */
function spentFrom(receipt: Receipt): Date {
  const endOfDay = new Date(yerevanMidnight(receiptDay(receipt)).getTime() + DAY_MS)
  return receipt.createdAt < endOfDay ? receipt.createdAt : endOfDay
}

/** What «Обмен денег» and «Доходы» are both built from — see `ownMoney`. */
interface OwnMoney {
  readonly preference: RatePreference
  readonly base: Currency
  readonly quote: Currency
  readonly baseSince: string | null
  readonly exchanges: readonly Exchange[]
  readonly incomes: readonly Income[]
  readonly cached: ReadonlyMap<string, readonly CachedRate[]>
  readonly rates: OwnRates
  readonly heldEstimates: ExchangesResponse['heldEstimates']
  readonly receipts: readonly ReceiptView[]
}

/**
 * The person's own money as of today, walked once for either screen (MOL-66): the exchanges and
 * incomes, the official rates of their days, the rates they make, what each currency is likely
 * still held at, and every exchange and income with whether it gave its currency a price.
 *
 * The cache of official rates is read once for every day of an exchange and of an income in a
 * currency that needs valuing: the same rows compare each exchange with the bank and value money
 * whose cost nobody named.
 */
export async function ownMoney(
  repositories: Repositories,
  owner: Owner,
  now: Date = new Date(),
): Promise<OwnMoney> {
  const { exchanges, incomes } = repositories
  const today = yerevanDate(now)
  const base = owner.incomeCurrency
  const quote = owner.spendCurrency
  const [{ preference, since }, list, received] = await Promise.all([
    exchanges.rateSettings(owner.id),
    exchanges.list(owner.id),
    incomes.list(owner.id),
  ])
  const cached = await officialRatesOn(repositories, [
    ...list.map(({ exchangedOn }) => exchangedOn),
    ...received
      .filter(({ amount }) => amount.currency !== base)
      .map(({ receivedOn }) => receivedOn),
  ])

  const receipts: Receipt[] = [...list, ...received]
  const baseSince = sinceDay(since)
  const rates = ownRates(receipts, base, quote, today, officialRateOf(cached, base), baseSince)

  const currencies = [
    ...new Set(
      receipts.map((receipt) =>
        'given' in receipt ? receipt.received.currency : receipt.amount.currency,
      ),
    ),
  ].filter((currency) => currency !== base)
  const heldEstimates = await Promise.all(
    currencies.map(async (currency) => {
      const last = lastReceipt(receipts, currency, today)
      if (!last) return null
      const spent = await exchanges.spentSince(owner.id, currency, spentFrom(last))
      const estimate = heldEstimate(receipts, last, spent)
      if (!estimate) return null
      const from: 'exchange' | 'income' = 'given' in last ? 'exchange' : 'income'
      return { ...estimate, from }
    }),
  )

  return {
    preference,
    base,
    quote,
    baseSince,
    exchanges: list,
    incomes: received,
    cached,
    rates,
    heldEstimates: heldEstimates.filter((estimate) => estimate !== null),
    receipts: receiptsOf(receipts, rates.priced),
  }
}

/**
 * «Обмен денег» whole (MOL-40, MOL-42): the preference, the pair a trip started today would convert
 * by, the wallet of that pair and the cost of every other currency held as of today, the hints for
 * the next exchange into each currency, and every exchange, newest first. Everything a figure on
 * the screen is comes from here — the phone divides nothing.
 */
export async function exchangesOverview(
  repositories: Repositories,
  owner: Owner,
  now: Date = new Date(),
): Promise<ExchangesResponse> {
  const [money, history] = await Promise.all([
    ownMoney(repositories, owner, now),
    repositories.exchanges.history(owner.id),
  ])
  const { base, quote, rates } = money
  return {
    preference: money.preference,
    pair: base === quote ? null : { base, quote },
    wallet: rates.wallet,
    costs: [...rates.costs],
    walletUnknown: rates.unknownAt,
    heldEstimates: money.heldEstimates,
    baseSince: money.baseSince,
    exchanges: viewsOf(money.exchanges, money.cached, history),
    receipts: [...money.receipts],
  }
}

/**
 * «Записать обмен». The day is the person's to name, but not a day that has not come yet in
 * Yerevan: a rate from tomorrow would enter today's trips (the same line «not from the future»
 * draws for an official rate). 201 for a new exchange, and the screen whole either way.
 */
/**
 * The screen as it is on opening. A removed exchange is final from here: the screen that offered
 * it back is gone (В-5).
 */
export async function readExchanges(
  repositories: Repositories,
  owner: Owner,
  now: Date = new Date(),
): Promise<ExchangesResponse> {
  await repositories.exchanges.purgeRemoved(owner.id)
  return exchangesOverview(repositories, owner, now)
}

/** The day of the owner's live exchange, or null — what a write lets the frozen months go from. */
async function dayOfExchange(
  repositories: Pick<Repositories, 'exchanges'>,
  owner: Pick<Owner, 'id'>,
  id: string,
): Promise<string | null> {
  const own = resourceIdOf(id)
  const exchanges = await repositories.exchanges.list(owner.id)
  return exchanges.find((exchange) => exchange.id === own)?.exchangedOn ?? null
}

/** The earlier of two days, the known one when only one is. */
export function earlier(one: string | null, other: string): string {
  return one !== null && one < other ? one : other
}

export async function recordExchange(
  repositories: Writing,
  owner: Owner,
  body: ExchangeBody,
  now: Date = new Date(),
): Promise<{ overview: ExchangesResponse; created: boolean }> {
  if (body.exchangedOn > yerevanDate(now)) throw new DomainError(ERROR.EXCHANGE_IN_FUTURE)
  await repositories.exchanges.purgeRemoved(owner.id)
  const { created } = await repositories.exchanges.add(owner.id, body)
  await repositories.money.thaw(owner.id, body.exchangedOn)
  return { overview: await exchangesOverview(repositories, owner, now), created }
}

/**
 * «Сохранить правку» (MOL-42, В-3): the exchange as it should now be, the version before it kept.
 * The same «not after today» as a new exchange. Trips already started keep the rate they took;
 * trips from now on count by the amended exchange — and its history says why the two differ.
 */
export async function amendExchange(
  repositories: Writing,
  owner: Owner,
  id: string,
  body: ExchangeAmendBody,
  now: Date = new Date(),
): Promise<ExchangesResponse> {
  if (body.exchangedOn > yerevanDate(now)) throw new DomainError(ERROR.EXCHANGE_IN_FUTURE)
  await repositories.exchanges.purgeRemoved(owner.id)
  const before = await dayOfExchange(repositories, owner, id)
  await repositories.exchanges.amend(owner.id, id, body)
  await repositories.money.thaw(owner.id, earlier(before, body.exchangedOn))
  return exchangesOverview(repositories, owner, now)
}

/**
 * «Удалить обмен» (Р-4): no amending, a wrong exchange is removed and entered again. Trips
 * already started keep the rate they took; only trips from now on see the wallet without it.
 * Removed and not yet final: the one removed before it is, since only the latest is offered back
 * — but never this one, when the removal is sent again after a lost answer (round 3, Д2).
 */
export async function removeExchange(
  repositories: Writing,
  owner: Owner,
  id: string,
  now: Date = new Date(),
): Promise<ExchangesResponse> {
  await repositories.exchanges.purgeRemoved(owner.id, id)
  const day = await dayOfExchange(repositories, owner, id)
  await repositories.exchanges.remove(owner.id, id)
  if (day !== null) await repositories.money.thaw(owner.id, day)
  return exchangesOverview(repositories, owner, now)
}

/**
 * «Вернуть» (В-5): the removed exchange as it was, `created_at` included. Again after a lost answer
 * it is the same success. Nothing to bring back — already final, or someone else's — answers as a
 * missing row does.
 */
export async function restoreExchange(
  repositories: Writing,
  owner: Owner,
  id: string,
  now: Date = new Date(),
): Promise<ExchangesResponse> {
  if (!(await repositories.exchanges.restore(owner.id, id))) {
    throw new DomainError(ERROR.NOT_FOUND)
  }
  const day = await dayOfExchange(repositories, owner, id)
  if (day !== null) await repositories.money.thaw(owner.id, day)
  return exchangesOverview(repositories, owner, now)
}

/**
 * «Мой / Официальный» (В-3): for trips from now on — a trip keeps the rate it took. The months of
 * «Деньги» are counted by it, not snapshotted by it, so every frozen one is let go and counted by the
 * new rule when next read (MOL-73, owner's decision В-8): two past months by two rules, decided by
 * which was opened first, was the alternative.
 */
export async function chooseRatePreference(
  repositories: Writing,
  owner: Owner,
  preference: RatePreference,
  now: Date = new Date(),
): Promise<ExchangesResponse> {
  await repositories.exchanges.purgeRemoved(owner.id)
  await repositories.exchanges.setPreference(owner.id, preference)
  await repositories.money.thaw(owner.id)
  return exchangesOverview(repositories, owner, now)
}
