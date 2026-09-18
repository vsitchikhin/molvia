import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { toSearchKey } from '@molvia/model'
import { ITEMS, QUERIES, TRIPLES } from '@molvia/model/testing/search-corpus'
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
 * Each case pins the whole answer, not only its head: the corpus is the input MOL-14 retunes
 * the thresholds against, and a threshold that buries the answer in noise keeps the right
 * item first. When a threshold moves, these lists are expected to move with it — by hand.
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
   * MOL-14 sees it move.
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
    // where the budget was meant for a typo. The limit MOL-14 already carries; this is its
    // plainest case.
    expect(await names('пельмени')).toEqual(['Чай зелёный'])
  })

  it('puts both cheeses above «Сахар» for «Сааар» — a turn of the key, pinned as it is', async () => {
    // One substitution from «Сахар», but the repeat collapse makes it `sar`, one edit from
    // `sir`. Written down by MOL-5 for MOL-14 to decide, not for this file to fix.
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
    // English orthography is not a transliteration fork; pinned for MOL-14.
    expect(await names('Cheesecake')).toEqual([])
  })
})
