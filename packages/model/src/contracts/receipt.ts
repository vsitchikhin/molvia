import { z } from 'zod'
import { deviceIdSchema, isoDate } from './trip'
import {
  RECEIPT_PARTS_MAX,
  linkReceiptCountrySchema,
  photoReceiptCountrySchema,
  receiptCountrySchema,
  receiptFailureSchema,
  receiptMatchSchema,
  receiptStatusSchema,
  receiptViaSchema,
} from '#model/entities/receipt'
import { newItemSchema } from '#model/entities/item'
import { serbianReceiptLink } from '#model/entities/receipt-link'
import { newPlaceSchema } from '#model/entities/place'
import { ERROR } from '#model/support/errors'
import { LOCALES } from '#model/support/locale'
import { citySchema } from '#model/values/geo'
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
export const receiptPhotoBodySchema = z.strictObject({
  id: deviceIdSchema,
  parts: z.int().min(1).max(RECEIPT_PARTS_MAX),
  country: photoReceiptCountrySchema,
  language: z.enum(LOCALES),
  capturedAt: isoDate,
})

/** Past any link of the tax office's — 794–878 signs measured (MOL-223) — and short of a flood. */
export const RECEIPT_LINK_LENGTH_MAX = 2_048

/**
 * A Serbian receipt by the link of its QR code (MOL-232), with no photo: the server asks the tax
 * office for its lines. The link is checked at the door as the phone checked it before queueing it.
 */
export const receiptLinkBodySchema = z.strictObject({
  id: deviceIdSchema,
  link: z
    .string()
    .max(RECEIPT_LINK_LENGTH_MAX)
    .refine((link) => serbianReceiptLink(link).ok, { error: ERROR.RECEIPT_LINK_INVALID }),
  country: linkReceiptCountrySchema,
  language: z.enum(LOCALES),
  capturedAt: isoDate,
  /**
   * How the link came, and whether the camera missed in the sheet before it (MOL-234). Optional: a
   * body a phone of an earlier build left in its queue has neither, and a door refused is never sent
   * again (Р-3) — such a receipt is counted as not named.
   */
  via: receiptViaSchema.optional(),
  missed: z.boolean().optional(),
})

export const receiptBodySchema = z.union([receiptPhotoBodySchema, receiptLinkBodySchema])
export type ReceiptBody = z.output<typeof receiptBodySchema>
export type ReceiptPhotoBody = z.output<typeof receiptPhotoBodySchema>
export type ReceiptLinkBody = z.output<typeof receiptLinkBodySchema>

/** What the receipt prints at its head and foot, as read: the seller's tax number is its place (MOL-126). */
export const receiptHeaderCodec = z.strictObject({
  tin: z.string().nullable(),
  date: z.iso.date().nullable(),
  time: z.string().nullable(),
  receiptNo: z.string().nullable(),
  /**
   * The shop's own name, as the tax office names a Serbian receipt's premises — «RODA MEGAMARKET 463»
   * (MOL-232): what a new place is proposed as. A photo's head reads none.
   */
  shop: z.string().nullable(),
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
  /**
   * The package's code the Serbian tax office gave the line, which the item shown does not hold
   * (MOL-234): «Привязать штрихкоды?» asks about it at «Записать», never in silence (MOL-100). Sent only
   * when there is one — an installed app of an earlier build reads a line strictly.
   */
  code: z.string().optional(),
})
export type ReceiptReviewLine = z.output<typeof receiptReviewLineCodec>

/** A receipt in «Покупки»: where it is, what was read of its head, how much is there to check. */
export const receiptSummaryCodec = z.strictObject({
  id: z.uuid(),
  status: receiptStatusSchema,
  failure: receiptFailureSchema.nullable(),
  /** Parts of its photo; none for a receipt by its link (MOL-232). */
  parts: z.int().min(0).max(RECEIPT_PARTS_MAX),
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

/**
 * A line as it is to be recorded (MOL-126): every line of the receipt once, by its position. Left out —
 * «не записываем», still in «Строки» (MOL-124 Р-5). Recorded — an item of the catalogue, or a new one by
 * the name the person settled on (created by the rules of MOL-12), the quantity and what was paid for
 * the line, «цена за всё, как в чеке»: the unit price is the server's to work out.
 */
export const receiptRecordLineSchema = z.discriminatedUnion('skip', [
  z.strictObject({ position: z.int().min(0), skip: z.literal(true) }),
  z.strictObject({
    position: z.int().min(0),
    skip: z.literal(false),
    item: z.union([
      z.strictObject({ id: z.uuid() }),
      z.strictObject({ name: newItemSchema.shape.name }),
    ]),
    quantity: quantityCodec.nullable(),
    amount: moneyCodec.nullable(),
  }),
])

/**
 * «Записать» (MOL-126): the whole receipt as the phone holds it, never its edits alone — the server's
 * suggestions may have changed since it was looked at (Р-4). The trip is named by the phone, as every
 * write offline is (MOL-24): a record sent again from the queue meets its own trip. The place is one
 * of the catalogue, or a new store in a city of the receipt's country — either held to the person's
 * geography; the day is the one the person confirmed — the printed one, or their correction of it —
 * and never one still to come anywhere on Earth (`latestDay`).
 */
export const receiptRecordBodySchema = z.strictObject({
  tripId: deviceIdSchema,
  place: z.union([
    z.strictObject({ id: z.uuid() }),
    z.strictObject({ name: newPlaceSchema.shape.name, city: citySchema }),
  ]),
  purchasedOn: z.iso.date(),
  /**
   * The receipt's total as the phone holds it (owner, В-5 of the review, 03.10.2026): the printed one,
   * or the person's correction of a total OCR misread. Absent — the server takes the printed one where
   * it is not below the lines, else the lines.
   */
  total: moneyCodec.refine((value) => value.minor > 0n, { error: ERROR.INVALID_AMOUNT }).optional(),
  lines: z.array(receiptRecordLineSchema).max(500),
  /**
   * What the person put right on the review (MOL-222, the measure of 0.2): the positions of the lines
   * whose item they changed from the one the review showed, and of those whose quantity or sum they
   * typed anew. Only the phone knows what it showed — the shops' memory may have learnt meanwhile from
   * another record (adversarial А6) — and a total put right moves no line (review 2). Counted, never
   * recorded: a figure of the measure, not of money. Absent from a phone of an earlier build — the
   * server then compares with the review as it would show it now.
   */
  edited: z
    .strictObject({
      item: z.array(z.int().min(0)).max(500),
      figures: z.array(z.int().min(0)).max(500),
    })
    .optional(),
  /**
   * «Привязать и записать» (MOL-234, owner's В-2 «а»): the positions of the lines whose code the
   * person binds to the item recorded — by the rules of MOL-100. Absent — no question was asked.
   */
  barcodes: z.array(z.int().min(0)).max(500).optional(),
})
export type ReceiptRecordBody = z.output<typeof receiptRecordBodySchema>

/** What «Записать» answers: the receipt, recorded, and its purchases — where the phone goes next. */
export const receiptRecordedCodec = z.strictObject({
  receipt: receiptSummaryCodec,
  tripId: z.uuid(),
  /**
   * What became of each code asked to be bound (MOL-234), only when some were: `written`; `there` —
   * the item held it already; `held` — another item holds it, named, and nothing was written, as
   * MOL-100's 409 says; `full` — the item holds twenty. The record stands whichever it was.
   */
  codes: z
    .array(
      z.strictObject({
        position: z.int().min(0),
        code: z.string(),
        outcome: z.enum(['written', 'there', 'held', 'full']),
        holder: z.string().optional(),
      }),
    )
    .optional(),
})
export type ReceiptRecorded = z.output<typeof receiptRecordedCodec>

/**
 * The trip the receipt was recorded as — until that trip is removed for good, so one only marked removed,
 * which «Вернуть» may still bring back, too — or none; read once no «Записать» of it is still running on
 * the server (MOL-169, adversarial Г1): what «Отменить запись» asks before it lets a begun record go,
 * and where the review goes when it is recorded (round 4, Д1; review 8).
 */
export const receiptSettledCodec = z.strictObject({ tripId: z.uuid().nullable() })
export type ReceiptSettled = z.output<typeof receiptSettledCodec>

/**
 * The query of `GET /receipts` and `GET /receipts/:id` (MOL-129, adversarial А1): `shown=1` — the
 * phone asks with its page in view, so a receipt it is answered read is heard of in the app and
 * «чек разобран» will not follow. A list asked hidden — the connection back, a queue landing — says
 * nothing of the person, and leaves the bot to tell them.
 */
export const receiptReadQuerySchema = z.strictObject({ shown: z.literal('1').optional() })
