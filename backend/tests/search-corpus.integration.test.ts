import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { synonymKeys, toSearchKey } from '@molvia/model'
import {
  ITEMS,
  QUERIES,
  SHELF,
  SHELF_ABSENT,
  SHELF_ARMENIAN,
  SHELF_ARMENIAN_QUERIES,
  SHELF_EVERYDAY_ABSENT,
  SHELF_QUERIES,
  SHELF_TYPED_OTHERWISE,
  TRIPLES,
} from '@molvia/model/testing/search-corpus'
import { randomUUID } from 'node:crypto'
import { sql as raw } from 'drizzle-orm'
import { createItemRepository } from '@/db/items-repository'
import { connectDrizzle } from './db'
import { clearAll, insertItem } from './fixtures'

/**
 * The corpora of MOL-5 through the real search — candidates by `word_similarity`, ranking by
 * `levenshtein`, both in Postgres. The key's own corpus test measures the alphabet with a
 * model of the ranking; this one measures what a person sees.
 *
 * Each case pins the whole answer, not only its head: the corpus is what a retune of the
 * thresholds is measured against (MOL-14 kept them, MOL-47 measures again), and a threshold
 * that buries the answer in noise keeps the right item first. When a threshold moves, these
 * lists are expected to move with it — by hand.
 */

const { db, close } = connectDrizzle()
const repo = createItemRepository(db)

/** Nobody's memory: the order of MOL-10, with no pick lifting anything. */
const nobody = randomUUID()

async function names(query: string): Promise<string[]> {
  return (await repo.search(query, 20, nobody)).map((item) => item.name)
}

/**
 * A tie is a group: equal distance and equal similarity leave the order to the row id, a
 * random uuid, so inside a group the order is not the search's to keep. Only a real tie is a
 * group — where the similarity differs, the order is the search's and is pinned as a list.
 */
type Answer = readonly (string | readonly string[])[]

async function answers(query: string, expected: Answer): Promise<void> {
  const found = await names(query)
  let at = 0
  const grouped = expected.map((entry) => {
    const size = typeof entry === 'string' ? 1 : entry.length
    const slice = found.slice(at, (at += size))
    return typeof entry === 'string' ? slice[0] : [...slice].sort()
  })
  const wanted = expected.map((entry) => (typeof entry === 'string' ? entry : [...entry].sort()))
  expect([...grouped, ...found.slice(at)], query).toEqual(wanted)
}

async function seed(catalogue: readonly string[]): Promise<void> {
  await clearAll(db)
  for (const name of catalogue) await insertItem(db, { name, searchKey: toSearchKey(name) })
}

afterAll(async () => {
  await clearAll(db)
  await close()
})

describe('the corpus of forks, through the search', () => {
  beforeAll(async () => {
    await seed(ITEMS)
  })

  /**
   * Answers that are more than the one expected item. On `moloko` the milks tie outright —
   * distance 0, similarity 1 — and the query names both: breaking that is memory's job
   * (MOL-11). On «малако» they are not a tie. Both are two edits away, but `malako` shares
   * more trigrams with `mariana` than with `moloko ashar` (0.429 against 0.167), so the
   * similarity puts «Марианна» first every time: the typo resembles the brand, not the milk.
   * Not wrong — the query names both milks — and pinned so the tie-break by similarity is
   * guarded where it decides the first row. The rest is noise within the budget, pinned so
   * a retune shows it move.
   */
  const LONGER: Readonly<Record<string, Answer>> = {
    moloko: [['Молоко Ашхар 3.2%', 'Молоко Марианна']],
    малако: ['Молоко Марианна', 'Молоко Ашхар 3.2%'],
    malako: ['Молоко Марианна', 'Молоко Ашхар 3.2%'],
    ashhar: ['Молоко Ашхар 3.2%', 'Сахар'],
    ashkhar: ['Молоко Ашхар 3.2%', 'Сахар'],
    sahar: ['Сахар', 'Молоко Ашхар 3.2%'],
    sakhar: ['Сахар', 'Молоко Ашхар 3.2%'],
    chai: ['Чай зелёный', 'Сыр Чанах'],
    chay: ['Чай зелёный', 'Сыр Чанах'],
  }

  /** Where the similarity puts another item above the one the corpus names. */
  const SECOND = new Set(['малако', 'malako'])

  it('names only queries the corpus has', () => {
    const queries = new Set(QUERIES.map(([query]) => query))
    expect(Object.keys(LONGER).filter((query) => !queries.has(query))).toEqual([])
  })

  it('keeps the corpus item in every longer answer: first, or second where named', () => {
    // A longer answer replaces the corpus expectation, so it must still carry it — or the one
    // list both tests read would drift from this file silently.
    for (const [query, expected] of QUERIES) {
      const answer = LONGER[query]
      if (answer === undefined) continue
      expect(answer.flat().indexOf(expected), query).toBe(SECOND.has(query) ? 1 : 0)
    }
    expect([...SECOND].filter((query) => LONGER[query] === undefined)).toEqual([])
  })

  it.each(QUERIES)('«%s» → «%s»', async (query, expected) => {
    await answers(query, LONGER[query] ?? [expected])
  })

  it('reaches a two-word brand across the forks: «Grand Candy»', async () => {
    // Three edits before the forks were folded — outside the budget (MOL-5).
    expect(await names('Grand Candy')).toEqual(['Шоколад Гранд Кенди'])
    expect(await names('гранд кенди')).toEqual(['Шоколад Гранд Кенди'])
  })

  it.each(['бастурма', 'basturma', 'хинкали', 'арбуз'])(
    'answers nothing to «%s», which names none of the twenty-four',
    async (query) => {
      expect(await names(query)).toEqual([])
    },
  )

  it('finds «Чай зелёный» by «пельмени» — the absolute budget, pinned as it is', async () => {
    // `pelmeni` is two edits from `zeleni`: a seven-letter word wrong from end to end passes
    // where the budget was meant for a typo. No threshold separates it from «малако» — MOL-46;
    // this is its plainest case.
    expect(await names('пельмени')).toEqual(['Чай зелёный'])
  })

  it('puts both cheeses above «Сахар» for «Сааар» — a turn of the key, pinned as it is', async () => {
    // One substitution from «Сахар», but the repeat collapse makes it `sar`, one edit from
    // `sir`. Written down by MOL-5, left in place by MOL-14 (MOL-47), not for this file to fix.
    await answers('Сааар', [['Сыр Лори', 'Сыр Чанах'], 'Сахар', 'Молоко Ашхар 3.2%'])
  })
})

describe('typos: substitutions against the budget of two', () => {
  beforeAll(async () => {
    await seed(ITEMS)
  })

  /**
   * One word, eight letters, so that three substitutions still share trigrams with the name:
   * «not found» below has to be the distance speaking, not the candidate threshold.
   */
  const CASES: readonly (readonly [string, number, readonly string[]])[] = [
    ['шоколат', 1, ['Шоколад Гранд Кенди']],
    ['шакалад', 2, ['Шоколад Гранд Кенди']],
    ['шакалат', 3, []],
    ['shokolat', 1, ['Шоколад Гранд Кенди']],
    ['shakalad', 2, ['Шоколад Гранд Кенди']],
    ['shakalat', 3, []],
  ]

  it.each(CASES)('«%s», %i substitutions', async (query, edits, expected) => {
    const [row] = await db.execute<{ edits: number; similarity: number }>(
      raw`select levenshtein(${toSearchKey(query)}, ${toSearchKey('шоколад')}) as edits,
                 word_similarity(${toSearchKey(query)}, ${toSearchKey('Шоколад Гранд Кенди')}) as similarity`,
    )
    expect(row?.edits).toBe(edits)
    expect(Number(row?.similarity)).toBeGreaterThan(0.15)
    expect(await names(query)).toEqual(expected)
  })
})

describe('the corpus of scripts, through the search', () => {
  beforeAll(async () => {
    await seed(TRIPLES.map(([armenian]) => armenian))
  })

  it.each(TRIPLES)('«%s» is found by «%s», «%s» and itself', async (armenian, russian, latin) => {
    for (const query of [russian, latin, armenian]) {
      expect(await names(query), query).toEqual([armenian])
    }
  })
})

describe('what is not in the corpus: two words, and English spelling', () => {
  beforeAll(async () => {
    await seed(['Հաց Կաթ', 'Чизкейк', 'Спрайт', 'Якобс', 'Капучино', 'Мазда СХ-30'])
  })

  it('matches two words word for word: «Hats Kat» and «Ац Кат» find «Հաց Կաթ»', async () => {
    // Measured as a whole query against the name's words, this pair came out at 4 with
    // identical keys — the reason the distance is taken word against word.
    expect(await names('Hats Kat')).toEqual(['Հաց Կաթ'])
    expect(await names('Ац Кат')).toEqual(['Հաց Կաթ'])
  })

  it.each([
    ['Sprite', 'Спрайт'],
    ['Jacobs', 'Якобс'],
    ['Cappuccino', 'Капучино'],
    ['Mazda CX-30', 'Мазда СХ-30'],
  ])('finds «%s» → «%s», inside the budget', async (query, name) => {
    expect(await names(query)).toEqual([name])
  })

  it('does not find «Чизкейк» by «Cheesecake» — six edits, the class the key does not cover', async () => {
    // English orthography is not a transliteration fork; pinned, and left to MOL-47.
    expect(await names('Cheesecake')).toEqual([])
  })
})

describe("the shelf of MOL-14: the owner's own words, through the search", () => {
  beforeAll(async () => {
    await seed(SHELF)
  })

  /**
   * What the search answers today, whole, at the thresholds MOL-14 measured and kept:
   * candidates above 0.15, distance within 2. The noise is pinned with the rest — «мол» ties
   * the milks with «Кофе … молотый», «туалетка» the paper with the cat litter's «туалета» —
   * so a change of either threshold shows what it moves, query by query.
   */
  const ANSWERS: Readonly<Record<string, Answer>> = {
    кола: [
      ['Coca-Cola 1 л', 'Coca-Cola 0,5 л'],
      ['Колбаса докторская', 'Колбаса сервелат Макур'],
      'Средство для мытья пола Mr. Proper 1 л',
      [
        'Корм для кошек Whiskas 85 г',
        'Корм для собак Pedigree 400 г',
        'Кофе Jacobs Monarch молотый 230 г',
        "Хлопья кукурузные Kellogg's Corn Flakes 375 г",
      ],
    ],
    кол: [
      ['Coca-Cola 1 л', 'Coca-Cola 0,5 л', 'Колбаса докторская', 'Колбаса сервелат Макур'],
      [
        'Корм для кошек Whiskas 85 г',
        'Корм для собак Pedigree 400 г',
        'Кофе Jacobs Monarch молотый 230 г',
        "Хлопья кукурузные Kellogg's Corn Flakes 375 г",
      ],
    ],
    фанта: ['Fanta апельсин 1 л'],
    фан: ['Fanta апельсин 1 л'],
    молоко: [
      ['Молоко Марианна 3,2% 1 л', 'Молоко Ашхар 2,5% 1 л'],
      'Кофе Jacobs Monarch молотый 230 г',
    ],
    мол: [
      ['Кофе Jacobs Monarch молотый 230 г', 'Молоко Марианна 3,2% 1 л', 'Молоко Ашхар 2,5% 1 л'],
      'Средство для мытья пола Mr. Proper 1 л',
    ],
    моло: [
      ['Кофе Jacobs Monarch молотый 230 г', 'Молоко Марианна 3,2% 1 л', 'Молоко Ашхар 2,5% 1 л'],
      'Полотенце кухонное',
      'Средство для мытья пола Mr. Proper 1 л',
    ],
    несквик: ['Nesquik какао-напиток 250 г'],
    неск: ['Nesquik какао-напиток 250 г', 'Хлопья Nestlé Fitness 300 г'],
    хлопья: [['Хлопья Nestlé Fitness 300 г', "Хлопья кукурузные Kellogg's Corn Flakes 375 г"]],
    хлоп: [
      ['Хлопья Nestlé Fitness 300 г', "Хлопья кукурузные Kellogg's Corn Flakes 375 г"],
      ['Хлеб Матнакаш', "Хлеб тостовый Harry's 470 г"],
    ],
    хлеб: [['Хлеб Матнакаш', "Хлеб тостовый Harry's 470 г"]],
    колбаса: [['Колбаса докторская', 'Колбаса сервелат Макур']],
    колб: [
      ['Колбаса докторская', 'Колбаса сервелат Макур'],
      ['Coca-Cola 1 л', 'Coca-Cola 0,5 л'],
      [
        'Корм для кошек Whiskas 85 г',
        'Корм для собак Pedigree 400 г',
        'Кофе Jacobs Monarch молотый 230 г',
        "Хлопья кукурузные Kellogg's Corn Flakes 375 г",
      ],
    ],
    нутелла: ['Nutella 350 г'],
    нут: ['Nutella 350 г', 'Сок Noy яблочный 1 л'],
    пиво: [['Пиво Gyumri 0,5 л', 'Пиво Kilikia 0,5 л'], 'Пирожное Наполеон'],
    говядина: ['Говядина мякоть'],
    мясо: ['Говядина мякоть', 'Фарш говяжий'],
    говя: [['Фарш говяжий', 'Говядина мякоть']],
    сок: [
      ['Сок Rich апельсин 1 л', 'Сок Noy яблочный 1 л'],
      [
        'Корм для собак Pedigree 400 г',
        'Мука пшеничная высший сорт 2 кг',
        'Соевый соус Kikkoman 150 мл',
        'Соус чесночный Махеевъ 200 г',
      ],
      "Чипсы Lay's сметана и лук 150 г",
    ],
    чипсы: ["Чипсы Lay's сметана и лук 150 г"],
    чип: ["Чипсы Lay's сметана и лук 150 г"],
    принглс: ['Pringles Original 165 г'],
    прин: ['Pringles Original 165 г'],
    читос: ['Cheetos кукурузные палочки 55 г'],
    котлеты: ['Котлеты куриные замороженные'],
    котл: [
      'Котлеты куриные замороженные',
      [
        'Корм для кошек Whiskas 85 г',
        'Корм для собак Pedigree 400 г',
        'Кофе Jacobs Monarch молотый 230 г',
        'Coca-Cola 1 л',
        "Хлопья кукурузные Kellogg's Corn Flakes 375 г",
        'Coca-Cola 0,5 л',
      ],
    ],
    спагетти: ['Спагетти Barilla №5 500 г'],
    спаг: ['Спагетти Barilla №5 500 г'],
    кетчуп: ['Кетчуп Heinz томатный 570 г'],
    соусы: [['Соевый соус Kikkoman 150 мл', 'Соус чесночный Махеевъ 200 г']],
    орешки: ['Фисташки жареные 100 г', 'Арахис солёный 150 г'],
    салфетки: [['Салфетки бумажные Zewa 100 шт', 'Салфетки влажные Huggies 56 шт']],
    салф: [['Салфетки бумажные Zewa 100 шт', 'Салфетки влажные Huggies 56 шт']],
    'влажные салфетки': ['Салфетки влажные Huggies 56 шт', 'Салфетки бумажные Zewa 100 шт'],
    картошка: ['Картофель'],
    виноград: ['Виноград Арарат'],
    нектарины: ['Нектарины'],
    перчатки: ['Перчатки хозяйственные Vileda'],
    батарейки: ['Батарейки Duracell AA 4 шт'],
    белизна: ['Белизна 1 л'],
    отбеливатель: ['Белизна 1 л'],
    кофе: [
      'Кофе Jacobs Monarch молотый 230 г',
      [
        'Корм для кошек Whiskas 85 г',
        'Корм для собак Pedigree 400 г',
        'Coca-Cola 1 л',
        "Хлопья кукурузные Kellogg's Corn Flakes 375 г",
        'Coca-Cola 0,5 л',
      ],
    ],
    креветки: ['Креветки королевские 500 г'],
    сливки: ['Сливки Марианна 20% 200 мл'],
    крекеры: ['Крекеры TUC 100 г'],
    булочки: ['Булочки с кунжутом 4 шт', 'Cheetos кукурузные палочки 55 г'],
    булки: ['Булочки с кунжутом 4 шт'],
    пирожные: ['Пирожное Наполеон'],
    вода: [['Вода Бжни 1,5 л', 'Вода Джермук 0,5 л']],
    дошик: ['Doshirak лапша курица 90 г'],
    лапша: [['Лапша удон 300 г', 'Doshirak лапша курица 90 г']],
    паштет: ['Паштет печёночный Hame 105 г'],
    творог: ['Творог Ашхар 9% 400 г'],
    твор: ['Творог Ашхар 9% 400 г'],
    мука: ['Мука пшеничная высший сорт 2 кг', ['Coca-Cola 1 л', 'Coca-Cola 0,5 л']],
    туалетка: [['Туалетная бумага Zewa Plus 4 рулона', 'Наполнитель для кошачьего туалета 5 л']],
    бритва: ['Станки Gillette Blue II 5 шт'],
    'соевый соус': ['Соевый соус Kikkoman 150 мл', 'Соус чесночный Махеевъ 200 г'],
    рис: ['Рис длиннозёрный Мистраль 900 г', 'Сок Rich апельсин 1 л'],
    'таблетки для посудомойки': ['Таблетки для посудомоечной машины Finish 40 шт'],
    курица: [['Курица целая охлаждённая', 'Курица филе', 'Doshirak лапша курица 90 г']],
    кур: [
      [
        'Курица целая охлаждённая',
        'Котлеты куриные замороженные',
        'Курица филе',
        'Doshirak лапша курица 90 г',
      ],
      ["Хлопья кукурузные Kellogg's Corn Flakes 375 г", 'Колбаса сервелат Макур'],
      ['Корм для кошек Whiskas 85 г', 'Корм для собак Pedigree 400 г', 'Крекеры TUC 100 г'],
    ],
    'средство для полов': ['Средство для мытья пола Mr. Proper 1 л'],
    'собачий корм': ['Корм для собак Pedigree 400 г'],
    корм: [
      ['Корм для кошек Whiskas 85 г', 'Корм для собак Pedigree 400 г'],
      ['Креветки королевские 500 г', "Хлопья кукурузные Kellogg's Corn Flakes 375 г"],
      ['Кофе Jacobs Monarch молотый 230 г', 'Coca-Cola 1 л', 'Coca-Cola 0,5 л'],
      'Мука пшеничная высший сорт 2 кг',
    ],
    наполнитель: ['Наполнитель для кошачьего туалета 5 л'],
    'стиральный порошок': ['Стиральный порошок Ariel 3 кг'],
    порошок: ['Стиральный порошок Ariel 3 кг'],
    тарелки: ['Тарелка суповая'],
    кружки: ['Кружка керамическая'],
    полотенца: ['Полотенце кухонное'],
  }

  /**
   * The owner's word is not the shelf's: «картошка» for «Картофель», «орешки» for «Арахис».
   * No spelling rule reaches a synonym and no threshold does either — MOL-14 pinned these as
   * misses, and the dictionary of MOL-45 is what finds them now. «мясо» was counted a hit by
   * luck before it: `miaso` is one edit from the start of `miakot`, and «Фарш говяжий», meat
   * just as much, was not found at all.
   */
  const SYNONYMS = ['орешки', 'картошка', 'отбеливатель', 'булки', 'бритва', 'мясо']

  it.each(SYNONYMS)('finds «%s» through the dictionary, which is what reaches it', (query) => {
    // Taken out of the dictionary, the word goes back to missing — the answer above is pinned.
    expect(synonymKeys(toSearchKey(query))).not.toEqual([])
  })

  it('pins an answer for every query of the shelf, and no other', () => {
    expect(Object.keys(ANSWERS).sort()).toEqual(SHELF_QUERIES.map(([query]) => query).sort())
  })

  /**
   * Where the first place is a tie with an item the query did not mean: equal distance and
   * similarity, so the row id — a random uuid — decides which one the person sees. «мол» and
   * «моло» tie the milks with «Кофе … молотый», «кол» the colas with the sausages, «кур» and
   * «курица» the chicken with «Котлеты куриные» and «Doshirak лапша курица», «туалетка» the
   * paper with the litter's «туалета». Memory (MOL-11) settles it from the second trip, not the
   * first. Counted apart from a hit: 67 queries have what they meant first alone, not 73.
   */
  const TIED_WITH_FOREIGN = new Set(['кол', 'мол', 'моло', 'кур', 'курица', 'туалетка'])

  const meantFirst = (
    answer: Answer | undefined,
    meant: readonly string[],
  ): 'alone' | 'tied' | 'not-first' | 'empty' => {
    const head = [answer?.[0] ?? []].flat()
    if (head.length === 0) return 'empty'
    if (!head.some((name) => meant.includes(name))) return 'not-first'
    return head.every((name) => meant.includes(name)) ? 'alone' : 'tied'
  }

  it('puts what the query meant first alone — apart from the ties named above', () => {
    // The pinned answers replace nothing in the shared list, so they must still agree with it.
    for (const [query, meant] of SHELF_QUERIES) {
      const expected = TIED_WITH_FOREIGN.has(query) ? 'tied' : 'alone'
      expect(meantFirst(ANSWERS[query], meant), query).toBe(expected)
    }
  })

  it.each(SHELF_QUERIES)('«%s»', async (query) => {
    await answers(query, ANSWERS[query] ?? [])
  })

  /**
   * Two of the owner's words for what the shelf does not carry still find something: `ovoshi`
   * is two edits from `vishi` of «высший сорт», `speцi` two from `soevi`. The absolute budget
   * of MOL-10 — the class of «пельмени» — and with the one button «Предложить товар» shown
   * only on an empty answer, such an item cannot be added. Pinned as it is.
   */
  const FALSE_HITS: Readonly<Record<string, Answer>> = {
    овощи: ['Мука пшеничная высший сорт 2 кг'],
    специи: ['Соевый соус Kikkoman 150 мл'],
  }

  it.each(SHELF_ABSENT.filter((query) => !(query in FALSE_HITS)))(
    'answers nothing to «%s», which the shelf does not carry',
    async (query) => {
      expect(await names(query)).toEqual([])
    },
  )

  it.each(Object.entries(FALSE_HITS))(
    'finds something for «%s» — the absolute budget, pinned as it is',
    async (query, answer) => {
      await answers(query, answer)
    },
  )

  /**
   * Fifty everyday purchases the shelf does not carry — the adversarial pass's words, not the
   * owner's. Twenty-five find something, and every one that does hides «Предложить товар»,
   * shown only on an empty answer. They are three outcomes, not one:
   *
   * - `RELATED` — the first row carries the word's root: a taste or a property printed on
   *   another item. Six are found exactly or by the start of a word («сметана», «лук» in the
   *   chips', «печень» in «печёночный») — no threshold removes those, a question for the
   *   screen (MOL-23), not the search. Six more by an edit of the ending, inside the budget
   *   («томаты» → «томатный», «яблоки» → «яблочный», two edits, gone at a budget of 1).
   * - `UNRELATED` — nothing in common but letters: the absolute budget («водка» → «Вода»,
   *   «мыло» → «Молоко», «торт», «плов», «сыр» → «Сок» and «сорт» — MOL-46). A unit grounded
   *   matches too until MOL-48 — «сыр» is two edits from `sht` of «4 шт» — and six of the
   *   ten «сыр» found went with it.
   * - `BY_SYNONYM` — the shelf does carry it, under another name: «макароны» are the spaghetti.
   *   Absent from the list by its word, found by the dictionary (MOL-45).
   *
   * Pinned whole, as they are.
   */
  const RELATED_EXACT = new Set(['соль', 'печень', 'лук', 'сметана', 'суп', 'вино'])
  const RELATED_BY_EDIT = new Set(['яблоки', 'апельсины', 'томаты', 'чеснок', 'кукуруза', 'пирог'])
  const RELATED = new Set([...RELATED_EXACT, ...RELATED_BY_EDIT])
  const BY_SYNONYM = new Set(['макароны'])
  const UNRELATED = new Set([
    'сахар',
    'чай',
    'сыр',
    'ложка',
    'мыло',
    'губка',
    'пакеты',
    'плов',
    'водка',
    'конфеты',
    'торт',
    'печенье',
  ])
  const EVERYDAY: Readonly<Record<string, Answer>> = {
    яйца: [],
    сахар: [['Молоко Ашхар 2,5% 1 л', 'Творог Ашхар 9% 400 г']],
    соль: [
      'Арахис солёный 150 г',
      ['Сок Rich апельсин 1 л', 'Сок Noy яблочный 1 л'],
      [
        'Мука пшеничная высший сорт 2 кг',
        'Соус чесночный Махеевъ 200 г',
        'Соевый соус Kikkoman 150 мл',
      ],
      'Средство для мытья пола Mr. Proper 1 л',
    ],
    масло: [],
    чай: ["Чипсы Lay's сметана и лук 150 г"],
    сыр: [
      [
        'Мука пшеничная высший сорт 2 кг',
        'Средство для мытья пола Mr. Proper 1 л',
        'Сок Rich апельсин 1 л',
        'Сок Noy яблочный 1 л',
      ],
    ],
    кефир: [],
    йогурт: [],
    бананы: [],
    яблоки: ['Сок Noy яблочный 1 л'],
    апельсины: [['Fanta апельсин 1 л', 'Сок Rich апельсин 1 л']],
    томаты: ['Кетчуп Heinz томатный 570 г'],
    помидоры: [],
    чеснок: ['Соус чесночный Махеевъ 200 г'],
    кукуруза: [
      ["Хлопья кукурузные Kellogg's Corn Flakes 375 г", 'Cheetos кукурузные палочки 55 г'],
    ],
    печень: ['Паштет печёночный Hame 105 г'],
    лук: [
      "Чипсы Lay's сметана и лук 150 г",
      'Крекеры TUC 100 г',
      ['Сок Rich апельсин 1 л', 'Сок Noy яблочный 1 л'],
    ],
    сметана: ["Чипсы Lay's сметана и лук 150 г"],
    сосиски: [],
    макароны: ['Спагетти Barilla №5 500 г'],
    гречка: [],
    огурцы: [],
    зелень: [],
    суп: [
      'Тарелка суповая',
      [
        "Чипсы Lay's сметана и лук 150 г",
        'Соус чесночный Махеевъ 200 г',
        'Сок Rich апельсин 1 л',
        'Сок Noy яблочный 1 л',
        'Соевый соус Kikkoman 150 мл',
      ],
    ],
    ложка: [['Coca-Cola 0,5 л', 'Coca-Cola 1 л']],
    лезвия: [],
    щётка: [],
    'зубная паста': [],
    шампунь: [],
    мыло: [
      ['Молоко Ашхар 2,5% 1 л', 'Кофе Jacobs Monarch молотый 230 г', 'Молоко Марианна 3,2% 1 л'],
    ],
    губка: ['Мука пшеничная высший сорт 2 кг'],
    пакеты: ['Спагетти Barilla №5 500 г'],
    фольга: [],
    плов: ['Туалетная бумага Zewa Plus 4 рулона'],
    шаурма: [],
    тоник: [],
    сироп: [],
    вино: ['Виноград Арарат'],
    коньяк: [],
    водка: [
      ['Вода Джермук 0,5 л', 'Вода Бжни 1,5 л'],
      ['Coca-Cola 0,5 л', 'Coca-Cola 1 л'],
    ],
    сигареты: [],
    жвачка: [],
    шоколад: [],
    конфеты: ['Котлеты куриные замороженные'],
    мороженое: [],
    торт: [["Хлеб тостовый Harry's 470 г", 'Мука пшеничная высший сорт 2 кг']],
    пирог: ['Пирожное Наполеон', ['Пиво Kilikia 0,5 л', 'Пиво Gyumri 0,5 л']],
    сухарики: [],
    семечки: [],
    печенье: ['Паштет печёночный Hame 105 г'],
  }

  it('pins an answer for every everyday word, and no other', () => {
    expect(Object.keys(EVERYDAY).sort()).toEqual([...SHELF_EVERYDAY_ABSENT].sort())
  })

  it('files every everyday word that finds something: 12 related, 12 unrelated, 1 by synonym', () => {
    const found = SHELF_EVERYDAY_ABSENT.filter((query) => (EVERYDAY[query] ?? []).length > 0)
    const filed = new Set([...RELATED, ...UNRELATED, ...BY_SYNONYM])
    expect(found.filter((query) => !filed.has(query))).toEqual([])
    expect([...filed].filter((query) => !found.includes(query))).toEqual([])
    expect([RELATED.size, UNRELATED.size, BY_SYNONYM.size]).toEqual([12, 12, 1])
  })

  it.each(SHELF_EVERYDAY_ABSENT)('everyday «%s», which the shelf does not carry', async (query) => {
    await answers(query, EVERYDAY[query] ?? [])
  })

  /**
   * The shelf typed another way. Latin finds its item first; two brands spelled in Cyrillic do
   * not: «хаггис» puts «Хлеб тостовый Harry's» above the Huggies wipes (both two edits, the
   * bread's similarity 0.333 against 0.167), and «лейс» ties the chips with «Рис» — pinned for
   * MOL-47.
   */
  const OTHERWISE: Readonly<Record<string, Answer>> = {
    kola: [
      ['Coca-Cola 0,5 л', 'Coca-Cola 1 л'],
      ['Колбаса сервелат Макур', 'Колбаса докторская'],
      'Средство для мытья пола Mr. Proper 1 л',
      [
        'Корм для собак Pedigree 400 г',
        "Хлопья кукурузные Kellogg's Corn Flakes 375 г",
        'Кофе Jacobs Monarch молотый 230 г',
        'Корм для кошек Whiskas 85 г',
      ],
    ],
    cola: [
      ['Coca-Cola 0,5 л', 'Coca-Cola 1 л'],
      ['Колбаса сервелат Макур', 'Колбаса докторская'],
      'Средство для мытья пола Mr. Proper 1 л',
      [
        'Корм для собак Pedigree 400 г',
        "Хлопья кукурузные Kellogg's Corn Flakes 375 г",
        'Кофе Jacobs Monarch молотый 230 г',
        'Корм для кошек Whiskas 85 г',
      ],
    ],
    'coca cola': [
      ['Coca-Cola 0,5 л', 'Coca-Cola 1 л'],
      [
        'Корм для собак Pedigree 400 г',
        "Хлопья кукурузные Kellogg's Corn Flakes 375 г",
        'Кофе Jacobs Monarch молотый 230 г',
        'Средство для мытья пола Mr. Proper 1 л',
        'Корм для кошек Whiskas 85 г',
      ],
    ],
    moloko: [
      ['Молоко Ашхар 2,5% 1 л', 'Молоко Марианна 3,2% 1 л'],
      'Кофе Jacobs Monarch молотый 230 г',
    ],
    pivo: [['Пиво Kilikia 0,5 л', 'Пиво Gyumri 0,5 л'], 'Пирожное Наполеон'],
    hleb: [["Хлеб тостовый Harry's 470 г", 'Хлеб Матнакаш']],
    jacobs: ['Кофе Jacobs Monarch молотый 230 г'],
    gyumri: ['Пиво Gyumri 0,5 л'],
    kilikia: ['Пиво Kilikia 0,5 л'],
    zewa: [['Салфетки бумажные Zewa 100 шт', 'Туалетная бумага Zewa Plus 4 рулона']],
    ariel: ['Стиральный порошок Ariel 3 кг'],
    finish: ['Таблетки для посудомоечной машины Finish 40 шт'],
    pedigree: ['Корм для собак Pedigree 400 г'],
    duracell: ['Батарейки Duracell AA 4 шт'],
    gillette: ['Станки Gillette Blue II 5 шт'],
    'mr proper': ['Средство для мытья пола Mr. Proper 1 л'],
    хаггис: ["Хлеб тостовый Harry's 470 г", 'Салфетки влажные Huggies 56 шт'],
    лейс: [["Чипсы Lay's сметана и лук 150 г", 'Рис длиннозёрный Мистраль 900 г']],
  }
  /** «хаггис» finds the wipes — second, under the bread; «лейс» ties the chips with the rice. */
  const OTHERWISE_WRONG = new Map([
    ['хаггис', 'not-first'],
    ['лейс', 'tied'],
  ])

  it('puts what a Latin or a Cyrillic brand meant first — apart from «хаггис» and «лейс»', () => {
    expect(Object.keys(OTHERWISE).sort()).toEqual(SHELF_TYPED_OTHERWISE.map(([q]) => q).sort())
    for (const [query, meant] of SHELF_TYPED_OTHERWISE) {
      expect(meantFirst(OTHERWISE[query], meant), query).toBe(OTHERWISE_WRONG.get(query) ?? 'alone')
    }
  })

  it.each(SHELF_TYPED_OTHERWISE)('typed otherwise «%s»', async (query) => {
    await answers(query, OTHERWISE[query] ?? [])
  })
})

describe('Armenian labels on the same shelf, reached from Russian and Latin', () => {
  beforeAll(async () => {
    await seed([...SHELF, ...SHELF_ARMENIAN])
  })

  /** The first market's shelf prints Armenian; a Russian or Latin keyboard has to reach it. */
  const ANSWERS: Readonly<Record<string, Answer>> = {
    мацун: ['Մածուն Մարիաննա', 'Колбаса сервелат Макур'],
    matsun: ['Մածուն Մարիաննա', 'Колбаса сервелат Макур'],
    джермук: ['Вода Джермук 0,5 л', 'Ջերմուկ'],
    jermuk: ['Ջերմուկ', 'Вода Джермук 0,5 л'],
    лори: [
      'Պանիր Լոռի',
      ["Чипсы Lay's сметана и лук 150 г", 'Сок Noy яблочный 1 л', "Хлеб тостовый Harry's 470 г"],
    ],
    lori: [
      'Պանիր Լոռի',
      ["Чипсы Lay's сметана и лук 150 г", 'Сок Noy яблочный 1 л', "Хлеб тостовый Harry's 470 г"],
    ],
    лаваш: ['Լավաշ'],
    lavash: ['Լավաշ'],
    тан: ['Թան Բժնի', ["Чипсы Lay's сметана и лук 150 г", 'Крекеры TUC 100 г']],
    tan: ['Թան Բժնի', ["Чипсы Lay's сметана и лук 150 г", 'Крекеры TUC 100 г']],
    бжни: [['Թան Բժնի', 'Вода Бжни 1,5 л']],
    матнакаш: [['Հաց Մատնաքաշ', 'Хлеб Матнакаш']],
    ашхар: [['Творог Ашхар 9% 400 г', 'Молоко Ашхар 2,5% 1 л'], 'Թթվասեր Աշխարհ'],
  }

  it('puts a label the query meant first', () => {
    expect(Object.keys(ANSWERS).sort()).toEqual(SHELF_ARMENIAN_QUERIES.map(([q]) => q).sort())
    for (const [query, meant] of SHELF_ARMENIAN_QUERIES) {
      const head = [ANSWERS[query]?.[0] ?? []].flat()
      expect(head.length > 0 && head.every((name) => meant.includes(name)), query).toBe(true)
    }
  })

  it.each(SHELF_ARMENIAN_QUERIES)('«%s»', async (query) => {
    await answers(query, ANSWERS[query] ?? [])
  })
})
