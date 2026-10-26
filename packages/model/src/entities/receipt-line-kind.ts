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
  // a unit is small however the till writes its words, «Ազնվամորու Մուրաբա կգ» (review 6, №1)
  const small = hasSmall(head.filter((token) => !UNIT_WORDS.has(keyed(token))))
  const named = (word: string): boolean => small && words.indexOf(word) > 0 && titled(word)
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
  // a Russian brand's «-ое», «Ալեքսեևսկոյե» Алексеевское (MOL-261)
  ['ոյե', 'ое'],
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

/**
 * A capital says a name only on a line the till printed a small first letter in: in «Ազնվամորու Մուրաբա», every
 * word a capital, it says nothing (review 5, №1). A unit's counts for a sort after the kind — «Բանան Սաբրոսթար կգ» —
 * never for the kind itself, which a genitive must not take (review 6, №1).
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

/** A line printed in capitals all through says nothing by them: «ԴԱՐԱՆ ԿԼԵՅ». */
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
 * What a new item's name is written with beyond the till's words (MOL-261). Each part is the backend's
 * dictionary, as the till's words are; without one the name is as MOL-293 made it.
 */
export interface NameLexicon {
  /**
   * A brand or a product line as the till prints it, lower case, «և» one letter, to how its package spells it:
   * «կոկա կոլա» Coca-Cola, «լովիտա» Lovita, «ալյոնկա» Алёнка (owner's В-2 «а»).
   */
  readonly brands?: Readonly<Record<string, string>>
  /**
   * The seed's items with their names in the till's language (the catalogue's nodes): a new item is of the kind
   * of one of them, and is named so — «Желудки куриные «Аштарак»», «Яйца «Воскеат»» — so that `kindKey` of the
   * two is one and «Тут дешевле» reads them as one kind.
   */
  readonly seed?: readonly SeedName[]
  /**
   * A till's word in the genitive as an adjective, «լոլիկի» «томатный» (Т-4): keyed by the genitive itself, since
   * «-ի» ends a nominative as often.
   */
  readonly genitives?: Readonly<Record<string, string>>
}

/** An item of the seed: its name and its names in the till's language. */
export interface SeedName {
  readonly name: string
  readonly names: readonly string[]
}

const lexiconKey = (text: string): string =>
  text.toLowerCase().replace(/եվ|եւ/gu, 'և').replace(/\s+/gu, ' ').trim()

// a package's spelling in Latin letters is written bare, as the shelf writes it: «Печенье Roshen Lovita»
const LATIN_NAME = /^[\p{Script=Latin}\d\s'&.-]+$/u

/** The package's spelling of a brand or a line the lexicon knows, else none. */
const shelfOf = (text: string, lexicon: NameLexicon): string | null =>
  lexicon.brands?.[lexiconKey(text)] ?? null

/**
 * A brand as a name writes it (MOL-261, owner's В-2 «а»): the package's spelling, a Latin one with no quotes —
 * «Coca-Cola», «Roshen» — a Cyrillic one in «…»; a brand the lexicon has not, in Russian letters in «…».
 */
function brandInName(brand: string, lexicon: NameLexicon): string {
  const shelf = shelfOf(brand, lexicon)
  if (shelf === null) return `«${armenianInRussian(brand)}»`
  return LATIN_NAME.test(shelf) ? shelf : `«${shelf}»`
}

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
  lexicon: NameLexicon = {},
): LineName | null {
  let spelled = false
  const kindOf = seedKindOf(parts, dictionary, lexicon.seed ?? [])
  // the seed's words the name begins with stand for what they covered: «Желудки куриные» for «հավի … քարաճիկ»
  const said: string[] = kindOf === null ? [] : wordsOf(kindOf.name)
  const covered = kindOf?.covered ?? new Set<string>()

  // a word of the name, with where its token stood on the line and whether it was the kind
  interface Said {
    readonly word: string
    readonly at: number
    readonly kind: boolean
  }

  // a product line of two words is the lexicon's before either of them: «Արտ Բեյքրի» Art Bakery
  const lines = (tokens: readonly (readonly [string, number])[]): (readonly [string, number])[] =>
    tokens.flatMap(([token, at], i) => {
      const pair = `${tokens[i - 1]?.[0] ?? ''} ${token}`
      if (i > 0 && shelfOf(pair, lexicon) !== null) return []
      const next = `${token} ${tokens[i + 1]?.[0] ?? ''}`
      if (i + 1 < tokens.length && shelfOf(next, lexicon) !== null) return [[next, at] as const]
      return [[token, at] as const]
    })

  const words = (tokens: readonly (readonly [string, number])[]): Said[] =>
    lines(tokens).flatMap(([token, at]): Said[] => {
      const kind = token === parts.kind
      // what the seed's name stands for
      if (covered.has(token)) return []
      const shelf = shelfOf(token, lexicon)
      if (shelf !== null) return [{ word: shelf, at, kind }]
      if (!isNameWord(token) || UNIT_WORDS.has(keyed(token))) return []
      if (LATIN.test(token)) return [{ word: token, at, kind }]
      const genitive = kind ? undefined : lexicon.genitives?.[lexiconKey(token)]
      const gloss = genitive ?? asSeedSays(glossOf(token, dictionary), kind, lexicon.seed ?? [])
      // an abbreviation the dictionary has not, «անտ.», is no word to spell
      if (gloss === null && token.endsWith('.')) return []
      if (gloss === null) spelled = true
      const word = gloss ?? spellWord(token, !shouting(parts) && token.length <= ABBREVIATION)
      // «Հավկիթ «Արզնի» հավկիթ» is eggs once, «Կարագ սերուցքային» butter that is creamy once
      const own = wordsOf(word)
      if (own.length > 0 && own.every((one) => said.some((was) => sameRussian(one, was)))) return []
      said.push(...own)
      return [{ word, at, kind }]
    })
  const indexed = (tokens: readonly string[]): (readonly [string, number])[] =>
    tokens.map((token, at) => [token, at] as const)
  // the kind first, as a shelf names it: «Капуста квашеная», «Напиток газированный» — the seed's name in its
  // place where it stands for the kind; read first, so that what it says is not said again
  const kindAt = parts.kind === null ? -1 : parts.before.indexOf(parts.kind)
  const before = indexed(parts.before)
  const kindFirst =
    kindAt < 0 ? before : [before[kindAt] ?? ['', 0], ...before.filter((_, at) => at !== kindAt)]
  const beforeSaid = words(kindFirst)
  const afterSaid = words(indexed(parts.after))
  const head =
    kindOf?.name ??
    [...beforeSaid, ...afterSaid].find((one) => one.kind)?.word ??
    beforeSaid[0]?.word ??
    ''
  // an Armenian adjective stands before its noun: it agrees with the next noun the line printed, else the head;
  // past the kind a till lists what qualifies the kind, «Երշիկ հում-ապխտած չորիզո» is a sausage, raw-smoked
  const agreed = (segment: readonly Said[], kindAt: number): string[] => {
    const inOrder = [...segment].sort((a, b) => a.at - b.at)
    return segment.map((one) => {
      if (!isAdjective(one.word)) return one.word
      if (kindAt >= 0 && one.at > kindAt) return agreeing(one.word, head)
      const noun = inOrder.find((other) => other.at > one.at && (other.kind || isNoun(other.word)))
      return agreeing(one.word, noun?.word ?? head)
    })
  }
  const name = [
    ...(kindOf === null ? [] : [kindOf.name]),
    ...agreed(beforeSaid, kindAt),
    ...(parts.brand === null ? [] : [brandInName(parts.brand, lexicon)]),
    ...agreed(afterSaid, -1),
    ...(parts.percent === null ? [] : [parts.percent]),
    ...(parts.size === null ? [] : [parts.size]),
  ].join(' ')
  if (!/\p{L}/u.test(name)) return null
  return { name: name.charAt(0).toUpperCase() + name.slice(1), spelled }
}

/** A Russian noun's gender or plural, which an adjective agrees with. */
type Agreement = 'masculine' | 'feminine' | 'neuter' | 'plural'

// nouns of a soft sign, by their gender: no ending tells «соль» from «картофель»
const FEMININE_SOFT = new Set([
  'соль',
  'морковь',
  'фасоль',
  'смесь',
  'мазь',
  'сельдь',
  'печень',
  'зелень',
  'вермишель',
  'тушь',
  'нить',
  'ткань',
  'кисть',
  'форель',
  'ваниль',
  'обувь',
  'постель',
  'часть',
])
const MASCULINE_SOFT = new Set([
  'картофель',
  'кисель',
  'миндаль',
  'щавель',
  'имбирь',
  'уголь',
  'пельмень',
  'шампунь',
  'гель',
  'лосось',
  'окунь',
  'ячмень',
])
// nouns of no ending of their own: «кофе» is masculine, «киви» and «чили» one fruit
const INDECLINABLE: Readonly<Record<string, Agreement>> = {
  кофе: 'masculine',
  фри: 'masculine',
  киви: 'masculine',
  чили: 'masculine',
  мини: 'masculine',
}
// plurals in «-а», «-я», never a feminine: «Яйца куриные», «Семена тыквенные»
const PLURAL_A = new Set(['яйца', 'семена', 'бедра', 'крылья', 'окорока', 'перья'])
// nouns of an adjective's ending, never agreed: «Пакет … алюминий» is no adjective
const NOT_ADJECTIVES = new Set(['алюминий', 'магний', 'кальций', 'натрий', 'калий', 'гербарий'])
// the possessive adjectives, «говяжья», «рыбье»: their ending keeps a soft sign
const POSSESSIVE = new Set([
  'говяжий',
  'рыбий',
  'козий',
  'овечий',
  'бараний',
  'кошачий',
  'собачий',
  'птичий',
])

const lowerRussian = (word: string): string => word.toLowerCase().replace(/ё/gu, 'е')

/** A word a dictionary gives as an adjective, in the masculine: «мелкий», «сгущённый», «пищевой». */
const isAdjective = (word: string): boolean =>
  /^[а-яё-]{5,}$/iu.test(word) &&
  /(?:ый|ий|ой)$/u.test(word) &&
  !NOT_ADJECTIVES.has(lowerRussian(word))

/** A word that may be the noun an adjective agrees with: Russian letters, no adjective's ending, no preposition. */
const isNoun = (word: string): boolean => {
  const first = lowerRussian(word.split(' ')[0] ?? '')
  return (
    /^[а-я-]+$/u.test(first) &&
    !/(?:ый|ий|ой|ая|яя|ое|ее|ые|ие)$/u.test(first) &&
    !['с', 'со', 'для', 'на', 'в', 'во', 'из', 'без', 'по'].includes(first)
  )
}

/**
 * The gender or number of a Russian noun by its ending (MOL-261, Т-3), the first word of a gloss that is not
 * an adjective's — «целлофановый пакет» is a «пакет»; none where the ending does not say.
 */
function agreementOf(noun: string): Agreement | null {
  const words = noun.split(' ').map(lowerRussian)
  // an adjective of the gloss already agreed says it: «кондитерские изделия», «растительное масло»
  const [first = ''] = words
  if (/^[а-я-]{4,}(?:ые|ие)$/u.test(first)) return 'plural'
  if (/^[а-я-]{4,}(?:ое|ее)$/u.test(first) && words.length > 1) return 'neuter'
  if (/^[а-я-]{4,}(?:ая|яя)$/u.test(first) && words.length > 1) return 'feminine'
  const word = words.find((one) => !/(?:ый|ий|ой|ая|яя|ое|ее|ые|ие)$/u.test(one)) ?? first
  if (!/^[а-я-]+$/u.test(word)) return null
  if (PLURAL_A.has(word)) return 'plural'
  const indeclinable = INDECLINABLE[word]
  if (indeclinable !== undefined) return indeclinable
  // a head that is an adjective's noun keeps its own: «Мороженое», «Пирожное»
  if (/(?:ое|ее)$/u.test(word)) return 'neuter'
  if (/(?:ая|яя)$/u.test(word)) return 'feminine'
  if (/(?:ые|ие)$/u.test(word)) return 'plural'
  if (/(?:ий|й)$/u.test(word)) return 'masculine'
  if (/[ыи]$/u.test(word)) return 'plural'
  if (/[ая]$/u.test(word)) return 'feminine'
  if (/[оеё]$/u.test(word)) return 'neuter'
  if (word.endsWith('ь')) {
    if (FEMININE_SOFT.has(word)) return 'feminine'
    return MASCULINE_SOFT.has(word) ? 'masculine' : null
  }
  return 'masculine'
}

/**
 * An adjective of the dictionary, given in the masculine, in the gender or number of its noun (MOL-261, Т-3):
 * «Соль мелкая», «Желудки … свежие», «Мороженое … пломбирное». A noun whose gender no ending tells leaves it
 * as the dictionary has it, as before.
 */
function agreeing(adjective: string, noun: string): string {
  const to = agreementOf(noun)
  const found = /^(.*?)(ый|ий|ой)$/u.exec(adjective)
  if (to === null || to === 'masculine' || found === null) return adjective
  const [, stem = '', ending = ''] = found
  if (POSSESSIVE.has(lowerRussian(adjective))) {
    return stem + { feminine: 'ья', neuter: 'ье', plural: 'ьи' }[to]
  }
  const last = lowerRussian(stem.slice(-1))
  const velar = 'гкх'.includes(last)
  const hushing = 'жшчщ'.includes(last)
  const soft = ending === 'ий' && !velar && !hushing
  if (to === 'feminine') return stem + (soft ? 'яя' : 'ая')
  if (to === 'neuter') return stem + (soft || (hushing && ending === 'ий') ? 'ее' : 'ое')
  return stem + (soft || velar || hushing ? 'ие' : 'ые')
}

/** The seed's item a new one is of the kind of, and the line's tokens its name in the till's language covers. */
interface SeedKind {
  readonly name: string
  readonly covered: ReadonlySet<string>
}

/**
 * The seed's item whose name in the till's language says the line's kind (MOL-261, Т-2) — by `seedNameFits`'s
 * rule but on a branded line too, since a name may begin with a kind the line's brand is of — and has every word
 * of it in the line: the one that covers most of the line, else the shorter name. Its head word must be the
 * kind's gloss in some form — else the seed reads the line its own way, «Лимонад» for «газированный напиток»,
 * «Пломбир» for an ice cream — or the dictionary have none. A name that covers more than the kind stands for the
 * kind, its figures apart, and for every word it covered where it has as many words — «Желудки куриные» for
 * «հավի … քարաճիկ», «Рис круглозёрный» for «բրինձ կլոր». With fewer the seed lumps, and the other words are
 * said: «Кофе» for «սուրճ աղացած» leaves «молотый». One that covers the kind alone says only the word of the
 * kind, and only where the dictionary has none: else the gloss is the line's own word, in the seed's number
 * (`asSeedSays`).
 */
function seedKindOf(
  parts: ReceiptLineParts,
  dictionary: Readonly<Record<string, string>>,
  seed: readonly SeedName[],
): SeedKind | null {
  if (parts.kind === null || seed.length === 0) return null
  const tokens = [...parts.before, ...parts.after].filter(
    (token) => isNameWord(token) && ARMENIAN.test(token),
  )
  let best: { name: string; covered: Set<string> } | null = null
  for (const item of seed) {
    for (const name of item.names) {
      const nameWords = name
        .toLowerCase()
        .split(/[^ա-ֆև-]+/u)
        .filter((word) => word.length >= 2)
      if (nameWords.length === 0 || !saysKind(parts, nameWords, dictionary)) continue
      const covered = new Set(
        tokens.filter((token) => nameWords.some((word) => sameArmenian(token, word, dictionary))),
      )
      if (!nameWords.every((word) => tokens.some((token) => sameArmenian(token, word, dictionary))))
        continue
      const russian = item.name.replace(/\s+\d.*$/u, '')
      if (
        best === null ||
        covered.size > best.covered.size ||
        (covered.size === best.covered.size && russian.length < best.name.length)
      )
        best = { name: russian, covered }
    }
  }
  if (best === null) return null
  const head = best.name.split(' ')[0] ?? best.name
  const gloss = glossOf(parts.kind, dictionary)
  if (gloss === null) return { name: head, covered: new Set([parts.kind]) }
  const glossHead = (gloss.split(' ')[0] ?? '').toLowerCase().replace(/ё/gu, 'е')
  if (!sameRussian(glossHead, head.toLowerCase().replace(/ё/gu, 'е'))) return null
  if (best.covered.size === 1) return null
  const all = wordsOf(best.name).length >= best.covered.size
  return { name: best.name, covered: all ? best.covered : new Set([parts.kind]) }
}

/**
 * The kind's gloss in the form the seed names that kind by, its number: «яйцо» is the seed's «Яйца», «шампиньон»
 * its «Шампиньоны» (MOL-261, Т-2). Only the head word, only for the line's kind, only a form of the same word.
 */
function asSeedSays(
  gloss: string | null,
  isKind: boolean,
  seed: readonly SeedName[],
): string | null {
  if (gloss === null || !isKind) return gloss
  const [head, ...rest] = gloss.split(' ')
  if (head === undefined) return gloss
  const key = head.toLowerCase().replace(/ё/gu, 'е')
  const form = seed
    .map((item) => (item.name.split(' ')[0] ?? '').toLowerCase())
    .find((first) => first !== key && sameRussian(key, first.replace(/ё/gu, 'е')))
  return form === undefined ? gloss : [form, ...rest].join(' ')
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
 * form — «MARS», «LAYS» are things (review 5, №2). «ICE», «ZERO» are not in it: they change the thing, a cold tea, a
 * beer with no alcohol (review 7).
 */
const STANDARDS = new Set([
  'BIO',
  'ECO',
  'MIX',
  'PET',
  'MINI',
  'MAX',
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
  lexicon: NameLexicon = {},
): (itemName: string, options?: FitOptions) => boolean {
  const tokens = [...parts.before, ...(parts.brand === null ? [] : [parts.brand]), ...parts.after]
  const glossed = tokens.flatMap((token) => sensesOf(token, dictionary).flatMap(wordsOf))
  // a brand or a line the lexicon knows is the line's in its package's spelling too: «Կինդեր» is Kinder
  const shelves = [...tokens, ...tokens.slice(1).map((token, at) => `${tokens[at] ?? ''} ${token}`)]
    .map((token) => shelfOf(token, lexicon))
    .filter((shelf): shelf is string => shelf !== null)
  const spelt = [...tokens, ...shelves].flatMap(wordsOf)
  const figures = [
    ...tokens.flatMap(figuresOf),
    ...figuresOf(parts.percent ?? ''),
    ...figuresOf(parts.size ?? ''),
  ]
  const brand = wordsOf(parts.brand ?? '')
  const shelfBrand = wordsOf(parts.brand === null ? '' : (shelfOf(parts.brand, lexicon) ?? ''))
  const brands = shelfBrand.length > 0 ? [brand, shelfBrand] : [brand]
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
    const named = brands.find((one) =>
      one.every((word) => item.some((other) => sameLetters(word, other))),
    )
    if (named === undefined) return false
    if (named.length > 0 && item.every((word) => named.some((one) => sameLetters(word, one))))
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
  return parts.brand === null && saysKind(parts, nameWords, dictionary)
}

/** Whether a name in the till's language says the line's kind, and both of two things side by side. */
function saysKind(
  parts: ReceiptLineParts,
  nameWords: readonly string[],
  dictionary: Readonly<Record<string, string>>,
): boolean {
  if (parts.kind === null) return false
  // «Կուս-կուս», «Բալզամ-ողողիչ»: the names are matched hyphen apart
  const says = (printed: string): boolean =>
    printed
      .split('-')
      .filter((piece) => piece !== '')
      .every((piece) => nameWords.some((word) => sameArmenian(piece, word, dictionary)))
  const next = nextThing(parts, dictionary)
  return says(parts.kind) && (next === null || says(next))
}
