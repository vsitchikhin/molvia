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
 * Every word of the query against every word of the name, worst word wins. Measured the
 * other way round — the whole query against the words of the name — «Հաց Կաթ» and «Hats Kat»
 * came out at distance 4 while holding identical keys. That is an artefact of the metric,
 * not of the transliteration, and MOL-10 has to compute it this way.
 */
function distance(query: string, name: string): number {
  const words = name.split(' ')
  return Math.max(
    ...query.split(' ').map((word) => Math.min(...words.map((part) => levenshtein(word, part)))),
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

  it('не склеивает два разных названия в один ключ', () => {
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
