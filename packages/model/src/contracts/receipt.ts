import { z } from 'zod'
import { deviceIdSchema, isoDate } from './trip'
import {
  RECEIPT_PARTS_MAX,
  receiptCountrySchema,
  receiptFailureSchema,
  receiptStatusSchema,
} from '#model/entities/receipt'
import { LOCALES } from '#model/support/locale'
import { moneyCodec } from '#model/values/money'
import { quantityCodec } from '#model/values/units'

/**
 * «Отправить чек» (MOL-125): the receipt is named by the phone, as everything written offline is, so
 * a receipt sent twice from the queue is one receipt; «Переснять» is a new one (П-3). The parts follow
 * one by one, `PUT /receipts/:id/parts/:n`, as JPEG.
 *
 * `language` is the one the lines are to be read out in — the interface's, which the server does not
 * otherwise know (П-4, MOL-55). `country` is where it was bought: it picks the reader's alphabets
 * and the currency.
 */
export const receiptBodySchema = z.strictObject({
  id: deviceIdSchema,
  parts: z.int().min(1).max(RECEIPT_PARTS_MAX),
  country: receiptCountrySchema,
  language: z.enum(LOCALES),
  capturedAt: isoDate,
})
export type ReceiptBody = z.output<typeof receiptBodySchema>

/** What the receipt prints at its head and foot, as read: the seller's tax number is its place (MOL-126). */
export const receiptHeaderCodec = z.strictObject({
  tin: z.string().nullable(),
  date: z.iso.date().nullable(),
  time: z.string().nullable(),
  receiptNo: z.string().nullable(),
})

/** A line as the receipt printed it, with its figures as the server laid them out. */
export const receiptLineCodec = z.strictObject({
  printed: z.string(),
  hs: z.string().nullable(),
  sku: z.string().nullable(),
  quantity: quantityCodec.nullable(),
  price: moneyCodec.nullable(),
  sum: moneyCodec.nullable(),
  discount: moneyCodec.nullable(),
  /** The line's own arithmetic holds: quantity × price = paid + discount. */
  settled: z.boolean(),
})
export type ReceiptLineView = z.output<typeof receiptLineCodec>

/** A receipt in «Покупки»: where it is, what was read of its head, how much is there to check. */
export const receiptSummaryCodec = z.strictObject({
  id: z.uuid(),
  status: receiptStatusSchema,
  failure: receiptFailureSchema.nullable(),
  parts: z.int().min(1).max(RECEIPT_PARTS_MAX),
  /** Parts the server holds; fewer than `parts` while it is `uploading`. */
  received: z.int().min(0).max(RECEIPT_PARTS_MAX),
  capturedAt: isoDate,
  country: receiptCountrySchema,
  language: z.enum(LOCALES),
  header: receiptHeaderCodec.nullable(),
  total: moneyCodec.nullable(),
  /** The lines add up to the printed total. */
  balanced: z.boolean(),
  lineCount: z.int().min(0),
  /** Lines whose own arithmetic does not hold — highlighted, never refused (Р-3 of MOL-113). */
  unsettled: z.int().min(0),
})
export type ReceiptSummary = z.output<typeof receiptSummaryCodec>

export const receiptsResponseCodec = z.strictObject({ receipts: z.array(receiptSummaryCodec) })
export type ReceiptsResponse = z.output<typeof receiptsResponseCodec>

/** One receipt with its lines, in the order printed. */
export const receiptDetailCodec = z.strictObject({
  receipt: receiptSummaryCodec,
  lines: z.array(receiptLineCodec),
})
export type ReceiptDetail = z.output<typeof receiptDetailCodec>
