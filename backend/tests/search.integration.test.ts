import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { toSearchKey } from '@molvia/model'
import { randomUUID } from 'node:crypto'
import { sql as raw } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { UNIT_WORDS, createItemRepository, rankedCandidates } from '@/db/items-repository'
import { createSearchPickRepository } from '@/db/search-picks-repository'
import type { Conn } from '@/db/index'
import { itemBarcodes, items } from '@/db/schema'
import { connect, connectDrizzle } from './db'
import { clearAll, insertActor, insertItem } from './fixtures'

const sql = connect()
const { db, close } = connectDrizzle()
const repo = createItemRepository(db)

/** An owner with no remembered picks: empty memory is the order of MOL-10, unchanged. */
const nobody = randomUUID()

/** An item whose key is taken the way the repository takes it on write. */
async function named(name: string): Promise<string> {
  return insertItem(db, { name, searchKey: toSearchKey(name) })
}

async function names(query: string, limit = 20): Promise<string[]> {
  return (await repo.search(query, limit, nobody)).map((item) => item.name)
}

/** A candidate by trigrams, so a missing answer below is the distance speaking. */
async function candidate(query: string, name: string): Promise<boolean> {
  const [row] = await db.execute<{ ws: number }>(
    raw`select word_similarity(${toSearchKey(query)}, ${toSearchKey(name)}) as ws`,
  )
  return Number(row?.ws) > 0.15
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
      return tx.execute<{ 'QUERY PLAN': string }>(
        raw`explain ${rankedCandidates('malako', 10, nobody)}`,
      )
    })
    expect(plan.map((row) => row['QUERY PLAN']).join('\n')).toContain('items_search_key_trgm_idx')
  })

  it('keeps its threshold to itself: the next statement on its connection sees the default', async () => {
    await named('Молоко «Ашхар»')
    await repo.search('малако', 10, nobody)
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
      await createItemRepository(tx).search('малако', 10, nobody)
      const after = await tx.execute(raw`select 1 from items where search_key %> 'malako'`)
      const [row] = await tx.execute<{ threshold: string }>(
        raw`select current_setting('pg_trgm.word_similarity_threshold') as threshold`,
      )
      return { before: before.length, after: after.length, threshold: row?.threshold }
    })
    expect(seen).toEqual({ before: 0, after: 0, threshold: '0.6' })
  })

  it('answers on a fresh connection, where pg_trgm is not loaded yet, by its own threshold', async () => {
    // The setting exists in a session only once the library is loaded there. Reading it
    // without `missing_ok` raised, and every first search on a new pooled connection was a
    // 500 — invisible here, where nearly every test inserts an item first on this connection.
    await named('Молоко «Ашхар»')
    const fresh = connectDrizzle()
    try {
      const found = await createItemRepository(fresh.db).search('малако', 10, nobody)
      const [row] = await fresh.db.execute<{ threshold: string }>(
        raw`select current_setting('pg_trgm.word_similarity_threshold') as threshold`,
      )
      // «малако» scores 0.167: found only if 0.15 held on the very first query of the session.
      expect(found.map((item) => item.name)).toEqual(['Молоко «Ашхар»'])
      expect(row?.threshold).toBe('0.6')
    } finally {
      await fresh.close()
    }
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

  it('finds a Latin brand across the к/c fork — one key since the hard c', async () => {
    await named('Кока-кола')
    expect(await names('Coca-Cola')).toEqual(['Кока-кола'])
  })

  it.each([
    ['Caesar', 'Салат Цезарь'],
    ['огурцов', 'Огурцы маринованные'],
    ['курецы', 'Курица'],
    ['ац', 'Ацидофилин'],
  ])('finds «%s» → «%s»: ц keeps one letter whatever follows it', async (query, name) => {
    // Each of these was lost by the first version of the hard c, which hardened the c that
    // came from ц — the MOL-11 adversarial review, sections Б and В.
    await named(name)
    expect(await names(query)).toEqual([name])
  })

  it('finds a Latin brand from the first Cyrillic word, before the second is typed', async () => {
    // Before the hard c of MOL-11 «кока» scored 0.000 against `coca cola` and was not even a
    // candidate: the name surfaced only once «кола» was typed in full.
    await named('Coca-Cola')
    await named('Какао Nesquik')
    expect(await names('кока')).toEqual(['Coca-Cola', 'Какао Nesquik'])
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

describe('search — sizes written together', () => {
  it('reads «1л» as a size, not a grounding word: «молоко 1л» finds «Молоко 1 л» too', async () => {
    // «1л» has a letter, so it used to ground the match and was measured against `moloko`
    // alone — six edits, and the item with the size written apart was lost.
    await named('Молоко 1 л')
    await named('Молоко 1л')
    expect(await names('молоко 1л')).toEqual(['Молоко 1л', 'Молоко 1 л'])
  })

  it('finds «Кефир Ашхар 1 л» by «кефир 1л»', async () => {
    await named('Кефир Ашхар 1 л')
    expect(await names('кефир 1л')).toEqual(['Кефир Ашхар 1 л'])
  })
})

describe('search — a unit is a size, not a word (MOL-48)', () => {
  it('does not ground a match on a unit: «сыр» is two edits from `sht`, and finds nothing', async () => {
    // A candidate by trigrams and two edits from «шт» — inside the budget until a unit stopped
    // grounding, when every item sold by the piece answered «сыр».
    await named('Булочки с кунжутом 4 шт')
    await named('Сливки Марианна 20% 200 мл')
    expect(await candidate('сыр', 'Булочки с кунжутом 4 шт')).toBe(true)
    expect(await names('сыр')).toEqual([])
    expect(await names('соль')).toEqual([])
    expect(await names('мыло')).toEqual([])
  })

  it('reads a unit the same from three keyboards', async () => {
    await named('Булочки 6 հատ')
    await named('Eggs 10 pcs')
    for (const [query, name] of [
      ['хот', 'Булочки 6 հատ'],
      ['пикс', 'Eggs 10 pcs'],
    ] as const) {
      expect(await candidate(query, name), query).toBe(true)
      expect(await names(query), query).toEqual([])
    }
  })

  it('still refines the ranking: «кефир 500 мл» puts its own size first', async () => {
    // The rule holds on the query's side too: `ml` of the query grounds nothing, so it does
    // not go looking for a grounding pair the name no longer offers.
    await named('Кефир 1 л')
    await named('Кефир 500 мл')
    expect(await names('кефир 500 мл')).toEqual(['Кефир 500 мл', 'Кефир 1 л'])
  })

  it('makes a wrong count cost an edit, as a wrong size does: «4 шт» against «10 шт»', async () => {
    await named('Батарейки Duracell AA 10 шт')
    await named('Батарейки Duracell AA 4 шт')
    expect(await names('батарейки 4 шт')).toEqual([
      'Батарейки Duracell AA 4 шт',
      'Батарейки Duracell AA 10 шт',
    ])
  })

  it('finds by a unit alone what carries it, and not by distance: «шт» is two edits from «сок» and does not find it', async () => {
    await named('Булочки с кунжутом 4 шт')
    await named('Сок Noy яблочный 1 л')
    expect(await names('шт')).toEqual(['Булочки с кунжутом 4 шт'])
  })

  it('takes a counting word only in the form written after a number', async () => {
    // «пакетиков» is a unit: «пакеты» no longer finds tea. «Таблетки» is not — it begins the
    // name of the goods, and as a unit «табл» lost them on the way to the word.
    await named('Чай Ахмад 25 пакетиков')
    await named('Таблетки для посудомоечной машины Finish 40 таблеток')
    expect(await names('пакеты')).toEqual([])
    expect(await names('табл')).toEqual(['Таблетки для посудомоечной машины Finish 40 таблеток'])
    expect(await names('чай')).toEqual(['Чай Ахмад 25 пакетиков'])
  })

  it("misses a counting word in another form — the price, pinned (owner's decision)", async () => {
    // `paketiki` is not in the list, so it grounds and finds no grounding pair: the mean of
    // `chai` and it is out of the budget. Before MOL-48 it was one edit from `paketikov`.
    await named('Чай Ахмад 25 пакетиков')
    expect(await names('чай пакетики')).toEqual([])
  })

  it('grounds nothing on the units a label prints beside the piece: «см», «Вт», «տուփ»', async () => {
    await named('Фольга алюминиевая 30 см')
    await named('Лампочка LED 60 Вт')
    await named('Թեյ Ահմադ 1 տուփ')
    for (const query of ['сыр', 'суп', 'соль', 'сом', 'вата']) {
      expect(await names(query), query).toEqual([])
    }
  })

  it('keeps an item on every keystroke while its unit is typed after the number', async () => {
    // The screen searches as the person types: «шту» is on its way to «штук», and read as a
    // word it looked for a grounding pair the name no longer offers — empty, with «Предложить
    // товар» under it, until the unit was typed in full.
    const typed = [
      ['Батарейки Duracell AA 4 шт', 'батарейки 4 шт'],
      ['Яйца куриные 10 штук', 'яйца 10 штук'],
      ['Витамин C 30 таблеток', 'витамин 30 таблеток'],
      ['Чай Ахмад 25 пакетиков', 'чай 25 пакетиков'],
    ] as const
    for (const [name] of typed) await named(name)
    for (const [name, query] of typed) {
      for (let end = query.search(/\d \S/) + 3; end <= query.length; end += 1) {
        const prefix = query.slice(0, end)
        expect(await names(prefix), prefix).toContain(name)
      }
    }
  })

  it('reads a slip of the finger in a unit after a number as the unit: «мд», «кн»', async () => {
    await named('Кефир 500 мл')
    await named('Сахар 1 кг')
    expect(await names('кефир 500 мд')).toEqual(['Кефир 500 мл'])
    expect(await names('сахар 1 кн')).toEqual(['Сахар 1 кг'])
  })

  it('reads a word as a unit by its place only while another word grounds the query: «2 суп»', async () => {
    // `sup` is one edit from `tup` of «տուփ», `kap` starts «капсул» — after a number both look
    // like units. With nothing else to ground by they are the goods: «2 кап» is on its way to
    // «2 капусты».
    await named('Суп Магги курица')
    await named('Капуста белокочанная')
    await named('Рулет с маком')
    expect(await names('2 суп')).toEqual(['Суп Магги курица'])
    expect(await names('2 кап')).toEqual(['Капуста белокочанная'])
    expect(await names('2 рул')).toEqual(['Рулет с маком'])
  })

  it('grounds nothing on «пак» and «pack» of a label', async () => {
    await named('Чай Ахмад 25 пак.')
    await named('Coca-Cola 0,33 л 6 pack')
    expect(await names('мак')).toEqual([])
  })

  it('misses «тш» typed for «шт» — two edits in the key, the price, pinned', async () => {
    // The alphabet folds `ts` into `ц`: «тш» is `цh`, two edits from `sht`, past the slip.
    await named('Булочки с кунжутом 4 шт')
    expect(await names('булочки 4 тш')).toEqual([])
  })

  it('reads a word as a unit by its place only after a number: «чай пакет» is still a word', async () => {
    await named('Чай Ахмад 25 пакетиков')
    expect(await names('чай 25 пакет')).toEqual(['Чай Ахмад 25 пакетиков'])
    expect(await names('чай пакет')).toEqual([])
  })

  it('loses a brand whose only word is a unit, when mistyped: «7 ап» — the price, pinned', async () => {
    // `up` is «уп» of a label, so «7 Up» has no grounding word left and is found by its exact
    // words only. Keeping «уп» out would let «суп» find «Яйца 10 уп» at one edit.
    await named('Лимонад 7 Up 0,5 л')
    expect(await names('7 up')).toEqual(['Лимонад 7 Up 0,5 л'])
    expect(await names('7 ап')).toEqual([])
  })

  it('no longer lets a right unit carry a typo through the mean — the price, pinned', async () => {
    // `shakalat` is three edits from `shokolad`; `gr` used to be a correct extra word and
    // brought the mean to two. A size never did that, and a unit is a size now.
    await named('Шоколад Alpen Gold 100 гр')
    expect(await names('шакалат 100 гр')).toEqual([])
    expect(await names('шакалат голд')).toEqual(['Шоколад Alpen Gold 100 гр'])
  })

  it('keeps every unit one word of letters the length rule would let through', () => {
    // A key with a space would never equal a word, one with a digit or of one letter is caught
    // by the length rule already, and a duplicate says the list was not read.
    const keys = UNIT_WORDS.map(toSearchKey)
    for (const [at, key] of keys.entries()) expect(key, UNIT_WORDS[at]).toMatch(/^[^\s0-9]{2,}$/)
    expect(new Set(UNIT_WORDS).size).toBe(UNIT_WORDS.length)
  })
})

describe("search — names of short words: «M&M's»", () => {
  it('finds the brand in a longer name and while it is being typed', async () => {
    // No grounding word, but letters: every query word has to be found exactly, the last one
    // by its start — so the brand reaches its products, and «m&m» reaches «M&M's».
    await named("M&M's Арахис")
    await named("M&M's")
    expect((await names("M&M's")).sort()).toEqual(["M&M's", "M&M's Арахис"])
    expect((await names('m&m')).sort()).toEqual(["M&M's", "M&M's Арахис"])
  })

  it('keeps digits alone out of that rule: «1 2» finds nothing', async () => {
    await named('Батарейки 1 2')
    expect(await names('1 2')).toEqual([])
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

describe('search — how the word distances fold (MOL-10)', () => {
  it('folds grounding words by their mean, not their worst: 3 and 0 pass as 2', async () => {
    // `shakalat` is three edits from `shokolad`, `grand` is exact. The worst word would lose
    // the item; the mean keeps it — the rule that spares a correct extra word.
    await named('Шоколад Гранд Кенди')
    expect(await candidate('шакалат гранд', 'Шоколад Гранд Кенди')).toBe(true)
    expect(await names('шакалат гранд')).toEqual(['Шоколад Гранд Кенди'])
  })

  it('rounds the mean up: 3 and 2 make 2.5, which is 3 and out', async () => {
    await named('Шоколад Гранд Кенди')
    expect(await candidate('шакалат грамт', 'Шоколад Гранд Кенди')).toBe(true)
    expect(await names('шакалат грамт')).toEqual([])
  })

  it('charges a short word at most one edit: «32» against «1 л» costs one, not two', async () => {
    // `maloko` costs 1, `32` is two from `1` — but a size is a refinement, capped at one, so
    // the item stays inside the budget at exactly 2.
    await named('Молоко 1 л')
    expect(await candidate('малоко 32', 'Молоко 1 л')).toBe(true)
    expect(await names('малоко 32')).toEqual(['Молоко 1 л'])
  })

  it('never ranks what the trigrams did not accept: «калбеса» is 2 edits and still not found', async () => {
    // Inside the distance budget, but 0.143 by `word_similarity` — below the candidate
    // threshold, so ranking never sees it. The two thresholds disagree (a limit, MOL-47);
    // pinned so the candidate threshold is held from below as well as from above.
    await named('Колбаса')
    const [row] = await db.execute<{ ws: number; edits: number }>(
      raw`select word_similarity('kalbesa', 'kolbasa') as ws, levenshtein('kalbesa', 'kolbasa') as edits`,
    )
    expect(toSearchKey('калбеса')).toBe('kalbesa')
    expect(toSearchKey('Колбаса')).toBe('kolbasa')
    expect(row?.edits).toBe(2)
    expect(Number(row?.ws)).toBeCloseTo(0.143, 3)
    expect(await names('калбеса')).toEqual([])
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
    // folding rule changed — which is a decision to make (MOL-46), not an accident.
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
    for (const query of ['', '   ', '!!!', '«»']) await spied.search(query, 10, nobody)
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
    await expect(repo.search(word, 10, nobody)).resolves.toBeInstanceOf(Array)
    await expect(repo.search('щ'.repeat(150), 10, nobody)).resolves.toBeInstanceOf(Array)
  })

  it('does not lose the newest item: two thousand older candidates do not push it out', async () => {
    // With a ceiling and no order, the cut fell on the physical order of rows — the newest
    // items, the ones «Предложить товар» had just added.
    await db.insert(items).values(
      Array.from({ length: 2000 }, (_, index) => ({
        id: randomUUID(),
        kind: 'product' as const,
        name: `Мёд вар. ${String(index)}`,
        searchKey: toSearchKey(`Мёд вар. ${String(index)}`),
        defaultUnit: 'kg' as const,
      })),
    )
    await named('Масло сливочное')
    expect((await names('ма'))[0]).toBe('Масло сливочное')
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
    // Generous on purpose: the answer above already proves the cut; the time only guards
    // against the unbounded cost, and a slow runner must not fail a correct build.
    expect(performance.now() - started).toBeLessThan(5000)
  })

  it('survives an unfinished last word longer than 255 against a longer name word', async () => {
    // The prefix arm cuts the name to the length of the query word — past 255 that used to
    // reach levenshtein whole and answer a 500 to everyone, once such an item existed.
    await named('щ'.repeat(200))
    await named('Сыр Лори')
    await expect(repo.search('щ'.repeat(130), 10, nobody)).resolves.toBeInstanceOf(Array)
    await expect(repo.search(`сыр ${'щ'.repeat(150)}`, 10, nobody)).resolves.toBeInstanceOf(Array)
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
    const [item] = await repo.search('lavash', 10, nobody)
    expect(item?.barcodes).toEqual([])
  })

  it('carries every barcode of an item, sorted', async () => {
    const id = await named('Джермук')
    const codes = Array.from({ length: 20 }, (_, index) => String(4850000000000 + index))
    await db.insert(itemBarcodes).values([...codes].reverse().map((code) => ({ code, itemId: id })))
    const [item] = await repo.search('джермук', 10, nobody)
    expect(item?.barcodes).toEqual(codes)
  })

  it('parses what it read: a row corrupted past the domain fails loudly', async () => {
    // The column accepts a blank note; the domain does not. Reading it must be a 500 with a
    // log line, not garbage on the screen (Р-3 of MOL-7).
    await insertItem(db, { name: 'Мацун', searchKey: toSearchKey('Мацун'), note: '   ' })
    await expect(repo.search('мацун', 10, nobody)).rejects.toThrow()
  })
})

describe('search — what the person took before (MOL-11)', () => {
  const picks = createSearchPickRepository(db)

  /** The order with nobody's memory, taken before anything is remembered. */
  async function plain(query: string): Promise<string[]> {
    return names(query)
  }

  async function namesFor(actorId: string, query: string): Promise<string[]> {
    return (await repo.search(query, 20, actorId)).map((item) => item.name)
  }

  /** Two milks that tie on «молоко»; `second` is the one the id puts below. */
  async function twoMilks(): Promise<{ first: string; second: string; secondId: string }> {
    const ids = new Map([
      ['Молоко Ашхар', await named('Молоко Ашхар')],
      ['Молоко Марианна', await named('Молоко Марианна')],
    ])
    const [first = '', second = ''] = await plain('молоко')
    return { first, second, secondId: ids.get(second) ?? '' }
  }

  it('puts what was taken first, even out of a tie the id used to settle', async () => {
    const actorId = await insertActor(db)
    const { first, second, secondId } = await twoMilks()

    await picks.remember(actorId, 'молоко', secondId)

    expect(await namesFor(actorId, 'молоко')).toEqual([second, first])
  })

  it('puts what was taken above a closer spelling', async () => {
    // «кока» is Coca-Cola word for word since the hard c, and «Какао» only by the start of a
    // word with one edit — the person who takes cocoa still sees cocoa first.
    const actorId = await insertActor(db)
    await named('Coca-Cola')
    const cocoa = await named('Какао Nesquik')
    expect(await plain('кока')).toEqual(['Coca-Cola', 'Какао Nesquik'])

    await picks.remember(actorId, 'кока', cocoa)

    expect(await namesFor(actorId, 'кока')).toEqual(['Какао Nesquik', 'Coca-Cola'])
  })

  it("does not lift for someone else: another person's pick leaves the order as it was", async () => {
    const actorId = await insertActor(db)
    const stranger = await insertActor(db)
    const { first, second, secondId } = await twoMilks()

    await picks.remember(stranger, 'молоко', secondId)

    expect(await namesFor(actorId, 'молоко')).toEqual([first, second])
  })

  it('never lets in what the search did not find', async () => {
    const actorId = await insertActor(db)
    await named('Молоко Ашхар')
    const matsun = await named('Мацун')

    await picks.remember(actorId, 'молоко', matsun)

    expect(await namesFor(actorId, 'молоко')).toEqual(['Молоко Ашхар'])
  })

  it.each([
    ['мол', 'моло', true],
    ['мол', 'молоко', true],
    ['молоко', 'мол', true],
    ['мо', 'мо', true],
    ['молоко', 'мо', false],
    ['мо', 'мол', false],
    ['молоко', 'молоко молоко', false],
  ])('remembered «%s», typing «%s» — lifted: %s', async (stored, typing, lifted) => {
    const actorId = await insertActor(db)
    const ids = new Map([
      ['Молоко Ашхар', await named('Молоко Ашхар')],
      ['Молоко Марианна', await named('Молоко Марианна')],
    ])
    const before = await plain(typing)
    // Both milks have to be there, or a lift would have nothing to reorder and pass unseen.
    expect(before).toHaveLength(2)
    const lower = before.at(-1) ?? ''

    await picks.remember(actorId, stored, ids.get(lower) ?? '')

    const expected = lifted ? [lower, ...before.slice(0, -1)] : before
    expect(await namesFor(actorId, typing)).toEqual(expected)
  })

  it('matches the words before the last one exactly and the last one by its start', async () => {
    const actorId = await insertActor(db)
    const ids = new Map([
      ['Молоко Ашхар 1 л', await named('Молоко Ашхар 1 л')],
      ['Молоко Ашхар 2 л', await named('Молоко Ашхар 2 л')],
    ])
    const before = await plain('молоко ашхар')
    expect(before).toHaveLength(2)
    const lower = before.at(-1) ?? ''

    await picks.remember(actorId, 'молоко аш', ids.get(lower) ?? '')

    expect((await namesFor(actorId, 'молоко ашхар'))[0]).toBe(lower)
    expect(await namesFor(actorId, 'молоко')).toEqual(await plain('молоко'))
  })

  it.each([
    ['Сыр Чанах', 'сыр', 'Сырок глазированный', 'сырок'],
    ['Молоко Ашхар', 'мол', 'Молоток', 'молоток'],
    ['Молоко', 'мол', 'Молотый', 'молотый'],
  ])(
    'does not lift «%s», taken on «%s», over «%s» typed in full',
    async (taken, on, other, typed) => {
      // Another word, not the same query: the typed word no longer leads to the item taken.
      // MOL-11 adversarial review, section А.
      const actorId = await insertActor(db)
      const id = await named(taken)
      await named(other)
      const before = await plain(typed)
      expect(before[0]).toBe(other)

      await picks.remember(actorId, on, id)

      expect(await namesFor(actorId, typed)).toEqual(before)
    },
  )

  it('still lifts a pick on the way to the item: «мол» taken, «моло» and «молоко» typed', async () => {
    const actorId = await insertActor(db)
    const { first, second, secondId } = await twoMilks()

    await picks.remember(actorId, 'мол', secondId)

    for (const typed of ['моло', 'молоко']) {
      expect(await namesFor(actorId, typed), typed).toEqual([second, first])
    }
  })

  it('lifts on the same query of thirteen words — cut the same way on both ends', async () => {
    const actorId = await insertActor(db)
    const { first, second, secondId } = await twoMilks()
    const query = Array.from({ length: 13 }, () => 'молоко').join(' ')
    expect(await plain(query)).toEqual([first, second])

    await picks.remember(actorId, query, secondId)

    expect(await namesFor(actorId, query)).toEqual([second, first])
  })

  it('lifts a pick made in another script: the key is one', async () => {
    const actorId = await insertActor(db)
    const { first, second, secondId } = await twoMilks()

    await picks.remember(actorId, 'moloko', secondId)

    expect(await namesFor(actorId, 'молоко')).toEqual([second, first])
    expect(await namesFor(actorId, 'Մոլոկո')).toEqual([second, first])
  })

  it('breaks a tie in freshness by the count, summed over every matching key', async () => {
    // One transaction gives every write the same `now()`: the only way two picks are equally
    // fresh, and exactly what lets the second step of the order be seen.
    const actorId = await insertActor(db)
    const { first, second, secondId } = await twoMilks()
    const firstId =
      (await repo.search('молоко', 20, actorId)).find((item) => item.name === first)?.id ?? ''

    await db.transaction(async (tx) => {
      const inTx = createSearchPickRepository(tx)
      await inTx.remember(actorId, 'молоко', firstId)
      await inTx.remember(actorId, 'мол', secondId)
      await inTx.remember(actorId, 'моло', secondId)
    })

    expect(await namesFor(actorId, 'молоко')).toEqual([second, first])
  })

  it('keeps memory to the query: a brand taken through its own name does not move another query', async () => {
    // A limit, stated rather than fixed: «Марианна» found by «марианна» leaves «Ашхар» on top
    // of «молоко» until «Марианна» is taken on «молоко» itself. Section Г of the review.
    const actorId = await insertActor(db)
    const ashkhar = await named('Молоко Ашхар')
    const marianna = await named('Молоко Марианна')

    await picks.remember(actorId, 'молоко', ashkhar)
    await picks.remember(actorId, 'марианна', marianna)
    await picks.remember(actorId, 'марианна', marianna)

    expect((await namesFor(actorId, 'молоко'))[0]).toBe('Молоко Ашхар')
  })

  it('puts the latest pick first, over the more frequent one', async () => {
    const actorId = await insertActor(db)
    const ashkhar = await named('Молоко Ашхар')
    const marianna = await named('Молоко Марианна')

    for (let n = 0; n < 3; n += 1) await picks.remember(actorId, 'молоко', ashkhar)
    await picks.remember(actorId, 'молоко', marianna)

    expect(await namesFor(actorId, 'молоко')).toEqual(['Молоко Марианна', 'Молоко Ашхар'])
  })

  it('answers with one row for an item remembered under two keys', async () => {
    const actorId = await insertActor(db)
    const { first, second, secondId } = await twoMilks()

    await picks.remember(actorId, 'мол', secondId)
    await picks.remember(actorId, 'моло', secondId)

    expect(await namesFor(actorId, 'молоко')).toEqual([second, first])
  })

  it('treats a malformed owner as one with no memory, not as a 500', async () => {
    const { first, second } = await twoMilks()

    expect(await namesFor('not-a-uuid', 'молоко')).toEqual([first, second])
  })

  it('reaches the index with the memory joined in', async () => {
    const actorId = await insertActor(db)
    const item = await named('Молоко «Ашхар»')
    await picks.remember(actorId, 'малако', item)

    const plan = await db.transaction(async (tx) => {
      await tx.execute(raw`set local enable_seqscan = off`)
      return tx.execute<{ 'QUERY PLAN': string }>(
        raw`explain ${rankedCandidates('malako', 10, actorId)}`,
      )
    })
    expect(plan.map((row) => row['QUERY PLAN']).join('\n')).toContain('items_search_key_trgm_idx')
  })

  it('carries no word of paid placement in its order', () => {
    // The product rule in CLAUDE.md: a result order holds nothing named like a promotion.
    // The lift is personal memory, and the query says so in its own words.
    const text = new PgDialect().sqlToQuery(rankedCandidates('moloko', 10, nobody)).sql
    expect(text).not.toMatch(/boost|promot|sponsor/i)
  })
})
