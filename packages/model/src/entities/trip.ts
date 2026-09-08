import { z } from 'zod'
import { INT8_MAX, convertScaled } from '#model/support/decimal'
import { DomainError, ERROR, ISSUE } from '#model/support/errors'
import type { Expense } from './expense'
import { MINOR_EXPONENT, currencySchema } from '#model/values/money'
import type { Currency, Money } from '#model/values/money'
import { RATE_DIGITS, exchangeRateSchema } from '#model/values/rates'
import type { ExchangeRate } from '#model/values/rates'

const ONE_DAY_MS = 24 * 60 * 60 * 1000

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
  // A day of slack: the official rate is published at UTC midnight and Armenia is UTC+4,
  // so any trip before 04:00 local is «earlier» than the rate of its own day.
  .refine(
    (trip) =>
      trip.rate === null || trip.rate.asOf.getTime() <= trip.startedAt.getTime() + ONE_DAY_MS,
    { error: ISSUE.RATE_AFTER_TRIP_START },
  )
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
    .sort((a, b) => (a.currency < b.currency ? -1 : 1))
}

/** Display only. The rate lives in the trip as a snapshot; last month must not move. */
export function convertMoney(amount: Money, rate: ExchangeRate): Money {
  if (amount.currency !== rate.quote) {
    throw new DomainError(ERROR.CURRENCY_MISMATCH, `${amount.currency} vs ${rate.quote}`)
  }

  const minor = convertScaled(
    amount.minor,
    rate.scaled,
    RATE_DIGITS,
    MINOR_EXPONENT[amount.currency],
    MINOR_EXPONENT[rate.base],
  )
  return { minor, currency: rate.base }
}
