import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import postgres from 'postgres'
import type { Sql } from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { testDatabaseUrl } from './db'
import { MIGRATIONS } from '@/db/migrate'

/**
 * 0012 on a database that holds what every copy holds: owners, and everything hanging off
 * them. `telegram_user_id` is NOT NULL and there is nowhere to get one for a row already
 * written — the key to an account lives at Telegram, not here — so the migration empties the
 * tables rather than inventing identities (MOL-52, Р-2, agreed with the owner on 20.09.2026).
 *
 * What this pins is the part that is easy to get wrong in the dark: **what survives**. A
 * catalogue wiped along with its authors would be a loss with no one to notice it, and the
 * order of the deletes is the only thing standing between «the copy loses its noise» and «the
 * API does not start because a foreign key refused».
 *
 * Its own database, created and dropped here, as in `migration-0010.integration.test.ts`: the
 * chain has to be left one step short of its end.
 */
interface JournalEntry {
  readonly idx: number
  readonly tag: string
}

const journal = JSON.parse(readFileSync(`${MIGRATIONS}/meta/_journal.json`, 'utf8')) as {
  entries: readonly JournalEntry[]
}

const url = new URL(testDatabaseUrl())
const database = `${url.pathname.slice(1)}_0012`
const maintenance = new URL(url.toString())
maintenance.pathname = '/postgres'
const ownUrl = new URL(url.toString())
ownUrl.pathname = `/${database}`

let admin: Sql
let sql: Sql

async function apply(entry: JournalEntry): Promise<void> {
  const file = readFileSync(`${MIGRATIONS}/${entry.tag}.sql`, 'utf8')
  for (const statement of file.split('--> statement-breakpoint')) {
    if (statement.trim() === '') continue
    await sql.unsafe(statement)
  }
}

async function countOf(table: string): Promise<number> {
  const [row] = await sql<{ n: number }[]>`select count(*)::int as n from ${sql(table)}`
  return row?.n ?? 0
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

describe('0012: the owners a Telegram identity cannot be found for', () => {
  it('empties what belongs to them, keeps the catalogue, and only then adds the column', async () => {
    const before = journal.entries.filter((entry) => entry.idx < 12)
    const [twelve] = journal.entries.filter((entry) => entry.idx === 12)
    expect(twelve?.tag).toBe('0012_telegram_identity')
    for (const entry of before) await apply(entry)

    const actorId = randomUUID()
    const itemId = randomUUID()
    const placeId = randomUUID()
    const tripId = randomUUID()

    await sql`
      insert into actors (id, country, city, spend_currency, income_currency)
      values (${actorId}, 'AM', 'Гюмри', 'AMD', 'RUB')
    `
    // The one row of this whole set that a person actually typed: an item they added to the
    // shared catalogue. It is not their data, and it has to outlive them.
    await sql`
      insert into items (id, kind, name, search_key, default_unit, created_by)
      values (${itemId}, 'product', 'Молоко «Ашхар»', 'moloko ashar', 'l', ${actorId})
    `
    await sql`
      insert into places (id, kind, name, country, city)
      values (${placeId}, 'store', 'SAS', 'AM', 'Гюмри')
    `
    await sql`
      insert into trips (id, actor_id, place_id, currency)
      values (${tripId}, ${actorId}, ${placeId}, 'AMD')
    `
    await sql`
      insert into expenses (id, trip_id, item_id, qty_milli, qty_unit, amount_minor, amount_currency)
      values (${randomUUID()}, ${tripId}, ${itemId}, 1000, 'l', 52000, 'AMD')
    `
    // A product is rated without a place — `verdicts_place_matches_kind` holds that, and it
    // is the schema's business, not this test's.
    await sql`
      insert into verdicts (id, actor_id, item_id, item_kind, score)
      values (${randomUUID()}, ${actorId}, ${itemId}, 'product', 4)
    `
    await sql`
      insert into search_picks (actor_id, query_key, item_id)
      values (${actorId}, 'moloko', ${itemId})
    `
    await sql`
      insert into events (actor_id, type, payload)
      values (${actorId}, 'catalogue_viewed', '{"subject":"product"}'::jsonb)
    `

    await apply(twelve ?? { idx: 12, tag: '0012_telegram_identity' })

    // Gone: the owner and everything that only meant something through them. Expenses are in
    // the list although the migration never names them — they ride out on the trip's cascade,
    // and a cascade that stopped working would show up here rather than in production.
    for (const table of ['actors', 'trips', 'expenses', 'verdicts', 'search_picks', 'events']) {
      expect([table, await countOf(table)]).toEqual([table, 0])
    }

    // Alive: the shared catalogue and the places, the item merely orphaned. That is
    // `ON DELETE SET NULL` doing it, not a line of the migration — which is the point of
    // checking: nothing in the file says «keep the items».
    expect(await countOf('places')).toBe(1)
    const items = await sql<{ id: string; created_by: string | null }[]>`
      select id, created_by from items
    `
    expect(items).toEqual([{ id: itemId, created_by: null }])

    // And the column it cleared the way for is there with its constraints, not merely added:
    // a migration that dropped the UNIQUE would leave every later login able to fork an
    // account in two. The bounds themselves are the schema's to prove, and they are, in
    // `schema.integration.test.ts`.
    const one = (telegramUserId: number) => sql`
      insert into actors (id, telegram_user_id, country, city, spend_currency, income_currency)
      values (${randomUUID()}, ${telegramUserId}, 'AM', 'Гюмри', 'AMD', 'RUB')
    `
    await one(777_000_123)
    await expect(one(777_000_123)).rejects.toMatchObject({ code: '23505' })
  })
})
