/**
 * The words people say for what a shelf writes otherwise: «картошка» for «Картофель», «орешки»
 * for «Арахис» (MOL-45). No spelling rule reaches these and no threshold does either — MOL-14
 * measured it — so the search is told, word by word, what else a word may stand for.
 *
 * Only the query is expanded, never a stored key, so unlike the alphabet of `search-key` this
 * table is **not frozen**: a word added here is an ordinary commit, not a migration.
 *
 * What goes in, and what does not:
 *
 * - **A target is a kind of product, never a brand.** «бритва» finds «станок», not «Gillette»:
 *   expanding into a brand would be a place in the results handed to one maker by hand — a paid
 *   placement without the payment. The other way round is fine: «памперсы» finds «подгузники»
 *   of every maker. «Белизна» is the common name of chlorine bleach from many makers, and is
 *   let in as a kind.
 * - **No categories.** «овощи», «фрукты», «специи», «сладости» name a shelf, not a purchase, and
 *   an answer to them is a list of everything; reaching kefir from «молочка» is what embeddings
 *   are for in 0.2.
 * - **The forms people type are written out** — singular and plural, the nominative, the
 *   genitive and the accusative: «картошка», «картошки», «картошку». A word is looked up by its
 *   exact key: with an edit budget «белки» would be one edit from «булки» and find buns. A form
 *   left out is a miss, not a wrong answer.
 */

import { toSearchKey } from './search-key'

/** Words that mean one thing: each finds the names written with any other. */
const SAME: readonly (readonly string[])[] = [
  ['картошка', 'картошки', 'картошку', 'картофель', 'картофеля'],
  ['булка', 'булки', 'булку', 'булок', 'булочка', 'булочки', 'булочку', 'булочек'],
  ['помидор', 'помидора', 'помидоры', 'помидоров', 'томат', 'томата', 'томаты', 'томатов'],
  ['огурец', 'огурца', 'огурцы', 'огурцов', 'огурчик', 'огурчики', 'огурчиков'],
  ['оливка', 'оливки', 'оливок', 'маслина', 'маслины', 'маслин'],
  ['гречка', 'гречки', 'гречку', 'греча', 'гречи', 'гречу', 'гречневая', 'гречневой', 'гречневую'],
  ['мацун', 'мацуна', 'мацони'],
  ['бритва', 'бритвы', 'бритву', 'бритв', 'станок', 'станка', 'станки', 'станков'],
  ['отбеливатель', 'отбеливателя', 'белизна', 'белизны', 'белизну'],
  ['курица', 'курицы', 'курицу', 'курятина', 'курятины', 'курятину'],
  ['кабачок', 'кабачка', 'кабачки', 'кабачков', 'цукини'],
  ['баклажан', 'баклажана', 'баклажаны', 'баклажанов', 'синенькие'],
  ['пакет', 'пакета', 'пакеты', 'пакетов', 'мешок', 'мешка', 'мешки', 'мешков'],
  ['овсянка', 'овсянки', 'овсянку', 'овсяная', 'овсяную', 'овсяные', 'овсяных'],
  [
    'сгущенка',
    'сгущёнка',
    'сгущенки',
    'сгущёнки',
    'сгущенку',
    'сгущёнку',
    'сгущенное',
    'сгущённое',
    'сгущенного',
    'сгущённого',
  ],
  ['шоколадка', 'шоколадки', 'шоколадку', 'шоколадок', 'шоколад', 'шоколада'],
  ['лампочка', 'лампочки', 'лампочку', 'лампочек', 'лампа', 'лампы', 'лампу', 'ламп'],
  ['дезодорант', 'дезодоранта', 'дезодоранты', 'антиперспирант', 'антиперспиранта'],
  ['селедка', 'селёдка', 'селедки', 'селёдки', 'селедку', 'селёдку', 'сельдь', 'сельди'],
]

/**
 * A word that stands for narrower ones: «орешки» finds «Арахис», and «арахис» never finds
 * «Фисташки» — a peanut is not a pistachio, however both are nuts. The narrower words are
 * written as a shelf writes them, in the nominative; the wider ones in every form people type.
 */
const NARROWER: readonly (readonly [readonly string[], readonly string[]])[] = [
  [
    ['орешки', 'орешков', 'орешек', 'орехи', 'орехов', 'орех'],
    ['орехи', 'орешки', 'арахис', 'фисташки', 'миндаль', 'кешью', 'фундук'],
  ],
  [
    ['мясо', 'мяса'],
    ['говядина', 'свинина', 'баранина', 'телятина', 'фарш'],
  ],
  // «минеральная», not «вода»: the water is in «Вода туалетная» and «Вода мицеллярная» too, first
  // word and all (review М). The price: «Вода Джермук», without the word, is not a «минералка».
  [['минералка', 'минералки', 'минералку'], ['минеральная']],
  [
    ['газировка', 'газировки', 'газировку'],
    ['лимонад', 'газированная', 'газированный'],
  ],
  [['памперсы', 'памперс', 'памперсов'], ['подгузники']],
  [
    ['зелень', 'зелени'],
    ['петрушка', 'укроп', 'кинза', 'киндза', 'базилик', 'тархун'],
  ],
  [
    ['макароны', 'макарон', 'макарошки'],
    ['спагетти', 'вермишель', 'рожки'],
  ],
  [['сок', 'сока', 'соки', 'соков'], ['нектар']],
  [
    ['хлеб', 'хлеба', 'хлебушек'],
    ['батон', 'лаваш', 'матнакаш', 'багет'],
  ],
  [
    ['колбаса', 'колбасы', 'колбасу', 'колбаски', 'колбасок'],
    ['сервелат', 'салями'],
  ],
  [
    ['сыр', 'сыра', 'сыры', 'сыров'],
    ['чанах', 'лори', 'моцарелла', 'гауда', 'чечил', 'сулугуни'],
  ],
  [
    ['рыба', 'рыбы', 'рыбу'],
    ['лосось', 'семга', 'форель', 'скумбрия', 'треска', 'тунец', 'сельдь', 'селедка'],
  ],
]

function keysOf(words: readonly string[]): string[] {
  return [...new Set(words.map(toSearchKey))]
}

const EXPANSIONS: ReadonlyMap<string, readonly string[]> = (() => {
  const map = new Map<string, Set<string>>()
  const add = (from: string, to: readonly string[]) => {
    const known = map.get(from) ?? new Set<string>()
    for (const key of to) if (key !== from) known.add(key)
    map.set(from, known)
  }
  for (const group of SAME) {
    const keys = keysOf(group)
    for (const key of keys) add(key, keys)
  }
  for (const [heads, tails] of NARROWER) {
    const targets = keysOf(tails)
    for (const key of keysOf(heads)) add(key, targets)
  }
  return new Map([...map].map(([key, targets]) => [key, [...targets]]))
})()

/**
 * The search keys a word of a query also stands for; the word's own key is never among them.
 * Takes one word of a key already made by `toSearchKey` — the query is folded once, by the
 * same function the names were, and a word is looked up exactly.
 */
export function synonymKeys(wordKey: string): readonly string[] {
  return EXPANSIONS.get(wordKey) ?? []
}

/**
 * A word that describes rather than names — an adjective, by its ending, in Cyrillic: «Молодой»,
 * «копчёная», «армянский». A pattern for Postgres as much as for this module, so it is written
 * without `\p{…}` and without case folding, which the database does by its locale.
 * Read off the name and not off the key, which collapses doubled letters: «солёный» is `soleni`
 * there, ending like «огурцы» and «фисташки».
 */
export const ADJECTIVE_WORD = '^[а-яёА-ЯЁ]+(ый|ий|ой|ая|яя|ое|ее|ые|ие|ЫЙ|ИЙ|ОЙ|АЯ|ЯЯ|ОЕ|ЕЕ|ЫЕ|ИЕ)$'

const ADJECTIVE = new RegExp(ADJECTIVE_WORD, 'u')

/**
 * Nouns with an adjective's ending — the kind, not a property of it: «Пирожное Картошка» is a
 * cake, not a potato (owner's decision on review, MOL-45 Р). Case is spelled out letter by letter,
 * for Postgres, like `ADJECTIVE_WORD`. The price, named: a noun not on the list is read as an
 * adjective all the same.
 */
const NOT_ADJECTIVES = ['пирожное', 'пирожные', 'мороженое', 'жаркое', 'шампанское', 'заливное']

export const NOUN_WORD = `^(${NOT_ADJECTIVES.map((word) =>
  word.replace(/./gu, (letter) => `[${letter}${letter.toUpperCase()}]`),
).join('|')})$`

const NOUN = new RegExp(NOUN_WORD, 'u')

/** Whether a word of a name describes rather than names — by `ADJECTIVE_WORD` and `NOUN_WORD`. */
function describes(word: string): boolean {
  return ADJECTIVE.test(word) && !NOUN.test(word)
}

/**
 * What separates the words of a name for `kindKey` — every Unicode `White_Space`, written out.
 * Not `\s`: in JavaScript it takes the no-break space, in Postgres it does not, and «Молодой
 * картофель» pasted from a site with U+00A0 between its words was two words on the phone and one
 * in the database — found offline, missed online (review У, Р-4). The same trap as `INVISIBLE`, and
 * held the same way: a test walks every code point.
 */
export const WORD_BREAK = '[\t-\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+'

const BREAK = new RegExp(WORD_BREAK, 'u')

/**
 * The word of a name a synonym is compared with: the first one that is not an adjective, as a
 * search key — where a shelf writes the kind («Вода Джермук», «Скумбрия х/к», «Молодой
 * картофель»), and not the tuna of a cat food or the water of «Туалетная вода» (owner's decisions
 * on review, MOL-45 А and Н). Empty when every word describes. The search takes it by the same
 * pattern in SQL: the adjectives are plain words, so each is one word of the key as well.
 */
export function kindKey(name: string): string {
  const words = name.split(BREAK).filter((word) => word !== '')
  const at = words.findIndex((word) => !describes(word))
  return at === -1 ? '' : (toSearchKey(name).split(' ')[at] ?? '')
}

// Narrower targets only. An adjective of a group of the same thing — «гречневая», «овсяная» —
// describes somebody else's product as often as its own («Лапша гречневая», «Мука овсяная»), and
// counts only beside a kind of its own, `PAIRED` (owner's decisions on review, MOL-45 С and Ц).
const DESCRIBING: ReadonlySet<string> = new Set(
  NARROWER.flatMap(([, tails]) => tails)
    .filter(describes)
    .map(toSearchKey),
)

/**
 * Whether a synonym describes rather than names — «минеральная», «газированная». Such a word is
 * never the kind, which skips adjectives, so it counts as any word of a name: it is precise
 * enough that «Вода туалетная» does not carry it.
 */
export function synonymDescribes(key: string): boolean {
  return DESCRIBING.has(key)
}

/**
 * The adjectives of a group of the same thing, each with the kinds it names that thing beside:
 * «гречневая» is «гречка» on «Крупа гречневая» and «Гречневая крупа» alike, and on «Лапша
 * гречневая» it is somebody else's product (review С). Never the kind, which skips adjectives, and
 * not by its place beside it, since a shelf writes both orders — «Молоко цельное сгущённое с
 * сахаром», by the standard (owner's decisions on review, MOL-45 Ф and Ц). The kinds are written
 * as a shelf writes them, in the nominative. The price: a kind left out — «Ядрица гречневая» —
 * is found by letters only, until it is written here.
 */
const PAIRED: readonly (readonly [readonly string[], readonly string[]])[] = [
  [
    ['гречневая', 'гречневой', 'гречневую'],
    ['крупа', 'крупы'],
  ],
  [
    ['овсяная', 'овсяную', 'овсяные', 'овсяных'],
    ['хлопья', 'каша'],
  ],
  [['сгущенное', 'сгущённое', 'сгущенного', 'сгущённого'], ['молоко']],
]

const PAIRED_KINDS: ReadonlyMap<string, readonly string[]> = new Map(
  PAIRED.flatMap(([adjectives, kinds]) => {
    const keys = keysOf(kinds)
    return keysOf(adjectives).map((adjective) => [adjective, keys] as const)
  }),
)

/**
 * The kinds beside which a synonym counts — an adjective of a group anywhere in a name whose
 * kind is one of them (see `PAIRED`). Empty for every other word.
 */
export function synonymPairedKinds(key: string): readonly string[] {
  return PAIRED_KINDS.get(key) ?? []
}

/**
 * Exported for the test that holds the rules above — no brand as a target, one group per word —
 * to walk the real table rather than a copy of it. Nothing in the applications reads this.
 */
export const SYNONYM_TABLES = Object.freeze({ same: SAME, narrower: NARROWER, paired: PAIRED })
