/**
 * The merge of twins and its undo (MOL-106), on a real database: every row that names a merged item
 * or place moves and is written down, one person's two verdicts settle without the 0.2 gate gaining or
 * losing a rating, and `unmerge` puts the database back as it was.
 */
import { randomUUID } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { GATE_RATINGS, GATE_RATINGS_WINDOW_HOURS } from '@molvia/model'
import type { OwnerNotice } from '@molvia/model'
import { EMBEDDING_MODEL, NO_EMBEDDER } from '@/embeddings/embedder'
import { mergeNight, mergeTick } from '@/usecases/merge-twins'
import { createErasureRepository } from '@/db/erasure-repository'
import { createItemRepository } from '@/db/items-repository'
import { createMergeRepository } from '@/db/merge-repository'
import type { MergeRepository } from '@/db/merge-repository'
import { createStoreMemoryRepository } from '@/db/store-memory-repository'
import { createVerdictRepository } from '@/db/verdicts-repository'
import { actors, catalogueMergeMoves, catalogueMerges, items, places } from '@/db/schema'
import { connectDrizzle } from './db'
import {
  clearAll,
  insertActor,
  insertCounted,
  insertItem,
  insertPlace,
  insertTrip,
} from './fixtures'

const { db, close } = connectDrizzle()
const merges = createMergeRepository(db)
const NIGHT = { by: 'night', night: '2026-10-06', edits: 1, worst: 1, meaning: 0.95 } as const

let owner: string
let older: string
let younger: string

beforeEach(async () => {
  await clearAll(db)
  // Counted by gate 0.2 across a merge (Т-6), so they consented to the statistics (MOL-236).
  owner = await insertCounted(db)
  // An hour apart, after every `made` below: two inserts in a row may share a millisecond, and a tie goes
  // to the lower id (MOL-252).
  older = await insertItem(db, {
    name: 'Молоко 3,2%',
    searchKey: 'moloko 3 2',
    createdAt: new Date('2026-10-01T10:00:00Z'),
  })
  younger = await insertItem(db, {
    name: 'Малоко 3,2%',
    searchKey: 'maloko 3 2',
    createdAt: new Date('2026-10-01T11:00:00Z'),
  })
})

afterAll(async () => {
  await clearAll(db)
  await close()
})

async function verdict(
  actorId: string,
  itemId: string,
  patch: {
    score?: number
    ratedAt?: string
    deleted?: boolean
    placeId?: string
    kind?: string
  } = {},
): Promise<string> {
  const id = randomUUID()
  const ratedAt = patch.ratedAt ?? '2026-09-01T10:00:00Z'
  await db.execute(sql`
    insert into verdicts (id, actor_id, item_id, item_kind, place_id, score, rated_at, updated_at, deleted_at)
    values (${id}, ${actorId}, ${itemId}, ${patch.kind ?? 'product'}, ${patch.placeId ?? null},
            ${patch.score ?? 4}, ${ratedAt}::timestamptz, ${ratedAt}::timestamptz,
            ${patch.deleted ? sql`${ratedAt}::timestamptz + interval '1 hour'` : null})`)
  return id
}

/** Every row a merge may touch, in a stable order — a merge undone must leave this exactly as it was. */
async function snapshot(): Promise<unknown> {
  const read = (statement: ReturnType<typeof sql>) => db.execute(statement)
  return {
    items: await read(sql`select id, merged_into from items order by id`),
    places: await read(sql`select id, merged_into from places order by id`),
    expenses: await read(sql`select id, item_id from expenses order by id`),
    trips: await read(sql`select id, place_id from trips order by id`),
    verdicts: await read(sql`
      select id, actor_id, item_id, place_id, score, review, rated_at, updated_at, deleted_at
      from verdicts order by id`),
    picks: await read(sql`
      select actor_id, query_key, item_id, picks, last_picked_at, admits
      from search_picks order by actor_id, query_key, item_id`),
    codes: await read(sql`select code, item_id from item_barcodes order by code`),
    names: await read(
      sql`select item_id, language, name from item_names order by language, name, item_id`,
    ),
    headings: await read(sql`select item_id, hs from item_hs order by hs, item_id`),
    memory: await read(sql`select id, item_id from store_memory order by id`),
    lines: await read(
      sql`select receipt_id, position, item_id from receipt_lines order by position`,
    ),
  }
}

async function receiptLine(itemId: string): Promise<void> {
  const receipt = randomUUID()
  await db.execute(sql`
    insert into receipts (id, actor_id, status, parts, country, language, currency, captured_at, queued_at)
    values (${receipt}, ${owner}, 'queued', 1, 'AM', 'ru', 'AMD', now(), now())`)
  await db.execute(sql`
    insert into receipt_lines (receipt_id, position, printed, settled, item_id)
    values (${receipt}, 0, 'ԿԱԹ 3.2%', false, ${itemId})`)
}

/** Everything that names the younger item: a purchase, a pick, a code, a name, a heading, memory, a line. */
async function everything(): Promise<void> {
  const place = await insertPlace(db)
  const trip = await insertTrip(db, { actorId: owner, placeId: place })
  await db.execute(sql`
    insert into expenses (id, trip_id, item_id) values (${randomUUID()}, ${trip}, ${younger})`)
  await verdict(owner, younger)
  await db.execute(sql`
    insert into search_picks (actor_id, query_key, item_id) values (${owner}, 'maloko', ${younger})`)
  await db.execute(
    sql`insert into item_barcodes (code, item_id) values ('4600000000003', ${younger})`,
  )
  await db.execute(
    sql`insert into item_names (item_id, language, name) values (${younger}, 'hy', 'կաթ')`,
  )
  await db.execute(sql`insert into item_hs (item_id, hs) values (${younger}, '0401')`)
  await db.execute(sql`
    insert into store_memory (id, tin, kind, key, actor_id, item_id)
    values (${randomUUID()}, '01282006', 'sku', '1163909', ${owner}, ${younger})`)
  await receiptLine(younger)
}

const namedBy = async (table: string, itemId: string) =>
  (
    await db.execute<{ n: number }>(
      sql`select count(*)::int as n from ${sql.raw(table)} where item_id = ${itemId}`,
    )
  )[0]?.n

describe('a merge of items', () => {
  it('moves every row that names the younger item, and writes each down', async () => {
    await everything()
    const outcome = await merges.mergeItems(younger, older, NIGHT)
    expect('id' in outcome).toBe(true)
    for (const table of [
      'expenses',
      'verdicts',
      'search_picks',
      'item_barcodes',
      'item_names',
      'item_hs',
      'store_memory',
      'receipt_lines',
    ]) {
      expect([table, await namedBy(table, younger), await namedBy(table, older)]).toEqual([
        table,
        0,
        1,
      ])
    }
    const [trace] = await db.select().from(items).where(eq(items.id, younger))
    expect(trace?.mergedInto).toBe(older)
    const moved = await db.select({ what: catalogueMergeMoves.what }).from(catalogueMergeMoves)
    expect(moved.map((row) => row.what).sort()).toEqual(
      [
        'barcode',
        'expense',
        'item_hs',
        'item_name',
        'pick',
        'receipt_line',
        'store_memory',
        'verdict',
      ].sort(),
    )
    const [journal] = await db.select().from(catalogueMerges)
    expect([journal?.subject, journal?.by, journal?.edits, journal?.meaning]).toEqual([
      'item',
      'night',
      1,
      0.95,
    ])
  })

  it('adds one person’s picks of one query together, keeping their own word', async () => {
    await db.execute(sql`
      insert into search_picks (actor_id, query_key, item_id, picks, admits)
      values (${owner}, 'moloko', ${older}, 2, false), (${owner}, 'moloko', ${younger}, 3, true)`)
    await merges.mergeItems(younger, older, NIGHT)
    const rows = await db.execute(sql`select item_id, picks, admits from search_picks`)
    expect(rows).toEqual([{ item_id: older, picks: 5, admits: true }])
  })

  it('takes the traces of the younger item along, so a trace never points at a trace', async () => {
    const third = await insertItem(db, { name: 'Молако 3,2%', searchKey: 'molako 3 2' })
    await merges.mergeItems(third, younger, NIGHT)
    await merges.mergeItems(younger, older, NIGHT)
    const [row] = await db.select().from(items).where(eq(items.id, third))
    expect(row?.mergedInto).toBe(older)
  })

  it('refuses what cannot be one item', async () => {
    const dish = await insertItem(db, { kind: 'dish', name: 'Хаш', searchKey: 'hash' })
    expect(await merges.mergeItems(dish, older, NIGHT)).toEqual({ refused: 'kind' })
    expect(await merges.mergeItems(older, older, NIGHT)).toEqual({ refused: 'same' })
    expect(await merges.mergeItems(randomUUID(), older, NIGHT)).toEqual({ refused: 'missing' })
    expect(await merges.mergeItems('not-an-id', older, NIGHT)).toEqual({ refused: 'missing' })
    await merges.mergeItems(younger, older, NIGHT)
    const third = await insertItem(db, { name: 'Мол', searchKey: 'mol' })
    expect(await merges.mergeItems(third, younger, NIGHT)).toEqual({ refused: 'trace' })
  })

  it('refuses codes past what one item holds — the pair is left to the owner', async () => {
    const codes = (from: number, itemId: string) =>
      Array.from(
        { length: 11 },
        (_, i) => sql`(${String(4600000000000 + from + i)}, ${itemId}::uuid)`,
      )
    await db.execute(
      sql`insert into item_barcodes (code, item_id) values ${sql.join([...codes(0, older), ...codes(100, younger)], sql`, `)}`,
    )
    expect(await merges.mergeItems(younger, older, NIGHT)).toEqual({ refused: 'barcodes' })
  })
})

describe('one person’s two verdicts on the twins (Т-5)', () => {
  const live = async (itemId: string) =>
    db.execute<{ score: number; deleted: boolean }>(sql`
      select score, deleted_at is not null as deleted from verdicts
      where actor_id = ${owner} and item_id = ${itemId}`)

  it('keeps the later of two live ones on the survivor, the other withdrawn on the trace', async () => {
    await verdict(owner, older, { score: 2, ratedAt: '2026-09-01T10:00:00Z' })
    await verdict(owner, younger, { score: 5, ratedAt: '2026-09-02T10:00:00Z' })
    await merges.mergeItems(younger, older, NIGHT)
    expect(await live(older)).toEqual([{ score: 5, deleted: false }])
    expect(await live(younger)).toEqual([{ score: 2, deleted: true }])
  })

  it('keeps the survivor’s when it is the later', async () => {
    await verdict(owner, older, { score: 2, ratedAt: '2026-09-03T10:00:00Z' })
    await verdict(owner, younger, { score: 5, ratedAt: '2026-09-02T10:00:00Z' })
    await merges.mergeItems(younger, older, NIGHT)
    expect(await live(older)).toEqual([{ score: 2, deleted: false }])
  })

  it('never lets a withdrawn one beat a live one, however late', async () => {
    await verdict(owner, older, { score: 2, ratedAt: '2026-09-03T10:00:00Z', deleted: true })
    await verdict(owner, younger, { score: 5, ratedAt: '2026-09-01T10:00:00Z' })
    await merges.mergeItems(younger, older, NIGHT)
    expect(await live(older)).toEqual([{ score: 5, deleted: false }])
  })

  it('moves the survivor’s place in «Что брать» no more than the person did', async () => {
    await verdict(owner, older, { ratedAt: '2026-09-01T10:00:00Z' })
    await verdict(owner, younger, { ratedAt: '2026-09-02T10:00:00Z' })
    await merges.mergeItems(younger, older, NIGHT)
    // The winner's own moment, not the merge's: the rows traded what they say, the time included.
    const rows = await db.execute<{ same: boolean }>(sql`
      select updated_at = '2026-09-02T10:00:00Z'::timestamptz as same
      from verdicts where item_id = ${older}`)
    expect(rows).toEqual([{ same: true }])
  })
})

describe('the 0.2 gate across a merge (Т-6)', () => {
  const gate = () =>
    createVerdictRepository(db).reachedRatings({
      from: new Date('2026-08-01T00:00:00Z'),
      to: new Date('2026-12-01T00:00:00Z'),
      ratings: GATE_RATINGS,
      windowHours: GATE_RATINGS_WINDOW_HOURS,
    })

  it.each([
    [GATE_RATINGS - 1, 0],
    [GATE_RATINGS, 1],
    [GATE_RATINGS + 1, 1],
  ])('one who rated %i, both twins among them, stays where they were', async (count, reached) => {
    await db.execute(sql`update actors set created_at = '2026-09-01T09:00:00Z' where id = ${owner}`)
    await verdict(owner, older, { ratedAt: '2026-09-01T10:00:00Z' })
    await verdict(owner, younger, { ratedAt: '2026-09-01T11:00:00Z' })
    for (let i = 2; i < count; i++) {
      const other = await insertItem(db, {
        name: `Товар ${String(i)}`,
        searchKey: `tovar ${String(i)}`,
      })
      await verdict(owner, other, { ratedAt: '2026-09-02T10:00:00Z' })
    }
    const before = await gate()
    expect(before.reached).toBe(reached)
    await merges.mergeItems(younger, older, NIGHT)
    expect(await gate()).toEqual(before)
  })
})

describe('the undo', () => {
  it('puts every row back where it was', async () => {
    await everything()
    await verdict(owner, older, { score: 2, ratedAt: '2026-08-01T10:00:00Z' })
    const stranger = await insertActor(db)
    await verdict(stranger, older, { score: 3 })
    await verdict(stranger, younger, { score: 1, deleted: true, ratedAt: '2026-09-05T10:00:00Z' })
    await db.execute(sql`
      insert into search_picks (actor_id, query_key, item_id, picks)
      values (${owner}, 'maloko', ${older}, 2)`)
    const before = await snapshot()
    const outcome = await merges.mergeItems(younger, older, NIGHT)
    if (!('id' in outcome)) throw new Error('not merged')
    expect(await snapshot()).not.toEqual(before)
    expect(await merges.unmerge(outcome.id)).toEqual({
      subject: 'item',
      from: younger,
      into: older,
    })
    expect(await snapshot()).toEqual(before)
  })

  it('is done once, and the night never merges the pair again — the owner’s hand still may', async () => {
    const outcome = await merges.mergeItems(younger, older, NIGHT)
    if (!('id' in outcome)) throw new Error('not merged')
    await merges.unmerge(outcome.id)
    expect(await merges.unmerge(outcome.id)).toEqual({ refused: 'undone' })
    expect(await merges.unmerge(999_999)).toEqual({ refused: 'missing' })
    expect(await merges.mergeItems(older, younger, NIGHT)).toEqual({ refused: 'undone' })
    expect('id' in (await merges.mergeItems(younger, older, { by: 'hand' }))).toBe(true)
  })
})

describe('the sweep', () => {
  it('moves what reached a trace after its merge, under the merge’s own number', async () => {
    const outcome = await merges.mergeItems(younger, older, NIGHT)
    if (!('id' in outcome)) throw new Error('not merged')
    const place = await insertPlace(db)
    const trip = await insertTrip(db, { actorId: owner, placeId: place })
    // A write that read the id a moment before the merge took it.
    await db.execute(sql`
      insert into expenses (id, trip_id, item_id) values (${randomUUID()}, ${trip}, ${younger})`)
    expect(await merges.sweep()).toBe(1)
    expect(await namedBy('expenses', older)).toBe(1)
    expect(await merges.sweep()).toBe(0)
    const moved = await db.select().from(catalogueMergeMoves)
    expect(moved.map((row) => [row.mergeId, row.what])).toEqual([[outcome.id, 'expense']])
  })
})

describe('a merge of places', () => {
  it('moves the trips and the dishes’ verdicts, and the undo moves them back', async () => {
    const kept = await insertPlace(db, { kind: 'venue', name: 'Ереван Сити' })
    const merged = await insertPlace(db, { kind: 'venue', name: 'Ереван  Сити' })
    const trip = await insertTrip(db, { actorId: owner, placeId: merged })
    const dish = await insertItem(db, { kind: 'dish', name: 'Хаш', searchKey: 'hash' })
    await verdict(owner, dish, {
      kind: 'dish',
      placeId: kept,
      score: 2,
      ratedAt: '2026-09-01T10:00:00Z',
    })
    await verdict(owner, dish, {
      kind: 'dish',
      placeId: merged,
      score: 5,
      ratedAt: '2026-09-02T10:00:00Z',
    })
    const before = await snapshot()
    const outcome = await merges.mergePlaces(merged, kept, NIGHT)
    if (!('id' in outcome)) throw new Error('not merged')
    const trips = await db.execute(sql`select place_id from trips where id = ${trip}`)
    expect(trips).toEqual([{ place_id: kept }])
    const live = await db.execute(sql`
      select place_id, score from verdicts where deleted_at is null`)
    expect(live).toEqual([{ place_id: kept, score: 5 }])
    const [row] = await db.select().from(places).where(eq(places.id, merged))
    expect(row?.mergedInto).toBe(kept)
    await merges.unmerge(outcome.id)
    expect(await snapshot()).toEqual(before)
  })

  it('never merges one name in two cities, or a store with a venue', async () => {
    const gyumri = await insertPlace(db, { name: 'Ереван Сити', city: 'Гюмри' })
    const yerevan = await insertPlace(db, { name: 'Ереван Сити', city: 'Ереван' })
    const venue = await insertPlace(db, { kind: 'venue', name: 'Ереван Сити' })
    expect(await merges.mergePlaces(yerevan, gyumri, { by: 'hand' })).toEqual({ refused: 'city' })
    expect(await merges.mergePlaces(venue, gyumri, { by: 'hand' })).toEqual({ refused: 'kind' })
  })
})

describe('the journal and erasure', () => {
  it('keeps no pick of a person erased since, and the rest of the merge stands', async () => {
    await db.execute(sql`
      insert into search_picks (actor_id, query_key, item_id) values (${owner}, 'maloko', ${younger})`)
    const outcome = await merges.mergeItems(younger, older, NIGHT)
    if (!('id' in outcome)) throw new Error('not merged')
    const [person] = await db
      .select({ tg: actors.telegramUserId })
      .from(actors)
      .where(eq(actors.id, owner))
    if (!person) throw new Error('no person')
    await createErasureRepository(db).erase(person.tg, { dryRun: false })
    const left = await db.execute(sql`
      select 1 from catalogue_merge_moves where actor_id is not null or key::text like ${`%${owner}%`}`)
    expect(left).toEqual([])
    expect(await merges.unmerge(outcome.id)).toEqual({
      subject: 'item',
      from: younger,
      into: older,
    })
  })
})

/** An item made at its own moment: the older survives. */
const made = (name: string, key: string, day: string) =>
  insertItem(db, { name, searchKey: key, createdAt: new Date(`${day}T10:00:00Z`) })

/** A vector on the first two axes: the cosine of two of them is their dot product. */
async function vector(itemId: string, x: number, y: number): Promise<void> {
  const v = Array.from({ length: 768 }, (_, i) => (i === 0 ? x : i === 1 ? y : 0))
  await db.execute(sql`
    insert into item_embeddings (item_id, model, embedding)
    values (${itemId}, ${EMBEDDING_MODEL}, ${`[${v.join(',')}]`}::halfvec)`)
}

async function bought(itemId: string): Promise<string> {
  const trip = await insertTrip(db, { actorId: owner, placeId: await insertPlace(db) })
  const id = randomUUID()
  await db.execute(
    sql`insert into expenses (id, trip_id, item_id) values (${id}, ${trip}, ${itemId})`,
  )
  return id
}

const itemOfExpense = async (id: string) =>
  (await db.execute<{ item_id: string }>(sql`select item_id from expenses where id = ${id}`))[0]
    ?.item_id
const tracedTo = async (id: string) =>
  (await db.select({ to: items.mergedInto }).from(items).where(eq(items.id, id)))[0]?.to

function numbered(outcome: Awaited<ReturnType<MergeRepository['mergeItems']>>): number {
  if (!('id' in outcome)) throw new Error(`not merged: ${outcome.refused}`)
  return outcome.id
}

describe('the undo of a chain, from its end (adversarial А3, Б1)', () => {
  let a: string
  let b: string
  let c: string
  let purchase: string
  let first: number
  let second: number

  const rate = (itemId: string, score: number, ratedAt: string) =>
    db.execute(sql`
      insert into verdicts (id, actor_id, item_id, item_kind, score, review, rated_at, updated_at)
      values (${randomUUID()}, ${owner}, ${itemId}, 'product', ${score}, ${`отзыв ${String(score)}`},
              ${ratedAt}::timestamptz, ${ratedAt}::timestamptz)`)

  /** The person's live score on each, as «Что брать» shows it. */
  const scores = async () => {
    const read = async (itemId: string) =>
      (
        await db.execute<{ score: number; review: string | null }>(sql`
          select score, review from verdicts
          where actor_id = ${owner} and item_id = ${itemId} and deleted_at is null`)
      )[0] ?? null
    return { A: await read(a), B: await read(b), C: await read(c) }
  }

  beforeEach(async () => {
    c = await made('Молоко 3.2%', 'moloko 3 2', '2026-09-01')
    b = await made('Молоко 3,2%', 'moloko 3 2', '2026-09-02')
    a = await made('Малоко 3,2%', 'maloko 3 2', '2026-09-03')
    purchase = await bought(a)
    // The person rated all three: both steps of the chain swap their verdicts.
    await rate(b, 1, '2026-09-01T10:00:00Z')
    await rate(c, 3, '2026-09-02T10:00:00Z')
    await rate(a, 5, '2026-09-03T10:00:00Z')
    first = numbered(await merges.mergeItems(a, b, NIGHT))
    second = numbered(await merges.mergeItems(b, c, NIGHT))
  })

  it('puts every row and every opinion back, undone from the end', async () => {
    await merges.unmerge(second)
    await merges.unmerge(first)
    expect([await itemOfExpense(purchase), await tracedTo(a), await tracedTo(b)]).toEqual([
      a,
      null,
      null,
    ])
    // Every score home. The texts of the two that lost on the way are gone — a withdrawn row holds no
    // text, the named price; the one that won keeps its own.
    expect(await scores()).toEqual({
      A: { score: 5, review: 'отзыв 5' },
      B: { score: 1, review: null },
      C: { score: 3, review: null },
    })
  })

  it('refuses the first step while the second stands, naming it, and changes nothing', async () => {
    const before = await snapshot()
    expect(await merges.unmerge(first)).toEqual({ refused: 'chained', later: second })
    expect(await snapshot()).toEqual(before)
  })
})

describe('the undo leaves what people did after the merge (adversarial А4)', () => {
  it('leaves a code let go and written to another item', async () => {
    const other = await made('Кефир 1%', 'kefir 1', '2026-09-05')
    await db.execute(
      sql`insert into item_barcodes (code, item_id) values ('4600000000003', ${younger})`,
    )
    const id = numbered(await merges.mergeItems(younger, older, NIGHT))
    const catalogue = createItemRepository(db)
    await catalogue.detachBarcode(older, '4600000000003')
    await catalogue.attachBarcode(other, '4600000000003', owner)
    await merges.unmerge(id)
    expect(await db.execute(sql`select item_id from item_barcodes`)).toEqual([{ item_id: other }])
  })

  it('leaves a word of the shop’s memory said again after the merge', async () => {
    const other = await made('Кефир 1%', 'kefir 1', '2026-09-05')
    const memory = createStoreMemoryRepository(db)
    const word = { kind: 'sku' as const, key: '1163909', price: null }
    await memory.remember(owner, '01282006', [{ ...word, itemId: younger }])
    const id = numbered(await merges.mergeItems(younger, older, NIGHT))
    await memory.remember(owner, '01282006', [{ ...word, itemId: other }])
    await merges.unmerge(id)
    expect(await db.execute(sql`select item_id from store_memory`)).toEqual([{ item_id: other }])
  })
})

describe('the survivor’s own pick after the undo (adversarial А7)', () => {
  it('gets back its «own word» and its last pick', async () => {
    await db.execute(sql`
      insert into search_picks (actor_id, query_key, item_id, picks, last_picked_at, admits)
      values (${owner}, 'moloko', ${older}, 2, '2026-09-01T10:00:00Z', false),
             (${owner}, 'moloko', ${younger}, 1, '2026-09-20T10:00:00Z', true)`)
    await merges.unmerge(numbered(await merges.mergeItems(younger, older, NIGHT)))
    const rows = await db.execute<{
      item_id: string
      picks: number
      admits: boolean
      same: boolean
    }>(sql`
      select item_id, picks, admits,
             last_picked_at = case when item_id = ${older} then '2026-09-01T10:00:00Z'::timestamptz
                                   else '2026-09-20T10:00:00Z'::timestamptz end as same
      from search_picks order by picks desc`)
    expect(rows).toEqual([
      { item_id: older, picks: 2, admits: false, same: true },
      { item_id: younger, picks: 1, admits: true, same: true },
    ])
  })
})

describe('a pair undone is never joined again by the survivor’s survivor (adversarial А5)', () => {
  it('leaves the younger alone after its survivor was merged on', async () => {
    const c = await made('Молоко 3.2%', 'moloko 3 2', '2026-09-01')
    const b = await made('Молоко 3,2%', 'moloko 3 2', '2026-09-02')
    const a = await made('Малоко 3,2%', 'maloko 3 2', '2026-09-03')
    for (const id of [a, b, c]) await vector(id, 1, 0)
    const first = numbered(await merges.mergeItems(a, b, NIGHT))
    const second = numbered(await merges.mergeItems(b, c, NIGHT))
    // The owner: «Малоко» is not «Молоко 3,2%». A chain is undone from its end, and the right step
    // merged again by hand.
    await merges.unmerge(second)
    await merges.unmerge(first)
    numbered(await merges.mergeItems(b, c, { by: 'hand' }))
    const report = (
      await mergeNight(
        { merges, embedder: NO_EMBEDDER, failed: () => undefined },
        'on',
        '2026-10-07',
      )
    ).report
    expect([report.merged, await tracedTo(a)]).toEqual([0, null])
    // Not even named: the owner said once that they are two things.
    const named = report.candidatePairs.map((pair) => [pair.fromId, pair.intoId].sort().join(' '))
    expect(named).not.toContain([a, c].sort().join(' '))
  })
})

describe('the night on the real database (adversarial А1, А6)', () => {
  const at = (day: string, hhmm: string) => new Date(`${day}T${hhmm}:00+04:00`)
  const queued: OwnerNotice[] = []
  const deps = (repository: MergeRepository = merges) => ({
    merges: repository,
    embedder: NO_EMBEDDER,
    notices: {
      queue: (notice: OwnerNotice) => {
        queued.push(notice)
        return Promise.resolve()
      },
    },
    owner: true,
    failed: () => undefined,
  })

  async function twoPairs(): Promise<void> {
    const milk = await made('Молоко 3,2%', 'moloko 3 2', '2026-08-01')
    const milkPoint = await made('Молоко 3.2%', 'moloko 3 2', '2026-08-02')
    const kefir = await made('Кефир 1%', 'kefir 1', '2026-08-01')
    const kefirSpaced = await made('Кефир 1 %', 'kefir 1', '2026-08-02')
    for (const id of [milk, milkPoint]) await vector(id, 1, 0)
    for (const id of [kefir, kefirSpaced]) await vector(id, 0, 1)
  }

  beforeEach(() => {
    queued.length = 0
  })

  it('claims its day once, finishes it, and hands the report once from nine', async () => {
    await twoPairs()
    await mergeTick(deps(), 'on', at('2026-10-06', '04:30'))
    await mergeTick(deps(), 'on', at('2026-10-06', '04:31'))
    expect(await db.execute(sql`select count(*)::int as n from catalogue_merges`)).toEqual([
      { n: 2 },
    ])
    await mergeTick(deps(), 'on', at('2026-10-06', '09:00'))
    await mergeTick(deps(), 'on', at('2026-10-06', '09:01'))
    expect(
      queued.map((notice) => (notice.kind === 'catalogue_merged' ? notice.merged : -1)),
    ).toEqual([2])
  })

  it('claims a night again an hour after it died, and names what it merged before', async () => {
    await twoPairs()
    // The first instance merged one pair and died: its day claimed, never finished.
    await db.execute(sql`
      insert into catalogue_merge_runs (day, mode, started_at) values ('2026-10-06', 'on', ${at('2026-10-06', '04:30').toISOString()}::timestamptz)`)
    const [first] = await db.execute<{ a: string; b: string }>(sql`
      select f.id as a, t.id as b from items f join items t on t.name = 'Молоко 3,2%'
      where f.name = 'Молоко 3.2%'`)
    if (!first) throw new Error('no pair')
    numbered(await merges.mergeItems(first.a, first.b, NIGHT))

    await mergeTick(deps(), 'on', at('2026-10-06', '05:00'))
    expect(await db.execute(sql`select count(*)::int as n from catalogue_merges`)).toEqual([
      { n: 1 },
    ])
    await mergeTick(deps(), 'on', at('2026-10-06', '05:31'))
    await mergeTick(deps(), 'on', at('2026-10-06', '09:00'))
    const report = queued[0]
    if (report?.kind !== 'catalogue_merged') throw new Error('no report')
    expect(report.mergedPairs.map((pair) => pair.from).sort()).toEqual(['Кефир 1 %', 'Молоко 3.2%'])
  })
})

describe('two things the owner says are apart (make apart)', () => {
  it('are never merged or named by the night, nor what they are merged into since', async () => {
    const c = await made('Молоко 3.2%', 'moloko 3 2', '2026-09-01')
    const b = await made('Молоко 3,2%', 'moloko 3 2', '2026-09-02')
    const a = await made('Малоко 3,2%', 'maloko 3 2', '2026-09-03')
    for (const id of [a, b, c]) await vector(id, 1, 0)
    expect(await merges.apart(a, b)).toEqual({ subject: 'item', said: true })
    expect(await merges.apart(b, a)).toEqual({ subject: 'item', said: false })
    numbered(await merges.mergeItems(b, c, { by: 'hand' }))
    const report = (
      await mergeNight(
        { merges, embedder: NO_EMBEDDER, failed: () => undefined },
        'on',
        '2026-10-07',
      )
    ).report
    expect(await tracedTo(a)).toBeNull()
    const named = report.candidatePairs.map((pair) => [pair.fromId, pair.intoId].sort().join(' '))
    expect(named).not.toContain([a, c].sort().join(' '))
    // The owner's hand still may.
    expect('id' in (await merges.mergeItems(a, c, { by: 'hand' }))).toBe(true)
  })

  it('refuses what is no pair', async () => {
    const dish = await made('Хаш', 'hash', '2026-09-01')
    await db.update(items).set({ kind: 'dish' }).where(eq(items.id, dish))
    expect(await merges.apart(older, older)).toEqual({ refused: 'same' })
    expect(await merges.apart(older, randomUUID())).toEqual({ refused: 'missing' })
    expect(await merges.apart(older, dish)).toEqual({ refused: 'kind' })
    const gyumri = await insertPlace(db, { name: 'Ереван Сити', city: 'Гюмри' })
    const yerevan = await insertPlace(db, { name: 'Ереван Сити', city: 'Ереван' })
    expect(await merges.apart(gyumri, yerevan)).toEqual({ refused: 'city' })
  })
})

describe('the undo of a fan into one survivor (review №11, adversarial В1, В3)', () => {
  let a: string
  let b: string
  let d: string
  let first: number
  let second: number

  const scores = async () => {
    const read = async (itemId: string) =>
      (
        await db.execute<{ score: number }>(sql`
          select score from verdicts
          where actor_id = ${owner} and item_id = ${itemId} and deleted_at is null`)
      )[0]?.score ?? null
    return [await read(a), await read(b), await read(d)]
  }

  beforeEach(async () => {
    b = await made('Молоко 3,2%', 'moloko 3 2', '2026-09-01')
    a = await made('Малоко 3,2%', 'maloko 3 2', '2026-09-02')
    d = await made('Молако 3,2%', 'molako 3 2', '2026-09-03')
    for (const [itemId, score, day] of [
      // both merges swap: A is later than B, and D later than what A left on B
      [b, 1, '2026-09-01'],
      [a, 5, '2026-09-02'],
      [d, 3, '2026-09-03'],
    ] as const) {
      await db.execute(sql`
        insert into verdicts (id, actor_id, item_id, item_kind, score, rated_at, updated_at)
        values (${randomUUID()}, ${owner}, ${itemId}, 'product', ${score},
                ${`${day}T10:00:00Z`}::timestamptz, ${`${day}T10:00:00Z`}::timestamptz)`)
    }
    first = numbered(await merges.mergeItems(a, b, NIGHT))
    second = numbered(await merges.mergeItems(d, b, NIGHT))
  })

  it('refuses the first while the second swapped the same verdict, and changes nothing', async () => {
    const before = await snapshot()
    expect(await merges.unmerge(first)).toEqual({ refused: 'chained', later: second })
    expect(await snapshot()).toEqual(before)
  })

  it('puts every score home undone from the last', async () => {
    await merges.unmerge(second)
    await merges.unmerge(first)
    expect(await scores()).toEqual([5, 1, 3])
  })

  it('refuses it too while the second added to the same pick, keeping the «own word»', async () => {
    const c = await made('Кефир 1%', 'kefir 1', '2026-09-01')
    const x = await made('Кифир 1%', 'kifir 1', '2026-09-02')
    const y = await made('Кефир 1 %', 'kefir 1', '2026-09-03')
    await db.execute(sql`
      insert into search_picks (actor_id, query_key, item_id, picks, admits)
      values (${owner}, 'kefir', ${c}, 1, false), (${owner}, 'kefir', ${x}, 1, true),
             (${owner}, 'kefir', ${y}, 1, true)`)
    const one = numbered(await merges.mergeItems(x, c, NIGHT))
    const two = numbered(await merges.mergeItems(y, c, NIGHT))
    expect(await merges.unmerge(one)).toEqual({ refused: 'chained', later: two })
  })

  it('lets a merge go that no later one touched', async () => {
    const c = await made('Кефир 1%', 'kefir 1', '2026-09-01')
    const x = await made('Кифир 1%', 'kifir 1', '2026-09-02')
    const y = await made('Кефир 1 %', 'kefir 1', '2026-09-03')
    const one = numbered(await merges.mergeItems(x, c, NIGHT))
    numbered(await merges.mergeItems(y, c, NIGHT))
    expect(await merges.unmerge(one)).toEqual({ subject: 'item', from: x, into: c })
  })
})

describe('every pair of a night (adversarial В2) and «apart» through a third (Г1)', () => {
  async function twelvePairs(): Promise<void> {
    for (let i = 0; i < 12; i++) {
      const kept = await made(`Товар ${String(i)}`, `tovar ${String(i)}`, '2026-09-01')
      const twin = await made(`Товар  ${String(i)}`, `tovar ${String(i)}`, '2026-09-02')
      const axis = Array.from({ length: 768 }, (_, j) => (j === i ? 1 : 0))
      for (const id of [kept, twin]) {
        await db.execute(sql`
          insert into item_embeddings (item_id, model, embedding)
          values (${id}, ${EMBEDDING_MODEL}, ${`[${axis.join(',')}]`}::halfvec)`)
      }
    }
  }

  const tick = (mode: 'on' | 'report') =>
    mergeTick(
      {
        merges,
        embedder: NO_EMBEDDER,
        notices: { queue: () => Promise.resolve() },
        owner: true,
        failed: () => undefined,
      },
      mode,
      new Date('2026-10-06T05:00:00Z'),
    )

  it('keeps every merge of an `on` night past the ten the message names, by number', async () => {
    await twelvePairs()
    await tick('on')
    const night = await merges.nightList('2026-10-06')
    expect(night?.mode).toBe('on')
    expect(night?.pairs.map((pair) => typeof pair.id)).toEqual(Array(12).fill('number'))
  })

  it('keeps every pair a `report` night would merge, with both ids', async () => {
    await twelvePairs()
    await tick('report')
    const night = await merges.nightList('2026-10-06')
    expect(night?.mode).toBe('report')
    expect(night?.pairs).toHaveLength(12)
    expect(
      night?.pairs.every((pair) => pair.fromId !== undefined && pair.intoId !== undefined),
    ).toBe(true)
  })

  it('does not promise in report to merge two things apart into one third', async () => {
    const c = await made('Молоко 3.2%', 'moloko 3 2', '2026-09-01')
    const b = await made('Молоко 3,2%', 'moloko 3 2', '2026-09-02')
    const a = await made('Малоко 3,2%', 'maloko 3 2', '2026-09-03')
    for (const id of [a, b, c]) await vector(id, 1, 0)
    await merges.apart(a, b)
    const { report } = await mergeNight(
      { merges, embedder: NO_EMBEDDER, failed: () => undefined },
      'report',
      '2026-10-07',
    )
    const would = report.mergedPairs.filter((pair) => pair.intoId === c).map((pair) => pair.fromId)
    expect(would).toHaveLength(1)
  })
})

describe('a fan where the later merge only withdrew (review №12, adversarial Д1, Д2)', () => {
  it('waits for the later merge when it withdrew against a verdict the earlier one brought', async () => {
    const b = await made('Молоко 3,2%', 'moloko 3 2', '2026-09-01')
    const a = await made('Малоко 3,2%', 'maloko 3 2', '2026-09-02')
    const d = await made('Молако 3,2%', 'molako 3 2', '2026-09-03')
    for (const [itemId, score, day] of [
      [d, 2, '2026-09-02'],
      [a, 5, '2026-09-03'],
    ] as const) {
      await db.execute(sql`
        insert into verdicts (id, actor_id, item_id, item_kind, score, rated_at, updated_at)
        values (${randomUUID()}, ${owner}, ${itemId}, 'product', ${score},
                ${`${day}T10:00:00Z`}::timestamptz, ${`${day}T10:00:00Z`}::timestamptz)`)
    }
    const first = numbered(await merges.mergeItems(a, b, NIGHT))
    // A's later five moved onto B wins without a swap; D's two is withdrawn against it.
    const second = numbered(await merges.mergeItems(d, b, NIGHT))
    expect(await merges.unmerge(first)).toEqual({ refused: 'chained', later: second })
  })

  it('leaves the survivor a name its other twin knew too', async () => {
    const b = await made('Молоко', 'moloko', '2026-09-01')
    const a = await made('Малоко', 'maloko', '2026-09-02')
    const d = await made('Молако', 'molako', '2026-09-03')
    await db.execute(sql`
      insert into item_names (item_id, language, name) values (${a}, 'hy', 'կաթ'), (${d}, 'hy', 'կաթ')`)
    await db.execute(sql`insert into item_hs (item_id, hs) values (${a}, '0401'), (${d}, '0401')`)
    const first = numbered(await merges.mergeItems(a, b, NIGHT))
    numbered(await merges.mergeItems(d, b, NIGHT))
    await merges.unmerge(first)
    const names = await db.execute<{ item_id: string }>(
      sql`select item_id from item_names order by item_id`,
    )
    expect(names.map((row) => row.item_id).sort()).toEqual([a, b, d].sort())
    const headings = await db.execute<{ item_id: string }>(sql`select item_id from item_hs`)
    expect(headings.map((row) => row.item_id).sort()).toEqual([a, b, d].sort())
  })

  it('leaves the survivor as it was, the fan undone from the earlier merge on (adversarial Е1)', async () => {
    const b = await made('Молоко', 'moloko', '2026-09-01')
    const a = await made('Малоко', 'maloko', '2026-09-02')
    const d = await made('Молако', 'molako', '2026-09-03')
    await db.execute(sql`
      insert into item_names (item_id, language, name) values (${a}, 'hy', 'կաթ'), (${d}, 'hy', 'կաթ')`)
    await db.execute(sql`insert into item_hs (item_id, hs) values (${a}, '0401'), (${d}, '0401')`)
    const before = await snapshot()
    const first = numbered(await merges.mergeItems(a, b, NIGHT))
    const second = numbered(await merges.mergeItems(d, b, NIGHT))
    await merges.unmerge(first)
    await merges.unmerge(second)
    expect(await snapshot()).toEqual(before)
  })

  it('keeps a name of the survivor its own, whatever the twins knew', async () => {
    const b = await made('Молоко', 'moloko', '2026-09-01')
    const a = await made('Малоко', 'maloko', '2026-09-02')
    const d = await made('Молако', 'molako', '2026-09-03')
    await db.execute(sql`
      insert into item_names (item_id, language, name)
      values (${a}, 'hy', 'կաթ'), (${d}, 'hy', 'կաթ'), (${b}, 'hy', 'կաթ')`)
    const before = await snapshot()
    const first = numbered(await merges.mergeItems(a, b, NIGHT))
    const second = numbered(await merges.mergeItems(d, b, NIGHT))
    await merges.unmerge(first)
    await merges.unmerge(second)
    expect(await snapshot()).toEqual(before)
  })

  it('still takes a name back whole when no other twin knew it', async () => {
    const b = await made('Молоко', 'moloko', '2026-09-01')
    const a = await made('Малоко', 'maloko', '2026-09-02')
    await db.execute(
      sql`insert into item_names (item_id, language, name) values (${a}, 'hy', 'կաթ')`,
    )
    await merges.unmerge(numbered(await merges.mergeItems(a, b, NIGHT)))
    expect(await db.execute(sql`select item_id from item_names`)).toEqual([{ item_id: a }])
  })
})
