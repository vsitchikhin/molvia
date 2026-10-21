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

/**
 * An adjective or a participle by its ending: «Գազավորված ըմպելիք», «Աշխատանքային ձեռնոց». Two letters of a stem
 * at least: «հող», soil, is a noun.
 */
const ADJECTIVE = /^.{2,}(?:ային|ական|ավոր|ված|ած|ող|յան)$/u
// nouns of an adjective's ending: «Խորոված խոզի» is a shashlik of pork, not a pig (adversarial А4)
const NOUNS = new Set(['խորոված'])
/**
 * A noun in the genitive, instrumental or ablative: «Կաղամբի չորաթթու», «Հաց … ցորենից». Its ending is a
 * noun's too — «Ֆրի», «Բուլկի», «սպեղանի» — so such a word is the head where nothing else is.
 */
const CASE = /(?:ի|ով|ից)$/u
/**
 * The genitive of a noun in «-ի», «ազնվամորու մուրաբա» — raspberry jam, never raspberries (review 2, №2): a
 * nominative ends so too, «կատու», «թթու», «լեզու», so such a word is the head before one in a case. «ձու» is
 * too short to be one, «-յու» a loan's own end («քեշյու»).
 */
const SOFT_CASE = /.[^յ]ու$/u
// genitives of no ending a rule could read: of fish, of a pomegranate, of a lamb, of a dog
const GENITIVES = new Set(['ձկան', 'ձողաձկան', 'նռան', 'գառան', 'շան'])
const inSoftCase = (word: string): boolean => SOFT_CASE.test(word) || GENITIVES.has(word)

// a till's unit after a count: never a word of the name
const UNIT_WORDS = new Set(['կգ', 'գր', 'գ', 'լ', 'մլ', 'հտ', 'հատ', 'հ', 'մ', 'սմ'])

const ARMENIAN = /[ա-ֆԱ-Ֆ]/u
const LATIN = /^[A-Za-z][A-Za-z'&-]*$/u

const keyed = (word: string): string => word.toLowerCase()

/** A word of a name: letters with no digit, not a packaging mark («ա/տ», «թ/տ»), not a code («#0-1»). */
function isNameWord(token: string): boolean {
  // a lone «x» is a pack's count, «x 24»; any other Latin letter is a size, «M», and a word (review 2, №3)
  const latin = LATIN.test(token) && !/^[xX]$/u.test(token)
  return !/\d/u.test(token) && !token.includes('/') && (ARMENIAN.test(token) || latin)
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
  const before = tokensOf(brand === null ? printed.replace(/[«»]/gu, ' ') : printed.slice(0, open))
  const after = brand === null || close < 0 ? [] : tokensOf(printed.slice(close + 1))
  const head = brand === null ? [...before, ...after] : before.length > 0 ? before : after
  const words = head.filter(
    (token) =>
      isNameWord(token) &&
      ARMENIAN.test(token) &&
      !token.endsWith('.') &&
      !UNIT_WORDS.has(keyed(token)),
  )
  const plain = words.filter(
    (word) =>
      NOUNS.has(keyed(word)) || (!QUALIFIERS.has(keyed(word)) && !ADJECTIVE.test(keyed(word))),
  )
  // a capital past the first word on a line of small letters is a name — a sort, a brand printed bare: the kind
  // only where nothing else is, «Լեզու տավարի Արցախ» is a tongue (adversarial Г3)
  const named = (word: string): boolean => hasSmall(head) && words.indexOf(word) > 0 && titled(word)
  const kind =
    plain.find((word) => !CASE.test(keyed(word)) && !inSoftCase(keyed(word)) && !named(word)) ??
    plain.find((word) => !CASE.test(keyed(word)) && !named(word)) ??
    plain.find((word) => !CASE.test(keyed(word))) ??
    plain[0] ??
    words[0] ??
    null
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
  // «և» spelt as of old, «Երեւան» (review 5, Д1)
  ['եւ', 'ев'],
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
  // a lone «ւ» is «ու» Tesseract broke: «կլւոոր»
  ւ: 'у',
}

/**
 * One word's Armenian letters in Russian ones; anything else as it is. A capital stays a capital; a word all in
 * capitals stays so in a brand («ԳԵԳ») and an abbreviation (`capitals`), and is a word like any other in a name
 * («ԸՆԴԱԼԹ», review №5).
 */
function spellWord(word: string, capitals = true): string {
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
  if (whole) return capitals ? out.toUpperCase() : out
  return capital ? out.charAt(0).toUpperCase() + out.slice(1) : out
}

/** A line printed in capitals all through says nothing by them: «ԴԱՐԱՆ ԿԼԵՅ». */
/**
 * A capital says a name only on a line the till printed a small first letter in, a unit's included — «Բանան
 * Սաբրոսթար կգ» is a sort; in «Ազնվամորու Մուրաբա», every word a capital, it says nothing (review 5, №1).
 */
const hasSmall = (tokens: readonly string[]): boolean =>
  tokens.some((token) => {
    const first = token.slice(0, 1)
    return ARMENIAN.test(first) && first !== first.toUpperCase()
  })

/** A word with a capital and small letters after it, «Արցախ»: «ԱՐՑԱԽ» in capitals is shouted, never a name. */
const titled = (word: string): boolean => {
  const first = word.slice(0, 1)
  const rest = word.slice(1)
  return first !== first.toLowerCase() && rest !== rest.toUpperCase()
}

const shouting = (parts: ReceiptLineParts): boolean =>
  [...parts.before, ...parts.after].every(
    (token) => !ARMENIAN.test(token) || token === token.toUpperCase(),
  )

/** A word in capitals of up to four letters is an abbreviation on a line of small ones: «ԱԱ», «ԳՕՍՏ» (review 2, №3). */
const ABBREVIATION = 4

/** A brand or a word in Russian letters, word by word: «Երեմյան Փրոդաքթս» — «Еремян Продактс». */
export const armenianInRussian = (text: string): string =>
  text.replace(/[ա-ֆԱ-Ֆև]+/gu, (word) => spellWord(word))

/**
 * A word's senses by the dictionary of till words, «креветка/краб» two of them, the first the one a name
 * takes. An abbreviation by its own entry first, «գազ.» — «газированный», then as a word.
 */
function sensesOf(word: string, dictionary: Readonly<Record<string, string>>): string[] {
  // the dictionary keys «և» as one letter, «սև»; a reading may spell it «եվ», or «եւ», as of old (review 5, Д1)
  const spellings = [word, word.replace(/\.$/u, '')].flatMap((one) => {
    const lower = one.toLowerCase()
    return [lower, lower.replace(/եվ|եւ/gu, 'և')]
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
      const word = gloss ?? spellWord(token, !shouting(parts) && token.length <= ABBREVIATION)
      // «Հավկիթ «Արզնի» հավկիթ» is eggs once, «Կարագ սերուցքային» butter that is creamy once
      const own = wordsOf(word)
      if (own.length > 0 && own.every((one) => said.some((was) => sameRussian(one, was)))) return []
      said.push(...own)
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

// a preposition of an item's name asks nothing of the line: «Рулет … с фруктовой начинкой»
const NO_WORD = new Set(['для', 'без', 'из', 'на', 'по', 'со', 'во'])

/** A name's words, lower case, «ё» as «е»: Cyrillic, Latin and Armenian alike, figures apart. */
const wordsOf = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/ё/gu, 'е')
    .split(/[^\p{L}]+/u)
    .filter((word) => word.length > 2 && !NO_WORD.has(word))

const ADJECTIVE_ENDINGS = [
  'ый',
  'ий',
  'ой',
  'ая',
  'яя',
  'ое',
  'ее',
  'ые',
  'ие',
  'ого',
  'его',
  'ому',
  'ему',
  'ым',
  'им',
  'ую',
  'юю',
  'ых',
  'их',
  'ыми',
  'ими',
]
const NOUN_ENDINGS = [
  'а',
  'у',
  'е',
  'ом',
  'ой',
  'ы',
  'и',
  'ов',
  'ам',
  'ами',
  'ах',
  'ю',
  'ей',
  'ем',
  'я',
]

/**
 * A Russian word's forms an item may name it by: an adjective in any gender, number and case — «сливочное»,
 * «сливочный»; a noun in any number and case — «огурец», «огурцы»; «яйцо», «яйца»; «шиповник», «шиповника»;
 * and the adjective a noun makes — «оливки», «оливковый»; «шоколад», «шоколадный»; «молоко», «молочный».
 * Nothing else: a common start found «Пастила» for a toothpaste and «Печенье» for a liver (adversarial А1, А3).
 */
function formsOf(word: string): Set<string> {
  const out = new Set([word])
  const adjective = ADJECTIVE_ENDINGS.filter(
    (one) => word.endsWith(one) && word.length > one.length + 2,
  )
    .sort((a, b) => b.length - a.length)
    .at(0)
  if (adjective !== undefined) {
    for (const one of ADJECTIVE_ENDINGS) out.add(word.slice(0, -adjective.length) + one)
    return out
  }
  // the stem: less its last vowel or soft sign, «ец» and «ок» losing their vowel — «огурц», «сырк»
  const stems = /[аяоеиыйь]$/u.test(word)
    ? [word.slice(0, -1)]
    : word.endsWith('ец') || word.endsWith('ок')
      ? [word, `${word.slice(0, -2)}${word.slice(-1)}`]
      : [word]
  // «-ой» is a feminine's case alone: «рыбой», never «сыр» — «сырой» is raw
  const endings = /[ая]$/u.test(word) ? NOUN_ENDINGS : NOUN_ENDINGS.filter((one) => one !== 'ой')
  for (const stem of stems) {
    if (stem.length < 3) continue
    for (const one of endings) out.add(stem + one)
  }
  // the adjective of a noun: «оливк» — «оливков», «шоколад» — «шоколадн», «молок» — «молочн»
  const root = stems[0] ?? word
  const roots = [root, ...(root.endsWith('к') ? [`${root.slice(0, -1)}ч`] : [])]
  for (const one of roots) {
    if (one.length < 3) continue
    for (const suffix of ['н', 'ов', 'ев']) {
      for (const ending of ADJECTIVE_ENDINGS) out.add(one + suffix + ending)
    }
  }
  return out
}

/** Two Russian words one word by its forms, either way. */
const sameRussian = (a: string, b: string): boolean => formsOf(a).has(b) || formsOf(b).has(a)

/**
 * Two names one by their letters — a brand, a word of no dictionary spelt across scripts: the same by the
 * search key, or one edit from five letters («Pringles», «Принглс»; «Пейпер», «Փեյփր»). Never a common start:
 * «паста» and «пастила» are two edits.
 */
function sameLetters(a: string, b: string): boolean {
  const [x, y] = [toSearchKey(a), toSearchKey(b)]
  if (x === y) return true
  return Math.min(x.length, y.length) >= 5 && levenshtein(x, y) <= 1
}

const HY_UNITS: Readonly<Record<string, string>> = {
  գր: 'г',
  գ: 'г',
  կգ: 'кг',
  մլ: 'мл',
  լ: 'л',
  հտ: 'шт',
  հատ: 'шт',
  միկրոն: 'мкм',
  միկր: 'мкм',
  սմ: 'см',
  մ: 'м',
}
const RU_UNITS = new Set(['г', 'гр', 'кг', 'мл', 'л', 'шт', 'мкм', 'см', 'м'])

/**
 * The figures of a text with their units, «2,5%», «130г», «1л»: a fat is never a litre (adversarial А5). A
 * figure with no unit stands alone.
 */
function figuresOf(text: string): string[] {
  const out: string[] = []
  for (const found of text.matchAll(/(\d+(?:[.,]\d+)?)\s*(%|[\p{L}]+)?/gu)) {
    const figure = (found[1] ?? '').replace('.', ',')
    const unit = (found[2] ?? '').toLowerCase()
    const named = unit === '%' ? '%' : (HY_UNITS[unit] ?? (RU_UNITS.has(unit) ? unit : ''))
    out.push(`${figure}${named === 'гр' ? 'г' : named}`)
  }
  return out
}

// a dictionary's adjective is masculine or feminine, «средний», «докторская»; «мороженое» is a thing
const QUALITY_ENDINGS = ['ый', 'ий', 'ой', 'ая', 'яя']

/**
 * Latin a till prints for a standard or a size, never a thing (adversarial Г2): a list, since a brand has the same
 * form — «MARS», «LAYS» are things (review 5, №2).
 */
const STANDARDS = new Set([
  'UHT',
  'LED',
  'USB',
  'HD',
  'AA',
  'AAA',
  'XS',
  'S',
  'M',
  'L',
  'XL',
  'XXL',
  'XXXL',
])

/**
 * A gloss names a thing, not a quality: «таблетки», «мороженое», «пастила фруктовая» — a word of it no adjective
 * (adversarial В2) — never «средний», «без запаха».
 */
function isThingSense(sense: string): boolean {
  const words = sense.toLowerCase().split(/\s+/u)
  return (
    !NO_WORD.has(words[0] ?? '') &&
    words.some((word) => !QUALITY_ENDINGS.some((ending) => word.endsWith(ending)))
  )
}

/**
 * The thing printed right after the kind with no case of its own, «Ելակ յոգուրտ»: of two things side by side
 * a till does not say which the line is — a yoghurt of strawberries, or strawberries — so an item must say
 * both (adversarial Б1). A word the dictionary has not is a name where a capital says so on a line of small
 * Armenian letters, «Բանան Սաբրոսթար», a sort; else a thing it does not know, «Ելակ սմուզի», «Ելակ Smoothie»
 * (adversarial В1).
 */
function nextThing(
  parts: ReceiptLineParts,
  dictionary: Readonly<Record<string, string>>,
): string | null {
  const at = parts.kind === null ? -1 : parts.before.indexOf(parts.kind)
  const next = at < 0 ? undefined : parts.before[at + 1]
  if (next === undefined || !isNameWord(next) || next.endsWith('.')) return null
  const key = keyed(next)
  const sense = sensesOf(next, dictionary)[0]
  // «-ի» and «-ու» end a loan as well as a genitive, «սմուզի»: a case only of a word the dictionary has
  const qualifies =
    UNIT_WORDS.has(key) ||
    QUALIFIERS.has(key) ||
    ADJECTIVE.test(key) ||
    /(?:ով|ից)$/u.test(key) ||
    (sense !== undefined && (CASE.test(key) || inSoftCase(key)))
  if (qualifies) return null
  if (sense !== undefined) return isThingSense(sense) ? next : null
  if (STANDARDS.has(next)) return null
  // Latin is capitalised, a brand and a word alike: «Ելակ Smoothie» is a thing
  return ARMENIAN.test(next) && titled(next) && hasSmall([...parts.before, ...parts.after])
    ? null
    : next
}

/** Whether a fitter takes an item of the seed: the seed names no brand, so it takes no branded line. */
export interface FitOptions {
  /** The item is the seed's own — a kind, never a brand: «Бекон», «Энергетик». */
  readonly generic?: boolean
}

/**
 * Whether an item may stand on the line (MOL-293, В-1 «а», В-2 «а»): every word of its name is the line's —
 * by a form of the dictionary's Russian, or by its letters where the line spells it — and every figure with
 * its unit, so it names no flavour, brand, fat or size the line has not; the line's brand is in its name; and
 * its name says the line's kind, unless all of it is that brand: «Coca-Cola» for «Գազավորված ըմպելիք «Կոկա
 * Կոլա»». An item of the seed is a kind, and takes no branded line. A line whose kind the dictionary has not
 * takes nothing but its brand. The line is read once, for every item asked about.
 */
export function lineFitter(
  parts: ReceiptLineParts,
  dictionary: Readonly<Record<string, string>>,
): (itemName: string, options?: FitOptions) => boolean {
  const tokens = [...parts.before, ...(parts.brand === null ? [] : [parts.brand]), ...parts.after]
  const glossed = tokens.flatMap((token) => sensesOf(token, dictionary).flatMap(wordsOf))
  const spelt = tokens.flatMap(wordsOf)
  const figures = [
    ...tokens.flatMap(figuresOf),
    ...figuresOf(parts.percent ?? ''),
    ...figuresOf(parts.size ?? ''),
  ]
  const brand = wordsOf(parts.brand ?? '')
  // any of the kind's senses: «հրուշակեղեն» is pastry and confectionery
  const kinds = parts.kind === null ? [] : sensesOf(parts.kind, dictionary).map(wordsOf)
  const next = nextThing(parts, dictionary)
  const nexts = next === null ? [] : sensesOf(next, dictionary).map(wordsOf)
  // a thing the dictionary has not is said by its letters: «Смузи» for «սմուզի»
  const saysNext = (item: readonly string[]): boolean =>
    next === null ||
    (nexts.length > 0 ? says(nexts, item) : item.some((one) => sameLetters(next, one)))
  const says = (senses: readonly (readonly string[])[], item: readonly string[]): boolean =>
    senses.some(
      (sense) =>
        sense.length > 0 && sense.every((word) => item.some((one) => sameRussian(word, one))),
    )
  const lineHas = (word: string): boolean =>
    glossed.some((one) => sameRussian(word, one)) || spelt.some((one) => sameLetters(word, one))
  return (itemName, options = {}) => {
    const item = wordsOf(itemName)
    if (item.length === 0) return false
    if (parts.brand !== null && options.generic === true) return false
    if (!item.every(lineHas)) return false
    if (!figuresOf(itemName).every((figure) => figures.includes(figure))) return false
    if (!brand.every((word) => item.some((one) => sameLetters(word, one)))) return false
    if (brand.length > 0 && item.every((word) => brand.some((one) => sameLetters(word, one))))
      return true
    return says(kinds, item) && saysNext(item)
  }
}

// what a word of the till's language takes on the end of a seed's: a plural, a case, a collective —
// «կոնֆետներ», «հրուշակեղեն»; any other end is another word, «տուշ» is no «տուշոնկա» (adversarial Б3)
const ENDINGS = ['ներ', 'եր', 'ի', 'ու', 'ը', 'ն', 'ով', 'ից', 'եղեն']

/**
 * A word of the line as a word of a seed's name in the till's language: the same, the one inflected past the
 * other, or — a word the dictionary has not, from four letters — the name's word with one letter lost, as
 * Tesseract and the model lose one: «Կոլասա» is «կոլբասա» (adversarial Б4). A letter misread is not forgiven,
 * «Ռոլիկ» is no «լոլիկ», nor a word the dictionary has: «լոշիկ» is a flat bread.
 */
function sameArmenian(
  printed: string,
  word: string,
  dictionary: Readonly<Record<string, string>>,
): boolean {
  const line = printed.toLowerCase().replace(/և|եւ/gu, 'եվ')
  if (line === word) return true
  const [short, long] = line.length < word.length ? [line, word] : [word, line]
  if (short.length >= 3 && long.startsWith(short) && ENDINGS.includes(long.slice(short.length)))
    return true
  return (
    line.length >= 4 &&
    line.length === word.length - 1 &&
    sensesOf(printed, dictionary).length === 0 &&
    levenshtein(line, word) === 1
  )
}

/**
 * Whether a name of the seed in the till's language says the line's kind (MOL-293): the names path matches
 * the catalogue's own Armenian name, whose Russian one the dictionary need not know — «Ատամի պաստա» is
 * «Паста зубная» by the seed's word, not the gloss. A branded line takes no name of the seed, and a line of
 * two things side by side one that says both.
 */
export function seedNameFits(
  parts: ReceiptLineParts,
  nameWords: readonly string[],
  dictionary: Readonly<Record<string, string>>,
): boolean {
  if (parts.brand !== null || parts.kind === null) return false
  // «Կուս-կուս», «Բալզամ-ողողիչ»: the names are matched hyphen apart
  const says = (printed: string): boolean =>
    printed
      .split('-')
      .filter((piece) => piece !== '')
      .every((piece) => nameWords.some((word) => sameArmenian(piece, word, dictionary)))
  const next = nextThing(parts, dictionary)
  return says(parts.kind) && (next === null || says(next))
}
