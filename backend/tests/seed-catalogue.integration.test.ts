import { execFileSync, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { count, eq, isNull } from 'drizzle-orm'
import { newItemSchema, toSearchKey } from '@molvia/model'
import { connectDrizzle, testDatabaseUrl } from './db'
import { clearAll, insertActor, insertItem } from './fixtures'
import { CATALOGUE_SEED } from '@/catalogue-seed'
import { items } from '@/db/schema'
import { createSeedRepository } from '@/db/seed-repository'

/**
 * The seed against a real Postgres (MOL-112): the whole list, through `createUnlessNamed`, in one
 * transaction. Every file here clears the catalogue before and after, so the seed never stays in
 * the test database, where it would move the answers of the search corpora (Р-5).
 */
const root = fileURLToPath(new URL('../..', import.meta.url))
const { db, close } = connectDrizzle()
const seeder = createSeedRepository(db)
const lines = CATALOGUE_SEED.map(([name, unit]) =>
  newItemSchema.parse({ kind: 'product', name, defaultUnit: unit }),
)
// The whole list takes seconds — five statements a line — so it runs twice in this file, as the
// dry run below and as the bundle; the rest is held on the first lines, milk and bread among them.
const FULL_RUN_MS = 60_000
const few = lines.slice(0, 5)

async function itemCount(): Promise<number> {
  const [row] = await db.select({ n: count() }).from(items)
  return row?.n ?? 0
}

beforeEach(async () => {
  await clearAll(db)
})

afterAll(async () => {
  await clearAll(db)
  await close()
})

describe('SeedRepository.seed', () => {
  // A dry run is the real run rolled back, so this is also every line going into the table.
  it(
    'a dry run counts every line and writes nothing',
    async () => {
      const report = await seeder.seed(lines, { dryRun: true })

      expect(report).toEqual({ added: lines.length, kept: [], twins: [] })
      expect(await itemCount()).toBe(0)
    },
    FULL_RUN_MS,
  )

  it('writes every line with no author, and a second run adds nothing', async () => {
    const first = await seeder.seed(few, { dryRun: false })
    const again = await seeder.seed(few, { dryRun: false })

    expect(first.added).toBe(few.length)
    expect(again.added).toBe(0)
    expect(again.kept).toHaveLength(few.length)
    expect(await itemCount()).toBe(few.length)
    const [authored] = await db.select({ n: count() }).from(items).where(isNull(items.createdBy))
    expect(authored?.n).toBe(few.length)
  })

  it('keeps an item someone proposed, with its unit and its author, and says so', async () => {
    const actor = await insertActor(db)
    const id = await insertItem(db, {
      name: 'молоко',
      searchKey: toSearchKey('молоко'),
      defaultUnit: 'kg',
      createdBy: actor,
    })

    const report = await seeder.seed(few, { dryRun: false })

    expect(report.added).toBe(few.length - 1)
    expect(report.kept).toEqual([{ name: 'молоко', unit: 'kg', seeded: 'l' }])
    const [kept] = await db.select().from(items).where(eq(items.id, id))
    expect(kept).toMatchObject({ name: 'молоко', defaultUnit: 'kg', createdBy: actor })
  })

  it('a dry run over an item already there reports it and leaves the rest unwritten', async () => {
    await insertItem(db, { name: 'МОЛОКО 1,5%', searchKey: toSearchKey('Молоко 1,5%') })

    const report = await seeder.seed(few, { dryRun: true })

    expect(report).toEqual({
      added: few.length - 1,
      kept: [{ name: 'МОЛОКО 1,5%', unit: 'l', seeded: 'l' }],
      twins: [],
    })
    expect(await itemCount()).toBe(1)
  })
})

/**
 * The tool is only worth anything where it is needed: in the production image, which holds one
 * bundled file per entry and no `node_modules`. Run here as the image would run it — a dry run
 * only, which writes nothing.
 */
// Adversarial В: the name alone folds case and spacing, the key also `ё`, a decimal point and the
// scripts — so the person's spelling was answered with a second item the search cannot tell apart.
describe('SeedRepository.seed — the same thing under another spelling', () => {
  it.each([
    ['Мед', 'Мёд', 'kg'],
    ['Тушенка', 'Тушёнка', 'kg'],
    ['Молоко 3.2%', 'Молоко 3,2%', 'l'],
    ['Լավաշ', 'Лаваш', 'piece'],
    ['Cola', 'Кола', 'l'],
  ] as const)('leaves «%s» alone and does not write «%s» beside it', async (theirs, line, unit) => {
    expect(toSearchKey(theirs)).toBe(toSearchKey(line))
    const actor = await insertActor(db)
    await insertItem(db, {
      name: theirs,
      searchKey: toSearchKey(theirs),
      defaultUnit: unit,
      createdBy: actor,
    })
    const seedLine = newItemSchema.parse({ kind: 'product', name: line, defaultUnit: unit })

    const others = few.filter((other) => other.name !== line)
    const report = await seeder.seed([seedLine, ...others], { dryRun: false })

    expect(report.twins).toEqual([{ name: theirs, seed: line }])
    expect(report.added).toBe(others.length)
    const same = await db
      .select()
      .from(items)
      .where(eq(items.searchKey, toSearchKey(line)))
    expect(same.map((item) => item.name)).toEqual([theirs])
  })

  it('an item of the same name beside a twin is still «already there», not a twin', async () => {
    await insertItem(db, { name: 'Мед', searchKey: toSearchKey('Мед'), defaultUnit: 'kg' })
    await insertItem(db, { name: 'мёд', searchKey: toSearchKey('мёд'), defaultUnit: 'kg' })

    const report = await seeder.seed(
      [newItemSchema.parse({ kind: 'product', name: 'Мёд', defaultUnit: 'kg' })],
      { dryRun: true },
    )

    expect(report).toEqual({
      added: 0,
      kept: [{ name: 'мёд', unit: 'kg', seeded: 'kg' }],
      twins: [],
    })
  })

  it('a dish of the same key is another kind, and the product is written', async () => {
    await insertItem(db, {
      kind: 'dish',
      name: 'Мед',
      searchKey: toSearchKey('Мед'),
      defaultUnit: 'kg',
    })

    const report = await seeder.seed(
      [newItemSchema.parse({ kind: 'product', name: 'Мёд', defaultUnit: 'kg' })],
      { dryRun: true },
    )

    expect(report).toEqual({ added: 1, kept: [], twins: [] })
  })
})

describe('dist/seed-catalogue.js', () => {
  function seed(...args: string[]) {
    return spawnSync('node', [`${root}backend/dist/seed-catalogue.js`, ...args], {
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        DATABASE_URL: testDatabaseUrl(),
        // The bundle is built as production, and production refuses to start without these.
        TELEGRAM_BOT_USERNAME: 'molvia_test_bot',
        BOT_API_SECRET: randomBytes(32).toString('base64url'),
      },
    })
  }

  it(
    'is built beside the server and answers from the bundle alone',
    { timeout: FULL_RUN_MS },
    async () => {
      execFileSync('node', ['bin/bundle.mjs', 'backend'], { cwd: root, stdio: 'pipe' })

      const dry = seed()

      expect(dry.status).toBe(0)
      expect(dry.stdout).toContain(`added           ${String(lines.length)}`)
      expect(dry.stdout).toContain('dry run: nothing changed')
      expect(await itemCount()).toBe(0)

      const wrong = seed('--force')
      expect(wrong.status).toBe(2)
      expect(wrong.stdout).toContain('usage: seed-catalogue')
    },
  )
})
