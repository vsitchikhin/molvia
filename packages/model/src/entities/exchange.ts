import { z } from 'zod'
import { INT8_MAX, divideRounded } from '#model/support/decimal'
import { ERROR, ISSUE } from '#model/support/errors'
import { minorPerMajor, priceSchema } from '#model/values/money'
import type { Currency, Money } from '#model/values/money'
import { RATE_SCALE, exchangeRateSchema, isRateDay, yerevanMidnight } from '#model/values/rates'
import type { ExchangeRate } from '#model/values/rates'

const positiveMoneySchema = priceSchema.refine((value) => value.minor > 0n, {
  error: ERROR.INVALID_AMOUNT,
})

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
 */
export const exchangeSchema = z
  .object({
    id: z.uuid(),
    actorId: z.uuid(),
    given: positiveMoneySchema,
    received: positiveMoneySchema,
    exchangedOn: exchangeDaySchema,
    heldBefore: priceSchema.nullable(),
    createdAt: z.date(),
  })
  .refine(({ given, received }) => given.currency !== received.currency, {
    error: ISSUE.EXCHANGE_SAME_CURRENCY,
  })
  .refine(
    ({ heldBefore, received }) => heldBefore === null || heldBefore.currency === received.currency,
    { error: ISSUE.EXCHANGE_HELD_NOT_RECEIVED },
  )
export type Exchange = z.infer<typeof exchangeSchema>

/**
 * How the rate of a wallet was arrived at: weighted by what was left, or taken from the last
 * exchange alone because what was left before it is unknown (MOL-40, В-2). The screen says which
 * — an unknown remainder is not quietly counted as zero.
 */
export const walletBasisSchema = z.enum(['weighted', 'last'])
export type WalletBasis = z.infer<typeof walletBasisSchema>

export interface WalletRate {
  readonly rate: ExchangeRate
  readonly basis: WalletBasis
}

/** A ratio of minor units — the received currency's per one of the given one — kept exact. */
interface Ratio {
  readonly quote: bigint
  readonly base: bigint
}

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
function rateOf(ratio: Ratio, base: Currency, quote: Currency, day: string): ExchangeRate | null {
  const scaled = divideRounded(
    ratio.quote * minorPerMajor(base) * RATE_SCALE,
    ratio.base * minorPerMajor(quote),
  )
  const rate = { base, quote, scaled, source: 'personal' as const, asOf: yerevanMidnight(day) }
  return exchangeRateSchema.safeParse(rate).success ? rate : null
}

function chronological(a: Exchange, b: Exchange): number {
  if (a.exchangedOn !== b.exchangedOn) return a.exchangedOn < b.exchangedOn ? -1 : 1
  const time = a.createdAt.getTime() - b.createdAt.getTime()
  if (time !== 0) return time
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
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
 * The person's own rate of `base` into `quote` on `day`: the average cost of the `quote` money
 * they hold, from their exchanges of `base` into `quote` dated no later than `day` (MOL-40, Т-2).
 *
 * Spending does not move it — it takes money and its cost away in one proportion — so purchases
 * are not an input. A new exchange does, and the weight of the money already held is exactly how
 * much of it was left at that moment:
 *
 * - the first exchange, or one whose `heldBefore` is unknown: the rate of that exchange alone,
 *   `basis: 'last'`. Before the first there is money of no known cost, and weighing it by nothing
 *   is the honest answer rather than weighing it by a guess;
 * - otherwise `(received + held) / (given + held / previous)`, `basis: 'weighted'`.
 *
 * Exact throughout — a ratio of integers — and rounded once at the end, so a chain of exchanges
 * carries no rounding from one link to the next. Exchanges of any other pair, the reverse one
 * included, are not part of this wallet: chains and reversals are the money model's, not this.
 */
export function walletRate(
  exchanges: readonly Exchange[],
  base: Currency,
  quote: Currency,
  day: string,
): WalletRate | null {
  const links = exchanges
    .filter(
      (exchange) =>
        exchange.given.currency === base &&
        exchange.received.currency === quote &&
        exchange.exchangedOn <= day,
    )
    .sort(chronological)

  let wallet: { ratio: Ratio; basis: WalletBasis; day: string } | null = null
  for (const link of links) {
    const held = link.heldBefore?.minor ?? null
    const ratio: Ratio =
      wallet === null || held === null
        ? reduced(link.received.minor, link.given.minor)
        : // The money held is worth `held / previous` of the base: added to what was given, it
          // is the cost of everything now in the wallet.
          reduced(
            (link.received.minor + held) * wallet.ratio.quote,
            link.given.minor * wallet.ratio.quote + held * wallet.ratio.base,
          )
    wallet = {
      ratio,
      basis: wallet === null || held === null ? 'last' : 'weighted',
      day: link.exchangedOn,
    }
  }
  if (wallet === null) return null

  const rate = rateOf(wallet.ratio, base, quote, wallet.day)
  return rate ? { rate, basis: wallet.basis } : null
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
 * A hint for «сколько было до обмена» (MOL-40, Р-7): what the last exchange left in the wallet
 * less what was spent in that currency since, never below zero. A hint and not a fact — purchases
 * without a price and money spent outside a trip are not in it, so the screen says «по записанным
 * тратам» — and absent when nothing is known of what came before.
 */
export function heldEstimate(last: Exchange, spent: bigint): Money {
  const held = last.received.minor + (last.heldBefore?.minor ?? 0n) - spent
  return { minor: held > 0n ? held : 0n, currency: last.received.currency }
}
