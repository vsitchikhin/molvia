import { z } from 'zod'
import { positiveMoneyCodec, receiptCodec } from './exchange'
import { deviceIdSchema, isoDate } from './trip'
import { exchangeDaySchema, exchangeNoteSchema } from '#model/entities/exchange'
import { incomeSourceSchema } from '#model/entities/income'
import { ISSUE } from '#model/support/errors'
import { currencySchema, moneyCodec } from '#model/values/money'
import type { Money } from '#model/values/money'

/** What an income says, as the screen sends it — the same whether it is recorded or amended. */
const incomeFields = {
  amount: positiveMoneyCodec,
  receivedOn: exchangeDaySchema,
  heldBefore: moneyCodec.optional(),
  source: incomeSourceSchema,
  note: exchangeNoteSchema.optional(),
}

interface IncomeFields {
  readonly amount: Money
  readonly heldBefore?: Money | undefined
}

/** What was held before is of the currency that came in, said under its own field. */
function withIncomeRules<Schema extends z.ZodType<IncomeFields>>(schema: Schema) {
  return schema.refine(
    ({ heldBefore, amount }) => heldBefore === undefined || heldBefore.currency === amount.currency,
    { error: ISSUE.INCOME_HELD_NOT_RECEIVED, path: ['heldBefore'] },
  )
}

/**
 * «Записать доход» (MOL-66). Named by the device, as an exchange is, so a tap sent twice is one
 * income. «Not after today» is the use case's, which has the clock.
 */
export const incomeBodySchema = withIncomeRules(
  z.strictObject({ id: deviceIdSchema, ...incomeFields }),
)
export type IncomeBody = z.infer<typeof incomeBodySchema>

/**
 * «Сохранить правку»: the income whole as it should now be, and the version it was amended over —
 * one amended on another phone in between is a conflict rather than lost (MOL-42, В-3).
 */
export const incomeAmendBodySchema = withIncomeRules(
  z.strictObject({ revision: z.int().min(1), ...incomeFields }),
)
export type IncomeAmendBody = z.infer<typeof incomeAmendBodySchema>

/** One income as the screen lists it, with the versions before its amendments, newest first. */
export const incomeViewCodec = z.strictObject({
  id: z.uuid(),
  receivedOn: exchangeDaySchema,
  amount: moneyCodec,
  heldBefore: moneyCodec.nullable(),
  source: incomeSourceSchema,
  note: z.string().nullable(),
  revision: z.int().min(1),
  amendedAt: isoDate.nullable(),
  history: z.array(
    z.strictObject({
      amount: moneyCodec,
      receivedOn: exchangeDaySchema,
      heldBefore: moneyCodec.nullable(),
      source: incomeSourceSchema,
      note: z.string().nullable(),
      replacedAt: isoDate,
    }),
  ),
})
export type IncomeView = z.output<typeof incomeViewCodec>

/** A calendar month as `YYYY-MM` — the month of the day money came in on, in Yerevan. */
const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)

/**
 * «Доходы» whole (MOL-66): the months, newest first, each with what came in per currency — summed
 * by the server and never converted (В-2) — and its incomes, newest first. Beside them what the
 * sheet needs to decide whether to ask «сколько было до поступления»: the currency of conversion,
 * the day it last changed, every exchange and income (`receipts`), and the hints of what is held.
 */
export const incomesResponseCodec = z.strictObject({
  base: currencySchema,
  baseSince: exchangeDaySchema.nullable(),
  months: z.array(
    z.strictObject({
      month: monthSchema,
      sums: z.array(moneyCodec),
      incomes: z.array(incomeViewCodec),
    }),
  ),
  receipts: z.array(receiptCodec),
  heldEstimates: z.array(z.strictObject({ held: moneyCodec, whole: z.boolean() })),
})
export type IncomesResponse = z.output<typeof incomesResponseCodec>
