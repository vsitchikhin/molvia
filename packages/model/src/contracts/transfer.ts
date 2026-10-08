import { z } from 'zod'
import { positiveMoneyCodec } from './exchange'
import { moneyAccountsCodec } from './money-account'
import { deviceIdSchema, isoDate } from './trip'
import { exchangeDaySchema, exchangeNoteSchema } from '#model/entities/exchange'
import type { Transfer } from '#model/entities/transfer'
import { ISSUE } from '#model/support/errors'
import { moneyCodec } from '#model/values/money'
import type { Money } from '#model/values/money'

const accountIdSchema = z.uuid().overwrite((id) => id.toLowerCase())

/** What a transfer says, as the sheet sends it — the same whether it is written or amended. */
const transferFields = {
  fromAccountId: accountIdSchema,
  toAccountId: accountIdSchema,
  amount: positiveMoneyCodec,
  /** What the bank took, from the source, in the same currency (MOL-253, Р-1); none is left out. */
  fee: positiveMoneyCodec.optional(),
  transferredOn: exchangeDaySchema,
  note: exchangeNoteSchema.optional(),
}

interface TransferFields {
  readonly fromAccountId: string
  readonly toAccountId: string
  readonly amount: Money
  readonly fee?: Money | undefined
}

/** Two accounts, not one; the fee of the money's currency — each said under its own field. */
function withTransferRules<Schema extends z.ZodType<TransferFields>>(schema: Schema) {
  return schema
    .refine(({ fromAccountId, toAccountId }) => fromAccountId !== toAccountId, {
      error: ISSUE.TRANSFER_SAME_ACCOUNT,
      path: ['toAccountId'],
    })
    .refine(({ fee, amount }) => fee === undefined || fee.currency === amount.currency, {
      error: ISSUE.TRANSFER_FEE_NOT_OF_CURRENCY,
      path: ['fee'],
    })
}

/**
 * «Перевести» (MOL-253). Named by the device once per opening of the sheet, as an exchange is: sent
 * again after a lost answer it is the same transfer, and anything else under that name a conflict.
 * Whether the accounts are the owner's, live and of the money's currency, and «not after today», are
 * the use case's.
 */
export const transferBodySchema = withTransferRules(
  z.strictObject({ id: deviceIdSchema, ...transferFields }),
)
export type TransferBody = z.infer<typeof transferBodySchema>

/**
 * «Сохранить» an amended transfer: whole, over the version it was opened with — one amended on another
 * phone meanwhile is a conflict rather than lost. Whatever is left out is cleared, the fee too.
 */
export const transferAmendBodySchema = withTransferRules(
  z.strictObject({ revision: z.int().min(1), ...transferFields }),
)
export type TransferAmendBody = z.infer<typeof transferAmendBodySchema>

/** One transfer as its sheet opens it. */
export const transferViewCodec = z.strictObject({
  id: z.uuid(),
  fromAccountId: z.uuid(),
  toAccountId: z.uuid(),
  amount: moneyCodec,
  fee: moneyCodec.nullable(),
  transferredOn: exchangeDaySchema,
  note: z.string().nullable(),
  revision: z.int().min(1),
  /** «исправлен 8 окт.» — the last amendment, or null. */
  amendedAt: isoDate.nullable(),
})
export type TransferView = z.output<typeof transferViewCodec>

export function transferViewOf(transfer: Transfer): TransferView {
  return {
    id: transfer.id,
    fromAccountId: transfer.fromAccountId,
    toAccountId: transfer.toAccountId,
    amount: transfer.amount,
    fee: transfer.fee,
    transferredOn: transfer.transferredOn,
    note: transfer.note,
    revision: transfer.revision,
    amendedAt: transfer.amendedAt,
  }
}

/**
 * What a write of a transfer answers: the transfer and «Счета» whole, as a write of an account does —
 * the two balances it moved are the server's, and every screen of accounts reads the same page.
 */
export const transferResponseCodec = z.strictObject({
  transfer: transferViewCodec,
  accounts: moneyAccountsCodec,
})
export type TransferResponse = z.output<typeof transferResponseCodec>
