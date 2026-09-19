import { z } from 'zod'
import { INT8_MAX, convertScaled } from '#model/support/decimal'
import { DomainError, ERROR, ISSUE } from '#model/support/errors'
import type { Expense } from './expense'
import { MINOR_EXPONENT, currencySchema } from '#model/values/money'
import type { Currency, Money } from '#model/values/money'
import { RATE_DIGITS, exchangeRateSchema, isRateFresh, yerevanDate } from '#model/values/rates'
import type { ExchangeRate } from '#model/values/rates'

/**
 * Which of two rates a trip counts by when the one it snapshotted jumped (MOL-39, Р-19): the
 * jumped one, or the one before it. Absent until the person chooses; until then the trip counts
 * by the rate it took.
 */
export const rateChoiceSchema = z.enum(['jumped', 'previous'])
export type RateChoice = z.infer<typeof rateChoiceSchema>

const tripFields = z.object({
  id: z.uuid(),
  actorId: z.uuid(),
  placeId: z.uuid(),
  currency: currencySchema,
  rate: exchangeRateSchema.nullable(),
  /**
   * The last rate before the snapshotted one jumped — the same pair from the same source — kept
   * beside it so the person can choose. Null when nothing jumped. The snapshot itself is never
   * rewritten: the choice only says which of the two to count by.
   */
  previousRate: exchangeRateSchema.nullable().default(null),
  rateChoice: rateChoiceSchema.nullable().default(null),
  startedAt: z.date(),
  finishedAt: z.date().nullable(),
})

export const tripSchema = tripFields
  .refine((trip) => trip.rate === null || trip.rate.quote === trip.currency, {
    error: ISSUE.RATE_NOT_OF_TRIP_CURRENCY,
  })
  .refine(
    ({ rate, previousRate }) =>
      previousRate === null ||
      (rate !== null &&
        previousRate.base === rate.base &&
        previousRate.quote === rate.quote &&
        previousRate.source === rate.source),
    { error: ISSUE.PREVIOUS_RATE_UNMATCHED },
  )
  .refine((trip) => trip.rateChoice === null || trip.previousRate !== null, {
    error: ISSUE.RATE_CHOICE_WITHOUT_PREVIOUS,
  })
  .refine((trip) => trip.finishedAt === null || trip.finishedAt >= trip.startedAt, {
    error: ISSUE.TRIP_FINISHED_BEFORE_START,
  })
export type Trip = z.infer<typeof tripSchema>

export const newTripSchema = z.strictObject({
  placeId: z.uuid(),
})
export type NewTrip = z.infer<typeof newTripSchema>

/** The rate a trip counts by: the one it took, unless the person chose the one before a jump. */
export function effectiveRate(trip: Trip): ExchangeRate | null {
  return trip.rateChoice === 'previous' && trip.previousRate ? trip.previousRate : trip.rate
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

/** Display only. The rate lives in the trip as a snapshot; last month must not move. */
export function convertMoney(amount: Money, rate: ExchangeRate): Money {
  const minor = convertedMinor(amount, rate)
  // A small rate grows the amount: without this bound the result is legal arithmetic and an
  // illegal Money, and the trip answer built from it fails on the wire (MOL-21, adversarial А).
  if (minor > INT8_MAX) throw new DomainError(ERROR.INVALID_AMOUNT, String(minor))
  return { minor, currency: rate.base }
}
