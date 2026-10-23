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
 * A sign of times, in either case, is one standing apart — «25 KES X 2G»; one glued to the figure after any letter,
 * «пакх2г», «4 банкиx0.5л», «2 коробкиx10шт» (reviews 2–6, В2, Д3, Ж1, №12); or one ending a word that follows a figure,
 * glued or apart, «25ПАКХ 2Г», «25 пакетикиx 2г», «2 коробкиx 10шт» (Г1, Г3, З1). A word of a count and a word of a
 * name read alike there — «25 пакетикиx 2г» and «Ariel 3в1 Max 25шт» are a figure, a word ending in «x», a figure — and a
 * package made up is worse than one unread (MOL-255). With no figure before the word, «x» is its own: «Elixir mix
 * 0.33l», «Pepsi MAX 1.5լ», «Durex 3հտ», «пальчиковых 4шт» (Г5). **The prices, named:** «Ariel 3в1 Max 25шт», «2in1 Max
 * 400мл», «в 2 вкусах 200г» and «Pepsi Max1.5լ», glued, keep none (review 7, З1 over Е3 and №11).
 */
const TIMES_SIGN = String.raw`(?:(?<!\p{L})[xх×]\s*|\d\s*\p{L}*[xх×]\s*|\p{L}[xх×])`
/**
 * A count of several beside the size — «4 банки 0.5л», «6 в упаковке», «из 6ти банок», «6pk», «x6», «1+1», «пара банок»,
 * «six-pack» — makes the size one of them, and the ways a count is spelt have no end: each of reviews 8–12 found new ones
 * while the rule listed the containers. So the size or the pack is read only where it is the name's one number: any
 * other whole number from 2 to 100 standing on its own, a number spelt in a word or a bundle keeps no package. Glued after
 * a letter it is a model's or a class's, «C1», «LR6», «N4» — a sign of times apart is no letter, «x6»; plies, «3D», years
 * and three in one glued after it are the name's, «3շ», «5տ», «3в1»; a fraction, a percent or degrees, a range and a
 * width by a length beside a count of pieces, «3.2%», «40°», «9-14կգ», «100шт 24х37», are no count; nor is a line's number before its name, «17.», nor a code past a
 * hundred, «9639». **The price, named, as one class:** a name's own number — «Балтика 7», «7 злаков», «Pampers 4 Maxi»,
 * «3 в 1», «12 лет», «Три медведя» — keeps none (MOL-255). **What stays:** a pack of several that prints no count,
 * «Пиво упаковка 0.5л», is read as one.
 */
// what a number glued to it says is no count: plies «3շ», «3D», years «5տ», three in one «3-ը 1-ում», «3в1», «2in1»
const NOT_A_COUNT = String.raw`(?:(?:շ|Դ|D|տ|[-–](?:ը|ում))(?!\p{L})|(?:в|in)1(?!\d))`
const OTHER_NUMBER = new RegExp(
  String.raw`(?<![\d.,#№])(?<!(?![xх×])\p{L})(?<!\p{L}[xх×])(?<!\d\s*[-–/xх×*+]\s*)(?:[2-9]|[1-9]\d|100)(?!\d|[.,]\d|\s*[%°]|\s*[-–/xх×*]\s*\d|${NOT_A_COUNT})`,
  'giu',
)
const COUNT_WORD = new RegExp(
  String.raw`(?<!\p{L})(?:${[
    String.raw`дв(?:а|е|ое|ух)|тр(?:и|ое|[её]х)|четыр\p{L}*|четвер\p{L}*|пят(?:ь|и|ер\p{L}*|надцат\p{L}*|ьдесят\p{L}*)`,
    String.raw`шест(?:ь|и|ер\p{L}*|надцат\p{L}*|ьдесят\p{L}*)|сем(?:ь|и|ер\p{L}*)|восем\p{L}*|восьм\p{L}*|девят\p{L}*|десят\p{L}*`,
    String.raw`одиннадцат\p{L}*|двенадцат\p{L}*|двадцат\p{L}*|тридцат\p{L}*|сорок\p{L}*|пар[аыу]|(?:пол)?дюжин\p{L}*|мульти-?пак\p{L}*`,
    String.raw`двойн\p{L}*|тройн\p{L}*|трио|спарк\p{L}*|double|triple|duplo|dupl\p{L}*|trostruk\p{L}*|կրկնակի`,
    String.raw`(?:two|three|four|five|six|eight|ten|twelve|twenty|twin|duo|pair|dozen|multi)(?:-?pack|pk)?`,
    String.raw`(?:երկու|երեք|չորս|հինգ|վեց|յոթ|ութ|ինը|տասը)(?:ական)?`,
    String.raw`dva|dve|tri|četiri|cetiri|šest|sest|sedam|osam|devet|deset|dvanaest|dvadeset|par`,
  ].join('|')})(?!\p{L})`,
  'iu',
)
// «1+1», «2+1» — a bundle, several taped into one
const BUNDLE = /\d\s*\+\s*\d/u
/**
 * Beside a weight or a volume, «N x M» is a pack of several, «0.5л 1х12», «2x6 0.5լ» (Н1): a width by a length, «24х37»,
 * stands only beside a count of pieces, «100шт 24х37».
 */
const PAIR = /(?<![\d.,])\d+\s*[xх×*]\s*\d+(?![.,]?\d)/giu
// a count past a hundred with a word after it, «200 пакетиков 2г» (№18) — a code stands alone, «250h 193», «(4818)»
const LARGE_COUNT = /(?<![\p{L}\d.,#№])[1-9]\d{2}(?![.,]?\d)(?=\s*\p{L})/gu
const LINE_NUMBER = /^\s*\d+[.)]/u
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
 * bench) and «հատ» as «հաբ». Two pieces at least: «1 հատ» is the till's own count as often as a pack.
 *
 * «× N» after it is what each piece weighs only where a unit of a size follows N, glued or apart — «25հտ x 2գ», «32шт х
 * 30 г»: the count stands alone. Anything else — nothing, a word, a hyphen, a bracket, a comma — may be packs or plies:
 * «4հ x 2», «x 2 տուփ», «x 2 (շերտ)», «x 2, Զևա», «x 2-х слойная»; nothing tells which, and the line keeps no package
 * (reviews 2–5, В1, Г2, Д1, Д2, Е1, Е2, №10). **The price, named:** «4հ x 2», eight rolls, keeps none.
 */
// «× N» after a count, and the unit of a size after N if one stands there — groups 3 and 4 of either country's pack
/**
 * A sign of times with a figure anywhere after a count, «10шт. х 3», «4հ «Զևա» x 2», «10հտ (C1) x 3» — packs the count's
 * own «× N» did not reach: unread, unless a unit of a size follows the figure (review 7, З2). A sign with a number standing
 * alone before it is the thing's width and length, «100шт 24х37см», «30հտ 50x60» (review 8, И1, №13); a number glued to a
 * letter is a word, «C1 x 3», «LR6 x 2» — packs (review 9, Й3).
 */
const LATER_TIMES = new RegExp(
  String.raw`(?<!(?<![\p{L}\d.,])\d+(?:[.,]\d+)?\s*)(?:(?<!\p{L})[xх×]|\p{L}[xх×]|\*)\s*\d+(?:[.,]\d+)?(?!\s*(?:կգ|գր|գ|մլ|լ|кг|гр|г|мл|л|kg|gr|g|ml|l)(?!\p{L}))(?![\d.,])`,
  'iu',
)
const PIECES_TIMES = String.raw`(?:\s*[xх×*]\s*(\d+(?:[.,]\d+)?)(\s*(?:կգ|գր|գ|մլ|լ|кг|гр|г|мл|л|kg|gr|g|ml|l)(?!\p{L}))?)?`
const ARMENIAN_PIECES = new RegExp(
  String.raw`(?<![\d.,])(\d+)\s*(հատ|հտ|հաբ|հ|hտ|h|զույգ|шт)(?![ա-ֆԱ-Ֆа-яёА-ЯЁA-Za-z])${PIECES_TIMES}`,
  'giu',
)
/**
 * A Latin «h» is the model's copy of «հ» — and a label's hours too, «Rexona 48h 150մլ» (adversarial А1, review №3):
 * beside a size it is no pack of pieces, and nothing tells which, so the line keeps no package. Alone it is the pack the
 * model copied, «Անձեռոցիկ 75h»: dropped, the bench lost 8 and 14 packages and made up the bags' litres.
 */
const LATIN_PIECES = 'h'
/**
 * A Serbian pack, «107KOM», «5KOM», «10/1», «20/ 1»: a «KOM» apart is the journal's unit of sale, «MLEKO 1 L KOM». Its
 * «× N» is read as an Armenian count's is: «100KOM X 2», «10/1 X 2» may be packs or plies, none (review 6, Ж2).
 */
const SERBIAN_PIECES = new RegExp(
  String.raw`(?<![\d.,])(\d+)((?:KOM|КОМ)(?![A-Za-zА-Яа-я])|\s*\/\s*1(?![\d.,]))${PIECES_TIMES}`,
  'giu',
)
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

// another number, or one in a word, beside what was read — the size and the pack read count for nothing
function countBeside(
  printed: string,
  sizes: readonly RegExpExecArray[],
  counts: readonly RegExpExecArray[],
): boolean {
  const start = LINE_NUMBER.exec(printed)?.[0].length ?? 0
  const read = [...sizes, ...counts]
  const inside = (at: number) =>
    read.some((match) => at >= match.index && at < match.index + match[0].length)
  const outside = (pattern: RegExp) =>
    [...printed.matchAll(pattern)].some((match) => match.index >= start && !inside(match.index))
  return (
    COUNT_WORD.test(printed) ||
    BUNDLE.test(printed) ||
    outside(OTHER_NUMBER) ||
    outside(LARGE_COUNT) ||
    (sizes.length > 0 && outside(PAIR))
  )
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
  const counted = [...printed.matchAll(photo ? ARMENIAN_PIECES : SERBIAN_PIECES)]
  if (countBeside(printed, found, counted)) return null
  const packs = counted
    .map((match) => {
      return {
        count: BigInt(match[1] ?? 0),
        // «× N» with no unit after it is packs or plies: unread (Д1, Д2, Е1, Е2)
        unread:
          (match[3] !== undefined && match[4] === undefined) ||
          LATER_TIMES.test(printed.slice(match.index + match[0].length)),
        // the count of a pack is the font's 6 as a size is (adversarial А2, review №4)
        doubted: photo && (match[1] ?? '').includes(DOUBTED),
        // in either case: «REXONA 48H 150ML» (review 2, №6, В3)
        latin: (match[2] ?? '').toLowerCase().startsWith(LATIN_PIECES),
        cut: TIMES_END.test(printed.slice(0, match.index)),
      }
    })
    .filter((pack) => pack.count >= 2n && pack.count * 1000n <= INT8_MAX)
  if (packs.length > 0) {
    if (packs.some((p) => p.unread || p.doubted || p.cut || (p.latin && found.length > 0))) {
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
