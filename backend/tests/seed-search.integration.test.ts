import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { newItemSchema, toSearchKey } from '@molvia/model'
import { connectDrizzle } from './db'
import { clearAll, insertItem } from './fixtures'
import { OWNER_WORDS } from './seed-words'
import { CATALOGUE_SEED } from '@/catalogue-seed'
import { createItemRepository } from '@/db/items-repository'
import { items } from '@/db/schema'
import { createSeedRepository } from '@/db/seed-repository'

/**
 * The owner's own words from a month of the expense log (25.08–25.09.2026, MOL-112), through the
 * search, against the seed alone. The list grows by commits, and a line added there can take the
 * first row of a word that was fine yesterday: this is where that shows. Things («кружка»,
 * «зонт») and names of a shelf («овощи», «специи») are left out of the seed on purpose, and so
 * out of here.
 */
const { db, close } = connectDrizzle()
const repo = createItemRepository(db)
const nobody = randomUUID()

beforeAll(async () => {
  await clearAll(db)
  const lines = CATALOGUE_SEED.map(([name, unit]) =>
    newItemSchema.parse({ kind: 'product', name, defaultUnit: unit }),
  )
  await createSeedRepository(db).seed(lines, { dryRun: false })
}, 60_000)

afterAll(async () => {
  await clearAll(db)
  await close()
})

async function first(query: string): Promise<[string | undefined, boolean]> {
  const { items, near } = await repo.search(query, 20, nobody, null)
  return [items[0]?.name, near]
}

describe("the owner's words, against the seed", () => {
  it.each(OWNER_WORDS)('«%s» → %s', async (query, name, near) => {
    expect(await first(query)).toEqual([name, near])
  })

  // «Печень куриная» and «Печень говяжья» are keys of one length, so the uuid picks between them;
  // what is held is that a liver comes first and not «Печенье» (review И).
  it('«печень» → a liver, not «Печенье»', async () => {
    expect((await first('печень'))[0]).toMatch(/^Печень /u)
  })

  /**
   * A brand over a kind is a miss, and the screen offers «Предложить товар» (owner's decision
   * В-1); «читос» has no kind of its own in the dictionary and waits for the person's own word.
   */
  it.each(['читос', 'молоко марианна', 'кефир ашхар'])('«%s» is not near', async (query) => {
    expect((await first(query))[1]).toBe(false)
  })

  /**
   * The brand's own item, once proposed, stands above the kind its word leads to: both are found
   * at no cost, the brand by the word typed and the kind by a synonym, and at one distance the
   * typed word ranks first (\`by_synonym\`) — not the similarity, which ranks after the length
   * (review С-8, М). MOL-112 first kept brands out of the dictionary on a claim about this that
   * was wrong (adversarial Д).
   */
  it.each([
    ['фанта', 'Фанта 0,5 л'],
    ['дошик', 'Дошик курица'],
    ['принглс', 'Принглс оригинал'],
  ])('«%s» puts a proposed «%s» above the kind', async (query, name) => {
    const id = await insertItem(db, { name, searchKey: toSearchKey(name), defaultUnit: 'piece' })
    try {
      expect((await first(query))[0]).toBe(name)
    } finally {
      await db.delete(items).where(eq(items.id, id))
    }
  })
})
