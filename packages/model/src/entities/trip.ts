import { z } from 'zod'
import { INT8_MAX, convertScaled } from '#model/support/decimal'
import { DomainError, ERROR, ISSUE } from '#model/support/errors'
import type { Expense } from './expense'
import { MINOR_EXPONENT, currencySchema } from '#model/values/money'
import type { Currency, Money } from '#model/values/money'
import { RATE_DIGITS, exchangeRateSchema } from '#model/values/rates'
import type { ExchangeRate } from '#model/values/rates'

const tripFields = z.object({
  id: z.uuid(),
  actorId: z.uuid(),
  placeId: z.uuid(),
  currency: currencySchema,
  rate: exchangeRateSchema.nullable(),
  startedAt: z.date(),
  finishedAt: z.date().nullable(),
})

export const tripSchema = tripFields
  .refine((trip) => trip.rate === null || trip.rate.quote === trip.currency, {
    error: ISSUE.RATE_NOT_OF_TRIP_CURRENCY,
  })
  .refine((trip) => trip.finishedAt === null || trip.finishedAt >= trip.startedAt, {
    error: ISSUE.TRIP_FINISHED_BEFORE_START,
  })
export type Trip = z.infer<typeof tripSchema>

export const newTripSchema = z.strictObject({
  placeId: z.uuid(),
})
export type NewTrip = z.infer<typeof newTripSchema>

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
