import { describe, expect, it } from 'vitest'
import { toSearchKey } from '#model/support/search-key'

/**
 * Not a test of the function so much as the contract MOL-10, MOL-13 and MOL-14 are promised:
 * whichever way a person spells a name, the key stays inside the edit distance the ranking
 * accepts. It fails the moment the alphabet drifts, and it moves into the integration tests
 * of MOL-13 as it stands.
 *
 * Levenshtein lives here rather than in `src`: in production Postgres computes it through
 * `fuzzystrmatch`, and `src/` holds only what ships.
 */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index)
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i]
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1)
      current.push(Math.min(previous[j]! + 1, current[j - 1]! + 1, substitution))
    }
    previous = current
  }
  return previous[b.length]!
}

/**
 * Words shorter than two characters are dropped — `moloko ashar 3 2` must not offer its
 * `3` to every numeric query — but only while longer ones remain. A query that is nothing
 * but `3,2%` would otherwise reduce to an empty list, and `Math.max()` of nothing is
 * -Infinity: a perfect match against the entire catalogue, better than any real answer.
 */
function words(key: string): readonly string[] {
  const all = key.split(' ')
  const long = all.filter((word) => word.length >= 2)
  return long.length > 0 ? long : all
}

/**
 * Every word of the query against every word of the name. Measured the other way round —
 * the whole query against the words of the name — «Հաց Կաթ» and «Hats Kat» came out at
 * distance 4 while holding identical keys; that is an artefact of the metric, not of the
 * transliteration.
 *
 * Taking the worst query word is the strict reading, and it has a known cost: a correct
 * extra word loses the item, because «молоко ашхар пастеризованное» is what the package
 * says and the catalogue holds «Молоко Ашхар 3.2%». How the per-word distances combine is
 * MOL-10's decision, not this corpus's — what the corpus pins is the transliteration.
 */
function distance(query: string, name: string): number {
  const parts = words(name)
  return Math.max(
    ...words(query).map((word) => Math.min(...parts.map((part) => levenshtein(word, part)))),
  )
}

const ACCEPTED = 2

const ITEMS = [
  'Молоко Ашхар 3.2%',
  'Молоко Марианна',
  'Сыр Чанах',
  'Сыр Лори',
  'Творог',
  'Кефир',
  'Мацун',
  'Шоколад Гранд Кенди',
  'Лаваш',
  'Яйца',
  'Гречка',
  'Жигули',
  'Хумус',
  'Цукаты',
  'Йогурт',
  'Щербет',
  'Айран',
  'Джем абрикосовый',
  'Масло сливочное',
  'Чай зелёный',
  'Сахар',
  'Форель',
  'Цыплёнок',
  'Икра кабачковая',
] as const

/** What a person actually types: both halves of every fork, and typos on top of them. */
const QUERIES: readonly (readonly [string, (typeof ITEMS)[number]])[] = [
  ['moloko', 'Молоко Ашхар 3.2%'],
  ['малако', 'Молоко Ашхар 3.2%'],
  ['malako', 'Молоко Ашхар 3.2%'],
  ['ashhar', 'Молоко Ашхар 3.2%'],
  ['ashkhar', 'Молоко Ашхар 3.2%'],
  ['chanah', 'Сыр Чанах'],
  ['chanakh', 'Сыр Чанах'],
  ['canah', 'Сыр Чанах'],
  ['чанах', 'Сыр Чанах'],
  ['tvorog', 'Творог'],
  ['kefir', 'Кефир'],
  ['matsun', 'Мацун'],
  ['macun', 'Мацун'],
  ['shokolad', 'Шоколад Гранд Кенди'],
  ['сокоlad', 'Шоколад Гранд Кенди'],
  ['chokolad', 'Шоколад Гранд Кенди'],
  ['lavash', 'Лаваш'],
  ['yaytsa', 'Яйца'],
  ['yaica', 'Яйца'],
  ['jajca', 'Яйца'],
  ['grechka', 'Гречка'],
  ['grecka', 'Гречка'],
  ['jiguli', 'Жигули'],
  ['zhiguli', 'Жигули'],
  ['humus', 'Хумус'],
  ['khumus', 'Хумус'],
  ['tsukaty', 'Цукаты'],
  ['cukati', 'Цукаты'],
  ['yogurt', 'Йогурт'],
  ['iogurt', 'Йогурт'],
  ['shcherbet', 'Щербет'],
  ['sherbet', 'Щербет'],
  ['scherbet', 'Щербет'],
  ['ayran', 'Айран'],
  ['airan', 'Айран'],
  ['djem', 'Джем абрикосовый'],
  ['jem', 'Джем абрикосовый'],
  ['maslo', 'Масло сливочное'],
  ['chai', 'Чай зелёный'],
  ['chay', 'Чай зелёный'],
  ['sahar', 'Сахар'],
  ['sakhar', 'Сахар'],
  ['forel', 'Форель'],
  ['ciplenok', 'Цыплёнок'],
  ['tsyplenok', 'Цыплёнок'],
  ['ikra', 'Икра кабачковая'],
]

/** Armenian on the shelf, Russian in the head, Latin on the keyboard. */
const TRIPLES: readonly (readonly [string, string, string])[] = [
  ['Ջերմուկ', 'Джермук', 'Jermuk'],
  ['Չանախ', 'Чанах', 'Chanakh'],
  ['Գյումրի', 'Гюмри', 'Gyumri'],
  ['Երևան', 'Ереван', 'Yerevan'],
  ['Մածուն', 'Мацун', 'Matsun'],
  ['Լավաշ', 'Лаваш', 'Lavash'],
  ['Ղափամա', 'Гапама', 'Ghapama'],
  ['Թան', 'Тан', 'Tan'],
  ['Բասթուրմա', 'Бастурма', 'Basturma'],
  ['Քունջութ', 'Кунжут', 'Kunjut'],
  ['Աշխար', 'Ашхар', 'Ashkhar'],
  ['Նոյ', 'Ной', 'Noy'],
  ['Ծաղկունք', 'Цахкунк', 'Tsaghkunk'],
  ['Հաց', 'Ац', 'Hats'],
  ['Սուջուխ', 'Суджух', 'Sujukh'],
  ['Փախինդզ', 'Пахиндз', 'Pakhindz'],
]

describe('корпус развилок', () => {
  const keys = new Map(ITEMS.map((item) => [item, toSearchKey(item)]))

  it.each(QUERIES)('%s находит «%s» внутри бюджета расстояния', (query, expected) => {
    expect(distance(toSearchKey(query), keys.get(expected)!)).toBeLessThanOrEqual(ACCEPTED)
  })

  it('не пропускает вперёд ни одну чужую позицию', () => {
    // Not «strictly first»: «Молоко Ашхар» and «Молоко Марианна» both sit at 0 from
    // `moloko`, and that is the right answer — the query names both of them. Breaking such
    // a tie is MOL-11's job, by remembering what the person picked last time.
    for (const [query, expected] of QUERIES) {
      const key = toSearchKey(query)
      const own = distance(key, keys.get(expected)!)
      const closest = Math.min(...ITEMS.map((item) => distance(key, keys.get(item)!)))
      expect(own, `запрос «${query}»: чужая позиция ближе нужной`).toBe(closest)
    }
  })

  it('оставляет ничью только между позициями, которые запрос и правда называет', () => {
    const tied = QUERIES.filter(([query]) => {
      const key = toSearchKey(query)
      const scored = ITEMS.map((item) => distance(key, keys.get(item)!)).sort((a, b) => a - b)
      return scored[0] === scored[1]
    }).map(([query]) => query)

    expect(tied).toEqual(['moloko', 'малако', 'malako'])
  })

  it('не склеивает в один ключ ни одну пару из этих двадцати четырёх', () => {
    // Says what it can: a statement about this list, not a property of the key. The key
    // does collide — «Мишка» и «Мышка» — and that is pinned in the unit tests instead.
    expect(new Set(keys.values()).size).toBe(ITEMS.length)
  })
})

describe('корпус письменностей', () => {
  it.each(TRIPLES)('«%s» находится и по «%s», и по «%s»', (armenian, russian, latin) => {
    const key = toSearchKey(armenian)
    expect(distance(toSearchKey(russian), key)).toBeLessThanOrEqual(ACCEPTED)
    expect(distance(toSearchKey(latin), key)).toBeLessThanOrEqual(ACCEPTED)
  })
})

describe('известный предел', () => {
  it('на паре «Кока-кола» / «Coca-Cola» бюджет расстояния исчерпан целиком', () => {
    // The к/c fork is the one the fold cannot close: c is already the target for ц, so
    // folding c to k would turn «цена» into kena. Two edits is the whole budget — nothing
    // left for a real typo on top. MOL-11 is what covers this pair, by remembering the pick.
    //
    // Asserted as exactly 2, not «at most 2»: a test that silently improves would hide the
    // day this stops being the limit, and a test that silently worsens would hide the day
    // the pair stops being findable at all.
    expect(distance(toSearchKey('Coca-Cola'), toSearchKey('Кока-кола'))).toBe(2)
  })
})

describe('многословный запрос', () => {
  it('сводит «Հաց Կաթ» и «Hats Kat» в один ключ, слово к слову', () => {
    // The pair the metric was written for, and the only two-word case in either corpus:
    // on a single word the two readings of «minimum across the words» are the same
    // function, so nothing below it would have caught the difference.
    expect(toSearchKey('Հաց Կաթ')).toBe(toSearchKey('Hats Kat'))
    expect(distance(toSearchKey('Hats Kat'), toSearchKey('Հաց Կաթ'))).toBe(0)
  })

  it('не даёт запросу из одних коротких слов совпасть со всем подряд', () => {
    // -Infinity would beat every real answer. The rule that drops short words has to be
    // conditional on longer ones remaining, and this is what says so.
    const key = toSearchKey('3,2%')
    expect(key).toBe('3 2')
    expect(distance(key, toSearchKey('Молоко Ашхар 3.2%'))).toBeGreaterThan(0)
  })

  it('теряет позицию на верном лишнем слове — цена строгого прочтения', () => {
    // Not a defect of the key: this is how the worst-word reading behaves, and MOL-10 has
    // to choose knowingly. The extra word is the one printed on the package.
    const name = toSearchKey('Молоко Ашхар 3.2%')
    expect(distance(toSearchKey('молоко ашхар'), name)).toBe(0)
    expect(distance(toSearchKey('молоко ашхар пастеризованное'), name)).toBeGreaterThan(ACCEPTED)
  })
})

describe('класс, которого в корпусе нет', () => {
  /**
   * Every one of the 46 queries above is a transliterated spelling of a Cyrillic name.
   * English orthography is a different class, it is on the shelf constantly — `dish` is in
   * the schema from 0.1 and a coffee-shop menu is written in Latin — and the key does not
   * cover it: the fold works on transliteration forks, not on the gap between how English
   * is written and how it is heard. Numbers pinned so MOL-14 retunes against them rather
   * than rediscovering them.
   */
  const PAIRS: readonly (readonly [string, string, number])[] = [
    ['Cheesecake', 'Чизкейк', 6],
    ['Sprite', 'Спрайт', 2],
    ['Jacobs', 'Якобс', 2],
    ['Cappuccino', 'Капучино', 2],
  ]

  it.each(PAIRS)('«%s» против «%s» стоит %i', (latin, cyrillic, expected) => {
    expect(distance(toSearchKey(latin), toSearchKey(cyrillic))).toBe(expected)
  })

  it('все четыре тратят весь бюджет ещё до первой опечатки', () => {
    // Three sit exactly at the threshold and one is past it outright: whatever MOL-14 does
    // with the numbers, this class has no room left for a typo on top.
    expect(PAIRS.filter(([, , d]) => d >= ACCEPTED)).toHaveLength(4)
  })
})
