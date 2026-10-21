// MOL-293 — what a line of an Armenian till is: its kind, the head word of its name, and its brand in «…».
// An item stands on a line only where the line's kind is the item's and the item names nothing the line
// does not print (owner, В-1 «а», 21.10.2026): a word of a flavour or a filling found «Клубника» for a
// strawberry yoghurt, «Пицца» for a pizza base. Anything else is a new item, named in full from the line —
// a guess, so «проверьте». Wrong is worse than unread (MOL-255).

import { levenshtein } from '#model/support/edits'
import { toSearchKey } from '#model/support/search-key'

/** A line taken apart: its words as printed, around its brand. */
export interface ReceiptLineParts {
  /** The words before the brand, or every word where the line prints none. */
  readonly before: readonly string[]
  /** What stands in «…», as printed; none where the line prints no letter there. */
  readonly brand: string | null
  readonly after: readonly string[]
  /** The head word of the name: what the line is — the first word before the brand that qualifies none. */
  readonly kind: string | null
  /** A fat or a strength as printed, «1,5%». */
  readonly percent: string | null
  /** The package's weight or volume, «130 г», «0,25 л», «2×40 г»; none for a line sold by weight. */
  readonly size: string | null
}

// words with no ending of their own that qualify the head: «Թարմ հավ» is a chicken, «Չոր վառելիք» a fuel
const QUALIFIERS = new Set([
  'թարմ',
  'տաք',
  'չոր',
  'սառը',
  'մանր',
  'կլոր',
  'կանաչ',
  'սև',
  'սպիտակ',
  'մուգ',
  'բաց',
  'ընտիր',
  'հում',
  'սուպեր',
  'էներգետիկ',
  'ծիածանափայլ',
  'բազմերանգ',
  'խոնավ',
  'միանգամյա',
  'մանկական',
  'շոկոլադե',
  'ալյումինե',
  'թղթե',
  'ապակե',
  'դոնդողե',
  'փայտե',
  'մետաղե',
  'ոչ',
  'խմելու',
  'ստանդարտ',
])

/** An adjective or a participle by its ending: «Գազավորված ըմպելիք», «Աշխատանքային ձեռնոց». */
const ADJECTIVE = /(?:ային|ական|ավոր|ված|ած|ող|յան)$/u
/**
 * A noun in the genitive, instrumental or ablative: «Կաղամբի չորաթթու», «Հաց … ցորենից». Its ending is a
 * noun's too — «Ֆրի», «Բուլկի», «սպեղանի» — so such a word is the head where nothing else is.
 */
const CASE = /(?:ի|ով|ից)$/u

// a till's unit after a count: never a word of the name
const UNIT_WORDS = new Set(['կգ', 'գր', 'գ', 'լ', 'մլ', 'հտ', 'հատ', 'հ', 'մ', 'սմ'])

const ARMENIAN = /[ա-ֆԱ-Ֆ]/u
const LATIN = /^[A-Za-z][A-Za-z'&-]*$/u

const keyed = (word: string): string => word.toLowerCase()

/** A word of a name: letters with no digit, not a packaging mark («ա/տ», «թ/տ»), not a code («#0-1»). */
function isNameWord(token: string): boolean {
  return !/\d/u.test(token) && !token.includes('/') && (ARMENIAN.test(token) || LATIN.test(token))
}

/** The tokens of a name: spaces and commas apart, «Գազ.ըմպելիք» at its point, parentheses dropped. */
function tokensOf(text: string): string[] {
  return text
    .replace(/[()]/gu, ' ')
    .split(/[\s,;:]+/u)
    .flatMap((token) => token.split(/(?<=[ա-ֆԱ-Ֆ]\.)(?=[ա-ֆԱ-Ֆ])/u))
    .map((token) => token.replace(/^[^\p{L}\d#№]+|[^\p{L}\d.%]+$/gu, ''))
    .filter((token) => token !== '')
}

const decimal = (figure: string): string => figure.replace('.', ',')

// «130գր», «0.25լ», «250±10գր», «2x40գր», «6լ(հատ)»; a till's «կգ» alone is a line sold by weight
const SIZE =
  /(?<![\d.,])(?:(\d+)\s*[xх×*]\s*)?(\d+(?:[.,]\d+)?)(?:±\d+)?\s*(կգ|գր|գ|մլ|լ)(?![ա-ֆ])/u
const SIZE_UNITS: Readonly<Record<string, string>> = {
  կգ: 'кг',
  գր: 'г',
  գ: 'г',
  մլ: 'мл',
  լ: 'л',
}

export function receiptLineParts(printed: string): ReceiptLineParts {
  const open = printed.indexOf('«')
  const close = open < 0 ? -1 : printed.indexOf('»', open + 1)
  const quoted = open < 0 ? null : printed.slice(open + 1, close < 0 ? undefined : close).trim()
  // «…» a till cut, «22/24» a calibre: no letter, no brand — its text stays a word of the line
  const brand = quoted !== null && /\p{L}/u.test(quoted) ? quoted : null
  const before = tokensOf(open < 0 ? printed : printed.slice(0, open))
  const after = open < 0 || close < 0 ? [] : tokensOf(printed.slice(close + 1))
  const head = brand === null ? [...before, ...after] : before.length > 0 ? before : after
  const words = head.filter(
    (token) => isNameWord(token) && ARMENIAN.test(token) && !token.endsWith('.'),
  )
  const plain = words.filter((word) => !QUALIFIERS.has(keyed(word)) && !ADJECTIVE.test(keyed(word)))
  const kind = plain.find((word) => !CASE.test(keyed(word))) ?? plain[0] ?? words[0] ?? null
  const percent = /(\d+(?:[.,]\d+)?)\s*%/u.exec(printed)?.[1]
  const size = SIZE.exec(printed)
  return {
    before: brand === null ? [...before, ...after] : before,
    brand,
    after: brand === null ? [] : after,
    kind,
    percent: percent === undefined ? null : `${decimal(percent)}%`,
    size:
      size === null
        ? null
        : `${size[1] === undefined ? '' : `${size[1]}×`}${decimal(size[2] ?? '')} ${SIZE_UNITS[size[3] ?? ''] ?? ''}`,
  }
}

// Armenian letters in Russian ones, as a name is spelt across the border: «Ճաշկինո» Чашкино, «Երեմյան»
// Еремян, «Մախեև» Махеев. Pairs are read before letters.
const PAIRS: readonly (readonly [string, string])[] = [
  ['ու', 'у'],
  ['յա', 'я'],
  ['յու', 'ю'],
  ['և', 'ев'],
]
const LETTERS: Readonly<Record<string, string>> = {
  ա: 'а',
  բ: 'б',
  գ: 'г',
  դ: 'д',
  ե: 'е',
  զ: 'з',
  է: 'э',
  ը: 'ы',
  թ: 'т',
  ժ: 'ж',
  ի: 'и',
  լ: 'л',
  խ: 'х',
  ծ: 'ц',
  կ: 'к',
  հ: 'х',
  ձ: 'дз',
  ղ: 'г',
  ճ: 'ч',
  մ: 'м',
  յ: 'й',
  ն: 'н',
  շ: 'ш',
  ո: 'о',
  չ: 'ч',
  պ: 'п',
  ջ: 'дж',
  ռ: 'р',
  ս: 'с',
  վ: 'в',
  տ: 'т',
  ր: 'р',
  ց: 'ц',
  փ: 'п',
  ք: 'к',
  օ: 'о',
  ֆ: 'ф',
}

/** One word's Armenian letters in Russian ones; anything else as it is. A capital stays a capital. */
function spellWord(word: string): string {
  const lower = word.toLowerCase()
  let out = ''
  for (let i = 0; i < lower.length;) {
    const pair = PAIRS.find(([from]) => lower.startsWith(from, i))
    // a word's first «ո» is «во»: «Ոսկեհավ» Воскеав
    const letter = pair?.[1] ?? (i === 0 && lower.startsWith('ո') ? 'во' : LETTERS[lower[i] ?? ''])
    out += letter ?? lower[i] ?? ''
    i += pair?.[0].length ?? 1
  }
  const first = word.slice(0, 1)
  const capital = first !== first.toLowerCase()
  const whole = word.length > 1 && word === word.toUpperCase() && ARMENIAN.test(word)
  if (whole) return out.toUpperCase()
  return capital ? out.charAt(0).toUpperCase() + out.slice(1) : out
}

/** A brand or a word in Russian letters, word by word: «Երեմյան Փրոդաքթս» — «Еремян Продактс». */
export const armenianInRussian = (text: string): string =>
  text.replace(/[ա-ֆԱ-Ֆև]+/gu, (word) => spellWord(word))

/**
 * A word's senses by the dictionary of till words, «креветка/краб» two of them, the first the one a name
 * takes. An abbreviation by its own entry first, «գազ.» — «газированный», then as a word.
 */
function sensesOf(word: string, dictionary: Readonly<Record<string, string>>): string[] {
  // the dictionary keys «և» as one letter, «սև»; a reading may spell it «եվ»
  const spellings = [word, word.replace(/\.$/u, '')].flatMap((one) => {
    const lower = one.toLowerCase()
    return [lower, lower.replace(/եվ/gu, 'և')]
  })
  const gloss = spellings.map((one) => dictionary[one]).find((one) => one !== undefined) ?? ''
  return gloss
    .split('/')
    .map((sense) => sense.replace(/\s*\(.*\)$/u, '').trim())
    .filter((sense) => sense !== '')
}

const glossOf = (word: string, dictionary: Readonly<Record<string, string>>): string | null =>
  sensesOf(word, dictionary)[0] ?? null

/** The name a new item is proposed under, and whether a word of it is spelt in letters (В-4). */
export interface LineName {
  readonly name: string
  readonly spelled: boolean
}

/**
 * A new item's name from the line (MOL-293, В-1 «б»): its words in Russian as printed, the brand in
 * «…» spelt in Russian letters, the fat and the package — «Йогурт «Еремян Продактс» клубника 2% 130 г».
 * A word is the dictionary's exactly, never the nearest: one edit away «լոշիկ» was «помидор». A word the
 * dictionary has not is spelt in letters, and the name says so (`spelled`, В-4 «а»): the review offers it,
 * and one press takes it away. Units, counts and packaging marks are no words of it. `null` with no word.
 */
export function newLineName(
  parts: ReceiptLineParts,
  dictionary: Readonly<Record<string, string>>,
): LineName | null {
  let spelled = false
  const said: string[] = []
  const words = (tokens: readonly string[]): string[] =>
    tokens.flatMap((token) => {
      if (!isNameWord(token) || UNIT_WORDS.has(keyed(token))) return []
      if (LATIN.test(token)) return [token]
      const gloss = glossOf(token, dictionary)
      // an abbreviation the dictionary has not, «անտ.», is no word to spell
      if (gloss === null && token.endsWith('.')) return []
      if (gloss === null) spelled = true
      const word = gloss ?? spellWord(token)
      // «Հավկիթ «Արզնի» հավկիթ» is eggs once, «Կարագ սերուցքային» butter that is creamy once
      const keys = keysOf(word)
      if (keys.length > 0 && keys.every((key) => said.some((one) => sameWord(key, one)))) return []
      said.push(...keys)
      return [word]
    })
  // the kind first, as a shelf names it: «Капуста квашеная», «Напиток газированный»
  const kindAt = parts.kind === null ? -1 : parts.before.indexOf(parts.kind)
  const before =
    kindAt <= 0
      ? parts.before
      : [parts.before[kindAt] ?? '', ...parts.before.filter((_, at) => at !== kindAt)]
  const name = [
    ...words(before),
    ...(parts.brand === null ? [] : [`«${armenianInRussian(parts.brand)}»`]),
    ...words(parts.after),
    ...(parts.percent === null ? [] : [parts.percent]),
    ...(parts.size === null ? [] : [parts.size]),
  ].join(' ')
  if (!/\p{L}/u.test(name)) return null
  return { name: name.charAt(0).toUpperCase() + name.slice(1), spelled }
}

// a preposition or a unit of an item's name asks nothing of the line: «Рулет … с фруктовой начинкой»
const NO_WORD = new Set(['dlia', 'bez'])

/**
 * A name's words by the search key, each its own — «Coca-Cola» is «koka» and «kola» — and its figures
 * whole, «3,2» for «3.2%», «3,2 %» and «3.2»: a fat or a size the line does not print is another item.
 */
function keysOf(text: string): string[] {
  const figures = (text.match(/\d+(?:[.,]\d+)?/gu) ?? []).map((figure) => figure.replace('.', ','))
  const words = toSearchKey(text.replace(/\d+(?:[.,]\d+)?/gu, ' '))
    .split(/[^\p{L}]+/u)
    .filter((key) => key.length > 2 && !NO_WORD.has(key))
  return [...words, ...figures]
}

/**
 * One word of an item found among the line's: the same by the key, one edit from five letters — the
 * search's own tolerance — or a common start that leaves at most two letters of the shorter: Russian
 * endings, «клубника» and «клубничный», «огурцы» and «огурец».
 */
function sameWord(a: string, b: string): boolean {
  if (a === b) return true
  if (/\d/u.test(a) || /\d/u.test(b)) return false
  // the key has no short word, so a word of three letters is whole: «чай», «сок»
  if (Math.min(a.length, b.length) <= 3) return false
  if (Math.min(a.length, b.length) >= 5 && levenshtein(a, b) <= 1) return true
  let common = 0
  while (common < Math.min(a.length, b.length) && a[common] === b[common]) common += 1
  return common >= Math.max(4, Math.min(a.length, b.length) - 2)
}

/**
 * Whether an item may stand on the line (MOL-293, В-1 «а», В-2 «а»): every word of its name is the line's —
 * by the dictionary's Russian, the letters of its Armenian, its figures — so it names no flavour, brand or
 * size the line has not; the line's brand is in its name; and its name says the line's kind, unless all of
 * it is that brand: «Coca-Cola» for «Գազավորված ըմպելիք «Կոկա Կոլա»». A line whose kind the dictionary has
 * not takes nothing but its brand. The line is read once, for every item asked about.
 */
export function lineFitter(
  parts: ReceiptLineParts,
  dictionary: Readonly<Record<string, string>>,
): (itemName: string) => boolean {
  const tokens = [...parts.before, ...(parts.brand === null ? [] : [parts.brand]), ...parts.after]
  const line = [
    ...tokens.flatMap((token) => keysOf(token)),
    ...tokens.flatMap((token) => sensesOf(token, dictionary).flatMap(keysOf)),
    ...keysOf(parts.percent ?? ''),
    ...keysOf(parts.size ?? ''),
  ]
  const brand = keysOf(parts.brand ?? '')
  // any of the kind's senses: «հրուշակեղեն» is pastry and confectionery
  const kinds = parts.kind === null ? [] : sensesOf(parts.kind, dictionary).map(keysOf)
  return (itemName) => {
    const item = keysOf(itemName)
    if (item.length === 0) return false
    if (!item.every((word) => line.some((one) => sameWord(word, one)))) return false
    if (!brand.every((word) => item.some((one) => sameWord(word, one)))) return false
    if (brand.length > 0 && item.every((word) => brand.some((one) => sameWord(word, one))))
      return true
    return kinds.some((kind) => kind.every((word) => item.some((one) => sameWord(word, one))))
  }
}
