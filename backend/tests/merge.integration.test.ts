/**
 * The merge of twins and its undo (MOL-106), on a real database: every row that names a merged item
 * or place moves and is written down, one person's two verdicts settle without the 0.2 gate gaining or
 * losing a rating, and `unmerge` puts the database back as it was.
 */
import { randomUUID } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { GATE_RATINGS, GATE_RATINGS_WINDOW_HOURS } from '@molvia/model'
import { createErasureRepository } from '@/db/erasure-repository'
import { createMergeRepository } from '@/db/merge-repository'
import { createVerdictRepository } from '@/db/verdicts-repository'
import { actors, catalogueMergeMoves, catalogueMerges, items, places } from '@/db/schema'
import { connectDrizzle } from './db'
import { clearAll, insertActor, insertItem, insertPlace, insertTrip } from './fixtures'

const { db, close } = connectDrizzle()
const merges = createMergeRepository(db)
const NIGHT = { by: 'night', edits: 1, worst: 1, meaning: 0.95 } as const

let owner: string
let older: string
let younger: string

beforeEach(async () => {
  await clearAll(db)
  owner = await insertActor(db)
  older = await insertItem(db, { name: 'Молоко 3,2%', searchKey: 'moloko 3 2' })
  younger = await insertItem(db, { name: 'Малоко 3,2%', searchKey: 'maloko 3 2' })
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
    names: await read(sql`select item_id, language, name from item_names order by language, name`),
    headings: await read(sql`select item_id, hs from item_hs order by hs`),
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

  it('takes the rows back from wherever a later merge moved them', async () => {
    await everything()
    const third = await insertItem(db, { name: 'Молоко 3.2%', searchKey: 'moloko 3 2' })
    const before = await snapshot()
    const first = await merges.mergeItems(younger, older, NIGHT)
    await merges.mergeItems(older, third, NIGHT)
    if (!('id' in first)) throw new Error('not merged')
    await merges.unmerge(first.id)
    expect(await namedBy('expenses', younger)).toBe(1)
    expect(await namedBy('search_picks', younger)).toBe(1)
    const [row] = await db.select().from(items).where(eq(items.id, younger))
    expect(row?.mergedInto).toBeNull()
    expect(before).toBeDefined()
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
