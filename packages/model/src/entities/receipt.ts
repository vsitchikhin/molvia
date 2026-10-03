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
 * The cities of the settings as a receipt prints them, as a word (Р-6): a place is the shop in its city.
 * «ԵՐԵՎԱՆ-ՍԻԹԻ», «YEREVAN CITY» is the chain's name, not the city.
 */
const CITY_WORDS: Readonly<Record<SettingsCity, string>> = {
  Гюмри: '(?:գյումրի|gyumri)(?![\\p{L}-])',
  Ереван: '(?:երևան|երե[վւ]ան|yerevan)(?![\\p{L}-])(?!\\s*[-–]?\\s*(?:սիթի|city|сити))',
}

/**
 * The start of a row before its city: marks and digits, one stray letter OCR reads at the paper's edge
 * («է ԳՅՈՒՄՐԻ Գորկու 62»), and «ք.».
 */
const OPENING = '^[^\\p{L}]*(?:\\p{L}[^\\p{L}\\s]*\\s+[^\\p{L}]*)??(?:ք\\.?\\s*)?'

/** A city opening a row of the head — the shop's address («ԳՅՈՒՄՐԻ Գորկու 62», «ք. Երևան, …»). */
export const RECEIPT_CITIES: Readonly<Record<SettingsCity, RegExp>> = {
  Гюмри: new RegExp(`${OPENING}${CITY_WORDS.Гюмри}`, 'iu'),
  Ереван: new RegExp(`${OPENING}${CITY_WORDS.Ереван}`, 'iu'),
}

/** A city after «ք.» — «город» — anywhere in a row of the head («ՀՀ, ք. Երևան, …»). */
const CITY_AFTER_MARK: Readonly<Record<SettingsCity, RegExp>> = {
  Гюмри: new RegExp(`(?<!\\p{L})ք\\.\\s*${CITY_WORDS.Гюмри}`, 'iu'),
  Ереван: new RegExp(`(?<!\\p{L})ք\\.\\s*${CITY_WORDS.Ереван}`, 'iu'),
}

/** A city named anywhere in a row of the head, a word of its own: an address, or an item's name. */
const CITY_ANYWHERE: Readonly<Record<SettingsCity, RegExp>> = {
  Гюмри: new RegExp(`(?<!\\p{L})${CITY_WORDS.Гюмри}`, 'iu'),
  Ереван: new RegExp(`(?<!\\p{L})${CITY_WORDS.Ереван}`, 'iu'),
}

/**
 * The head is the rows above the first item (round 6, Р6-В2): a fixed window of fifteen left the address
 * of «Ереван Сити» past it on six readings of the bench — its head runs to the 17th row. Where no item
 * row is read at all, this many rows stand for the head: past them the items begin (round 7, Р7-В1).
 */
const HEAD_ROWS = 20

/**
 * A table's item row, where the head ends (round 4, Р4-В1): its customs heading opening the row, then the
 * name — «(2203) ԳՅՈՒՄՐԻ ԳԱՐԵՋՈՒՐ», or «| |824) ՏՈՏՈՒՀՈՂ» as OCR reads it with the bracket and a digit
 * lost (round 5, Р5-В1), a stray letter at the edge before it forgiven (round 6, Р6-В1). Dog City's items
 * begin at its ninth row, and an item named after a city is a line, not the address. Not a phone's area
 * code «Հեռ. (0312) 5-55-55», which neither opens the row nor has a name after it (round 5, Р5-В2).
 */
const TABLE_ITEM_ROW = /^[^\p{L}\d]*(?:\p{L}[^\p{L}\s]*\s+[^\p{L}\d]*)?\(?\d{2,4}\)\s*\p{L}/u

/**
 * A card's article row, «0401/1163909», or cut by OCR, «1906/9000» (round 7, Р7-В1): the item's name stands
 * above it — one row, or two when it is split — and its number «1 …», «1…» is read without a dot as often
 * as with one. So the head of a card ends two rows above its first article, or at the item's number with
 * its dot «3.Գյումրի …» in those two rows — only there: a banner's row with «9.» OCR read at its edge
 * stands above the address (round 8, Р8-В1), and a house number «62, Գորկու …» is no item (review 16).
 */
const CARD_ARTICLE_ROW = /\d{4}\s*\/\s*\d{3,}/u
const CARD_NUMBER_ROW = /^\s*\d{1,3}\.\s*\p{L}/u
const CARD_NAME_ROWS = 2

/** Where a receipt's head ends: before its first item, or `HEAD_ROWS` where no item is read. */
function headEnd(rows: readonly TextRow[]): number {
  const ends: number[] = []
  const table = rows.findIndex((row) => TABLE_ITEM_ROW.test(row.text))
  if (table >= 0) ends.push(table)
  const article = rows.findIndex((row) => CARD_ARTICLE_ROW.test(row.text))
  if (article >= 0) {
    // the name above the article: its number with a dot marks where it begins, else two rows up
    const above = Math.max(0, article - CARD_NAME_ROWS)
    const numbered = rows.slice(above, article).findIndex((row) => CARD_NUMBER_ROW.test(row.text))
    ends.push(numbered < 0 ? above : above + numbered)
  }
  return ends.length === 0 ? Math.min(rows.length, HEAD_ROWS) : Math.min(...ends)
}

/**
 * The city a receipt's address prints, if it is one of the settings'; read in the first part only. A
 * city opening a row is the shop's address and decides. Else a city after «ք.» anywhere in a row —
 * «ՀՀ, ք. Երևան, …», «Շիրակի մարզ, ք. Գյումրի, …» (round 2, Р2-В4) — decides only when no other city
 * is named in the head at all: a chain prints its own legal address beside the shop's, «ՀՀ, ք.
 * Երևան» on a receipt of its Gyumri shop whose address is «Գորկու 62, Գյումրի» (round 3, Р3-В2).
 * Two cities are no answer — the place is then looked for in the person's own city.
 */
export function receiptCityOf(
  rows: readonly TextRow[],
  productWords: ReadonlySet<string> = NO_WORDS,
): SettingsCity | null {
  const first = rows.filter((row) => row.part === 0)
  const head = first.slice(0, headEnd(first))
  // the city is read off an address only — never off an item's row, wherever the head's end fell
  // (round 9, Р9-В1): the boundary is a guess OCR moves, what stands beside the city is the row's own
  const addresses = head.filter((row) => isAddressRow(row.text, productWords))
  const cities = Object.keys(RECEIPT_CITIES) as SettingsCity[]
  const opening = cities.filter((city) =>
    addresses.some((row) => RECEIPT_CITIES[city].test(row.text)),
  )
  if (opening.length === 1) return opening[0] ?? null
  if (opening.length > 1) return null
  const marked = cities.filter((city) =>
    addresses.some((row) => CITY_AFTER_MARK[city].test(row.text)),
  )
  const named = cities.filter((city) => head.some((row) => CITY_ANYWHERE[city].test(row.text)))
  return marked.length === 1 && named.length === 1 ? (marked[0] ?? null) : null
}

const NO_WORDS: ReadonlySet<string> = new Set()

/** The cities as a word of a row, lower case: what an address or an item's name says beside it. */
const CITY_WORD = /^(?:գյումրի|gyumri|երևան|երե[վւ]ան|yerevan)$/u

/**
 * What an item's row has and an address never does (round 9, Р9-В1): a table's customs heading opening
 * it; a card's article; an amount with its unit — a volume, a weight, a count, a fat — «0.5լ», «500գ»,
 * «5տ», «3.2%»; a sum with its hundredths «450.00»; a price and a sum, two numbers in the hundreds.
 */
const ITEM_SHAPED = [
  TABLE_ITEM_ROW,
  CARD_ARTICLE_ROW,
  // a unit ends its word: «500գ», never «1 ԳՅՈՒՄՐԻ», whose first letter is a gram's
  /\d\s*(?:%|(?:լ|մլ|կգ|գր?|հտ|հատ|տ|l|ml|kg|g|pcs)(?![\p{L}\d]))/iu,
  /\d[.,]\d{2}(?!\d)/u,
]

/**
 * A row an address may be read off. An item named after a city — the beer «Գյումրի», the cognac
 * «Երևան» — names its kind beside the city, «ԳՅՈՒՄՐԻ ԳԱՐԵՋՈՒՐ», «Կոնյակ Երևան», a word of the till's
 * dictionary, or puts the city in quotes as a brand, «Գարեջուր «Գյումրի»»; an address puts a street
 * beside it, «ԳՅՈՒՄՐԻ Գորկու 62». What OCR adds at the paper's edge — «9.», «2..1», «= 4 -» — stands
 * before an address as before an item and decides nothing.
 */
function isAddressRow(text: string, productWords: ReadonlySet<string>): boolean {
  if (ITEM_SHAPED.some((shape) => shape.test(text))) return false
  if (/[«“"„']\s*(?:գյումրի|gyumri|երևան|երե[վւ]ան|yerevan)/iu.test(text)) return false
  const prices = (text.match(/(?<![\p{L}\d])\d+(?![\p{L}\d])/gu) ?? []).filter(
    (number) => Number(number) >= 100,
  )
  if (prices.length >= 2) return false
  const words = text
    .toLowerCase()
    .split(/[^\p{L}]+/u)
    .filter((word) => Array.from(word).length >= 2)
  return !words.some(
    (word, i) =>
      CITY_WORD.test(word) &&
      [words[i - 1], words[i + 1]].some(
        (beside) => beside !== undefined && isProductWord(beside, productWords),
      ),
  )
}

/**
 * A word of the till's dictionary, or a long one OCR read a letter off («ԳԱՐԵՋՈԻՐ»). A short word must be
 * the word itself: the street «Շիրազի» is a letter off «շիրակի», «ширакский» of the dictionary.
 */
function isProductWord(word: string, productWords: ReadonlySet<string>): boolean {
  if (productWords.has(word)) return true
  if (Array.from(word).length < FUZZY_LETTERS) return false
  for (const known of productWords) {
    if (Math.abs(known.length - word.length) <= 1 && withinOneEdit(known, word)) return true
  }
  return false
}

/** From this many letters a word one letter off the dictionary's is still the dictionary's. */
const FUZZY_LETTERS = 7

function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true
  const [short, long] = a.length <= b.length ? [a, b] : [b, a]
  let i = 0
  let j = 0
  let edits = 0
  while (i < short.length && j < long.length) {
    if (short[i] === long[j]) {
      i++
      j++
      continue
    }
    if (++edits > 1) return false
    if (short.length === long.length) i++
    j++
  }
  return edits + (long.length - j) + (short.length - i) <= 1
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
