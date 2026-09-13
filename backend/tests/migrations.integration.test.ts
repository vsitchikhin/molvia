import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import postgres from 'postgres'
import type { Sql } from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { testDatabaseUrl } from './db'
import { MIGRATIONS } from '@/db/migrate'

/**
 * The chain against a database that already used it. Every other test starts from an empty
 * database, so the one case this covers is invisible to them: rows that were legal under an
 * earlier migration and are not under the next one. That is the case a developer's own copy
 * and the first deploy will meet, and there a failing migration means a service that does
 * not start.
 *
 * Its own database, created and dropped here: it has to be left mid-chain, which no other
 * test may see.
 */
interface JournalEntry {
  readonly idx: number
  readonly tag: string
}

const journal = JSON.parse(readFileSync(`${MIGRATIONS}/meta/_journal.json`, 'utf8')) as {
  entries: readonly JournalEntry[]
}

const url = new URL(testDatabaseUrl())
const database = `${url.pathname.slice(1)}_chain`
const maintenance = new URL(url.toString())
maintenance.pathname = '/postgres'
const chainUrl = new URL(url.toString())
chainUrl.pathname = `/${database}`

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
  sql = postgres(chainUrl.toString(), { max: 1, onnotice: () => undefined })
})

afterAll(async () => {
  await sql.end()
  await admin.unsafe(`drop database if exists "${database}"`)
  await admin.end()
})

describe('the migration chain on a database that already holds rows', () => {
  it('repairs what it makes illegal instead of refusing to start', async () => {
    const upTo0006 = journal.entries.filter((entry) => entry.idx <= 6)
    const rest = journal.entries.filter((entry) => entry.idx > 6)
    expect(rest.length).toBeGreaterThan(0)

    for (const entry of upTo0006) await apply(entry)

    // Six rows, every one of them legal under 0006 and illegal under what follows.
    const actorId = randomUUID()
    const itemId = randomUUID()
    const blankItemId = randomUUID()
    const dishId = randomUUID()
    const keptPlaceId = randomUUID()
    const duplicatePlaceId = randomUUID()
    const tripId = randomUUID()

    await sql`
      insert into actors (id, country, city, spend_currency, income_currency)
      values (${actorId}, 'AM', 'Гюмри', 'AMD', 'RUB')
    `
    await sql`
      insert into items (id, kind, name, search_key, default_unit)
      values (${itemId}, 'product', 'Молоко', 'moloko', 'l'),
             (${blankItemId}, 'product', 'Сыр', '   ', 'kg'),
             (${dishId}, 'dish', 'Карбонара', 'karbonara', 'piece')
    `
    await sql`
      insert into places (id, kind, name, country, city, created_at)
      values (${keptPlaceId}, 'store', 'SAS', 'AM', 'Ереван', now() - interval '1 day'),
             (${duplicatePlaceId}, 'store', 'sas', 'AM', 'Ереван', now())
    `
    await sql`
      insert into trips (id, actor_id, place_id, currency, rate_base, rate_quote, rate_scaled, rate_source, rate_as_of)
      values (${tripId}, ${actorId}, ${duplicatePlaceId}, 'AMD', 'RUB', 'AMD', 0, 'personal', now())
    `
    // One person, one product, two places — legal under 0006, because the rows differ in
    // place_id and NULLS NOT DISTINCT cannot see it. That was the hole A1 described, and
    // taking the place off both would turn them into the same triple.
    await sql`
      insert into verdicts (id, actor_id, item_id, place_id, score, rated_at)
      values (${randomUUID()}, ${actorId}, ${itemId}, ${keptPlaceId}, 2, now() - interval '1 day'),
             (${randomUUID()}, ${actorId}, ${itemId}, ${duplicatePlaceId}, 5, now())
    `
    // A dish rated nowhere: legal under 0006 and unrepairable — the place is half of what
    // such a verdict means, and there is nowhere to take it from.
    await sql`
      insert into verdicts (id, actor_id, item_id, score)
      values (${randomUUID()}, ${actorId}, ${dishId}, 4)
    `
    await sql`insert into events (actor_id, type) values (${actorId}, 'catalogue_viewed')`
    await sql`
      insert into search_picks (actor_id, query_key, item_id)
      values (${actorId}, ${'k'.repeat(700)}, ${itemId})
    `

    for (const entry of rest) await apply(entry)

    const [trip] = await sql<{ rate_scaled: string | null }[]>`
      select rate_scaled from trips where id = ${tripId}
    `
    // The trip survives; only the rate that could never convert anything is gone.
    expect(trip?.rate_scaled).toBeNull()

    const survivors = await sql<{ place_id: string | null; item_kind: string; score: number }[]>`
      select place_id, item_kind, score from verdicts
    `
    // One verdict left: the earliest of the two votes on the product, without its place.
    // The dish rated nowhere is gone.
    expect(survivors).toEqual([{ place_id: null, item_kind: 'product', score: 2 }])

    const places = await sql<{ id: string }[]>`select id from places`
    expect(places.map((row) => row.id)).toEqual([keptPlaceId])

    const [movedTrip] = await sql<{ place_id: string }[]>`
      select place_id from trips where id = ${tripId}
    `
    // The duplicate did not just disappear: the trip moved to the surviving card, so the
    // price history comes back together instead of splitting.
    expect(movedTrip?.place_id).toBe(keptPlaceId)

    await expect(sql`select 1 from events`).resolves.toHaveLength(0)
    await expect(sql`select 1 from search_picks`).resolves.toHaveLength(0)

    const [repaired] = await sql<{ search_key: string }[]>`
      select search_key from items where id = ${blankItemId}
    `
    expect(repaired?.search_key).toBe(`nokey-${blankItemId}`)
  })
})
