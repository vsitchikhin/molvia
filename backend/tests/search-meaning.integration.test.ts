/**
 * The search by meaning (MOL-105) against the seed, with the real model: what a shelf word finds,
 * what it must not move, what it must not find. The model is the one `make model` puts into
 * `.models/` — CI fetches it the same way; without it this file fails, as a search test without
 * Postgres would.
 */
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { catalogueEntryCodec, catalogueSearchResponseSchema, newItemSchema } from '@molvia/model'
import { connectDrizzle } from './db'
import { clearAll, insertActor, signIn } from './fixtures'
import { OWNER_WORDS } from './seed-words'
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
  const [row] = await db.select({ id: items.id }).from(items).where(eq(items.name, name))
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
