import { describe, expect, it } from 'vitest'
import { toSearchKey } from '#model/support/search-key'
import { ITEMS, QUERIES, TRIPLES } from './search-corpus'

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
 * Every word of the query against every word of the name. Measured the other way round —
 * the whole query against the words of the name — «Հաց Կաթ» and «Hats Kat» came out at
 * distance 4 while holding identical keys; that is an artefact of the metric, not of the
 * transliteration.
 *
 * **No word is dropped for being short.** An earlier version skipped words under two
 * characters so that `moloko ashar 3 2` would not offer its `3` to every numeric query —
 * and that quietly erased the packaging size, which is the one thing those words carry:
 * «Молоко 1 л» and «Молоко 2 л» came out identical, while «Молоко 1л» written without the
 * space did not. Two positions in the catalogue, indistinguishable for ranking, depending
 * on how a shop printed the label.
 *
 * Taking the worst query word is the strict reading, and it too has a known cost: a correct
 * extra word loses the item, because «молоко ашхар пастеризованное» is what the package
 * says and the catalogue holds «Молоко Ашхар 3.2%». Neither question belongs to this file:
 * how the per-word distances combine is MOL-10's to settle, and what the corpus pins is the
 * transliteration. Both traps are written down in §8.1 of the requirements instead.
 */
function distance(query: string, name: string): number {
  const parts = name.split(' ')
  return Math.max(
    ...query.split(' ').map((word) => Math.min(...parts.map((part) => levenshtein(word, part)))),
  )
}

const ACCEPTED = 2

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

describe('развилка к/c', () => {
  /*
   * Latin c is two letters: soft before e, i and the diphthong ae — that is ц in
   * transliteration and in Latin itself (`cena`, `Caesar`) — and k everywhere else
   * (`Coca-Cola`, `Picnic`). ц, ծ, ց and `ts` are one letter of their own in the key, never
   * c, so their spelling does not depend on the next letter. That is what the first version
   * of this rule got wrong: it hardened the c that came from ц, and a case ending or the
   * next keystroke flipped it — MOL-11 adversarial review, sections Б–З.
   */
  it('сводит «Кока-кола» и «Coca-Cola» в один ключ', () => {
    // Was the known limit: two edits, the whole budget, with nothing left for a typo on top,
    // and the pair was not even a candidate until «кола» was typed in full.
    expect(toSearchKey('Coca-Cola')).toBe(toSearchKey('Кока-кола'))
  })

  it.each([
    ['Nescafe', 'Нескафе'],
    ['Coffee', 'Кофе'],
    ['Tic Tac', 'Тик Так'],
    ['Picnic', 'Пикник'],
    ['Activia', 'Активиа'],
  ])('сводит «%s» и «%s» в один ключ', (latin, cyrillic) => {
    expect(toSearchKey(latin)).toBe(toSearchKey(cyrillic))
  })

  it.each([
    ['cena', 'цена'],
    ['tsena', 'цена'],
    ['tsukaty', 'цукаты'],
    ['konets', 'конец'],
  ])('находит «ц», набранное мягким c или через ts: «%s» и «%s» — один ключ', (latin, cyrillic) => {
    expect(toSearchKey(latin)).toBe(toSearchKey(cyrillic))
  })

  it('держит «ц» одной буквой, что бы ни шло за ним', () => {
    // A case ending must not change the letter before it: «курица», «курицы» and the
    // «куриц» the screen sends halfway are one stem.
    for (const [typed, finished] of [
      ['куриц', 'курицы'],
      ['куриц', 'курица'],
      ['огурц', 'огурцы'],
      ['спец', 'специи'],
      ['ац', 'ацидофилин'],
    ] as const) {
      expect(toSearchKey(finished).startsWith(toSearchKey(typed)), typed).toBe(true)
    }
    expect(distance(toSearchKey('курицы'), toSearchKey('Курица'))).toBe(1)
    expect(distance(toSearchKey('огурцов'), toSearchKey('Огурцы'))).toBe(2)
  })

  it('сливает удвоенное «цц» раньше, чем решает про твёрдость', () => {
    expect(toSearchKey('Пиццерия')).toBe(toSearchKey('Пицерия'))
    expect(distance(toSearchKey('пицце'), toSearchKey('Пицца'))).toBe(1)
  })

  it('читает латинское ae после c как мягкое: «Caesar» против «Цезарь» — 2', () => {
    expect(distance(toSearchKey('Caesar'), toSearchKey('Цезарь'))).toBe(2)
  })

  it('не трогает ch — это ч', () => {
    expect(toSearchKey('Чай')).toBe(toSearchKey('chai'))
  })

  it('теряет «ц», набранное твёрдым c, — цена правила', () => {
    // Before a, o, u, a consonant or at the end of a word Latin c is read as k, so a Russian
    // word spelled with c for ц costs an edit per such c. `jajca` left the corpus of 46 for
    // this — three from «Яйца», past the budget; `ts` spellings are untouched.
    expect(distance(toSearchKey('otec'), toSearchKey('отец'))).toBe(1)
    expect(distance(toSearchKey('cukaty'), toSearchKey('цукаты'))).toBe(1)
    expect(distance(toSearchKey('jajca'), toSearchKey('Яйца'))).toBe(3)
  })

  it('не узнаёт недописанное латинское слово на c — c решает следующая буква', () => {
    // «Nutric» ends in a hard c, «Nutrici» has a soft one: one keystroke moves the letter.
    // Narrow — Latin brands with ce/ci — and left to MOL-14.
    expect(toSearchKey('Nutricia').startsWith(toSearchKey('Nutric'))).toBe(false)
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

  it('оставляет размер фасовки различимым — и показывает цену этого', () => {
    // The reason no word is dropped for being short: those words are the packaging size.
    expect(distance(toSearchKey('Молоко 1 л'), toSearchKey('Молоко 2 л'))).toBe(1)

    // The price of keeping them: a query of nothing but digits matches every name that
    // carries them. A trap for MOL-10, recorded rather than papered over here — the cure
    // that dropped short words was worse than the disease.
    expect(distance(toSearchKey('3,2%'), toSearchKey('Молоко Ашхар 3.2%'))).toBe(0)
  })

  it('теряет позицию на верном лишнем слове — цена строгого прочтения', () => {
    // Not a defect of the key: this is how the worst-word reading behaves, and MOL-10 has
    // to choose knowingly. The extra word is the one printed on the package.
    const name = toSearchKey('Молоко Ашхар 3.2%')
    expect(distance(toSearchKey('молоко ашхар'), name)).toBe(0)
    expect(distance(toSearchKey('молоко ашхар пастеризованное'), name)).toBeGreaterThan(ACCEPTED)
  })
})

describe('повороты ранжирования, о которых MOL-10 и MOL-14 должны знать', () => {
  it('одна опечатка рядом с такой же буквой уводит к чужой позиции', () => {
    // «Сааар» is one substitution away from «Сахар». The repeat collapse then turns it into
    // `sar`, and `sar` is closer to «Сыр» than to the name it came from. Not a limit of the
    // key — a turn in the ranking, and it stays invisible unless it is written down.
    const typo = toSearchKey('Сааар')
    expect(distance(typo, toSearchKey('Сахар'))).toBe(2)
    expect(distance(typo, toSearchKey('Сыр'))).toBe(1)
  })

  it('латинское CX и кириллическое СХ расходятся на весь бюджет', () => {
    // A fork the fold creates rather than closes: `c`+`x` goes through `x → ks`, «с»+«х»
    // through the table into `sh`. Two apart — inside the budget with nothing to spare,
    // the same shape as «Кока-кола»/`Coca-Cola`. Harmless for groceries, not for a dish or
    // a brand written in Latin.
    expect(distance(toSearchKey('Mazda CX-30'), toSearchKey('Мазда СХ-30'))).toBe(2)
  })
})

describe('класс, которого в корпусе нет', () => {
  /**
   * Every one of the 45 queries above is a transliterated spelling of a Cyrillic name.
   * English orthography is a different class, it is on the shelf constantly — `dish` is in
   * the schema from 0.1 and a coffee-shop menu is written in Latin — and the key does not
   * cover it: the fold works on transliteration forks, not on the gap between how English
   * is written and how it is heard. Numbers pinned so MOL-14 retunes against them rather
   * than rediscovering them.
   */
  const PAIRS: readonly (readonly [string, string, number])[] = [
    ['Cheesecake', 'Чизкейк', 6],
    ['Sprite', 'Спрайт', 2],
    // 1 since MOL-11: the hard c made `jacobs` into `jakobs`.
    ['Jacobs', 'Якобс', 1],
    ['Cappuccino', 'Капучино', 2],
  ]

  it.each(PAIRS)('«%s» против «%s» стоит %i', (latin, cyrillic, expected) => {
    expect(distance(toSearchKey(latin), toSearchKey(cyrillic))).toBe(expected)
  })

  it('три из четырёх тратят весь бюджет ещё до первой опечатки', () => {
    // Two sit exactly at the threshold and one is past it outright: whatever MOL-14 does
    // with the numbers, this class has no room left for a typo on top. «Jacobs» dropped out
    // of it with the hard c of MOL-11.
    expect(PAIRS.filter(([, , d]) => d >= ACCEPTED)).toHaveLength(3)
  })
})
