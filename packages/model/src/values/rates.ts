import { z } from 'zod'
import { decimalFromScaled, divideRounded, scaledFromDecimal } from '#model/support/decimal'
import { DomainError, ERROR, ISSUE } from '#model/support/errors'
import { currencySchema } from './money'
import type { Currency } from './money'

export const RATE_DIGITS = 6
export const RATE_SCALE = 10n ** BigInt(RATE_DIGITS)

// A sanity band, not a validation: the real check on a personal rate is disagreement with the
// official one for the same day — MOL-40's, against the cache of MOL-39.
export const RATE_MIN = RATE_SCALE / 10_000n
export const RATE_MAX = RATE_SCALE * 1_000_000n

const RATE_EPOCH = new Date('2000-01-01T00:00:00.000Z')

/**
 * `official` is the Central Bank of Armenia. `fallback` is an open source standing in for it
 * when it has published nothing for a week (MOL-39) — the screen marks such a rate, because the
 * person trusts the number by where it came from.
 */
export const rateSourceSchema = z.enum(['personal', 'official', 'fallback'])
export type RateSource = z.infer<typeof rateSourceSchema>

const exchangeRateFields = z.object({
  base: currencySchema,
  quote: currencySchema,
  scaled: z.bigint().min(RATE_MIN).max(RATE_MAX),
  source: rateSourceSchema,
  asOf: z.date(),
})

export const exchangeRateSchema = exchangeRateFields
  .refine((rate) => rate.base !== rate.quote, {
    error: ISSUE.RATE_SAME_CURRENCY,
  })
  // No Date.now() here: a schema that answers differently depending on the clock is not
  // a schema. «Not from the future» belongs to the use case that snapshots the rate.
  .refine((rate) => rate.asOf >= RATE_EPOCH, { error: ISSUE.RATE_IMPLAUSIBLE_DATE })
export type ExchangeRate = z.infer<typeof exchangeRateSchema>

function scaledFromRate(input: string): bigint | null {
  const scaled = scaledFromDecimal(input, RATE_DIGITS)
  if (scaled === null || scaled < RATE_MIN || scaled > RATE_MAX) return null
  return scaled
}

export function parseRate(input: string): bigint {
  const scaled = scaledFromRate(input)
  if (scaled === null) throw new DomainError(ERROR.INVALID_RATE, input)
  return scaled
}

export function decimalFromRate(scaled: bigint): string {
  return decimalFromScaled(scaled, RATE_DIGITS)
}

export const exchangeRateWireSchema = z.object({
  base: currencySchema,
  quote: currencySchema,
  rate: z.string().max(40),
  source: rateSourceSchema,
  asOf: z.iso.datetime(),
})
export type ExchangeRateWire = z.infer<typeof exchangeRateWireSchema>

export const rateCodec = z.codec(exchangeRateWireSchema, exchangeRateSchema, {
  decode: ({ base, quote, rate, source, asOf }, payload) => {
    const scaled = scaledFromRate(rate)
    if (scaled === null) {
      payload.issues.push({
        code: 'custom',
        input: rate,
        path: ['rate'],
        message: ERROR.INVALID_RATE,
      })
    }
    return { base, quote, scaled: scaled ?? 1n, source, asOf: new Date(asOf) }
  },
  encode: (value) => ({
    base: value.base,
    quote: value.quote,
    rate: decimalFromRate(value.scaled),
    source: value.source,
    asOf: value.asOf.toISOString(),
  }),
})

/**
 * Where an official rate was read. The cache keeps the provider so that one pair is never built
 * from two sources — a rouble from one bank against a dollar from another is nobody's rate.
 */
export const rateProviderSchema = z.enum(['cba', 'cbr', 'erapi'])
export type RateProvider = z.infer<typeof rateProviderSchema>

/** One published rate: how many drams one unit of `currency` was worth on `date` in Yerevan. */
export interface AmdRate {
  readonly provider: RateProvider
  readonly currency: Exclude<Currency, 'AMD'>
  /** `YYYY-MM-DD`, the day in Yerevan the provider dates the rate by. */
  readonly date: string
  readonly scaled: bigint
}

// Armenia has kept +04:00 all year since 2012, so the offset is a constant, not a lookup.
const YEREVAN_OFFSET_MS = 4 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

/** The calendar day in Yerevan at `instant` — the day every provider dates its rate by. */
export function yerevanDate(instant: Date): string {
  return new Date(instant.getTime() + YEREVAN_OFFSET_MS).toISOString().slice(0, 10)
}

/** The instant a Yerevan day begins: what a daily rate's `asOf` means. */
export function yerevanMidnight(date: string): Date {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) - YEREVAN_OFFSET_MS)
}

function daysBetween(earlier: string, later: string): number {
  return Math.round((Date.parse(later) - Date.parse(earlier)) / DAY_MS)
}

/**
 * How long the Central Bank of Armenia may stay silent before a trip takes an open source
 * instead (MOL-39, В-7). A week covers weekends and holidays, when it publishes nothing and
 * nothing is wrong: a shorter bound would mark every Sunday trip «not the central bank».
 */
export const OFFICIAL_RATE_FRESH_DAYS = 7

// Tie-breaking order: the central bank first, then the other central bank, then the aggregator.
const PROVIDER_ORDER: readonly RateProvider[] = ['cba', 'cbr', 'erapi']

/**
 * The rate of `base` in `quote` built from rates against the dram: quote per one base, as the
 * snapshot stores it. Against the dram it is the published number itself; the inverse and the
 * cross are a division rounded half-up to the snapshot's six digits — the one rounding outside
 * output, because the snapshot's scale is fixed (MOL-4) and the snapshot is this value's output.
 *
 * `null` when a currency is missing, when the pair is not a pair, or when the result falls
 * outside the band `exchangeRateSchema` holds. The date is the older of the two halves: a cross
 * is no fresher than its stalest part.
 */
export function rateFromAmd(
  base: Currency,
  quote: Currency,
  rates: readonly AmdRate[],
  source: RateSource,
): ExchangeRate | null {
  if (base === quote) return null

  const halves = [base, quote].map((currency) =>
    currency === 'AMD' ? null : rates.find((rate) => rate.currency === currency),
  )
  if (halves.includes(undefined)) return null

  const amdPer = (index: number): bigint => halves[index]?.scaled ?? RATE_SCALE
  const scaled = divideRounded(amdPer(0) * RATE_SCALE, amdPer(1))
  if (scaled < RATE_MIN || scaled > RATE_MAX) return null

  const dates = halves.flatMap((half) => (half ? [half.date] : [])).sort()
  const [oldest] = dates
  if (oldest === undefined) return null

  return { base, quote, scaled, source, asOf: yerevanMidnight(oldest) }
}

/**
 * The official rate a trip started on `today` snapshots (MOL-39, В-7).
 *
 * The Central Bank of Armenia while its latest rate is at most a week old — a Friday rate on
 * Sunday is the right answer, not a stale one. Past that, whichever provider has the freshest
 * rate for both halves of the pair, the central bank winning a tie: an open source is taken only
 * for being newer, and a trip built on it is marked `fallback`. Rows dated after `today` are
 * ignored — a bank that sets tomorrow's rate today has not made it today's.
 */
export function pickOfficialRate(
  base: Currency,
  quote: Currency,
  rows: readonly AmdRate[],
  today: string,
): ExchangeRate | null {
  const candidates = PROVIDER_ORDER.flatMap((provider) => {
    const own = rows.filter((row) => row.provider === provider && row.date <= today)
    const latest = [...new Set(own.map((row) => row.currency))].map((currency) =>
      own
        .filter((row) => row.currency === currency)
        .reduce((best, row) => (row.date > best.date ? row : best)),
    )
    const rate = rateFromAmd(base, quote, latest, provider === 'cba' ? 'official' : 'fallback')
    return rate ? [{ provider, rate, date: yerevanDate(rate.asOf) }] : []
  })

  const central = candidates.find((candidate) => candidate.provider === 'cba')
  if (central && daysBetween(central.date, today) <= OFFICIAL_RATE_FRESH_DAYS) return central.rate

  const freshest = candidates.reduce<(typeof candidates)[number] | null>(
    (best, candidate) => (best === null || candidate.date > best.date ? candidate : best),
    null,
  )
  return freshest?.rate ?? null
}
