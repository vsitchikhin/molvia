/**
 * The search by meaning (MOL-105) against the seed, with the real model: what a shelf word finds,
 * what it must not move, what it must not find. The model is the one `make model` puts into
 * `.models/` — CI fetches it the same way; without it this file fails, as a search test without
 * Postgres would.
 */
import { randomUUID } from 'node:crypto'
import process from 'node:process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { catalogueEntryCodec, catalogueSearchResponseSchema, newItemSchema } from '@molvia/model'
import { connectDrizzle } from './db'
import { clearAll, insertActor, signIn } from './fixtures'
import { OWNER_WORDS } from './seed-words'
import { SEED_ABSENT, SHELF_WORDS } from '@molvia/model/testing/search-corpus'
import { CATALOGUE_SEED } from '@/catalogue-seed'
import { createItemEmbeddingRepository } from '@/db/item-embeddings-repository'
import { createItemRepository, rankedCandidates } from '@/db/items-repository'
import { itemEmbeddings, items } from '@/db/schema'
import { createSearchPickRepository } from '@/db/search-picks-repository'
import { createSeedRepository } from '@/db/seed-repository'
import { startEmbedder } from '@/embeddings/embedder'
import { env } from '@/env'
import { buildServer } from '@/server'
import { embedMissing } from '@/usecases/embed-items'
import { queryMeaning } from '@/usecases/query-meaning'
import { onlyRow } from './rows'

const { db, close } = connectDrizzle()
const repo = createItemRepository(db)
const embeddings = createItemEmbeddingRepository(db)
const nobody = randomUUID()
const quiet = { info: () => undefined, warn: () => undefined }
// A test pins answers and cannot leave a vector to the machine's load: it waits for every one.
const embedder = startEmbedder(env.EMBEDDINGS_DIR, quiet, { queryWaitMs: 60_000 })

beforeAll(async () => {
  await clearAll(db)
  const lines = CATALOGUE_SEED.map(([name, unit]) =>
    newItemSchema.parse({ kind: 'product', name, defaultUnit: unit }),
  )
  await createSeedRepository(db).seed(lines, { dryRun: false })
  await embedder.loaded
  await embedMissing({ embeddings, embedder })
}, 600_000)

afterAll(async () => {
  await clearAll(db)
  await close()
})

async function search(query: string, actorId: string = nobody) {
  const answer = await repo.search(query, 20, actorId, await queryMeaning(embedder, query))
  return { names: answer.items.map((item) => item.name), near: answer.near }
}

async function idOf(name: string): Promise<string> {
  const row = onlyRow(await db.select({ id: items.id }).from(items).where(eq(items.name, name)))
  if (!row) throw new Error(`the seed has «${name}»`)
  return row.id
}

describe('a word that names a shelf (owner’s decision В-3)', () => {
  it.each([
    ['молочка', 'Молоко'],
    ['молочные продукты', 'Молоко'],
    ['спиртное', 'Водка'],
    ['морепродукты', 'Креветки'],
  ])('«%s» finds «%s» first, and the answer is near', async (query, name) => {
    const { names, near } = await search(query)
    expect([names[0], near]).toEqual([name, true])
  })

  it('«овощи» puts the vegetables above the flour the letters find two edits away', async () => {
    const { names, near } = await search('овощи')
    expect(near).toBe(true)
    expect(names).toEqual(expect.arrayContaining(['Морковь', 'Помидоры', 'Огурцы']))
    const flour = names.indexOf('Мука высший сорт')
    const vegetables = ['Морковь', 'Помидоры', 'Огурцы'].map((name) => names.indexOf(name))
    expect(flour === -1 || vegetables.every((at) => at < flour)).toBe(true)
  })

  it('«заморозка» finds what is frozen, of every shelf', async () => {
    const { names } = await search('заморозка')
    expect(names).toEqual(
      expect.arrayContaining(['Пицца замороженная', 'Смесь овощная замороженная', 'Мороженое']),
    )
  })

  it('«для кошки» keeps the cat food the letters found first, and adds the litter', async () => {
    const { names } = await search('для кошки')
    expect(names[0]).toBe('Корм для кошек')
    expect(names).toContain('Наполнитель для лотка')
  })
})

describe('what the letters found does not move (owner’s decision В-3)', () => {
  /**
   * Every word of the owner's log answers with the first row the letters gave it — the meaning
   * comes after every name within one edit. Pinned whole: a word whose first row the model would
   * take is a change of the answer, and shows here. The nearness is the letters' too, but for the
   * words below: their first row, two edits away by the letters, is near by its meaning — the price
   * MOL-46 named («собачий корм» read «не нашли» over the dog food) taken back.
   */
  const NEAR_BY_MEANING: Readonly<Record<string, boolean>> = {
    'собачий корм': true,
    'корм собакам': true,
  }
  it.each(OWNER_WORDS)('«%s» still → %s', async (query, name, near) => {
    const { names, near: found } = await search(query)
    expect([names[0], found]).toEqual([name, NEAR_BY_MEANING[query] ?? near])
  })

  it('«молоко» names every milk before anything the meaning adds', async () => {
    const { names } = await search('молоко')
    const lastMilk = names.findLastIndex((found) => found.startsWith('Молоко'))
    const firstOther = names.findIndex((found) => !found.startsWith('Молоко'))
    expect(firstOther).toBeGreaterThan(lastMilk)
  })
})

describe('one exact word does not make the other right, with the meaning too (MOL-46, MOL-332)', () => {
  /**
   * A row the letters found within one edit by the mean with a word two off is near neither by its
   * letters nor by its meaning: one exact word lends the vector its sense as it lent the mean its
   * edits. Made near by its meaning wherever found, each of these read «нашли» over another thing,
   * where the screen says «не нашли» and offers «Предложить товар» (adversarial А2 of MOL-332,
   * owner's В-3 «а»). The first three are things people buy that the seed does not carry; the last
   * two are swaps of seed words by a generator, taken for their margins — of the ten plausible ones
   * only three stand clear both ways, and the guard holds the mechanism, not the words. Each stands
   * clear of the threshold both ways (adversarial В2): «не нашли» is held by the nearest name the
   * meaning alone would place — «Сахар», «Гель для бритья» at 0.375 and 0.382, the others below
   * 0.35 — and the thing named first stands at 0.42–0.48, so near wherever found turns each red.
   * «соус абрикосовый», «сода для посудомойки», «суп острый» stood 0.006–0.011 under it, on
   * «Абрикосы», «Сода пищевая», «Суп быстрого приготовления»
   * (`.scratch/tasks/status/MOL-332-review-5-guards.json`).
   */
  it.each([
    ['вода без сахара', 'Кола без сахара'],
    ['гель для мангала', 'Уголь для мангала'],
    ['диски влажные', 'Диски ватные'],
    ['бальзам для полов', 'Бальзам для волос'],
    ['соус мультифруктовый', 'Сок мультифруктовый'],
  ])('«%s» → «%s», far', async (query, name) => {
    const { names, near } = await search(query)
    expect([names[0], near]).toEqual([name, false])
  })

  /**
   * The price of it, named (MOL-332, owner's В-3 «а»): the meaning makes a row near only where it also
   * places it, so a typo more may read near where the typo less does not — «кокосовое малако» (0 and 2
   * edits) keeps «Молоко кокосовое» first and not near, «кокосовае малако» (1 and 2) near — there the
   * answer is near either way, by «Кокос», and the row is what moves: «проверьте» on a receipt's line,
   * none of «Что брать» past its twentieth. Where nothing else is near the whole answer moves, as on 52
   * of the seed's 711 typo ladders (adversarial Б1 of MOL-332). Pinned by the one of the 52 whose
   * narrower side stands furthest from the threshold (adversarial Г1), so a shift of a vector shows as
   * what it moves: «не нашли» over the butter is held by «Молоко 2,5%», nearest of what the meaning
   * alone would place, at 0.322; «нашли» by «Масло сливочное 82,5%» itself at 0.585. What holds «не
   * нашли» is that nearest stranger, not the thing meant: «шакалад белый» stood on «Капуста
   * белокочанная» at 0.390 (adversarial В1).
   */
  it('«кокосовое малако» — «Молоко кокосовое» first and not near; «кокосовае малако» — near', async () => {
    const milk = await idOf('Молоко кокосовое')
    const fewer = await repo.search(
      'кокосовое малако',
      20,
      nobody,
      await queryMeaning(embedder, 'кокосовое малако'),
    )
    const more = await repo.search(
      'кокосовае малако',
      20,
      nobody,
      await queryMeaning(embedder, 'кокосовае малако'),
    )
    expect([fewer.items[0]?.id, fewer.nearIds.includes(milk)]).toEqual([milk, false])
    expect(more.nearIds).toContain(milk)
  })

  it('«масло слевачное 82,5%» reads «не нашли» over the butter first, «масло слевачнае 82,5%» «нашли»', async () => {
    const fewer = await search('масло слевачное 82,5%')
    const more = await search('масло слевачнае 82,5%')
    expect([fewer.names[0], fewer.near]).toEqual(['Масло сливочное 82,5%', false])
    expect([more.names[0], more.near]).toEqual(['Масло сливочное 82,5%', true])
  })
})

describe('a word on its way finds by its spelling (MOL-332, owner’s В-1 «а»)', () => {
  /**
   * The price of the meaning, as of the letters' «молоч» → «Мука»: a cut word is read by how it is
   * spelt, and what it finds is near. «cheesecak» is cheese to the model (0.412), where right finds of
   * a shelf stand as close — «алкоголь» → «Водка» 0.406, «кисломолочка» → «Молоко» 0.419 — so no
   * threshold tells them apart (`.scratch/tasks/status/MOL-332-measure.json`). The seed carries no
   * cheesecake; with one in the catalogue it stays below the threshold (0.35, 0.40) and the cheese stands
   * alone. Pinned, so a change of the model or the threshold shows here.
   */
  it.each([
    ['cheesecak', 'Сыр чечил'],
    ['кроссо', 'Круассан'],
  ])('«%s» → «%s», near', async (query, name) => {
    const { names, near } = await search(query)
    expect([names[0], near]).toEqual([name, true])
  })
})

/**
 * Every shelf word of the corpus and every thing the seed does not carry (MOL-105), pinned whole:
 * the name seen first and whether the answer is near — the poor answers too, since a change of the
 * threshold or the model shows here as what it moves. Prices this pins, named in `search.md`: an
 * Armenian or Georgian shelf word finds a name by its spelling and calls it near («կաթնամթերք» →
 * «Матнакаш», «ბოსტნეული» → «Бастурма»); «бытовая химия», «гигиена», «приправы» find nothing.
 * The words marked at the threshold have their nearest name within 0.006 of it. Five of them answer
 * otherwise on x86 than on ARM — the model's arithmetic differs in the last digits between the two
 * (CI and production are x86, a Mac is ARM): those carry both answers seen, either holds.
 */
type Answer = readonly [string | null, boolean]
const SHELF_ANSWERS: readonly (readonly [string, string | null, boolean, Answer?])[] = [
  ['молочка', 'Молоко', true],
  ['молочное', 'Молоко', true],
  ['молочные продукты', 'Молоко', true],
  ['кисломолочка', 'Молоко', true],
  ['кисломолочное', 'Молоко', true],
  ['կաթնամթերք', 'Матнакаш', true],
  ['რძის პროდუქტები', null, false],
  ['mlečni proizvodi', 'Молоко', true],
  ['млечни производи', 'Молоко', true],
  ['птица', 'Пицца', true],
  ['курятина', 'Курица', true],
  ['мясные продукты', 'Говядина', true],
  ['միս', 'Рис', true],
  ['ხორცი', null, false, ['Хрен', true]], // either way: ARM, x86
  ['meso', 'Пакеты мусорные', true],
  ['копчёности', null, false],
  ['колбасные изделия', 'Колбаса', true],
  ['морепродукты', 'Креветки', true],
  ['рыбное', 'Филе рыбное', true],
  ['ձուկ', 'Лук-порей', true],
  ['riba', 'Рыба', true],
  ['овощи', 'Смесь овощная замороженная', true],
  ['корнеплоды', 'Морковь', true],
  ['բանջարեղեն', null, false],
  ['ბოსტნეული', 'Бастурма', true],
  ['povrće', null, false],
  ['поврће', null, false],
  ['пряные травы', null, false],
  ['фрукты', 'Пастила фруктовая', true],
  ['цитрусовые', 'Апельсины', true],
  ['միրգ', 'Маргарин', true],
  // MOL-109: Georgian and Serbian are letters of the key now — ხილი is `hili`, two edits from «белый»;
  // voće and воће are `voche`, three from «Вода», and find nothing where they found it by ć → ц.
  ['ხილი', 'Хлеб белый', false],
  ['voće', null, false],
  ['воће', null, false],
  ['выпечка', 'Бумага для выпечки', true],
  ['хлебобулочные', 'Хлебцы', true],
  ['hleb', 'Хлеб', true], // at the threshold
  ['крупы', 'Крупа кукурузная', true],
  ['каши', 'Кешью', true],
  ['бакалея', 'Баклажаны', true],
  ['злаки', 'Батончик злаковый', true], // at the threshold
  ['бобовые', null, false],
  ['приправы', null, false],
  ['пряности', null, false, ['Перец острый', true]], // either way: ARM, x86
  ['специи', 'Перец острый', true],
  ['консервы', 'Тунец консервированный', true],
  ['соленья', 'Арахис солёный', true],
  ['закатки', 'Котлеты', true],
  ['заморозка', 'Пломбир', true],
  ['полуфабрикаты', null, false],
  ['замороженное', 'Ягоды замороженные', true],
  ['кулинария', 'Голень куриная', false],
  ['сладкое', 'Сахар', true],
  ['сладости', 'Леденцы', true],
  ['к чаю', 'Чай', true],
  ['десерты', 'Пирожные', true],
  ['кондитерка', 'Пирожные', true],
  ['քաղցրավենիք', null, false],
  ['slatkiši', null, false],
  ['снеки', 'Соус соевый', false],
  ['закуски к пиву', 'Пиво', true],
  ['напитки', 'Пиво', true],
  ['газировка', 'Лимонад', true],
  ['безалкогольное', 'Пиво безалкогольное', true],
  ['горячие напитки', 'Чай холодный', true],
  ['piće', 'Печенье', true], // MOL-109: `piche` starts «Печенье» within an edit, as `piцe` did «Пицца»
  ['алкоголь', 'Водка', true],
  ['выпивка', null, false, ['Водка', true]], // either way: ARM, x86
  ['спиртное', 'Водка', true],
  ['ալկոհոլ', null, false],
  ['alkohol', null, false],
  ['детское питание', 'Пюре детское', false, ['Смесь детская', true]], // either way: ARM, x86
  ['для малыша', 'Смесь детская', true],
  ['бытовая химия', null, false],
  ['для уборки', 'Средство чистящее', true],
  ['моющее', 'Средство чистящее', true],
  ['хозтовары', 'Мыло хозяйственное', true], // at the threshold
  ['для дома', 'Крем для рук', false],
  ['гигиена', null, false],
  ['косметика', null, false],
  ['уход за собой', null, false],
  ['для кошки', 'Корм для кошек', false],
  ['зоотовары', 'Пелёнки для животных', true],
  ['для питомца', 'Лакомство для собак', true, ['Пелёнки для животных', true]], // either way: ARM, x86
]

const ABSENT_ANSWERS: readonly (readonly [string, string | null, boolean])[] = [
  ['кружка', 'Грудка куриная', false], // at the threshold
  ['зарядка для телефона', null, false],
  ['носки', 'Виски', false],
  ['футболка', null, false],
  ['сигареты', null, false],
  ['бензин', null, false],
  ['таблетки от головы', null, false],
  ['витамины', null, false],
  ['цветы', 'Капуста цветная', true],
  ['газета', 'Гата', false],
  ['билет на автобус', null, false],
  ['стрижка', 'Стружка кокосовая', true],
  ['молоток', 'Молоко', false],
  ['шуруповёрт', null, false],
  ['краска', 'Икра красная', true],
  ['клей', 'Сироп кленовый', true],
  ['ручка шариковая', null, false],
  ['тетрадь', null, false],
  ['игрушка', null, false],
  ['наушники', null, false],
  ['зонт', null, false],
  ['кастрюля', null, false],
  ['сковорода', null, false],
  ['кроссовки', null, false],
  ['симкарта', null, false],
]

describe('the corpus of shelf words, pinned whole', () => {
  it('pins an answer for every word of the corpus, and for nothing else', () => {
    expect(SHELF_ANSWERS.map(([word]) => word)).toEqual(SHELF_WORDS.map(([word]) => word))
    expect(ABSENT_ANSWERS.map(([word]) => word)).toEqual([...SEED_ABSENT])
  })

  it.each(
    [...SHELF_ANSWERS, ...ABSENT_ANSWERS].map(([word, name, near, other]) => ({
      word,
      answers: [[name, near] as const, ...(other ? [other] : [])],
    })),
  )('«$word» → $answers', async ({ word, answers }) => {
    const { names, near } = await search(word)
    expect(answers.map((answer) => JSON.stringify(answer))).toContain(
      JSON.stringify([names[0] ?? null, near]),
    )
  })
})

describe('what must not be found by meaning', () => {
  it.each(['витамины', 'кружка', 'сигареты', 'бензин'])(
    '«%s» — a thing the seed does not carry — finds nothing near',
    async (query) => {
      expect((await search(query)).near).toBe(false)
    },
  )

  it('three letters are a start of a word, never a meaning: «мол» answers as the letters do', async () => {
    const plain = await repo.search('мол', 20, nobody, null)
    expect((await search('мол')).names).toEqual(plain.items.map((item) => item.name))
  })

  it('reads only the vectors of its own model', async () => {
    const carrot = await idOf('Морковь')
    await db
      .update(itemEmbeddings)
      .set({ model: 'another@1' })
      .where(eq(itemEmbeddings.itemId, carrot))
    try {
      expect((await search('овощи')).names).not.toContain('Морковь')
    } finally {
      await embedMissing({ embeddings, embedder })
    }
    expect((await search('овощи')).names).toContain('Морковь')
  })
})

it('a pick on «овощи» lifts the tomatoes taken, as over any name found (MOL-11)', async () => {
  const actorId = await insertActor(db)
  expect((await search('овощи', actorId)).names[0]).not.toBe('Помидоры')
  await createSearchPickRepository(db).remember(actorId, 'овощи', await idOf('Помидоры'))
  expect((await search('овощи', actorId)).names[0]).toBe('Помидоры')
})

it('loads onnxruntime with its telemetry switched off (privacy.md)', () => {
  expect(process.env.ORT_DISABLE_TELEMETRY).toBe('1')
})

it('walks the HNSW index for the nearest names, not the whole table', async () => {
  const meaning = await queryMeaning(embedder, 'овощи')
  if (!meaning) throw new Error('a vector for «овощи»')
  const plan = await db.transaction(async (tx) => {
    await tx.execute(sql`set local enable_seqscan = off`)
    return tx.execute<{ 'QUERY PLAN': string }>(
      sql`explain ${rankedCandidates('ovoщi', 20, nobody, [], meaning)}`,
    )
  })
  expect(plan.map((row) => row['QUERY PLAN']).join('\n')).toContain('item_embeddings_hnsw_idx')
})

it('answers «молочка» through the server, and writes the vector of a proposed item', async () => {
  const app = buildServer({ db, embedder: () => embedder })
  await app.ready()
  try {
    const cookie = await signIn(db, await insertActor(db))
    const found = await app.inject({
      method: 'GET',
      url: `/catalogue/search?q=${encodeURIComponent('молочка')}`,
      headers: { cookie },
    })
    const answer = catalogueSearchResponseSchema.parse(JSON.parse(found.body))
    expect([answer.items[0]?.name, answer.near]).toEqual(['Молоко', true])

    const proposed = await app.inject({
      method: 'POST',
      url: '/catalogue/items',
      headers: { cookie },
      payload: { kind: 'product', name: 'Айран', defaultUnit: 'l' },
    })
    expect(proposed.statusCode).toBe(201)
    const { id } = catalogueEntryCodec.parse(JSON.parse(proposed.body))
    await expect
      .poll(
        async () =>
          (await db.select().from(itemEmbeddings).where(eq(itemEmbeddings.itemId, id))).length,
        { timeout: 30_000 },
      )
      .toBe(1)
  } finally {
    await app.close()
  }
}, 60_000)
