import { z } from 'zod'
import { convertScaled } from './decimal'
import { DomainError, ERROR, ISSUE } from './errors'
import type { Expense } from './expense'
import { MINOR_EXPONENT, currencySchema } from './money'
import type { Currency, Money } from './money'
import { RATE_DIGITS, exchangeRateSchema } from './rates'
import type { ExchangeRate } from './rates'

export const tripSchema = z
  .object({
    id: z.uuid(),
    actorId: z.uuid(),
    placeId: z.uuid(),
    currency: currencySchema,
    rate: exchangeRateSchema.nullable(),
    startedAt: z.date(),
    finishedAt: z.date().nullable(),
  })
  .refine((trip) => trip.rate === null || trip.rate.quote === trip.currency, {
    error: ISSUE.RATE_NOT_OF_TRIP_CURRENCY,
  })
  .refine((trip) => trip.rate === null || trip.rate.asOf <= trip.startedAt, {
    error: ISSUE.RATE_AFTER_TRIP_START,
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
    byCurrency.set(amount.currency, (byCurrency.get(amount.currency) ?? 0n) + amount.minor)
  }
  return [...byCurrency]
    .map(([currency, minor]) => ({ minor, currency }))
    .sort((a, b) => a.currency.localeCompare(b.currency))
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
