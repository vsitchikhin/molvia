import { z } from 'zod'

/**
 * What reading receipts by a model has cost this month, told to the owner (MOL-272, В-2 «а»): at half the
 * cap, at nine tenths and at the stop — the first call that would not fit under it, read by Tesseract; a
 * smaller one after it may still fit — each once a month. Money and a month, nobody's.
 */
export const modelSpendNoticeSchema = z.strictObject({
  kind: z.literal('model_spend'),
  /** The month in UTC, its first day: `2026-10-01`. */
  month: z.iso.date(),
  step: z.union([z.literal(50), z.literal(90), z.literal(100)]),
  spentMicroUsd: z.int().nonnegative(),
  capMicroUsd: z.int().positive(),
})
export type ModelSpendNotice = z.infer<typeof modelSpendNoticeSchema>

/**
 * One person's receipts reached their share of the month (MOL-367, owner's В-3 «а»): the first call of theirs that
 * would not fit under it, read by Tesseract — once a person a month. Like the stop, it stops that call: a smaller one
 * after it may still fit. The month and the share, never who: nobody's, as every notice of money.
 */
export const modelShareNoticeSchema = z.strictObject({
  kind: z.literal('model_share'),
  /** The month in UTC, its first day: `2026-10-01`. */
  month: z.iso.date(),
  shareMicroUsd: z.int().positive(),
})
export type ModelShareNotice = z.infer<typeof modelShareNoticeSchema>
