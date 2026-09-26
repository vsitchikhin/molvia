import { z } from 'zod'
import { INT8_MAX, convertScaled, divideRounded } from '#model/support/decimal'
import { DomainError, ERROR, ISSUE } from '#model/support/errors'
import type { Expense } from './expense'
import { MINOR_EXPONENT, currencySchema } from '#model/values/money'
import type { Currency, Money } from '#model/values/money'
import {
  RATE_DIGITS,
  RATE_SCALE,
  exchangeRateSchema,
  isRateFresh,
  parseRate,
  rateProviderSchema,
  yerevanDate,
} from '#model/values/rates'
import type { ExchangeRate } from '#model/values/rates'

/**
 * Which rate a trip counts by when the one it snapshotted jumped (MOL-39, Р-19, Р-21): the jumped
 * one, the one before it, or the person's own. Absent until chosen; until then the trip counts by
 * the rate it took.
 */
export const rateChoiceSchema = z.enum(['jumped', 'previous', 'manual'])
export type RateChoice = z.infer<typeof rateChoiceSchema>

const samePair = (a: ExchangeRate, b: ExchangeRate) => a.base === b.base && a.quote === b.quote

const tripFields = z.object({
  id: z.uuid(),
  actorId: z.uuid(),
  placeId: z.uuid(),
  currency: currencySchema,
  rate: exchangeRateSchema.nullable(),
  /**
   * Who published the snapshotted rate (MOL-22, Р-3). The source says «not the central bank of
   * Armenia»; the screen has to say which one it was instead, because the terms of the open
   * aggregator require naming it. Not a field of `ExchangeRate`: a personal rate has no provider,
   * and the field would be optional everywhere a rate is ever mentioned.
   */
  rateProvider: rateProviderSchema.nullable().default(null),
  /** The snapshotted rate jumped when it arrived: the screen warns, whatever else there is. */
  rateJumped: z.boolean().default(false),
  /**
   * Kept beside a jumped snapshot so the person can choose; the snapshot itself is never
   * rewritten, the choice only says which rate to count by. The rate before the jump — same pair,
   * same source, at most a week older — when there was one.
   */
  previousRate: exchangeRateSchema.nullable().default(null),
  /** The person's own rate for this trip, entered instead of the jumped one — `personal`. */
  manualRate: exchangeRateSchema.nullable().default(null),
  rateChoice: rateChoiceSchema.nullable().default(null),
  startedAt: z.date(),
  finishedAt: z.date().nullable(),
  /** Device completion is a separate clock: an offline finish may precede server start. */
  finishedOnDeviceAt: z.date().nullable().optional(),
})

export const tripSchema = tripFields
  // A provider belongs to a published rate and to nothing else: none without a snapshot, none for
  // a snapshot the person entered themselves, and one for every rate a bank or an aggregator gave.
  // And the two agree: `official` is the central bank of Armenia, every other publisher is a
  // `fallback`. They are one fact written twice, and a pair that disagrees would have the screen
  // say «not the central bank» and then name it (MOL-22, В2-11).
  .refine(
    ({ rate, rateProvider }) => {
      if (rate === null || rate.source === 'personal') return rateProvider === null
      return rateProvider !== null && (rate.source === 'official') === (rateProvider === 'cba')
    },
    { error: ISSUE.RATE_PROVIDER_UNMATCHED },
  )
  .refine((trip) => trip.rate === null || trip.rate.quote === trip.currency, {
    error: ISSUE.RATE_NOT_OF_TRIP_CURRENCY,
  })
  .refine(
    ({ rate, rateJumped, previousRate, manualRate }) =>
      (!rateJumped || rate !== null) &&
      (previousRate === null ||
        (rateJumped &&
          rate !== null &&
          samePair(previousRate, rate) &&
          previousRate.source === rate.source)) &&
      (manualRate === null ||
        (rateJumped &&
          rate !== null &&
          samePair(manualRate, rate) &&
          manualRate.source === 'personal')),
    { error: ISSUE.SIDE_RATE_UNMATCHED },
  )
  .refine(
    ({ rateChoice, rateJumped, previousRate, manualRate }) =>
      rateChoice === null ||
      (rateJumped &&
        (rateChoice !== 'previous' || previousRate !== null) &&
        (rateChoice !== 'manual' || manualRate !== null)),
    { error: ISSUE.RATE_CHOICE_NOT_HELD },
  )
  .refine((trip) => trip.finishedAt === null || trip.finishedAt >= trip.startedAt, {
    error: ISSUE.TRIP_FINISHED_BEFORE_START,
  })
export type Trip = z.infer<typeof tripSchema>

export const newTripSchema = z.strictObject({
  placeId: z.uuid(),
})
export type NewTrip = z.infer<typeof newTripSchema>

/** The rate a trip counts by: the one it took, unless the person chose another after a jump. */
export function effectiveRate(trip: Trip): ExchangeRate | null {
  if (trip.rateChoice === 'previous' && trip.previousRate) return trip.previousRate
  if (trip.rateChoice === 'manual' && trip.manualRate) return trip.manualRate
  return trip.rate
}

/**
 * The person's own rate for a trip whose snapshot jumped (Р-21): the snapshot's pair, their
 * number — refused as a rate typed under «мой курс» would be — and the moment they entered it.
 */
export function manualRateFor(snapshot: ExchangeRate, rate: string, at: Date): ExchangeRate {
  return {
    base: snapshot.base,
    quote: snapshot.quote,
    scaled: parseRate(rate),
    source: 'personal',
    asOf: at,
  }
}

/**
 * Whether the official rate a trip counts by was over a week old when the trip started — the
 * screen's «курс на 1 сентября, с тех пор ЦБ РА не менялся» (MOL-39, Р-18). A personal rate is
 * the person's own and never stale here.
 */
export function isTripRateStale(trip: Trip): boolean {
  const rate = effectiveRate(trip)
  if (rate === null || rate.source === 'personal') return false
  return !isRateFresh(yerevanDate(rate.asOf), yerevanDate(trip.startedAt))
}

/**
 * One total per currency: an expense carries its own, and paying for one thing by card in
 * another is an ordinary afternoon. Nothing priced gives an empty list, not a zero.
 */
export function tripTotal(expenses: readonly Expense[]): readonly Money[] {
  const byCurrency = new Map<Currency, bigint>()
  for (const { amount } of expenses) {
    if (amount === null) continue
    const total = (byCurrency.get(amount.currency) ?? 0n) + amount.minor
    if (total > INT8_MAX) throw new DomainError(ERROR.INVALID_AMOUNT, String(total))
    byCurrency.set(amount.currency, total)
  }
  return [...byCurrency]
    .map(([currency, minor]) => ({ minor, currency }))
    .sort((a, b) => (a.currency === b.currency ? 0 : a.currency < b.currency ? -1 : 1))
}

/** The converted amount in the base's minor units, unbounded — the caller decides what does not fit. */
export function convertedMinor(amount: Money, rate: ExchangeRate): bigint {
  if (amount.currency !== rate.quote) {
    throw new DomainError(ERROR.CURRENCY_MISMATCH, `${amount.currency} vs ${rate.quote}`)
  }

  return convertScaled(
    amount.minor,
    rate.scaled,
    RATE_DIGITS,
    MINOR_EXPONENT[amount.currency],
    MINOR_EXPONENT[rate.base],
  )
}

/**
 * The other way: an amount in the rate's `base` into its `quote`. A rate is kept in the orientation
 * whose number is at least one — «390 ֏ за $», never «0,002564 $ за ֏» — because six digits of a
 * small number are four significant ones (MOL-73; the trap MOL-81 names for the screen): a
 * spending's snapshot is «spending currency per its own», and converts from its base.
 */
export function convertFromBase(amount: Money, rate: ExchangeRate): Money {
  if (amount.currency !== rate.base) {
    throw new DomainError(ERROR.CURRENCY_MISMATCH, `${amount.currency} vs ${rate.base}`)
  }
  const minor = divideRounded(
    amount.minor * rate.scaled * 10n ** BigInt(MINOR_EXPONENT[rate.quote]),
    RATE_SCALE * 10n ** BigInt(MINOR_EXPONENT[amount.currency]),
  )
  if (minor > INT8_MAX) throw new DomainError(ERROR.INVALID_AMOUNT, String(minor))
  return { minor, currency: rate.quote }
}

/** Display only. The rate lives in the trip as a snapshot; last month must not move. */
export function convertMoney(amount: Money, rate: ExchangeRate): Money {
  const minor = convertedMinor(amount, rate)
  // A small rate grows the amount: without this bound the result is legal arithmetic and an
  // illegal Money, and the trip answer built from it fails on the wire (MOL-21, adversarial А).
  if (minor > INT8_MAX) throw new DomainError(ERROR.INVALID_AMOUNT, String(minor))
  return { minor, currency: rate.base }
}
