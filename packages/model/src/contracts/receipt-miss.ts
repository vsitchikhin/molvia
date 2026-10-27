import { z } from 'zod'
import { receiptCountrySchema } from '#model/entities/receipt'
import { RECEIPT_LINE_REASONS, RECEIPT_REASONS } from '#model/entities/receipt-verify'

/**
 * A receipt the model read not whole, told to the developer (MOL-309, owner's В-4 «б»): one where the
 * person has something to type — a line emptied, lines lost, nothing read. Which receipt, by the first
 * characters of its id, and why by kind: no name, no sum, no shop — the message lies on Telegram's
 * servers. Tesseract's readings are not told (owner, 27.10.2026).
 */
export const receiptPartialNoticeSchema = z.strictObject({
  kind: z.literal('receipt_partial'),
  /**
   * The first characters of the receipt's id, for `make receipt-miss ID=` — only where it is kept for the review:
   * of a receipt not kept it would name a person's receipt that nothing here opens (self-review №3).
   */
  receipt: z
    .string()
    .regex(/^[\da-f]{8}$/)
    .optional(),
  country: receiptCountrySchema,
  /** Item lines found, and how many of them went to the review with their figures. */
  lines: z.int().nonnegative(),
  shown: z.int().nonnegative(),
  /**
   * Why the receipt is not whole: one reason; none where it is proven whole and a line was emptied all the same — a
   * «1 × 0 = 0» that is no gift (adversarial А3).
   */
  reason: z.enum(RECEIPT_REASONS).optional(),
  /** Why lines were not shown as read: each kind with how many. */
  lineReasons: z.partialRecord(z.enum(RECEIPT_LINE_REASONS), z.int().positive()),
  /** Until when its photo and what was read are kept for the review; none — not kept. */
  keptUntil: z.iso.date().optional(),
})
export type ReceiptPartialNotice = z.infer<typeof receiptPartialNoticeSchema>

/** The receipts held back past the hour's budget (MOL-309, Р-6), told at most once an hour: how many. */
export const receiptPartialMutedNoticeSchema = z.strictObject({
  kind: z.literal('receipt_partial_muted'),
  count: z.int().positive(),
})
