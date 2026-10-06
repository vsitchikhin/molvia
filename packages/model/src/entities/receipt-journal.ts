import type { ReceiptTextLine } from '#model/entities/receipt-text'

// MOL-232 — the lines of a Serbian receipt from its journal, the 40-column text the tax office
// answers a receipt's link with (MOL-223). It is not the paper read by OCR but the tax office's own
// rendering of what the till sent, one format for every till: under «Назив Цена Кол. Укупно» each
// item is its name, wrapped at forty columns and ended by its tax label «(Ђ)», then a row «price
// quantity sum» — «.» groups thousands, «,» is the decimal mark. The port of MOL-223's
// `journal-lines.mjs`: 20 of 20 lines of three live receipts against the tax office's own
// specification, 78 of 78 on the 23 journals of MOL-229. The head of a journal names the cashier and
// the buyer's tax id: nothing of it is read here.

export interface SerbianJournal {
  readonly lines: readonly ReceiptTextLine[]
  /** «Укупан износ», in hundredths; null when the journal prints none. */
  readonly totalHundredths: number | null
}

const HEADING = /^Назив\s+Цена\s+Кол\.\s+Укупно/u
const RULE = /^-{10,}/u
const LABEL = /\s*\(([A-ZА-ЯЂЋЉЊЏ])\)\s*$/u
const AMOUNTS = /^\s*(-?[\d.]+,\d{2})\s+(-?[\d.]*\d(?:,\d+)?)\s+(-?[\d.]+,\d{2})\s*$/u
const TOTAL = /^\s*Укупан износ:\s+(-?[\d.]+,\d{2})\s*$/u

/** The journal's lines and total, or null when it holds no list of items at all. */
export function serbianJournal(journal: string): SerbianJournal | null {
  const rows = journal.replace(/\r\n?/gu, '\n').split('\n')
  const start = rows.findIndex((row) => HEADING.test(row.trim()))
  if (start < 0) return null
  const lines: ReceiptTextLine[] = []
  let name: string[] = []
  let end = rows.length
  for (let i = start + 1; i < rows.length; i++) {
    const row = rows[i] ?? ''
    if (RULE.test(row)) {
      end = i
      break
    }
    const figures = AMOUNTS.exec(row)
    if (figures !== null && name.length > 0) {
      lines.push(lineOf(name.join(''), figures[1] ?? '', figures[2] ?? '', figures[3] ?? ''))
      name = []
    } else {
      // a name runs over rows cut at the fortieth column, mid-word as often as not: joined as is
      name.push(row)
    }
  }
  const total = rows
    .slice(end)
    .map((row) => TOTAL.exec(row)?.[1])
    .find((sum) => sum !== undefined)
  return { lines, totalHundredths: total === undefined ? null : hundredthsOf(total) }
}

function lineOf(text: string, price: string, quantity: string, sum: string): ReceiptTextLine {
  const printed = text
    .replace(LABEL, '')
    .replace(/\s{2,}/gu, ' ')
    .trim()
  const milli = milliOf(quantity)
  const unit = unitOf(printed, milli)
  const priceHundredths = hundredthsOf(price)
  const sumHundredths = hundredthsOf(sum)
  return {
    printed,
    hs: null,
    sku: null,
    quantityMilli: milli,
    unit,
    priceHundredths,
    sumHundredths,
    discountHundredths: null,
    settled: settles(priceHundredths, milli, sumHundredths),
    rows: [],
  }
}

/** «1.259,97» in hundredths; null for anything else. */
function hundredthsOf(text: string): number | null {
  const amount = /^(-?)(\d{1,3}(?:\.\d{3})*|\d+),(\d{2})$/u.exec(text)
  if (amount === null) return null
  const value = Number(`${(amount[2] ?? '').replace(/\./gu, '')}${amount[3] ?? ''}`)
  return amount[1] === '-' ? -value : value
}

/** «1,482», «12», «1.000» in thousandths; null past three decimals or for anything else. */
function milliOf(text: string): number | null {
  const amount = /^(\d{1,3}(?:\.\d{3})*|\d+)(?:,(\d{1,3}))?$/u.exec(text)
  if (amount === null) return null
  return Number(`${(amount[1] ?? '').replace(/\./gu, '')}${(amount[2] ?? '').padEnd(3, '0')}`)
}

/** Price × quantity, half up to the hundredth, is the sum printed. */
function settles(price: number | null, milli: number | null, sum: number | null): boolean {
  if (price === null || milli === null || sum === null || price < 0 || sum < 0) return false
  return Math.floor((price * milli + 500) / 1000) === sum
}

/**
 * The words a till ends a name with to say how it is sold (the 98 lines of MOL-223 and MOL-229):
 * by the kilogram, the litre (fuel), or the piece — «KOM», komad, and its cut «KO», «FL» a bottle.
 */
const UNIT_WORDS: Readonly<Record<string, 'kg' | 'l' | 'piece'>> = {
  KG: 'kg',
  L: 'l',
  LIT: 'l',
  KOM: 'piece',
  KO: 'piece',
  КОМ: 'piece',
  KOMAD: 'piece',
  FL: 'piece',
  PAK: 'piece',
}

const WORDS = /[^\s/()[\]\\]+/gu

/**
 * How a line is sold: by the last of the unit words the name carries as words of their own — «1KG» and
 * «0.33L» are sizes, «MLEKO 1 L KOM» is a piece. With no unit word a fraction is weighed: «Filet
 * lososa/KG/0238062» names it, a count of pieces is whole.
 */
function unitOf(printed: string, milli: number | null): 'kg' | 'l' | 'piece' {
  const words = printed.toUpperCase().match(WORDS) ?? []
  const named = words.map((word) => UNIT_WORDS[word]).filter((unit) => unit !== undefined)
  const last = named.at(-1)
  if (last !== undefined) return last
  return milli !== null && milli % 1000 !== 0 ? 'kg' : 'piece'
}

// what ends a name and is no part of the item: a unit word, an article «/0238062», a code «- 8683…»;
// never a bare «L», which is as often a size, «MLEKO 1 L KOM»
const TAIL = /[\s/()[\]\\-]+(?:KG|LIT|KOM|KO|КОМ|KOMAD|FL|PAK|\d{5,})[)\]]*$/iu

/**
 * The name a line gives an item (MOL-232, В-3): what is printed less its unit word and the till's
 * article at the end — «SECER KRISTAL 1KG SUNOKO KOM» is «Secer kristal 1kg sunoko». A till prints in
 * capitals; a name in capitals is set as a sentence, as a person would type it.
 */
export function serbianItemName(printed: string): string {
  let name = printed.trim()
  for (let previous = ''; previous !== name;) {
    previous = name
    name = name.replace(TAIL, '').trim()
  }
  name = name.replace(/[\s/\\-]+$/u, '').trim()
  if (name === '') return printed.trim()
  if (name !== name.toUpperCase()) return name
  const lower = name.toLowerCase()
  return lower.charAt(0).toUpperCase() + lower.slice(1)
}

/**
 * The tax office names a shop by its premises' code and the name the firm gave it, «1113343-RODA
 * MEGAMARKET 463»: the code is one shop of a chain whose every shop shares the seller's tax number.
 */
export function serbianShopOf(
  locationName: string,
): { readonly unit: string | null; readonly name: string } | null {
  const text = locationName.replace(/\s+/gu, ' ').trim()
  if (text === '') return null
  const coded = /^(\d{3,})\s*-\s*(.+)$/u.exec(text)
  return coded === null
    ? { unit: null, name: text }
    : { unit: coded[1] ?? null, name: (coded[2] ?? '').trim() || text }
}

/**
 * The city of the settings a Serbian receipt was printed in, by its municipality — «Београд-Земун»,
 * «Нови Сад» — or its town; null for any other, whose place is then looked for in the person's city.
 */
export function serbianCityOf(...names: readonly (string | null)[]): 'Белград' | 'Нови-Сад' | null {
  for (const name of names) {
    const text = (name ?? '').toLowerCase()
    if (/^\s*(?:београд|beograd)/u.test(text)) return 'Белград'
    if (/^\s*(?:нови\s*сад|novi\s*sad)/u.test(text)) return 'Нови-Сад'
  }
  return null
}
