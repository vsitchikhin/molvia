import { z } from 'zod'
import { convertScaled } from './decimal'
import { DomainError, ERROR, ISSUE } from './errors'
import type { Expense } from './expense'
import { MINOR_EXPONENT, addMoney, currencySchema } from './money'
import type { Money } from './money'
import { RATE_DIGITS, exchangeRateSchema } from './rates'
import type { ExchangeRate } from './rates'

export const tripSchema = z
  .object({
    id: z.uuid(),
    actorId: z.uuid(),
    /** Required: an expense with no place answers neither "where is it cheaper" nor any aggregate. */
    placeId: z.uuid(),
    /**
     * A copy of the owner's spending currency at the time, not a reference to it. Moving
     * changes the setting, and it must not rewrite the currency of trips already recorded.
     */
    currency: currencySchema,
    /** null when there is nothing to convert into: spending and income are the same currency. */
    rate: exchangeRateSchema.nullable(),
    startedAt: z.date(),
    /** null while the trip is still going. A person closes it with a button — nothing else does. */
    finishedAt: z.date().nullable(),
  })
  .refine((trip) => trip.rate === null || trip.rate.quote === trip.currency, {
    // The snapshot converts out of what is being spent here. A rate quoted in anything
    // else would convert the trip total into a number about some other trip.
    error: ISSUE.RATE_NOT_OF_TRIP_CURRENCY,
  })
  // A snapshot taken when the trip started cannot be dated after it.
  .refine((trip) => trip.rate === null || trip.rate.asOf <= trip.startedAt, {
    error: ISSUE.RATE_AFTER_TRIP_START,
  })
  .refine((trip) => trip.finishedAt === null || trip.finishedAt >= trip.startedAt, {
    error: ISSUE.TRIP_FINISHED_BEFORE_START,
  })
export type Trip = z.infer<typeof tripSchema>

/**
 * The client picks the place. Everything else — who, in what currency, at what rate, from
 * when — is the server's to know.
 *
 * The rate used to arrive from the client, and the rule "the rate must be quoted in the
 * currency of the trip" sat on the read schema only, so a rate between any two currencies
 * passed on write. Removing the field removes the hole rather than guarding it: the
 * server has the owner's setting and the cache, and snapshots the current rate itself.
 */
export const newTripSchema = z.strictObject({
  placeId: z.uuid(),
})
export type NewTrip = z.infer<typeof newTripSchema>

/**
 * Expenses with no price are skipped rather than counted as zero, and an empty trip is
 * null rather than zero: zero means "went and spent nothing", which is a different fact.
 */
export function tripTotal(expenses: readonly Expense[]): Money | null {
  const priced = expenses.flatMap((expense) => (expense.amount === null ? [] : [expense.amount]))
  if (priced.length === 0) return null
  return priced.reduce((total, amount) => addMoney(total, amount))
}

/**
 * For display only. The result is stored nowhere: the rate lives in the trip as a
 * snapshot, and last month's total must not move with today's rate.
 *
 * Rounds to nearest rather than truncating. There is no exact answer to pick instead —
 * dividing by a rate rarely lands on a whole minor unit — and truncation would be a
 * one-sided bias. The two currencies may keep a different number of digits, so both
 * exponents take part.
 */
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
