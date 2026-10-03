import { z } from 'zod'
import { EXCHANGE_UNDO_MINUTES } from '#model/entities/exchange'
import type { ReceiptText, ReceiptTextLine, TextRow } from '#model/entities/receipt-text'
import type { SettingsCity } from '#model/contracts/settings'
import { toSearchKey } from '#model/support/search-key'
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
 * up to 3 200 px on the long side (MOL-114). The ceilings leave room above that and refuse what is
 * not a photo of a receipt; a phone's whole frame passes too — 4 032 px of a 12-megapixel camera,
 * 5 712 of a 24-megapixel one (review А8) — since a part refused is never retried.
 */
export const RECEIPT_PART_BYTES_MAX = 8 * 1024 * 1024
export const RECEIPT_SIDE_MAX = 6_000
export const RECEIPT_SIDE_MIN = 200

/**
 * How long anything of a receipt stays (В-3, MOL-125; owner, 02.10.2026): a receipt not recorded is
 * removed whole this many days after it reached the server — by its clock, not the phone's — and
 * the cut-out item lines kept for retraining the reader (MOL-169) leave this many days after the
 * receipt was recorded.
 */
export const RECEIPT_KEEP_DAYS = 28

/** «Удалить чек · Вернуть» (П-8): the ten minutes every removal of one's own money has (MOL-73). */
export const RECEIPT_UNDO_MINUTES = EXCHANGE_UNDO_MINUTES

/**
 * How many times a reading is begun before the receipt fails: one cut short by a restart of the API
 * is begun again, and a receipt that takes the reader down every time does not take it forever.
 */
export const RECEIPT_READ_ATTEMPTS = 2

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

/**
 * The language a country's tills print names in, and the language of the catalogue's names a line is
 * matched against (MOL-126): an item is a node, reached by its barcodes, the shops' articles, its
 * customs headings and its names in the countries' languages.
 */
export const itemNameLanguageSchema = z.enum(['hy'])
export type ItemNameLanguage = z.infer<typeof itemNameLanguageSchema>
export const RECEIPT_NAME_LANGUAGE: Readonly<Record<ReceiptCountry, ItemNameLanguage>> = {
  AM: 'hy',
}

/**
 * How a line found its item (MOL-126, the handoff's four): `memory` — the shop's memory; `search` — the
 * catalogue's names or its search, near; `weak` — found far, or by the customs heading alone, «проверьте»
 * (MOL-124 В-4); `new` — nothing: a new item named by the gloss. The memory is laid over on every reading
 * of the receipt; the other three are kept from the parse.
 */
export const receiptMatchSchema = z.enum(['memory', 'search', 'weak', 'new'])
export type ReceiptMatch = z.infer<typeof receiptMatchSchema>
export const receiptParsedMatchSchema = receiptMatchSchema.exclude(['memory'])
export type ReceiptParsedMatch = z.infer<typeof receiptParsedMatchSchema>

/**
 * The key of the shop's memory (MOL-126): `sku` — the till's own article, read reliably and the same
 * every time; `text` — the line as printed, for a till that prints no article (Dog City), by its search
 * key so that OCR's ե/է and ու do not split it.
 */
export const storeMemoryKindSchema = z.enum(['sku', 'text'])
export type StoreMemoryKind = z.infer<typeof storeMemoryKindSchema>

/** The longest key the shop's memory keeps, in octets: a line's search key past it is not remembered. */
export const STORE_MEMORY_KEY_MAX_OCTETS = 600

/** A key of the shop's memory: the till's article, or the line as printed by its search key. */
export interface StoreMemoryWord {
  readonly kind: StoreMemoryKind
  readonly key: string
}

/**
 * What the shop's memory knows a line by, the article first (MOL-126): it reads the same every time,
 * where OCR reads a name differently each time (MOL-114: 4 of 4 against 0 of 43). A line with no
 * article — Dog City prints none — is known by its text alone.
 */
export function storeMemoryWords(line: {
  readonly printed: string
  readonly sku: string | null
}): StoreMemoryWord[] {
  const words: StoreMemoryWord[] = []
  if (line.sku !== null && line.sku !== '') words.push({ kind: 'sku', key: line.sku })
  const text = toSearchKey(line.printed)
  // a key with no letter is a rule or a dash: every such line would be one item
  if (/\p{L}/u.test(text) && new TextEncoder().encode(text).length <= STORE_MEMORY_KEY_MAX_OCTETS) {
    words.push({ kind: 'text', key: text })
  }
  return words
}

/**
 * The cities of the settings as a receipt's address prints them, at the start of a row of the head
 * («ԳՅՈՒՄՐԻ Գորկու 62»): a place is the shop in its city (Р-6). «ԵՐԵՎԱՆ-ՍԻԹԻ» is the chain's name, not
 * the city, and an item named after the capital is a line, not the head.
 */
export const RECEIPT_CITIES: Readonly<Record<SettingsCity, RegExp>> = {
  Гюмри: /^[^\p{L}]*(?:գյումրի|gyumri)(?![\p{L}-])/iu,
  Ереван: /^[^\p{L}]*(?:երևան|երե[վւ]ան|yerevan)(?![\p{L}-])(?!\s*սիթի)/iu,
}

/** Rows of the head a city is looked for in: the address stands above the first item line. */
const HEAD_ROWS = 15

/** The city a receipt's address prints, if it is one of the settings'; read in the first part only. */
export function receiptCityOf(rows: readonly TextRow[]): SettingsCity | null {
  const head = rows.filter((row) => row.part === 0).slice(0, HEAD_ROWS)
  for (const [city, pattern] of Object.entries(RECEIPT_CITIES) as [SettingsCity, RegExp][]) {
    if (head.some((row) => pattern.test(row.text))) return city
  }
  return null
}

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
  const total = text.totalHundredths
  if (total !== null && total > 0) {
    // a sum the domain throws away — past a safe integer, or past the total itself — covers nothing
    // (review Р11): junk OCR would otherwise vouch for a receipt barely read
    const read = text.lines.reduce((sum, line) => {
      const own = line.sumHundredths
      return sum + (own !== null && Number.isSafeInteger(own) && own <= total ? own : 0)
    }, 0)
    return read < RESHOOT_TOTAL_SHARE * total
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

/**
 * The date a receipt prints, if it is one a receipt can have: `YYYY-MM-DD`, a day of the calendar,
 * not before 2000 and not after `latest` — the server's today and a day for the zones (review Р10,
 * Р13). OCR makes up «01.01.0000», which Postgres refuses, and «2099».
 */
export function receiptDateOf(text: ReceiptText, latest: string): string | null {
  if (text.date === null) return null
  const day = new Date(`${text.date}T00:00:00Z`)
  if (Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== text.date) return null
  return text.date >= '2000-01-01' && text.date <= latest ? text.date : null
}

/** Where a country's tills keep their clocks: Armenia is at +4 the year round. */
export const RECEIPT_UTC_OFFSET: Readonly<Record<ReceiptCountry, string>> = { AM: '+04:00' }

/**
 * The moment a receipt prints, its day and time read on the till's clock (MOL-126): what a trip
 * recorded from it is placed by among the person's purchases. `null` without a time.
 */
export function receiptMomentOf(
  day: string,
  time: string | null,
  country: ReceiptCountry,
): Date | null {
  if (time === null || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null
  const moment = new Date(`${day}T${time}:00${RECEIPT_UTC_OFFSET[country]}`)
  return Number.isNaN(moment.getTime()) ? null : moment
}

/** The time a receipt prints, if it is one a clock shows: `HH:MM` (review Р12). */
export function receiptTimeOf(text: ReceiptText): string | null {
  const time = /^([01]\d|2[0-3]):[0-5]\d$/.exec(text.time ?? '')
  return time === null ? null : time[0]
}
