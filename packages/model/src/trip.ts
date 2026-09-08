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
    /** Required: an expense with no place answers neither "where is it cheaper" nor any aggregate. */
    placeId: z.uuid(),
    /**
     * A copy of the owner's spending currency at the time, not a reference to it. Moving
     * changes the setting, and it must not rewrite the currency of trips already recorded.
     *
     * It is what an expense is prefilled with, not what an expense is limited to: paying
     * for one thing by card in roubles inside a dram shop is an ordinary afternoon, and
     * the model has no business calling it an error.
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
 * One total per currency, ordered by currency code so the same trip always reads the same
 * way.
 *
 * Not a single sum: an expense carries its own currency and may legitimately differ from
 * the trip's, so there is nothing to add them into without a rate — and refusing the whole
 * total because one line was paid by card in another currency would break the ordinary
 * case rather than catch a broken one.
 *
 * Expenses with no price are skipped rather than counted as zero, and a trip with nothing
 * priced gives an empty list rather than a zero: zero means "went and spent nothing",
 * which is a different fact.
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
