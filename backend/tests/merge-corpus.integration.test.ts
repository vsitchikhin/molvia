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
import { clearAll, insertActor, insertPlace } from './fixtures'

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
  // the closest by meaning of the seed's own transliterations, 0.902: past the threshold (review №6)
  ['Bulochki dlya burgerov', 'Булочки для бургеров', 'piece'],
]

/** Two sizes the search key folds into one, and the model puts past 0.93 (adversarial А2). */
const APART: readonly (readonly [string, string])[] = [
  ['Лента 50 м', 'Лента 50 мм'],
  ['Кабель 5 см', 'Кабель 5 км'],
  ['Батарейки AA 4 уп', 'Батарейки AA 4 pc'],
]

/** One shop written twice — older first, the survivor: merged by the night by itself. */
const SAME_PLACE: readonly (readonly [string, string])[] = [
  ['Ереван Сити', 'Ереван  Сити'],
  ['Гранд Кенди', 'Гранд-Кенди'],
  ['Перекрёсток', 'Перекресток'],
]

/** Two shops of one city a letter apart, which the model reads as one (adversarial Ж1). */
const LETTER_APART: readonly (readonly [string, string])[] = [
  ['Маркет Ширак', 'Маркет Шираз'],
  ['Магнит', 'Магнат'],
  ['Аптека Альфа', 'Аптека Альта'],
  // one search key, two shops: a proper name is compared as written (adversarial З1)
  ['Аптека Римма', 'Аптека Рима'],
  ['Салон Лилия', 'Салон Лиля'],
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
  for (const [i, name] of [...SAME_PLACE, ...LETTER_APART].flat().entries()) {
    await insertPlace(db, { name, city: 'Гюмри', createdAt: new Date(Date.UTC(2026, 8, 1, 0, i)) })
  }
  for (const name of APART.flat()) {
    await items.create(newItemSchema.parse({ kind: 'product', name, defaultUnit: 'piece' }), person)
  }
  await embedder.loaded
  await embedMissing({ embeddings: createItemEmbeddingRepository(db), embedder })
  report = (
    await mergeNight(
      {
        merges: createMergeRepository(db),
        embedder,
        failed: (error) => {
          throw error
        },
      },
      'on',
      '2026-10-06',
    )
  ).report
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
    expect(report.merged).toBe(TWINS.length + SAME_PLACE.length)
  })

  // Four nights with the real model: 3–4 s on a CI runner, past vitest's 5 s on a busy one.
  it('names what the model cannot judge, ten a morning, and merges none of it', async () => {
    // Ten a morning, the rest on the mornings after (review №2): read them all, as the owner would.
    const merges = createMergeRepository(db)
    const named = [...report.candidatePairs]
    for (const day of ['2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10']) {
      const next = (await mergeNight({ merges, embedder, failed: () => undefined }, 'on', day))
        .report
      expect(next.merged).toBe(0)
      named.push(...next.candidatePairs)
    }
    expect(named).toHaveLength(report.candidates)
    const pairs = named.map((pair) => [pair.from, pair.into].sort().join(' ~ '))
    for (const [from, into] of NAMED) expect(pairs).toContain([from, into].sort().join(' ~ '))
    // Two edits a word are two things of the shelf, never named (the owner, 06.10.2026).
    for (const pair of [
      ['Хлеб', 'Хлебцы'],
      ['Курица', 'Курага'],
      ['Редис', 'Редька'],
    ]) {
      expect(pairs).not.toContain(pair.sort().join(' ~ '))
    }
  }, 60_000)

  it('never merges two sizes the search key would fold into one', async () => {
    const merged = await db.execute<{ name: string }>(sql`
      select f.name from catalogue_merges m join items f on f.id = m.from_item`)
    for (const pair of APART) {
      for (const name of pair) expect(merged.map((row) => row.name)).not.toContain(name)
    }
  })

  it('merges one shop written twice, and never two shops a letter apart', async () => {
    const merged = await db.execute<{ from: string; into: string }>(sql`
      select f.name as "from", t.name as into
      from catalogue_merges m
      join places f on f.id = m.from_place
      join places t on t.id = m.into_place`)
    const pairs = merged.map((row) => `${row.from} → ${row.into}`).sort()
    expect(pairs).toEqual(SAME_PLACE.map(([into, from]) => `${from} → ${into}`).sort())
  })
})
