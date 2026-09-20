import { z } from 'zod'
import { decimalFromScaled, divideRounded, scaledFromDecimal } from '#model/support/decimal'
import { DomainError, ERROR, ISSUE } from '#model/support/errors'
import { currencySchema, currencySign } from './money'
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

export function decimalFromRate(scaled: bigint): `${number}` {
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
 * The rate as the screen prints it: «4,82 ֏/₽» — how much of the quote currency one unit of the
 * base buys, with both signs, because a bare number says nothing about which way it goes.
 *
 * Two digits, and up to four when the number is small: the snapshot keeps six, and a rate of
 * 0,0001 printed to two digits is «0,00» — a zero rate on screen (MOL-22).
 */
export function formatRate(rate: ExchangeRate, locale = 'ru-RU'): string {
  // The decimal itself, as every other formatter of the domain does it: a rate is six digits, and
  // a float on the way to the screen is a float in the one value that multiplies every amount.
  const decimal = decimalFromRate(rate.scaled)
  const small = rate.scaled < RATE_SCALE
  const number = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: small ? RATE_DIGITS : 2,
  }).format(decimal)
  return `${number} ${currencySign(rate.quote, locale)}/${currencySign(rate.base, locale)}`
}

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

/**
 * A rate as the cache holds it: what the provider published, and whether it jumped away from that
 * provider's recent rates when it arrived (MOL-39, Р-19). A jump is kept, not refused — it may be
 * true — and the trip that takes it lets the person choose.
 */
export interface CachedRate extends AmdRate {
  readonly jump: boolean
}

/** How many of a provider's latest rates of a currency a new one is measured against. */
export const RATE_JUMP_HISTORY = 5

/**
 * Fewer earlier rates than this and no judgement is made (MOL-39, Р-23). With two, the median is
 * their mean, and one wrong day ×100 made the next right day a jump — and offered the wrong one
 * as «previous».
 */
export const RATE_JUMP_MIN_HISTORY = 3

/** How far from their median a new rate may move before it counts as a jump: a quarter. */
const RATE_JUMP_PERCENT = 25n

/**
 * Whether `scaled` jumped: more than a quarter away from the median of `history` — the latest
 * rates it is measured against, newest first, at most `RATE_JUMP_HISTORY` of them and at least
 * `RATE_JUMP_MIN_HISTORY`. The lower median rather than the last value or a mean: one wrong day
 * in the history does not make the next right day look like a jump, and a move that holds for
 * three days of five stops being one.
 */
export function isRateJump(scaled: bigint, history: readonly bigint[]): boolean {
  const recent = [...history.slice(0, RATE_JUMP_HISTORY)].sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
  )
  if (recent.length < RATE_JUMP_MIN_HISTORY) return false
  const median = recent[Math.floor((recent.length - 1) / 2)] ?? scaled
  const distance = scaled > median ? scaled - median : median - scaled
  return distance * 100n > median * RATE_JUMP_PERCENT
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

/**
 * A day a rate may be dated by: a real calendar day whose Yerevan midnight the snapshot accepts.
 * `Date.parse('2026-02-31')` is the 3rd of March, not NaN, and `0001-01-01` is what a .NET service
 * answers for a date it does not have. One rule for the cache and the snapshot, so the cache never
 * holds what no trip could take.
 */
export function isRateDay(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false
  const parsed = new Date(`${date}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return false
  return yerevanMidnight(date) >= RATE_EPOCH
}

/**
 * How long the Central Bank of Armenia may stay silent before a trip takes an open source
 * instead (MOL-39, В-7). A week covers weekends and holidays, when it publishes nothing and
 * nothing is wrong: a shorter bound would mark every Sunday trip «not the central bank».
 */
export const OFFICIAL_RATE_FRESH_DAYS = 7

/**
 * Whether a rate dated `date` still counts as current on `today`: at most a week old. The one
 * measure of «silent» for both halves of MOL-39 — when the refresh asks the open sources, and
 * when a trip takes one — so the two can never disagree about the same day.
 */
export function isRateFresh(date: string, today: string): boolean {
  const days = Math.round((Date.parse(today) - Date.parse(date)) / DAY_MS)
  // Tomorrow is as far ahead as a bank dates a rate — the Bank of Russia sets it the day before.
  // Further ahead is not fresh but wrong: `9999-12-31` is a .NET service's «no date» (Р-25).
  return days >= -1 && days <= OFFICIAL_RATE_FRESH_DAYS
}

// Tie-breaking order: the central bank first, then the other central bank, then the aggregator.
const PROVIDER_ORDER: readonly RateProvider[] = ['cba', 'cbr', 'erapi']

/**
 * The rate of `base` in `quote` built from rates against the dram: quote per one base, as the
 * snapshot stores it. Against the dram it is the published number itself; the inverse and the
 * cross are a division rounded half-up to the snapshot's six digits — the one rounding outside
 * output, because the snapshot's scale is fixed (MOL-4) and the snapshot is this value's output.
 *
 * `null` when a currency is missing, when the pair is not a pair, or when the result is anything
 * `exchangeRateSchema` refuses — outside the band, or dated before 2000. The date is the older of the two halves: a cross
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

  const dates = halves.flatMap((half) => (half ? [half.date] : [])).sort()
  const [oldest] = dates
  if (oldest === undefined) return null

  // Whatever the snapshot would refuse — a rate outside the band, a date before 2000 — is not
  // built: a trip that cannot be written is a 500 at the shelf, not a trip without a rate.
  const rate = { base, quote, scaled, source, asOf: yerevanMidnight(oldest) }
  return exchangeRateSchema.safeParse(rate).success ? rate : null
}

/** The rate a trip snapshots, and — when that rate jumped — the last one before the jump. */
export interface OfficialRate {
  readonly rate: ExchangeRate
  /** Who published it: the trip keeps it, and the screen names the source it counts by (MOL-22). */
  readonly provider: RateProvider
  /** A half of the pair jumped when it arrived (MOL-39, Р-19, Р-21): the screen warns. */
  readonly jumped: boolean
  /**
   * The same pair from the provider's latest rows that did not jump, at most a week older than
   * the jump, offered as «count by the previous rate». Null when nothing jumped or there is no
   * such rate — the person can still count by the new one or enter their own.
   */
  readonly previous: ExchangeRate | null
}

function latestOf<Row extends AmdRate>(rows: readonly Row[]): Row[] {
  return [...new Set(rows.map((row) => row.currency))].flatMap((currency) => {
    const own = rows.filter((row) => row.currency === currency)
    const [first] = own
    return first === undefined
      ? []
      : [own.reduce((best, row) => (row.date > best.date ? row : best), first)]
  })
}

/**
 * The official rate a trip started on `today` snapshots (MOL-39, В-7, Р-18).
 *
 * The Central Bank of Armenia while its latest rate is at most a week old — a Friday rate on
 * Sunday is the right answer, not a stale one. Past that, whichever provider has the freshest
 * rate for both halves of the pair, the central bank winning a tie: an open source is taken only
 * for being newer, and a trip built on it is marked `fallback`. Rows dated after `today` are
 * ignored — a bank that sets tomorrow's rate today has not made it today's.
 *
 * `rows` may hold, beside each provider's latest rate of a currency, its latest rate that did not
 * jump: when a half of the chosen pair jumped, those build `previous`.
 */
export function pickOfficialRate(
  base: Currency,
  quote: Currency,
  rows: readonly CachedRate[],
  today: string,
): OfficialRate | null {
  const needed = new Set<Currency>([base, quote])
  const candidates = PROVIDER_ORDER.flatMap((provider) => {
    const own = rows.filter((row) => row.provider === provider && row.date <= today)
    const source = provider === 'cba' ? 'official' : 'fallback'
    const latest = latestOf(own)
    const rate = rateFromAmd(base, quote, latest, source)
    if (!rate) return []

    const jumped = latest.some((row) => row.jump && needed.has(row.currency))
    // A previous rate over a week older than the jump is not an alternative but a stale number
    // (Р-24): not offered, and the person still has «count by the new one» and their own.
    const steady = jumped
      ? rateFromAmd(base, quote, latestOf(own.filter((row) => !row.jump)), source)
      : null
    const date = yerevanDate(rate.asOf)
    const previous = steady && isRateFresh(yerevanDate(steady.asOf), date) ? steady : null
    return [{ provider, pick: { rate, provider, jumped, previous }, date }]
  })

  const central = candidates.find((candidate) => candidate.provider === 'cba')
  if (central && isRateFresh(central.date, today)) return central.pick

  const freshest = candidates.reduce<(typeof candidates)[number] | null>(
    (best, candidate) => (best === null || candidate.date > best.date ? candidate : best),
    null,
  )
  return freshest?.pick ?? null
}
