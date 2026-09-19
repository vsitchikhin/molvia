import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import postgres from 'postgres'
import type { Sql } from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { testDatabaseUrl } from './db'
import { MIGRATIONS } from '@/db/migrate'

/**
 * 0009 on a database that already holds what it makes one: two cards of one café that differ
 * only by a variation selector — legal before it, one place after. Without the merge the new
 * unique index refused them, and since migrations run when the API starts, the API did not
 * (MOL-21, adversarial round 4, А).
 *
 * Its own database, created and dropped here, as in `migrations.integration.test.ts`: it has to
 * be left one step short of the chain's end.
 */
interface JournalEntry {
  readonly idx: number
  readonly tag: string
}

const journal = JSON.parse(readFileSync(`${MIGRATIONS}/meta/_journal.json`, 'utf8')) as {
  entries: readonly JournalEntry[]
}

const url = new URL(testDatabaseUrl())
const database = `${url.pathname.slice(1)}_0009`
const maintenance = new URL(url.toString())
maintenance.pathname = '/postgres'
const ownUrl = new URL(url.toString())
ownUrl.pathname = `/${database}`

// Built from code points rather than typed: an invisible character in the source cannot be read.
const VS16 = String.fromCodePoint(0xfe0f)
const CUP = String.fromCodePoint(0x2615)

let admin: Sql
let sql: Sql

async function apply(entry: JournalEntry): Promise<void> {
  const file = readFileSync(`${MIGRATIONS}/${entry.tag}.sql`, 'utf8')
  for (const statement of file.split('--> statement-breakpoint')) {
    if (statement.trim() === '') continue
    await sql.unsafe(statement)
  }
}

beforeAll(async () => {
  admin = postgres(maintenance.toString(), { max: 1, onnotice: () => undefined })
  await admin.unsafe(`drop database if exists "${database}"`)
  await admin.unsafe(`create database "${database}"`)
  sql = postgres(ownUrl.toString(), { max: 1, onnotice: () => undefined })
})

afterAll(async () => {
  await sql.end()
  await admin.unsafe(`drop database if exists "${database}"`)
  await admin.end()
})

describe('0009: places that the new identity makes one', () => {
  it('merges them into the oldest card instead of refusing to start', async () => {
    const before = journal.entries.filter((entry) => entry.idx < 9)
    const [nine] = journal.entries.filter((entry) => entry.idx === 9)
    expect(nine?.tag).toBe('0009_place_identity_selectors')
    for (const entry of before) await apply(entry)

    const actorId = randomUUID()
    const dishId = randomUUID()
    const keptPlaceId = randomUUID()
    const duplicatePlaceId = randomUUID()
    const otherPlaceId = randomUUID()
    const tripId = randomUUID()

    await sql`
      insert into actors (id, country, city, spend_currency, income_currency)
      values (${actorId}, 'AM', 'Гюмри', 'AMD', 'RUB')
    `
    await sql`
      insert into items (id, kind, name, search_key, default_unit)
      values (${dishId}, 'dish', 'Хашлама', 'hashlama', 'piece')
    `
    // What `POST /trips` wrote without complaint before 0009: the old identity tells these apart.
    await sql`
      insert into places (id, kind, name, country, city, created_at)
      values (${keptPlaceId}, 'venue', ${`Кафе ${CUP}`}, 'AM', 'Гюмри', now() - interval '1 day'),
             (${duplicatePlaceId}, 'venue', ${`Кафе ${CUP}${VS16}`}, 'AM', 'Гюмри', now()),
             (${otherPlaceId}, 'venue', 'Кафе', 'AM', 'Гюмри', now())
    `
    await sql`
      insert into trips (id, actor_id, place_id, currency)
      values (${tripId}, ${actorId}, ${duplicatePlaceId}, 'AMD')
    `
    // One dish rated on both cards: merged, they would be one triple. The later opinion stays —
    // here it sits on the card that goes, so the merge has to carry it over, not keep the older.
    await sql`
      insert into verdicts (id, actor_id, item_id, item_kind, place_id, score, rated_at, updated_at)
      values (${randomUUID()}, ${actorId}, ${dishId}, 'dish', ${keptPlaceId}, 4,
              now() - interval '1 day', now() - interval '1 day'),
             (${randomUUID()}, ${actorId}, ${dishId}, 'dish', ${duplicatePlaceId}, 2, now(), now())
    `

    await apply(nine ?? { idx: 9, tag: '0009_place_identity_selectors' })

    const places = await sql<
      { id: string; name: string }[]
    >`select id, name from places order by name`
    // The oldest card survives with the name it was written with; a café without the cup is
    // another place and is left alone.
    expect(places).toEqual([
      { id: otherPlaceId, name: 'Кафе' },
      { id: keptPlaceId, name: `Кафе ${CUP}` },
    ])

    const [trip] = await sql<
      { place_id: string }[]
    >`select place_id from trips where id = ${tripId}`
    expect(trip?.place_id).toBe(keptPlaceId)

    const verdicts = await sql<{ place_id: string; score: number }[]>`
      select place_id, score from verdicts
    `
    expect(verdicts).toEqual([{ place_id: keptPlaceId, score: 2 }])

    // And the index is there and holds: the other spelling is refused now.
    await expect(
      sql`
        insert into places (id, kind, name, country, city)
        values (${randomUUID()}, 'venue', ${`Кафе ${CUP}${VS16}`}, 'AM', 'Гюмри')
      `,
    ).rejects.toThrow(/places_identity_key/)
  })
})
