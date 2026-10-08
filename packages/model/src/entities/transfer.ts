import { z } from 'zod'
import {
  EXCHANGE_UNDO_MINUTES,
  exchangeDaySchema,
  exchangeNoteSchema,
} from '#model/entities/exchange'
import { ERROR, ISSUE } from '#model/support/errors'
import { priceSchema } from '#model/values/money'
import type { Money } from '#model/values/money'

/** The same ten minutes as every removal of one's own money (MOL-73, В-4). */
export const TRANSFER_UNDO_MINUTES = EXCHANGE_UNDO_MINUTES

const positiveMoneySchema = priceSchema.refine((value) => value.minor > 0n, {
  error: ERROR.INVALID_AMOUNT,
})

/**
 * Money moved between two of one's own accounts of **one currency** (MOL-253): «Папина карта $» →
 * «Доллары $». It moves the balances of the two accounts and nothing else — not the month of
 * «Деньги», not the wallet and the person's own rate: nothing was spent, earned or exchanged. Between
 * two currencies it is an exchange, which has a rate (Р-2).
 *
 * `fee` is what the bank took for it, from the source, in the same currency: a real spending — an
 * ordinary row of `spendings` in «Прочее» tied to the transfer, so every reader of spendings counts it
 * as it counts any (Р-1). Both accounts are required: a transfer with no account is nothing at all.
 */
export const transferSchema = z
  .object({
    id: z.uuid(),
    actorId: z.uuid(),
    fromAccountId: z.uuid(),
    toAccountId: z.uuid(),
    amount: positiveMoneySchema,
    fee: positiveMoneySchema.nullable(),
    transferredOn: exchangeDaySchema,
    note: exchangeNoteSchema.nullable(),
    revision: z.int().min(1),
    createdAt: z.date(),
    amendedAt: z.date().nullable(),
  })
  .refine(({ fromAccountId, toAccountId }) => fromAccountId !== toAccountId, {
    error: ISSUE.TRANSFER_SAME_ACCOUNT,
  })
  .refine(({ fee, amount }) => fee === null || fee.currency === amount.currency, {
    error: ISSUE.TRANSFER_FEE_NOT_OF_CURRENCY,
  })
export type Transfer = z.infer<typeof transferSchema>

/** A version a transfer had before it was amended — the same trace an exchange keeps (MOL-42 В-3). */
export interface TransferRevision {
  readonly revision: number
  readonly fromAccountId: string
  readonly toAccountId: string
  readonly amount: Money
  readonly fee: Money | null
  readonly transferredOn: string
  readonly note: string | null
  readonly replacedAt: Date
}
