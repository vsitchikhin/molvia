import { z } from 'zod'
import type { ReceiptText, ReceiptTextLine } from '#model/entities/receipt-text'
import { MINOR_EXPONENT } from '#model/values/money'
import type { Currency, Money } from '#model/values/money'
import type { Quantity } from '#model/values/units'

// MOL-125 — a receipt photographed on the phone and read on our server. The phone sends it in
// parts, the server reads it in the background and lays it out into lines; recording the lines
// as purchases is MOL-126.

/** A long receipt is shot in parts, top to bottom, with an overlap (MOL-124 В-1). */
export const RECEIPT_PARTS_MAX = 4

/**
 * A part as the phone sends it: a JPEG of the receipt cropped to its edges at full resolution —
 * up to 3 200 px on the long side (MOL-114). The ceilings leave room above that, and refuse what is
 * not a photo of a receipt.
 */
export const RECEIPT_PART_BYTES_MAX = 8 * 1024 * 1024
export const RECEIPT_SIDE_MAX = 4_000
export const RECEIPT_SIDE_MIN = 200

/**
 * How long anything of a receipt stays (В-3, MOL-125; owner, 02.10.2026): a receipt not recorded is
 * removed whole this many days after it was shot, and the cut-out item lines kept for retraining the
 * reader (MOL-169) leave this many days after the receipt was recorded.
 */
export const RECEIPT_KEEP_DAYS = 28

/**
 * Where a receipt is:
 * - `uploading` — created, not every part has arrived;
 * - `queued` — every part is in, waiting for the reader;
 * - `reading` — being read;
 * - `parsed` — laid out into lines, waiting to be looked at and recorded;
 * - `failed` — nothing worth checking came out (`ReceiptFailure` says why);
 * - `recorded` — written as purchases (MOL-126).
 *
 * «Ждёт связи» and «не принят» are the phone's queue, not the server's: a refused part is answered
 * at once.
 */
export const receiptStatusSchema = z.enum([
  'uploading',
  'queued',
  'reading',
  'parsed',
  'failed',
  'recorded',
])
export type ReceiptStatus = z.infer<typeof receiptStatusSchema>

/**
 * Why a receipt failed: `reshoot` — too little was read to be worth correcting, a crumpled, shaded or
 * distant shot (В-4), so «разгладьте и переснимите»; `unreadable` — the photo could not be read at
 * all (the reader failed on it, or ran out of time, or its answer was not a reading).
 */
export const receiptFailureSchema = z.enum(['reshoot', 'unreadable'])
export type ReceiptFailure = z.infer<typeof receiptFailureSchema>

/**
 * The countries a receipt is read in, with Tesseract's languages for each, as MOL-114 measured them:
 * one country's set, never every script at once, which is slower and confuses the alphabets.
 * Georgia (`kat+eng`) and Serbia (`srp+srp_latn+eng`) join with their currencies (MOL-89); the
 * reader already carries their languages.
 */
export const receiptCountrySchema = z.enum(['AM'])
export type ReceiptCountry = z.infer<typeof receiptCountrySchema>

export const RECEIPT_LANGUAGES: Readonly<Record<ReceiptCountry, string>> = { AM: 'hye+rus+eng' }
export const RECEIPT_CURRENCY: Readonly<Record<ReceiptCountry, Currency>> = { AM: 'AMD' }

/** Tesseract's page modes the reading is tried in; the one whose lines add up is kept. */
export const RECEIPT_PAGE_MODES = [4, 6] as const

/**
 * Below this share of the printed total the lines read are not worth correcting (В-4): a crumpled
 * receipt loses its rows. Above it one or two lost lines are typed in by hand on the review screen.
 */
export const RESHOOT_TOTAL_SHARE = 0.7

/**
 * «Разгладьте и переснимите» (В-4, owner, 03.10.2026): no item lines at all; or the total was read and
 * the lines make up less than `RESHOOT_TOTAL_SHARE` of it; or the total was not read and fewer than
 * half of the lines add up by their own arithmetic. A total that was not read decides nothing alone —
 * OCR missed it on 9 of the bench's 16 readings, most of them good ones.
 */
export function needsReshoot(text: ReceiptText): boolean {
  if (text.lines.length === 0) return true
  if (text.totalHundredths !== null && text.totalHundredths > 0) {
    const read = text.lines.reduce((sum, line) => sum + (line.sumHundredths ?? 0), 0)
    return read < RESHOOT_TOTAL_SHARE * text.totalHundredths
  }
  const settled = text.lines.filter((line) => line.settled).length
  return settled * 2 < text.lines.length
}

/** A line of a parsed receipt, in the domain's own values. */
export interface ReceiptLine {
  readonly printed: string
  readonly hs: string | null
  readonly sku: string | null
  readonly quantity: Quantity | null
  readonly price: Money | null
  readonly sum: Money | null
  readonly discount: Money | null
  readonly settled: boolean
}

/**
 * A till's hundredths as the currency's minor units: drams happen to have hundredths too, but the
 * exponent is the currency's, never a constant. A figure that is not an amount — negative, or past
 * what a column holds — is no amount at all.
 */
export function moneyOfHundredths(hundredths: number | null, currency: Currency): Money | null {
  if (hundredths === null || !Number.isSafeInteger(hundredths) || hundredths < 0) return null
  const exponent = MINOR_EXPONENT[currency]
  const minor =
    exponent >= 2
      ? BigInt(hundredths) * 10n ** BigInt(exponent - 2)
      : BigInt(Math.round(hundredths / 10 ** (2 - exponent)))
  return { minor, currency }
}

function quantityOf(line: ReceiptTextLine): Quantity | null {
  const milli = line.quantityMilli
  if (milli === null || !Number.isSafeInteger(milli) || milli <= 0) return null
  // a count of pieces is whole; a fraction read for one is no count
  if (line.unit === 'piece' && milli % 1000 !== 0) return null
  return { milli: BigInt(milli), unit: line.unit }
}

export function receiptLineOf(line: ReceiptTextLine, currency: Currency): ReceiptLine {
  return {
    printed: line.printed,
    hs: line.hs,
    sku: line.sku,
    quantity: quantityOf(line),
    price: moneyOfHundredths(line.priceHundredths, currency),
    sum: moneyOfHundredths(line.sumHundredths, currency),
    discount: moneyOfHundredths(line.discountHundredths, currency),
    settled: line.settled,
  }
}

/** The date a receipt prints, if it is a real one: `YYYY-MM-DD`. */
export function receiptDateOf(text: ReceiptText): string | null {
  if (text.date === null) return null
  const day = new Date(`${text.date}T00:00:00Z`)
  return Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== text.date
    ? null
    : text.date
}
