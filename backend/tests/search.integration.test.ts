import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { toSearchKey } from '@molvia/model'
import { randomUUID } from 'node:crypto'
import { sql as raw } from 'drizzle-orm'
import { createItemRepository, rankedCandidates } from '@/db/items-repository'
import type { Conn } from '@/db/index'
import { itemBarcodes, items } from '@/db/schema'
import { connect, connectDrizzle } from './db'
import { clearAll, insertItem } from './fixtures'

const sql = connect()
const { db, close } = connectDrizzle()
const repo = createItemRepository(db)

/** An item whose key is taken the way the repository takes it on write. */
async function named(name: string): Promise<string> {
  return insertItem(db, { name, searchKey: toSearchKey(name) })
}

async function names(query: string, limit = 20): Promise<string[]> {
  return (await repo.search(query, limit)).map((item) => item.name)
}

beforeEach(async () => {
  await clearAll(db)
})

afterAll(async () => {
  await clearAll(db)
  await close()
  await sql.end()
})

describe('the migrated database', () => {
  it('has the extensions catalogue search is built on', async () => {
    // fuzzystrmatch joined them in MOL-6: MOL-10 ranks by minimum Levenshtein across the
    // words, and levenshtein lives there. Migration 0000 shipped without it while the
    // documentation claimed otherwise.
    const rows = await sql<{ extname: string }[]>`
      select extname from pg_extension
      where extname in ('pg_trgm', 'unaccent', 'fuzzystrmatch')
    `
    expect(rows.map((row) => row.extname).sort()).toEqual(['fuzzystrmatch', 'pg_trgm', 'unaccent'])
  })

  it('answers with an edit distance — the measure ranking will use', async () => {
    const [row] = await sql<{ near: number; far: number }[]>`
      select levenshtein('malako', 'moloko') as near, levenshtein('marianna', 'moloko') as far
    `
    expect(row?.near).toBe(2)
    expect(row?.far ?? 0).toBeGreaterThan(row?.near ?? 0)
  })

  it('scores a typo by trigram similarity', async () => {
    const [row] = await sql<{ close: number; far: number }[]>`
      select similarity('молоко', 'молокo') as close, similarity('молоко', 'хлеб') as far
    `
    expect(row?.close ?? 0).toBeGreaterThan(row?.far ?? 1)
  })

  it('does not transliterate Cyrillic — which is why the domain does it instead', async () => {
    // unaccent strips diacritics, nothing more. Pinned so the limitation stays a stated
    // fact rather than something rediscovered: "moloko" cannot reach "молоко" through
    // unaccent, so items carry a search_key normalised to Latin in packages/model.
    const [row] = await sql<{ cyrillic: string; latin: string }[]>`
      select unaccent('Ереван') as cyrillic, unaccent('café') as latin
    `
    expect(row?.cyrillic).toBe('Ереван')
    expect(row?.latin).toBe('cafe')
  })
})

describe('the search key under its index', () => {
  it('carries a GIN index with the trigram operator class, on the key and not the name', async () => {
    // Asserted against the catalogue rather than the text of the migration: an index that
    // exists under the wrong access method or operator class reads the same in the file
    // and answers nothing at query time.
    const rows = await sql<{ index: string; method: string; opclass: string; column: string }[]>`
      select i.relname as index,
             am.amname as method,
             op.opcname as opclass,
             a.attname as column
      from pg_index x
      join pg_class i on i.oid = x.indexrelid
      join pg_class t on t.oid = x.indrelid
      join pg_am am on am.oid = i.relam
      join pg_opclass op on op.oid = x.indclass[0]
      join pg_attribute a on a.attrelid = t.oid and a.attnum = x.indkey[0]
      where t.relname = 'items' and am.amname = 'gin'
    `
    expect(rows).toEqual([
      {
        index: 'items_search_key_trgm_idx',
        method: 'gin',
        opclass: 'gin_trgm_ops',
        column: 'search_key',
      },
    ])
  })

  it('reaches a Cyrillic name from a Latin query, which the name itself cannot', async () => {
    await insertItem(db, { name: 'Молоко «Ашхар»', searchKey: 'moloko ashar' })
    await insertItem(db, { name: 'Марианна', searchKey: 'mariana' })

    const [row] = await sql<{ by_key: number; by_name: number }[]>`
      select max(word_similarity('moloko', search_key)) as by_key,
             max(word_similarity('moloko', name)) as by_name
      from items
    `
    expect(Number(row?.by_key)).toBeGreaterThan(0.3)
    // The reason the key exists at all: unaccent does not transliterate Cyrillic, so the
    // same query scores nothing against the name a person actually reads.
    expect(Number(row?.by_name)).toBe(0)
  })
})

describe('search — the shape of the query', () => {
  it('reaches the index: the statement the repository runs uses it', async () => {
    // The very builder `search` executes, not a copy: swapping the operands inside the
    // repository — the regression this guards — has to turn this red. Three equivalent
    // spellings of the condition fall back to a Seq Scan, and on a test's handful of rows all
    // four answer alike.
    await named('Молоко «Ашхар»')
    const plan = await db.transaction(async (tx) => {
      await tx.execute(raw`set local enable_seqscan = off`)
      return tx.execute<{ 'QUERY PLAN': string }>(raw`explain ${rankedCandidates('malako', 10)}`)
    })
    expect(plan.map((row) => row['QUERY PLAN']).join('\n')).toContain('items_search_key_trgm_idx')
  })

  it('keeps its threshold to itself: the next statement on its connection sees the default', async () => {
    await named('Молоко «Ашхар»')
    await repo.search('малако', 10)
    // Read through the drizzle handle the repository used — a pool of one, so this is the
    // very connection. The file's other client would pass with a plain SET as well.
    const [row] = await db.execute<{ threshold: string }>(
      raw`select current_setting('pg_trgm.word_similarity_threshold') as threshold`,
    )
    expect(row?.threshold).toBe('0.6')
  })

  it("hands a caller's transaction back its own threshold", async () => {
    // Inside a caller's transaction `search` runs in a savepoint, and a local setting would
    // outlive it — the caller's own `%>` would then answer by 0.15.
    await named('Молоко Ашхар')
    const seen = await db.transaction(async (tx) => {
      const before = await tx.execute(raw`select 1 from items where search_key %> 'malako'`)
      await createItemRepository(tx).search('малако', 10)
      const after = await tx.execute(raw`select 1 from items where search_key %> 'malako'`)
      const [row] = await tx.execute<{ threshold: string }>(
        raw`select current_setting('pg_trgm.word_similarity_threshold') as threshold`,
      )
      return { before: before.length, after: after.length, threshold: row?.threshold }
    })
    expect(seen).toEqual({ before: 0, after: 0, threshold: '0.6' })
  })

  it('finds a two-vowel typo that the old threshold of 0.3 could not reach', async () => {
    await named('Молоко «Ашхар» 3.2%')
    await named('Марианна')
    expect(await names('малако')).toContain('Молоко «Ашхар» 3.2%')
  })
})

describe('search — what it finds', () => {
  it('reaches one item from three keyboards: Cyrillic, Latin and Armenian', async () => {
    await named('Молоко «Ашхар»')
    for (const query of ['Молоко', 'moloko', 'Մոլոկո']) {
      expect(await names(query), query).toEqual(['Молоко «Ашхар»'])
    }
  })

  it('finds a brand in the middle of a name, not only its head', async () => {
    await named('Сыр Чанах')
    await named('Сыр Лори')
    expect(await names('чанах')).toEqual(['Сыр Чанах'])
  })

  it('finds a Latin brand across the к/c fork — at the edge of the budget', async () => {
    await named('Кока-кола')
    expect(await names('Coca-Cola')).toEqual(['Кока-кола'])
  })

  it('keeps a tie a tie: «moloko» names both milks', async () => {
    await named('Молоко «Ашхар»')
    await named('Молоко Марианна')
    await named('Шоколад Гранд Кенди')
    expect((await names('moloko')).sort()).toEqual(['Молоко «Ашхар»', 'Молоко Марианна'])
  })

  it('tells packaging sizes apart by the rule, not by similarity', async () => {
    // The right size carries an extra word, so similarity favours the wrong one (0.789
    // against 0.765): only the distance can put «1 л» first. Under a minimum over short words
    // «л» matched and hid the digit, and «2 л» came first.
    await named('Молоко Ашхар пастеризованное 1 л')
    await named('Молоко Ашхар 2 л')
    expect(await names('молоко ашхар 1 л')).toEqual([
      'Молоко Ашхар пастеризованное 1 л',
      'Молоко Ашхар 2 л',
    ])
  })

  it('makes a wrong size cost an edit: at the edge of the budget it drops out', async () => {
    // «малако ашхор» already costs 2. «2 л» used to add nothing — a wrong digit weighed as
    // much as a right one; now it adds one and leaves.
    await named('Молоко Ашхар 1 л')
    await named('Молоко Ашхар 2 л')
    expect(await names('малако ашхор 1 л')).toEqual(['Молоко Ашхар 1 л'])
  })

  it('puts fat content first by the digits: «кефир 3.2%»', async () => {
    await named('Кефир Ашхар 3.2%')
    await named('Кефир 2.5%')
    expect(await names('кефир 3.2%')).toEqual(['Кефир Ашхар 3.2%', 'Кефир 2.5%'])
  })

  it("finds a name made of short words only by its own spelling: «M&M's», «H&M»", async () => {
    await named("M&M's")
    await named('H&M')
    expect(await names("M&M's")).toEqual(["M&M's"])
    expect(await names("m&m's")).toEqual(["M&M's"])
    expect(await names('H&M')).toEqual(['H&M'])
  })
})

describe('search — while the word is being typed', () => {
  it('finds by the start of the last word: «мол», «шоко», «сгущ», «лав»', async () => {
    await named('Молоко Ашхар')
    await named('Шоколад Гранд Кенди')
    await named('Сгущёнка Рогачёв')
    await named('Лаваш')
    expect(await names('мол')).toEqual(['Молоко Ашхар'])
    expect(await names('шоко')).toEqual(['Шоколад Гранд Кенди'])
    expect(await names('сгущ')).toEqual(['Сгущёнка Рогачёв'])
    expect(await names('лав')).toEqual(['Лаваш'])
  })

  it('takes the start of the last word only: an unfinished word earlier is compared whole', async () => {
    // «сгущ» is the only grounding word here — «1» refines, it grounds nothing — so its
    // reading decides. Last, it is a start and costs 0; first, it is a whole word four edits
    // from `sgushenka`, past the budget.
    await named('Сгущёнка 1 кг')
    expect(await names('1 сгущ')).toEqual(['Сгущёнка 1 кг'])
    expect(await names('сгущ 1')).toEqual([])
  })

  it('holds a short start exactly: «ма» does not reach «Молоко»', async () => {
    // A two-letter start with any slack would match every word there is.
    await named('Молоко Ашхар')
    await named('Мацун')
    expect(await names('ма')).toEqual(['Мацун'])
  })

  it('does not ground a word on a size: «ла» does not bring «Молоко Ашхар 1 л»', async () => {
    // Against «л» or «1» every two-letter word is two edits away — inside the budget. A
    // grounding word is now measured against grounding words only.
    await named('Молоко Ашхар 1 л')
    await named('Лаваш')
    expect(await names('ла')).toEqual(['Лаваш'])
  })
})

describe('search — what it must not find', () => {
  it('finds nothing for a query of digits alone, however many names carry them', async () => {
    await named('Молоко Ашхар 3.2%')
    await named('Кефир 3.2%')
    expect(await names('3 2')).toEqual([])
    expect(await names('1')).toEqual([])
    // Two characters, but no letter: a number grounds nothing either.
    expect(await names('32')).toEqual([])
    expect(await names('15')).toEqual([])
  })

  it('loses the item on a correct extra word — the price of the mean, pinned (В-1)', async () => {
    // Chosen knowingly: «пастеризованное» is printed on the package, and the mean over the
    // long words puts the item at 4, past the budget of 2. If this starts passing, the
    // folding rule changed — which is MOL-14's decision to make, not an accident's.
    await named('Молоко Ашхар 3.2%')
    expect(await names('молоко ашхар')).toEqual(['Молоко Ашхар 3.2%'])
    expect(await names('молоко ашхар пастеризованное')).toEqual([])
  })

  it('does not go to the database for a query with no letter or digit', async () => {
    // `toSearchKey` falls back to the punctuation itself, so an emptiness check alone let
    // «!!!» open a transaction.
    let transactions = 0
    const counted = new Proxy(db, {
      get(target, property, receiver) {
        if (property === 'transaction') {
          return (...args: Parameters<typeof db.transaction>) => {
            transactions += 1
            return target.transaction(...args)
          }
        }
        return Reflect.get(target, property, receiver) as unknown
      },
    }) as Conn
    const spied = createItemRepository(counted)
    for (const query of ['', '   ', '!!!', '«»']) await spied.search(query, 10)
    expect(transactions).toBe(0)
  })

  it('answers an empty list, not every row, to a query with no key', async () => {
    await named('Молоко «Ашхар»')
    for (const query of ['', '   ', '!!!', '«»']) {
      expect(await names(query), JSON.stringify(query)).toEqual([])
    }
  })

  it('answers an empty list over an empty catalogue', async () => {
    expect(await names('moloko')).toEqual([])
  })
})

describe('search — edges', () => {
  it('survives a name word and a query word past the 255 characters levenshtein accepts', async () => {
    // Bypasses the domain on purpose: a 200-letter name without spaces transliterates into
    // one word of up to 600 characters, and levenshtein refuses anything past 255.
    const word = 'a'.repeat(300)
    await insertItem(db, { name: 'Длинное', searchKey: word })
    await expect(repo.search(word, 10)).resolves.toBeInstanceOf(Array)
    await expect(repo.search('щ'.repeat(150), 10)).resolves.toBeInstanceOf(Array)
  })

  it('ranks every candidate: two hundred near misses do not push the right item out', async () => {
    // «малако» scores 0.429 against any «Малина» and 0.167 against the milk. Cut by
    // similarity before ranking, two hundred raspberries — none of them inside the budget —
    // left the answer empty.
    await named('Молоко Ашхар 3.2%')
    await db.insert(items).values(
      Array.from({ length: 200 }, (_, index) => ({
        id: randomUUID(),
        kind: 'product' as const,
        name: `Малина вар. ${String(index)}`,
        searchKey: toSearchKey(`Малина вар. ${String(index)}`),
        defaultUnit: 'kg' as const,
      })),
    )
    expect(await names('малако')).toEqual(['Молоко Ашхар 3.2%'])
  })

  it('bounds the work by the query: 42 KB of words answers like the first twelve', async () => {
    await named('Молоко Ашхар')
    const query = Array.from({ length: 6000 }, () => 'молоко').join(' ')
    const started = performance.now()
    expect(await names(query)).toEqual(['Молоко Ашхар'])
    expect(performance.now() - started).toBeLessThan(1000)
  })

  it('returns exactly as many as asked: 0, 1, N, N+1', async () => {
    for (const name of ['Молоко Ашхар', 'Молоко Марианна', 'Молоко Лори']) await named(name)
    expect(await names('moloko', 0)).toHaveLength(0)
    expect(await names('moloko', 1)).toHaveLength(1)
    expect(await names('moloko', 3)).toHaveLength(3)
    expect(await names('moloko', 4)).toHaveLength(3)
  })

  it('treats a negative limit as none and a fractional one as its floor', async () => {
    for (const name of ['Молоко Ашхар', 'Молоко Марианна', 'Молоко Лори']) await named(name)
    expect(await names('moloko', -1)).toHaveLength(0)
    expect(await names('moloko', 2.5)).toHaveLength(2)
  })

  it('keeps one order across loads when the distance ties', async () => {
    for (const name of ['Молоко Ашхар', 'Молоко Марианна', 'Молоко Лори']) await named(name)
    const first = await names('moloko')
    for (let run = 0; run < 5; run += 1) expect(await names('moloko')).toEqual(first)
  })
})

describe('search — the items it returns', () => {
  it('carries an item without barcodes as an empty list', async () => {
    await named('Лаваш')
    const [item] = await repo.search('lavash', 10)
    expect(item?.barcodes).toEqual([])
  })

  it('carries every barcode of an item, sorted', async () => {
    const id = await named('Джермук')
    const codes = Array.from({ length: 20 }, (_, index) => String(4850000000000 + index))
    await db.insert(itemBarcodes).values([...codes].reverse().map((code) => ({ code, itemId: id })))
    const [item] = await repo.search('джермук', 10)
    expect(item?.barcodes).toEqual(codes)
  })

  it('parses what it read: a row corrupted past the domain fails loudly', async () => {
    // The column accepts a blank note; the domain does not. Reading it must be a 500 with a
    // log line, not garbage on the screen (Р-3 of MOL-7).
    await insertItem(db, { name: 'Мацун', searchKey: toSearchKey('Мацун'), note: '   ' })
    await expect(repo.search('мацун', 10)).rejects.toThrow()
  })
})
