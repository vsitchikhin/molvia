import { z } from 'zod'
import {
  EXCHANGE_UNDO_MINUTES,
  exchangeDaySchema,
  exchangeNoteSchema,
} from '#model/entities/exchange'
import { ERROR, ISSUE } from '#model/support/errors'
import { priceSchema } from '#model/values/money'
import type { Money } from '#model/values/money'

/**
 * Where money came from — the owner's own list from the sheet the app replaces (MOL-66, В-3):
 * a closed list, so a month's sum can always tell a salary from the money brought on arrival. A
 * new source is a migration, as a new currency is.
 */
export const incomeSourceSchema = z.enum([
  'salary',
  'bonus',
  'freelance',
  'debt_return',
  'sale',
  'gift',
  'interest',
  'brought',
  'other',
])
export type IncomeSource = z.infer<typeof incomeSourceSchema>

/** The same ten minutes as an exchange (В-7): one rule for removing one's own money. */
export const INCOME_UNDO_MINUTES = EXCHANGE_UNDO_MINUTES

const positiveMoneySchema = priceSchema.refine((value) => value.minor > 0n, {
  error: ERROR.INVALID_AMOUNT,
})

/**
 * Money that came in with nothing given for it (MOL-66): the actual day, amount and currency, and
 * where it came from. Nothing expected is ever written — only what arrived.
 *
 * `heldBefore` is how much of that currency the person had just before it, as for an exchange: the
 * weight the old money keeps when the new is valued at the official rate of its day (В-1). Optional;
 * unknown, the income's own value stands alone.
 */
export const incomeSchema = z
  .object({
    id: z.uuid(),
    actorId: z.uuid(),
    amount: positiveMoneySchema,
    receivedOn: exchangeDaySchema,
    heldBefore: priceSchema.nullable(),
    source: incomeSourceSchema,
    note: exchangeNoteSchema.nullable(),
    revision: z.int().min(1),
    createdAt: z.date(),
    amendedAt: z.date().nullable(),
  })
  .refine(
    ({ heldBefore, amount }) => heldBefore === null || heldBefore.currency === amount.currency,
    { error: ISSUE.INCOME_HELD_NOT_RECEIVED },
  )
export type Income = z.infer<typeof incomeSchema>

/** A version an income had before it was amended, and when it stopped being the income. */
export interface IncomeRevision {
  readonly revision: number
  readonly amount: Money
  readonly receivedOn: string
  readonly heldBefore: Money | null
  readonly source: IncomeSource
  readonly note: string | null
  readonly replacedAt: Date
}
