import { z } from 'zod'
import { EXCHANGE_UNDO_MINUTES, exchangeDaySchema } from '#model/entities/exchange'
import { convertMoney } from '#model/entities/trip'
import { ERROR, ISSUE } from '#model/support/errors'
import { visibleLine } from '#model/support/text'
import { priceSchema } from '#model/values/money'
import type { Currency, Money } from '#model/values/money'
import { exchangeRateSchema } from '#model/values/rates'

/** «Что это» and «Где»: free text of one line, short enough for a row of the journal (handoff 02). */
export const SPENDING_TEXT_MAX = 80
export const spendingTextSchema = visibleLine(SPENDING_TEXT_MAX)

/** The same ten minutes as an exchange and an income (MOL-73, В-4): one rule for one's own money. */
export const SPENDING_UNDO_MINUTES = EXCHANGE_UNDO_MINUTES

const positiveMoneySchema = priceSchema.refine((value) => value.minor > 0n, {
  error: ERROR.INVALID_AMOUNT,
})

/**
 * Money spent outside a trip (MOL-73): the barber, the rent, the domain — whatever the catalogue of
 * goods does not hold. A day, an amount in its own currency, one of the person's categories, and
 * two optional lines of their own words. It makes no item, feeds no price and no verdict (В-2): a
 * purchase at a shop is still entered in «Поход», and the sheet says so.
 *
 * `rate` is the snapshot a spending in another currency than the spending one is counted by — the
 * rate of **its own day**, taken when it was written and never recomputed (CLAUDE.md, «Money»):
 * `base` is the spending currency of that moment, `quote` the spending's own. Null when the two are
 * one currency, and when nothing was known that day — then the month counts it by nothing and says
 * so, rather than by a rate from another day.
 */
export const spendingSchema = z
  .object({
    id: z.uuid(),
    actorId: z.uuid(),
    spentOn: exchangeDaySchema,
    amount: positiveMoneySchema,
    categoryId: z.uuid(),
    note: spendingTextSchema.nullable(),
    place: spendingTextSchema.nullable(),
    rate: exchangeRateSchema.nullable(),
    revision: z.int().min(1),
    createdAt: z.date(),
    amendedAt: z.date().nullable(),
  })
  .refine(({ rate, amount }) => rate === null || rate.quote === amount.currency, {
    error: ISSUE.RATE_NOT_OF_SPENDING_CURRENCY,
  })
export type Spending = z.infer<typeof spendingSchema>

/**
 * The spending in `currency` — the month's spending currency: as it is when it is already in it, by
 * its own day's snapshot when that snapshot is into it, and null when neither: a spending in dollars
 * written while the person counted in drams is not guessed into roubles after a move.
 */
export function spendingIn(spending: Spending, currency: Currency): Money | null {
  if (spending.amount.currency === currency) return spending.amount
  if (spending.rate?.base !== currency) return null
  return convertMoney(spending.amount, spending.rate)
}
