/**
 * The night's merge of twins (MOL-106) on the seed with the real model — the measure of the thresholds
 * pinned (`.scratch/tasks/status/MOL-106-measure.md`): the twins people type beside a seed line merge
 * into it, no two lines of the seed merge, and what the model cannot judge is only named. The pairs here
 * stand well clear of the thresholds: the model's last digits differ between a Mac and x86 (MOL-105).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { newItemSchema } from '@molvia/model'
import type { CatalogueMergedNotice } from '@molvia/model'
import { CATALOGUE_SEED } from '@/catalogue-seed'
import { createItemEmbeddingRepository } from '@/db/item-embeddings-repository'
import { createItemRepository } from '@/db/items-repository'
import { createMergeRepository } from '@/db/merge-repository'
import { createSeedRepository } from '@/db/seed-repository'
import { startEmbedder } from '@/embeddings/embedder'
import { env } from '@/env'
import { embedMissing } from '@/usecases/embed-items'
import { mergeNight } from '@/usecases/merge-twins'
import { connectDrizzle } from './db'
import { clearAll, insertActor } from './fixtures'

const { db, close } = connectDrizzle()
const quiet = { info: () => undefined, warn: () => undefined }
const embedder = startEmbedder(env.EMBEDDINGS_DIR, quiet, { queryWaitMs: 60_000 })

/** Typed by a person beside the seed's line, which merges them into itself. */
const TWINS: readonly (readonly [string, string, 'l' | 'kg' | 'piece'])[] = [
  ['Молоко 3.2%', 'Молоко 3,2%', 'l'],
  ['Масло топленое', 'Масло топлёное', 'kg'],
  ['Творог обизжиренный', 'Творог обезжиренный', 'kg'],
  ['Безлактозное молоко', 'Молоко безлактозное', 'l'],
]

/** Named to the owner, never merged: one key in two scripts, a typo the model doubts, a homograph. */
const NAMED: readonly (readonly [string, string, 'l' | 'kg' | 'piece'])[] = [
  ['Moloko', 'Молоко', 'l'],
  ['Кифир', 'Кефир', 'l'],
  ['Milo', 'Мыло', 'piece'],
]

let report: CatalogueMergedNotice

beforeAll(async () => {
  await clearAll(db)
  const lines = CATALOGUE_SEED.map(([name, unit]) =>
    newItemSchema.parse({ kind: 'product', name, defaultUnit: unit }),
  )
  await createSeedRepository(db).seed(lines, { dryRun: false })
  const person = await insertActor(db)
  const items = createItemRepository(db)
  for (const [name, , unit] of [...TWINS, ...NAMED]) {
    await items.create(newItemSchema.parse({ kind: 'product', name, defaultUnit: unit }), person)
  }
  await embedder.loaded
  await embedMissing({ embeddings: createItemEmbeddingRepository(db), embedder })
  report = await mergeNight({ merges: createMergeRepository(db), embedder }, 'on', '2026-10-06')
}, 600_000)

afterAll(async () => {
  await clearAll(db)
  await close()
})

describe('the night on the seed', () => {
  it('merges each twin typed beside a seed line into the line, and nothing else', async () => {
    const merged = await db.execute<{ from: string; into: string }>(sql`
      select f.name as "from", t.name as into
      from catalogue_merges m
      join items f on f.id = m.from_item
      join items t on t.id = m.into_item
      order by f.name`)
    expect(merged.map((row) => [row.from, row.into])).toEqual(
      TWINS.map(([from, into]) => [from, into]).sort(([a = ''], [b = '']) => (a < b ? -1 : 1)),
    )
    expect(report.merged).toBe(TWINS.length)
  })

  it('names what the model cannot judge, and merges none of it', async () => {
    const named = await db.execute<{ a: string; b: string }>(sql`
      select x.name as a, y.name as b
      from catalogue_merge_candidates c
      join items x on x.id = c.a
      join items y on y.id = c.b`)
    const pairs = named.map((row) => [row.a, row.b].sort().join(' ~ '))
    for (const [from, into] of NAMED) expect(pairs).toContain([from, into].sort().join(' ~ '))
    expect(report.candidates).toBe(named.length)
  })
})
