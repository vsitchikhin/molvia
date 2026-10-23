// MOL-264 — the package a line's name prints, and the purchase it makes. A till sells a bottle of cola as «1 шт» and
// prints «1.5լ» in its name; a price is compared only by the kilogram, the litre or the piece, so a purchase of one
// piece compares with nothing. The till's own figures stay as they are — its count, its shelf price, the line's
// arithmetic, the total and the shop's memory all speak in its pieces; the package only says what the purchase is.
// Wrong is worse than unread (MOL-255): a package not read for sure is none, and the line stays a piece.

import { scaledFromDecimal, INT8_MAX } from '#model/support/decimal'
import type { BaseUnit, Quantity } from '#model/values/units'
import type { ReceiptCountry } from '#model/entities/receipt'

// a size's unit in the scripts a till prints it in, and what a thousandth of it is in the base unit's thousandths
const SIZE_UNITS: Readonly<Record<string, readonly [BaseUnit, bigint]>> = {
  կգ: ['kg', 1000n],
  գր: ['kg', 1n],
  գ: ['kg', 1n],
  լ: ['l', 1000n],
  մլ: ['l', 1n],
  кг: ['kg', 1000n],
  гр: ['kg', 1n],
  г: ['kg', 1n],
  л: ['l', 1000n],
  мл: ['l', 1n],
  kg: ['kg', 1000n],
  gr: ['kg', 1n],
  g: ['kg', 1n],
  l: ['l', 1000n],
  ml: ['l', 1n],
}
const NUMBER = String.raw`\d+(?:[.,]\d+)?`
// a tolerance is no part of the size: «250±10գր», «470գր±3%»
const PLUS_MINUS = String.raw`(?:\s*±\s*${NUMBER}\s*%?)?`
// a count of N before the size is «N×», never «N*»: «Արարատ 3* 0.5լ» is a cognac of three stars (review №1)
const TIMES_BEFORE = String.raw`\s*[xх×]\s*`
const TIMES_AFTER = String.raw`\s*[xх×*]\s*`
/**
 * «1.5լ», «6х200մլ», «15գ*8», «0.33l»: a figure and a unit of weight or volume, the unit ending its word in its
 * script — «1 լոլիկ» is a tomato. Longer units first, so «մլ» is never «լ».
 * A till read off a photo glues its unit to the figure (232 sizes of 232 on the bench): «505 գր» is the model's copy of
 * «505 6գր», the glue's article and its 6 g with the 6 lost; «2019 г» a vintage, «Maxi 4 L» a nappy's size.
 */
const SIZE = new RegExp(
  String.raw`(?<![\d.,])(?:(\d+)${TIMES_BEFORE})?(${NUMBER})${PLUS_MINUS}(\s*)(կգ|գր|գ|մլ|լ|кг|гр|г|мл|л|kg|gr|g|ml|l)(?![ա-ֆԱ-Ֆа-яёА-ЯЁA-Za-z])${PLUS_MINUS}(?:${TIMES_AFTER}(\d+)(?![\d.,]))?`,
  'giu',
)
/**
 * What before a figure says it is no package of its own: a range, «9-14կգ» — a nappy for a child of that weight; a
 * fraction, «1/2կգ» — its denominator is no size; a multiplier whose count is a word, «25пак*2г», «25 փաթեթ x 2գր» —
 * one sachet of a box (review №2, adversarial А3, А4). The line keeps no package: half of it read is a guess. A star
 * after a figure and a space is a cognac's stars, «3* 0.5լ», and glued to both, «25*2գ», a count's sign.
 *
 * A sign of times, in either case, is one only standing apart — «25 KES X 2G» — or ending a word that begins with the
 * count, «25пакх2г», «25ПАКХ 2Г», «2X10հտ» (reviews 2 and 3, В2, Г1, Г3); the last letter of a word is a word's own,
 * «Elixir mix 0.33l», «Pepsi MAX 1.5լ», «Durex 3հտ», «пальчиковых 4шт» (Г5).
 */
const TIMES_SIGN = String.raw`(?:(?<!\p{L})[xх×]|\d\p{L}*[xх×])\s*`
const CUT_BEFORE = new RegExp(String.raw`(?:\d\s*[-–/]\s*|${TIMES_SIGN}|(?<!\d)\*\s*|\d\*)$`, 'iu')
// a count of pieces with a sign of times before it is a count of packs unread, «2x10հտ», «2X10հտ» (review 2, №7; Г1)
const TIMES_END = new RegExp(String.raw`(?:${TIMES_SIGN}|\*\s*)$`, 'iu')
/**
 * A vintage, never a package: a whole number from 1900 to 2099 before the Russian «г» of a year (adversarial А5) — never
 * an Armenian or a Latin gram, «2000գ» of cat food (review 2, В4).
 */
const YEAR = /^(?:19|20)\d\d$/u
/**
 * A pack of pieces, «10հտ», «5հատ», «12հ», «1զույգ», «32шт»; the model copies «հ» as a Latin «h» («75h», «4hտ», MOL-264
 * bench) and «հատ» as «հաբ». Two pieces at least: «1 հատ» is the till's own count as often as a pack. «× N» after it
 * multiplies only a bare number, a unit or a word after it glued or apart: «25հտ x 2գ» is 25 sachets of 2 g, «100հ x
 * 2 շերտ» two-ply (review 2 and 3, В1, Г2).
 */
const ARMENIAN_PIECES =
  /(?<![\d.,])(\d+)\s*(հատ|հտ|հաբ|հ|hտ|h|զույգ|шт)(?![ա-ֆԱ-Ֆа-яёА-ЯЁA-Za-z])(?:\s*[xх×*]\s*(\d+)(?![\d.,])(?!\s*\p{L}))?/giu
/**
 * A Latin «h» is the model's copy of «հ» — and a label's hours too, «Rexona 48h 150մլ» (adversarial А1, review №3):
 * beside a size it is no pack of pieces, and nothing tells which, so the line keeps no package. Alone it is the pack the
 * model copied, «Անձեռոցիկ 75h»: dropped, the bench lost 8 and 14 packages and made up the bags' litres.
 */
const LATIN_PIECES = 'h'
// a Serbian pack, «107KOM», «5KOM», «10/1», «20/ 1»: a «KOM» apart is the journal's unit of sale, «MLEKO 1 L KOM»
const SERBIAN_PIECES = /(?<![\d.,])(\d+)(?:(?:KOM|КОМ)(?![A-Za-zА-Яа-я])|\s*\/\s*1(?![\d.,]))/giu
// a thickness printed says the thing is packaging: its kilograms and litres are what it holds, never what it is
const THICKNESS = /միկր|mikron|микрон|мкм/iu
/**
 * A size no package a till sells weighs or holds — «330լ» is a can of 0,33 l with its point lost — is misread. A water
 * cooler's 19 l and a bag of cat food's 20 kg are packages.
 */
const LARGEST: Readonly<Record<BaseUnit, bigint>> = { kg: 50_000n, l: 25_000n, piece: INT8_MAX }
/**
 * The tills' font prints a 5 with a flat top, and both readers copy it as a 6 (MOL-290): «0.46լ» for 0,45 l, «260±10գր»
 * for 250 g. A size read off a photo with a 6 in it is in doubt, and a doubt is no package (MOL-255); the other way round
 * is rare, and doubting the fives too cost three times the packages read right on the bench for one made up less.
 */
const DOUBTED = '6'

function sizeOf(match: RegExpExecArray, printed: string, photo: boolean): Quantity | null {
  const [, before, figure, gap, unit, after] = match
  if (gap !== '' && (photo || /[ա-ֆ]/u.test(unit ?? ''))) return null
  if (photo && `${before ?? ''}${figure ?? ''}${after ?? ''}`.includes(DOUBTED)) return null
  if (CUT_BEFORE.test(printed.slice(0, match.index))) return null
  // «2019Г» of a journal in capitals too (review 3, №9, Г4)
  if (before === undefined && YEAR.test(figure ?? '') && unit?.toLowerCase() === 'г') return null
  const [base, factor] = SIZE_UNITS[(unit ?? '').toLowerCase()] ?? []
  const scaled = scaledFromDecimal(figure ?? '', 3)
  if (base === undefined || factor === undefined || scaled === null) return null
  // a thousandth of a gram is no package a till prints: «0,5 г» of a gram is unread, never rounded
  const thousandths = scaled * factor
  if (thousandths % 1000n !== 0n) return null
  const milli = (thousandths / 1000n) * BigInt(before ?? 1) * BigInt(after ?? 1)
  return milli > 0n && milli <= LARGEST[base] ? { milli, unit: base } : null
}

function one(found: readonly Quantity[]): Quantity | null {
  const [first] = found
  return first !== undefined && found.every((q) => q.milli === first.milli && q.unit === first.unit)
    ? first
    : null
}

/**
 * The package one piece of the line holds, by its name: a weight, a volume or a pack of pieces — none where the name
 * prints none, two that disagree, a thickness, or a size or a count in doubt. A pack of pieces is what one is where the name prints both: a
 * garbage bag's «35լ» is what it holds, its «30հտ» what it is (Р-3). A figure with no unit — a size the till cut,
 * «… 85» — is none.
 */
export function receiptPack(printed: string, country: ReceiptCountry): Quantity | null {
  if (THICKNESS.test(printed)) return null
  // a Serbian line is the tax office's text, never read off a photo
  const photo = country !== 'RS'
  const found = [...printed.matchAll(SIZE)]
  const packs = [...printed.matchAll(photo ? ARMENIAN_PIECES : SERBIAN_PIECES)]
    .map((match) => ({
      count: BigInt(match[1] ?? 0) * BigInt(match[3] ?? 1),
      // the count of a pack is the font's 6 as a size is (adversarial А2, review №4)
      doubted: photo && `${match[1] ?? ''}${match[3] ?? ''}`.includes(DOUBTED),
      // in either case: «REXONA 48H 150ML» (review 2, №6, В3)
      latin: (match[2] ?? '').toLowerCase().startsWith(LATIN_PIECES),
      cut: TIMES_END.test(printed.slice(0, match.index)),
    }))
    .filter((pack) => pack.count >= 2n && pack.count * 1000n <= INT8_MAX)
  if (packs.length > 0) {
    if (packs.some((pack) => pack.doubted || pack.cut || (pack.latin && found.length > 0))) {
      return null
    }
    return one(packs.map((pack): Quantity => ({ milli: pack.count * 1000n, unit: 'piece' })))
  }
  const sizes = found.map((match) => sizeOf(match, printed, photo))
  return sizes.includes(null) ? null : one(sizes as Quantity[])
}

/**
 * The package of a line the till sold in pieces — the one a purchase is made of; none for a line weighed, poured, or
 * with no count read (MOL-255: the check emptied it, and a package of nobody knows how many is a guess).
 */
export function linePack(
  line: { readonly printed: string; readonly quantity: Quantity | null },
  country: ReceiptCountry,
): Quantity | null {
  return line.quantity?.unit === 'piece' ? receiptPack(line.printed, country) : null
}

/**
 * What a line is recorded at: the till's count of pieces times the package one holds; a line the till weighed, a
 * line with no package and a line with no count stay as they are.
 */
export function packedQuantity(till: Quantity | null, pack: Quantity | null): Quantity | null {
  if (till === null || pack === null || till.unit !== 'piece') return till
  const milli = (till.milli / 1000n) * pack.milli
  return milli <= INT8_MAX ? { milli, unit: pack.unit } : till
}
