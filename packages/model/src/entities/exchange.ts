import { z } from 'zod'
import { INT8_MAX, divideRounded } from '#model/support/decimal'
import { ERROR, ISSUE } from '#model/support/errors'
import { visibleLine } from '#model/support/text'
import { minorPerMajor, priceSchema } from '#model/values/money'
import type { Currency, Money } from '#model/values/money'
import {
  RATE_MAX,
  RATE_MIN,
  RATE_SCALE,
  exchangeRateSchema,
  isRateDay,
  yerevanMidnight,
} from '#model/values/rates'
import type { ExchangeRate } from '#model/values/rates'

const positiveMoneySchema = priceSchema.refine((value) => value.minor > 0n, {
  error: ERROR.INVALID_AMOUNT,
})

/** The longest «Где и заметка»: «ВТБ банкомат (озон), по памяти» and then some (MOL-42, В-4). */
export const EXCHANGE_NOTE_MAX = 200

/** «Где и заметка»: one line of what the person wants to remember — private as the exchange. */
export const exchangeNoteSchema = visibleLine(EXCHANGE_NOTE_MAX)

/** The day of an exchange as the person names it — a day in Yerevan, the one rates are dated by. */
export const exchangeDaySchema = z
  .string()
  .refine(isRateDay, { error: ISSUE.RATE_IMPLAUSIBLE_DATE })

/**
 * Money changed from one currency into another (MOL-40): what was given, what was received, and
 * on which day. The rate is not stored — it is what the two amounts say, and a stored rate beside
 * them would be a second answer to the same question.
 *
 * `heldBefore` is how much of the received currency the person still had just before this
 * exchange. Optional, because nobody is made to count their wallet — and it is the one number the
 * average cost of what is left needs beyond the exchanges themselves (see `walletRate`).
 *
 * `revision` counts the versions: an amendment keeps the one before it (MOL-42, В-3), because
 * the rate of a past exchange is a fact and is not rewritten in silence.
 */
export const exchangeSchema = z
  .object({
    id: z.uuid(),
    actorId: z.uuid(),
    given: positiveMoneySchema,
    received: positiveMoneySchema,
    exchangedOn: exchangeDaySchema,
    heldBefore: priceSchema.nullable(),
    note: exchangeNoteSchema.nullable(),
    revision: z.int().min(1),
    createdAt: z.date(),
    amendedAt: z.date().nullable(),
  })
  .refine(({ given, received }) => given.currency !== received.currency, {
    error: ISSUE.EXCHANGE_SAME_CURRENCY,
  })
  .refine(({ given, received }) => isPlausibleExchange(given, received), {
    error: ERROR.INVALID_RATE,
  })
  .refine(
    ({ heldBefore, received }) => heldBefore === null || heldBefore.currency === received.currency,
    { error: ISSUE.EXCHANGE_HELD_NOT_RECEIVED },
  )
export type Exchange = z.infer<typeof exchangeSchema>

/** A version an exchange had before it was amended, and when it stopped being the exchange. */
export interface ExchangeRevision {
  readonly revision: number
  readonly given: Money
  readonly received: Money
  readonly exchangedOn: string
  readonly heldBefore: Money | null
  readonly note: string | null
  readonly replacedAt: Date
}

/**
 * How long a removed exchange can be brought back (owner's decision В-7, 25.09.2026). After that it
 * is deleted for good by the server's own minute timer — or sooner, by the owner's next request of
 * the screen. «Removed and left» used to keep the amounts for as long as the screen went unopened,
 * and removing an exchange is the one way to take one's figures away before MOL-58 (round 3, Д3).
 */
export const EXCHANGE_UNDO_MINUTES = 10

/**
 * How the rate of a wallet was arrived at: weighted by what was left, or taken from the last
 * exchange alone because what was left before it is unknown (MOL-40, В-2). The screen says which
 * — an unknown remainder is not quietly counted as zero.
 */
export const walletBasisSchema = z.enum(['weighted', 'last'])
export type WalletBasis = z.infer<typeof walletBasisSchema>

/**
 * What one unit of a currency cost in the currency of conversion, as a rate of the latter into
 * the former (MOL-42). `estimated` says that part of that cost was never named by the person and
 * was taken from the official rate of an exchange's day instead (В-1).
 */
export interface CurrencyCost {
  readonly rate: ExchangeRate
  readonly basis: WalletBasis
  readonly estimated: boolean
}

/** The person's own rate of the currency of conversion into the spending one. */
export type WalletRate = CurrencyCost

/**
 * The official rate of the currency of conversion into `currency` on `day`, already judged the way
 * a comparison judges it (a jumped rate gives way to the one before it) — or null when there is
 * none. The model reads no cache: the use case hands the answer in.
 */
export type OfficialRateOf = (currency: Currency, day: string) => ExchangeRate | null

const noOfficialRate: OfficialRateOf = () => null

/**
 * A ratio of minor units, kept exact: `quote` of a currency per `base` of the currency of
 * conversion — for an exchange alone, what was received per what was given.
 */
interface Ratio {
  readonly quote: bigint
  readonly base: bigint
}

interface Cost {
  readonly ratio: Ratio
  readonly basis: WalletBasis
  readonly estimated: boolean
  /** The day of the exchange that last moved it. */
  readonly day: string
}

const ONE: Ratio = { quote: 1n, base: 1n }

function gcd(a: bigint, b: bigint): bigint {
  let [x, y] = [a, b]
  while (y !== 0n) [x, y] = [y, x % y]
  return x
}

function reduced(quote: bigint, base: bigint): Ratio {
  const divisor = gcd(quote, base)
  return { quote: quote / divisor, base: base / divisor }
}

/**
 * The ratio as the snapshot keeps a rate: quote per one base, at `RATE_SCALE`, rounded half-up —
 * the one rounding, done once, where the exact value becomes a rate (as `rateFromAmd` does for a
 * cross). `null` when the result is outside what `exchangeRateSchema` accepts.
 */
function scaledOf(ratio: Ratio, base: Currency, quote: Currency): bigint {
  return divideRounded(
    ratio.quote * minorPerMajor(base) * RATE_SCALE,
    ratio.base * minorPerMajor(quote),
  )
}

function rateOf(ratio: Ratio, base: Currency, quote: Currency, day: string): ExchangeRate | null {
  const scaled = scaledOf(ratio, base, quote)
  const rate = { base, quote, scaled, source: 'personal' as const, asOf: yerevanMidnight(day) }
  return exchangeRateSchema.safeParse(rate).success ? rate : null
}

/** The order the wallet walks exchanges in: by day, then as written. */
function chronological(a: Exchange, b: Exchange): number {
  if (a.exchangedOn !== b.exchangedOn) return a.exchangedOn < b.exchangedOn ? -1 : 1
  const time = a.createdAt.getTime() - b.createdAt.getTime()
  if (time !== 0) return time
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/**
 * Whether the two amounts say a rate a trip could take (MOL-40, adversarial А3). An exchange
 * outside the band was accepted once and then could not be counted: the wallet vanished, the trip
 * took the bank's rate in silence and the screen said there were no exchanges above a list of two.
 * So it is refused where it is written, and the wallet of exchanges inside the band stays inside.
 */
export function isPlausibleExchange(given: Money, received: Money): boolean {
  if (given.minor <= 0n || received.minor <= 0n || given.currency === received.currency) {
    return true // not this rule's question: the amounts and currencies are refused by their own
  }
  const scaled = scaledOf(reduced(received.minor, given.minor), given.currency, received.currency)
  return scaled >= RATE_MIN && scaled <= RATE_MAX
}

/** The rate a single exchange was made at: what was received per one of what was given. */
export function exchangeRateOf(exchange: Exchange): ExchangeRate | null {
  return rateOf(
    reduced(exchange.received.minor, exchange.given.minor),
    exchange.given.currency,
    exchange.received.currency,
    exchange.exchangedOn,
  )
}

/**
 * What every currency cost in `base`, from the exchanges dated no later than `day` and no earlier
 * than `since` — the day `base` became the currency of conversion, or null when it always was
 * (MOL-42, В-2: a change of it works forwards, and nothing before it is re-counted in the new one).
 *
 * One rule covers the pair, chains and reversals alike. `base` costs one. **Giving money away
 * moves nothing** — it takes money and its cost away in one proportion, as spending does — so an
 * exchange back into `base` leaves every cost where it was. **Receiving money** costs what was
 * given for it, at the cost of that: roubles to dollars to drams carries the price of the dollars
 * into the drams. Then, as for the pair alone (MOL-40):
 *
 * - the first receipt of a currency, one whose `heldBefore` is unknown, or one after its cost
 *   became unknown: the cost of this exchange alone, `basis: 'last'`;
 * - otherwise weighted by what was held: `(received + held) / (paid + held / previous)`.
 *
 * What was given may have no known cost at all — dollars brought from home, whose price in roubles
 * nobody wrote down. Then it is valued at the official rate of the exchange's day and the cost
 * says so (`estimated`, В-1): what the person named is counted as named, and what they did not is
 * taken from a source, never as zero. With no official rate either, the received currency's cost
 * is unknown until an exchange starts it afresh.
 *
 * Exact throughout — ratios of integers, reduced at every link — and rounded once, at the end.
 */
function costsOf(
  exchanges: readonly Exchange[],
  base: Currency,
  day: string,
  officialOf: OfficialRateOf,
  since: string | null,
): Map<Currency, Cost | null> {
  const links = exchanges
    .filter(({ exchangedOn }) => exchangedOn <= day && (since === null || exchangedOn >= since))
    .sort(chronological)

  const costs = new Map<Currency, Cost | null>()
  const paidWith = (
    currency: Currency,
    on: string,
  ): { ratio: Ratio; estimated: boolean } | null => {
    if (currency === base) return { ratio: ONE, estimated: false }
    const own = costs.get(currency)
    if (own) return own
    const official = officialOf(currency, on)
    if (official?.base !== base || official.quote !== currency) return null
    const ratio = reduced(
      official.scaled * minorPerMajor(currency),
      RATE_SCALE * minorPerMajor(base),
    )
    return { ratio, estimated: true }
  }

  for (const link of links) {
    const { given, received } = link
    if (received.currency === base) continue

    const paid = paidWith(given.currency, link.exchangedOn)
    if (paid === null) {
      costs.set(received.currency, null)
      continue
    }
    const previous = costs.get(received.currency) ?? null
    const held = link.heldBefore?.minor ?? null
    costs.set(
      received.currency,
      previous === null || held === null
        ? {
            ratio: reduced(received.minor * paid.ratio.quote, given.minor * paid.ratio.base),
            basis: 'last',
            estimated: paid.estimated,
            day: link.exchangedOn,
          }
        : {
            // What was given is worth `given · paid.base / paid.quote` of the base, and the money
            // held `held · previous.base / previous.quote`: together, the cost of everything now
            // held. Both fractions are brought to one denominator so nothing is rounded.
            ratio: reduced(
              (received.minor + held) * paid.ratio.quote * previous.ratio.quote,
              given.minor * paid.ratio.base * previous.ratio.quote +
                held * previous.ratio.base * paid.ratio.quote,
            ),
            basis: 'weighted',
            estimated: paid.estimated || previous.estimated,
            day: link.exchangedOn,
          },
    )
  }
  return costs
}

function costOf(cost: Cost, base: Currency, currency: Currency): CurrencyCost | null {
  const rate = rateOf(cost.ratio, base, currency, cost.day)
  return rate ? { rate, basis: cost.basis, estimated: cost.estimated } : null
}

/**
 * The cost of every currency the person holds by exchange, other than `base` itself: what the
 * screen shows under the wallet, so a chain can be checked by eye (MOL-42, Р-4). Each is the price
 * of one unit of it in `base` — «доллар — 89,04 ₽» — the way a price is read, where the wallet is
 * the rate a trip converts by.
 */
export function currencyCosts(
  exchanges: readonly Exchange[],
  base: Currency,
  day: string,
  officialOf: OfficialRateOf = noOfficialRate,
  since: string | null = null,
): CurrencyCost[] {
  return [...costsOf(exchanges, base, day, officialOf, since)].flatMap(([currency, cost]) => {
    if (!cost) return []
    const price = { quote: cost.ratio.base, base: cost.ratio.quote }
    const rate = rateOf(price, currency, base, cost.day)
    return rate ? [{ rate, basis: cost.basis, estimated: cost.estimated }] : []
  })
}

/**
 * The person's own rate of `base` into `quote` on `day`: the average cost of the `quote` money
 * they hold (MOL-40, Т-2), through whatever currencies it was bought with (MOL-42). Spending does
 * not move it, so purchases are not an input; see `costsOf` for the rule. Null when the cost of
 * `quote` is not known — the trip then takes the official rate.
 */
export function walletRate(
  exchanges: readonly Exchange[],
  base: Currency,
  quote: Currency,
  day: string,
  officialOf: OfficialRateOf = noOfficialRate,
  since: string | null = null,
): WalletRate | null {
  if (base === quote) return null
  const cost = costsOf(exchanges, base, day, officialOf, since).get(quote)
  return cost ? costOf(cost, base, quote) : null
}

/**
 * How much more — or, below zero, less — an exchange gave than the official rate of its day would
 * have, in the received currency (MOL-40, В-3). Either sign is ordinary: the difference is not a
 * commission, and a good exchanger beats the bank. `null` when the rate is not of this pair, or
 * when the difference does not fit in money at all.
 */
export function officialDifference(exchange: Exchange, official: ExchangeRate): Money | null {
  const { given, received } = exchange
  if (official.base !== given.currency || official.quote !== received.currency) return null

  const expected = divideRounded(
    given.minor * official.scaled * minorPerMajor(received.currency),
    RATE_SCALE * minorPerMajor(given.currency),
  )
  const minor = received.minor - expected
  if (minor > INT8_MAX || minor < -INT8_MAX) return null
  return { minor, currency: received.currency }
}

/**
 * The latest exchange into `currency` dated no later than `day` — the one a hint of what is still
 * held starts from.
 */
export function lastReceipt(
  exchanges: readonly Exchange[],
  currency: Currency,
  day: string,
): Exchange | undefined {
  return exchanges
    .filter(({ received, exchangedOn }) => received.currency === currency && exchangedOn <= day)
    .sort(chronological)
    .at(-1)
}

/**
 * A hint for «сколько было до обмена» (MOL-40, Р-7, Р-13; MOL-42, Р-3): what the last exchange
 * into a currency left, less what was spent in it since and less what later exchanges gave of it —
 * a reversal and dollars handed over for drams take money away as a purchase does. A hint and not
 * a fact — purchases without a price and money spent outside a trip are not in it, so the screen
 * says «по записанным тратам».
 *
 * `whole` says whether it counts everything held: when the last exchange did not say what was
 * there before it, the hint is about that exchange's money alone and the screen says so — the
 * unknown remainder is not counted as zero (В-2). `null` when the figure is not money at all: an
 * absurd remainder once took the whole screen down with a 500 (adversarial А1).
 */
export function heldEstimate(
  exchanges: readonly Exchange[],
  last: Exchange,
  spent: bigint,
): { readonly held: Money; readonly whole: boolean } | null {
  const currency = last.received.currency
  const givenAfter = exchanges
    .filter((exchange) => exchange.given.currency === currency && chronological(exchange, last) > 0)
    .reduce((sum, exchange) => sum + exchange.given.minor, 0n)
  const held = last.received.minor + (last.heldBefore?.minor ?? 0n) - spent - givenAfter
  if (held > INT8_MAX) return null
  return {
    held: { minor: held > 0n ? held : 0n, currency },
    whole: last.heldBefore !== null,
  }
}
