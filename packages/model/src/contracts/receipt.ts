import { z } from 'zod'
import { deviceIdSchema, isoDate } from './trip'
import {
  RECEIPT_PARTS_MAX,
  receiptCountrySchema,
  receiptFailureSchema,
  receiptMatchSchema,
  receiptStatusSchema,
} from '#model/entities/receipt'
import { LOCALES } from '#model/support/locale'
import { moneyCodec } from '#model/values/money'
import { rateCodec } from '#model/values/rates'
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

/**
 * The place a receipt is at (MOL-126): the one its purchases were recorded at, or — before that — the
 * place with the receipt's tax number in its city, if there is one; `null` and the person names it.
 */
export const receiptPlaceCodec = z.strictObject({
  id: z.uuid(),
  name: z.string(),
  city: z.string(),
  tin: z.string().nullable(),
})
export type ReceiptPlace = z.output<typeof receiptPlaceCodec>

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

/**
 * A line on the review screen (MOL-126): as read, with the item it found and how — `weak` is
 * «проверьте» — the gloss, and what it will be recorded at (`amount`, MOL-124 В-5). `rememberedPrice`
 * is the shop's memory's shelf price when the one read is a digit OCR confuses off it (В-1): a hint,
 * the figures stay as read.
 */
export const receiptReviewLineCodec = z.strictObject({
  ...receiptLineCodec.shape,
  itemId: z.uuid().nullable(),
  itemName: z.string().nullable(),
  match: receiptMatchSchema,
  translation: z.string().nullable(),
  amount: moneyCodec.nullable(),
  rememberedPrice: moneyCodec.nullable(),
})
export type ReceiptReviewLine = z.output<typeof receiptReviewLineCodec>

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
  place: receiptPlaceCodec.nullable(),
  /** The purchases it was recorded as (MOL-126); `null` before, and once they are removed for good. */
  tripId: z.uuid().nullable(),
})
export type ReceiptSummary = z.output<typeof receiptSummaryCodec>

export const receiptsResponseCodec = z.strictObject({ receipts: z.array(receiptSummaryCodec) })
export type ReceiptsResponse = z.output<typeof receiptsResponseCodec>

/** The same receipt recorded before (MOL-126 Т-11): «Этот чек уже записан». */
export const receiptDuplicateCodec = z.strictObject({
  receiptId: z.uuid(),
  tripId: z.uuid(),
  recordedAt: isoDate,
})

/**
 * One receipt with its lines, in the order printed, and what the review needs beside them: the rate
 * of the receipt's day from its currency's pair with the person's income currency, as a trip snapshots
 * one (`null` — nothing to convert, or nothing known), and the same receipt recorded before.
 */
export const receiptDetailCodec = z.strictObject({
  receipt: receiptSummaryCodec,
  lines: z.array(receiptReviewLineCodec),
  rate: rateCodec.nullable(),
  duplicateOf: receiptDuplicateCodec.nullable(),
})
export type ReceiptDetail = z.output<typeof receiptDetailCodec>
