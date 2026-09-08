import { z } from 'zod'
import { divideRounded } from './decimal'
import { DomainError, ERROR } from './errors'
import type { Expense } from './expense'
import { addMoney, currencySchema, minorPerMajor } from './money'
import type { Money } from './money'
import { RATE_SCALE, exchangeRateSchema, rateCodec } from './rates'
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
    error: 'the rate must be quoted in the currency of the trip',
  })
  .refine((trip) => trip.finishedAt === null || trip.finishedAt >= trip.startedAt, {
    error: 'a trip cannot finish before it starts',
  })
export type Trip = z.infer<typeof tripSchema>

/**
 * The client picks the place and, when it has one, the rate to freeze. Everything else —
 * who, in what currency, from when — is the server's to know.
 */
export const newTripSchema = z.strictObject({
  placeId: z.uuid(),
  rate: rateCodec.optional(),
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

  const numerator = amount.minor * RATE_SCALE * minorPerMajor(rate.base)
  const denominator = rate.scaled * minorPerMajor(amount.currency)
  return { minor: divideRounded(numerator, denominator), currency: rate.base }
}
