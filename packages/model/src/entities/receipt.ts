import { z } from 'zod'
import { EXCHANGE_UNDO_MINUTES } from '#model/entities/exchange'
import { serbianItemName } from '#model/entities/receipt-journal'
import { classListStart } from '#model/entities/receipt-text'
import type { ReceiptText, ReceiptTextLine, TextRow } from '#model/entities/receipt-text'
import { COUNTRY_CITIES } from '#model/contracts/settings'
import { localClock } from '#model/entities/reminder'
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
 * Why a receipt failed: `reshoot` — not one item line was found, so there is nothing to correct and only
 * a new shot can help (MOL-222, В-1); `unreadable` — the photo could not be read at all (the reader
 * failed on it, or ran out of time, or its answer was not a reading), or the tax office's journal held
 * no list. A receipt read only in part is not a failure: it goes to the review with what was read
 * (`readPartly`). A receipt by its link (MOL-232): `missing` — the tax office never showed it in
 * `RECEIPT_LINK_WAIT_HOURS`; `invalid` — the tax office does not hold it valid.
 */
export const receiptFailureSchema = z.enum(['reshoot', 'unreadable', 'missing', 'invalid'])
export type ReceiptFailure = z.infer<typeof receiptFailureSchema>

/**
 * How long a receipt by its link is asked of the tax office before it fails as `missing` (MOL-232,
 * Р-2): a receipt just printed shows in a minute or two (receipto, TAP), one of a till that was
 * offline only once the till reaches the tax office — two days with room to spare.
 */
export const RECEIPT_LINK_WAIT_HOURS = 48

/**
 * The pauses between asks of a receipt the tax office does not show yet, in minutes: quick while it
 * is likely just printed, then once an hour to the end of `RECEIPT_LINK_WAIT_HOURS`.
 */
export const RECEIPT_LINK_RETRY_MINUTES = [1, 2, 4, 8, 15, 30] as const
const RECEIPT_LINK_RETRY_LAST_MINUTES = 60

/** The pause before the ask after `asked` asks the tax office did not answer with the receipt. */
export function receiptLinkRetryMinutes(asked: number): number {
  return RECEIPT_LINK_RETRY_MINUTES[asked - 1] ?? RECEIPT_LINK_RETRY_LAST_MINUTES
}

/**
 * How the person learned their receipt was read (MOL-129): `app` — the phone was handed it read, by
 * the list of «Покупки» or the review; `bot` — it was not, and the bot said so. Whichever came first;
 * nothing comes after it.
 */
export const receiptHeardSchema = z.enum(['app', 'bot'])
export type ReceiptHeard = z.infer<typeof receiptHeardSchema>

/**
 * «Чек разобран» goes only to someone who left the screen (owner, 30.09.2026): a receipt read this
 * long ago that no phone was handed read. «Покупки» ask every five seconds while one is read and the
 * screen is in view (`RECEIPT_POLL_MS`), so this is six asks of margin for a poor connection.
 */
export const RECEIPT_TELL_AFTER_SECONDS = 30

/**
 * …and no later than this after it was read: past it the answer waits in «Покупки», and a bot back
 * from a long outage does not bring a day of receipts at once.
 */
export const RECEIPT_TELL_WITHIN_HOURS = 6

/**
 * The night of the person's zone, when «чек разобран» comes without a sound: a receipt is read half
 * a minute after it is sent, by day, so one read at night was held by a reader that was away — and
 * nobody is waiting for it at 3 a.m.
 */
export const RECEIPT_TELL_QUIET_FROM_HOUR = 22
export const RECEIPT_TELL_QUIET_UNTIL_HOUR = 8

/** Whether «чек разобран» at `now` comes without a sound, by the hour of `timeZone`. */
export function tellsQuietly(now: Date, timeZone: string): boolean {
  const { hour } = localClock(now, timeZone)
  return hour >= RECEIPT_TELL_QUIET_FROM_HOUR || hour < RECEIPT_TELL_QUIET_UNTIL_HOUR
}

/**
 * The countries a receipt is read in, with Tesseract's languages for each, as MOL-114 measured them:
 * one country's set, never every script at once, which is slower and confuses the alphabets. Serbia's
 * receipts are not read off a photo at all but by the link of their QR code — the tax office gives
 * their lines (MOL-232); Georgia (`kat+eng`) joins with its card (MOL-248).
 */
export const photoReceiptCountrySchema = z.enum(['AM'])
export const linkReceiptCountrySchema = z.enum(['RS'])
export const receiptCountrySchema = z.enum([
  ...photoReceiptCountrySchema.options,
  ...linkReceiptCountrySchema.options,
])
export type ReceiptCountry = z.infer<typeof receiptCountrySchema>
export type PhotoReceiptCountry = z.infer<typeof photoReceiptCountrySchema>
export type LinkReceiptCountry = z.infer<typeof linkReceiptCountrySchema>

/**
 * Where a receipt's lines come from (MOL-232): `photo` — the phone's photo read by our reader;
 * `tax` — the tax office, asked by the link of the receipt's QR code. A country's receipts come one
 * way: a Serbian receipt off a photo is MOL-233's, and it is the link read off it that is sent.
 */
export const receiptSourceSchema = z.enum(['photo', 'tax'])
export type ReceiptSource = z.infer<typeof receiptSourceSchema>
export function receiptSourceOf(country: ReceiptCountry): ReceiptSource {
  return linkReceiptCountrySchema.safeParse(country).success ? 'tax' : 'photo'
}

/**
 * How a receipt's link reached the phone (MOL-234, owner's В-3 «а» of MOL-233): `qr` — read off the
 * photo by the app, `paste` — pasted by the person. The measure of the risk of MOL-233, whether a real
 * receipt's QR code reads off a photo; beside it whether the camera missed in the sheet before.
 */
export const receiptViaSchema = z.enum(['qr', 'paste'])
export type ReceiptVia = z.infer<typeof receiptViaSchema>

/**
 * The cities a receipt names, as a word of its head, of the countries read: a person in Tbilisi
 * records an Armenian receipt in Gyumri or Yerevan (MOL-109, Р-5).
 */
export const RECEIPT_CITIES = [...COUNTRY_CITIES.AM, ...COUNTRY_CITIES.RS] as const
export type ReceiptCity = (typeof RECEIPT_CITIES)[number]
type ArmenianCity = (typeof COUNTRY_CITIES.AM)[number]

/** Tesseract's languages of the countries read off a photo. */
export const RECEIPT_LANGUAGES: Readonly<Partial<Record<ReceiptCountry, string>>> = {
  AM: 'hye+rus+eng',
}
export const RECEIPT_CURRENCY: Readonly<Record<ReceiptCountry, Currency>> = {
  AM: 'AMD',
  RS: 'RSD',
}

/**
 * The language a country's tills print names in, and the language of the catalogue's names a line is
 * matched against (MOL-126): an item is a node, reached by its barcodes, the shops' articles, its
 * customs headings and its names in the countries' languages. Serbia has no names of its own yet: its
 * lines go by the shop's memory and the catalogue's search (MOL-232, В-3).
 */
export const itemNameLanguageSchema = z.enum(['hy'])
export type ItemNameLanguage = z.infer<typeof itemNameLanguageSchema>
export const RECEIPT_NAME_LANGUAGE: Readonly<Partial<Record<ReceiptCountry, ItemNameLanguage>>> = {
  AM: 'hy',
}

/**
 * What a line of a country with no names of its own in the catalogue is searched by, and the name a
 * new item takes from it (MOL-232, В-3): a Serbian till's name less its unit word and article. An
 * Armenian line goes by its gloss (MOL-126), so its name here is as printed.
 */
export function receiptLineName(printed: string, country: ReceiptCountry): string {
  return country === 'RS' ? serbianItemName(printed) : printed.trim()
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
const CITY_WORDS: Readonly<Record<ArmenianCity, string>> = {
  Гюмри: '(?:գյումրի|gyumri)(?![\\p{L}-])',
  Ереван: '(?:երևան|երե[վւ]ան|yerevan)(?![\\p{L}-])(?!\\s*[-–]?\\s*(?:սիթի|city|сити))',
}

/** A city named anywhere in a row of the head, a word of its own: an address, or an item's name. */
const CITY_ANYWHERE: Readonly<Record<ArmenianCity, RegExp>> = {
  Гюмри: new RegExp(`(?<!\\p{L})${CITY_WORDS.Гюмри}`, 'iu'),
  Ереван: new RegExp(`(?<!\\p{L})${CITY_WORDS.Ереван}`, 'iu'),
}

/** The city after «ք.», քաղաք — a mark an address has and an item's name never does. */
const CITY_MARKED: Readonly<Record<ArmenianCity, RegExp>> = {
  Гюмри: new RegExp(`(?<!\\p{L})ք\\.\\s*${CITY_WORDS.Гюмри}`, 'iu'),
  Ереван: new RegExp(`(?<!\\p{L})ք\\.\\s*${CITY_WORDS.Ереван}`, 'iu'),
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
  // a fiscal till's class code «Դաս. 56.10» opens its first item where neither layout reads (MOL-226)
  // read as the class reading reads it, so the head and the list never disagree (review А6)
  const coded = ends.length === 0 ? classListStart(rows) : -1
  if (coded >= 0) ends.push(coded)
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
): ArmenianCity | null {
  const first = rows.filter((row) => row.part === 0)
  const head = first.slice(0, headEnd(first))
  // the chain's site, «www.yerevan-city.am», however OCR read it — «Ww Yerevan: СПу. ат» — names no city
  const lines = head.filter((row) => !isSiteRow(row.text))
  const cities = Object.keys(CITY_ANYWHERE) as ArmenianCity[]
  // the city an address names — the one city named in the head at all: an item named after another
  // city, or a chain's legal address beside its shop's, is two cities and no answer (rounds 3–10)
  const named = cities.filter((city) => lines.some((row) => CITY_ANYWHERE[city].test(row.text)))
  if (named.length !== 1) return null
  const [city] = named
  if (city === undefined) return null
  return lines.some((row, i) => {
    if (!CITY_ANYWHERE[city].test(row.text)) return false
    // «ք.», a city's own mark, never stands in an item's name: after it the house may come first,
    // «62, Գորկու փ., ք. Գյումրի», or on the next row, «ք. Գյումրի,» / «Գորկու 62» — a shop named after a
    // city, «ԵՐԵՎԱՆ ՄԹԵՐՔ» over «Գորկու 62», has no mark and is no address (round 12, Р12-В1)
    const marked = CITY_MARKED[city].test(row.text)
    return (
      isAddressRow(row.text, productWords, marked) ||
      (marked &&
        !itemShaped(row.text, productWords) &&
        isAddressRow(lines[i + 1]?.text ?? '', productWords, false))
    )
  })
    ? city
    : null
}

/**
 * A site's row: «www.…», «….am», and how OCR reads them, «Ww …», «… ат» (round 11, Р11-В1) — with no
 * digit, since an address has its house: «ԳՅՈՒՄՐԻ Գորկու 62, AM» is the country's code (round 12, Р12-В2).
 */
function isSiteRow(text: string): boolean {
  return !/\d/u.test(text) && /(?<!\p{L})w{2,}(?!\p{L})|(?:\.|\s)(?:am|ат)\s*$|https?:/iu.test(text)
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
  // a unit ends its word: «500գ», never «1 ԳՅՈՒՄՐԻ», whose first letter is a gram's; a one-letter unit
  // stands right after its number, «5տ», «0.5լ» — «Գորկու 62 տ.» is a house, տուն (round 10, Р10-В2) —
  // and a gram is a hundred and more, or a fraction: «62գ» is a house's third building (round 11, Р11-В2)
  /\d\s*(?:%|(?:մլ|կգ|գր|հտ|հատ|ml|kg|pcs)(?![\p{L}\d]))|\d(?:լ|տ|l)(?![\p{L}\d])|(?:\d{3,}|\d[.,]\d+)(?:գ|g)(?![\p{L}\d])/iu,
  // a sum's hundredths «450.00», never a day «02.10.2026»
  /\d[.,]\d{2}(?![\d.,])/u,
]

/**
 * A row an address may be read off. An item named after a city — the beer «Գյումրի», the cognac
 * «Երևան» — names its kind beside the city, «ԳՅՈՒՄՐԻ ԳԱՐԵՋՈՒՐ», «Կոնյակ Երևան», a word of the till's
 * dictionary, or puts the city in quotes as a brand, «Գարեջուր «Գյումրի»»; an address puts a street
 * beside it, «ԳՅՈՒՄՐԻ Գորկու 62». What OCR adds at the paper's edge — «9.», «2..1», «= 4 -» — stands
 * before an address as before an item and decides nothing.
 */
function isAddressRow(text: string, productWords: ReadonlySet<string>, marked: boolean): boolean {
  if (itemShaped(text, productWords)) return false
  // an address names its house after its first word: «Գորկու 62», «Գորկուծ22» as OCR glued it; a row
  // with no number there — «1.ԳՅՈՒՄՐԻ ԳԱ ուր.», a name OCR cut — is no address (round 10, Р10-В1),
  // unless «ք.» names the city: «62, Գորկու փ., ք. Գյումրի» (round 12)
  const letter = text.search(/\p{L}/u)
  if (letter < 0 || !/\d/u.test(marked ? text : text.slice(letter))) return false
  // a house is four digits at most; five and more are a tax number, a till's, a receipt's (round 11)
  if (/\d{5,}/u.test(text)) return false
  // a price and a sum stand at the row's end, in the hundreds; a postal code and a house are not there
  // both, «Գյումրի 3101, Ռիժկովի 104», nor is a house and its flat «162/105» (round 10, Р10-В2)
  const tail = /(?:\s+\d+)+\s*$/u.exec(text.replace(/[^\p{L}\d\s/]+$/u, ''))?.[0] ?? ''
  const prices = (tail.match(/(?<![\d/])\d+(?![\d/])/gu) ?? []).filter(
    (number) => Number(number) >= 100,
  )
  if (prices.length >= 2) return false
  return true
}

/** The marks of an item's row (rounds 9–11): its shapes, the city in quotes, a kind beside the city. */
function itemShaped(text: string, productWords: ReadonlySet<string>): boolean {
  if (ITEM_SHAPED.some((shape) => shape.test(text))) return true
  if (/[«“"„']\s*(?:գյումրի|gyumri|երևան|երե[վւ]ան|yerevan)/iu.test(text)) return true
  // a word cut with a dot is an abbreviation, a street's as often as a kind's — «Վարդ.» is Վարդանանց, not
  // «վարդ», a rose — and decides nothing (round 11, Р11-В2)
  const words = [...text.toLowerCase().matchAll(/(\p{L}{2,})(\.?)/gu)].map(
    ([, word = '', dot]) => ({
      word,
      cut: dot === '.',
    }),
  )
  return words.some(
    ({ word }, i) =>
      CITY_WORD.test(word) &&
      [words[i - 1], words[i + 1]].some(
        (beside) => beside !== undefined && !beside.cut && isProductWord(beside.word, productWords),
      ),
  )
}

/**
 * A word of the till's dictionary, or a long one OCR read a letter off («ԳԱՐԵՋՈԻՐ»). A short word must be
 * the word itself: the street «Շիրազի» is a letter off «շիրակի», «ширакский» of the dictionary. A word
 * cut with a dot is not a kind's start: «Գոր.», «Շիր.» are streets as often (round 11, Р11-В2).
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
 * «Переснимите» (MOL-222, owner, 04.10.2026): not one item line was found, and the receipt is no section
 * printed with no items (MOL-227). Every receipt with a line in
 * it is read and goes to the review — «читать надо все кассы, все чеки» — however little of it was
 * read: the person's corrections are what the hypothesis of 0.2 counts, and a till read badly is one to
 * learn. What was «переснимите» before (В-4 of MOL-125) is `readPartly`, a hint on the review.
 */
export function needsReshoot(text: ReceiptText): boolean {
  return text.lines.length === 0 && text.layout !== 'department'
}

/**
 * A receipt read whole with no items on it (MOL-227): a sole trader's section and its sum. After
 * MOL-222 a receipt is read only with a line in it, so a read one with none is this and nothing else —
 * a sum to record, its purchases added later in the trip if the person wants (В-1).
 */
export function withoutItems(receipt: {
  readonly status: ReceiptStatus
  readonly lineCount: number
}): boolean {
  return receipt.status === 'parsed' && receipt.lineCount === 0
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

/**
 * Where a country's tills keep their clocks: Armenia is at +4 the year round, Serbia moves its clock
 * twice a year — a zone's name, never an offset (MOL-232).
 */
export const RECEIPT_TIME_ZONE: Readonly<Record<ReceiptCountry, string>> = {
  AM: 'Asia/Yerevan',
  RS: 'Europe/Belgrade',
}

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
  const asUtc = new Date(`${day}T${time}:00Z`)
  if (Number.isNaN(asUtc.getTime())) return null
  // the zone's offset at that moment, asked twice: once for the clock read as UTC, once for the answer
  const zone = RECEIPT_TIME_ZONE[country]
  const first = new Date(asUtc.getTime() - zoneOffsetMs(asUtc, zone))
  return new Date(asUtc.getTime() - zoneOffsetMs(first, zone))
}

/** The day and time a till's clock showed at `at`: `YYYY-MM-DD`, `HH:MM`. */
export function receiptClockOf(at: Date, country: ReceiptCountry): { day: string; time: string } {
  const parts = clockParts(at, RECEIPT_TIME_ZONE[country])
  return {
    day: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  }
}

interface Clock {
  readonly year: string
  readonly month: string
  readonly day: string
  readonly hour: string
  readonly minute: string
  readonly second: string
}

function clockParts(at: Date, timeZone: string): Clock {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at)
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((one) => one.type === type)?.value ?? ''
  return {
    year: part('year'),
    month: part('month'),
    day: part('day'),
    hour: part('hour'),
    minute: part('minute'),
    second: part('second'),
  }
}

/** How far a zone's clock is ahead of UTC at `at`, in milliseconds. */
function zoneOffsetMs(at: Date, timeZone: string): number {
  const p = clockParts(at, timeZone)
  const shown = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour),
    Number(p.minute),
    Number(p.second),
  )
  return shown - Math.floor(at.getTime() / 1000) * 1000
}

/** The time a receipt prints, if it is one a clock shows: `HH:MM` (review Р12). */
export function receiptTimeOf(text: ReceiptText): string | null {
  const time = /^([01]\d|2[0-3]):[0-5]\d$/.exec(text.time ?? '')
  return time === null ? null : time[0]
}
