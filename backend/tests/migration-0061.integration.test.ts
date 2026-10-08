import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import type { Sql } from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { testDatabaseUrl } from './db'
import { insertActor, insertItem, insertPlace, insertTrip } from './fixtures'
import { storeMemoryWords } from '@molvia/model'
import { MIGRATIONS } from '@/db/migrate'
import * as schema from '@/db/schema'
import { expenses, receiptLineImages, receipts, storeMemory } from '@/db/schema'
import { settleStoreMemory } from '@/db/store-memory-repository'

/**
 * 0061 on a database that holds what `SET NULL` left behind (MOL-240): a recorded receipt whose trip
 * was removed for good, a line whose purchase was removed, a line not recorded at «Записать», a
 * cut-out row of such a line. They go before the keys and the check are added — or the API does not
 * start — and nothing of a receipt still at work goes with them.
 *
 * Its own database, created and dropped here, as in `migration-0012.integration.test.ts`: the chain
 * has to be left one step short of 0061. The rows are written with the schema as it is now, but for
 * the lines: 0061 adds a column to them.
 */
interface JournalEntry {
  readonly idx: number
  readonly tag: string
}

const journal = JSON.parse(readFileSync(`${MIGRATIONS}/meta/_journal.json`, 'utf8')) as {
  entries: readonly JournalEntry[]
}

const url = new URL(testDatabaseUrl())
const database = `${url.pathname.slice(1)}_0061`
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

describe('0061: what a removed trip or purchase left of its receipt', () => {
  it('removes the orphans, then makes the receipt go with its trip and the line with its purchase', async () => {
    const before = journal.entries.filter((entry) => entry.idx < 61)
    const [own] = journal.entries.filter((entry) => entry.idx === 61)
    if (own === undefined) throw new Error('0061 is not in the journal')
    expect(own.tag).toBe('0061_receipt_goes_with_trip')
    for (const entry of before) await apply(entry)
    const db = drizzle(sql, { schema })

    const me = await insertActor(db)
    const milk = await insertItem(db)
    const place = await insertPlace(db)
    const trip = await insertTrip(db, { actorId: me, placeId: place })
    const bought = randomUUID()
    await db.insert(expenses).values({ id: bought, tripId: trip, itemId: milk })

    const receipt = (id: string, tripId: string | null) => ({
      id,
      actorId: me,
      status: 'recorded' as const,
      parts: 1,
      country: 'AM' as const,
      language: 'ru' as const,
      currency: 'AMD' as const,
      capturedAt: new Date(),
      queuedAt: new Date(),
      tin: '01282006',
      receiptNo: '21410811',
      totalMinor: 111_000n,
      tripId,
      recordedAt: new Date(),
    })
    const line = (receiptId: string, position: number, expenseId: string | null) => ({
      receiptId,
      position,
      printed: `строка ${String(position)}`,
      priceMinor: 37_000n,
      sumMinor: 37_000n,
      settled: true,
      expenseId,
    })
    const row = (receiptId: string, position: number) => ({
      receiptId,
      position,
      piece: 0,
      image: Buffer.from([0xff, 0xd8]),
      readText: `строка ${String(position)}`,
      confirmedText: `строка ${String(position)}`,
      confirmedAt: new Date(),
    })

    // a receipt at work: its trip is there, one line bought, one whose purchase was removed, one
    // not recorded — and a row cut out of each of the first two
    const working = randomUUID()
    // its trip removed for good: `SET NULL` left it here, with a line and a row
    const orphan = randomUUID()
    // not recorded yet: its lines have no purchase and must stay
    const parsed = randomUUID()
    await db
      .insert(receipts)
      .values([
        receipt(working, trip),
        receipt(orphan, null),
        { ...receipt(parsed, null), status: 'parsed', recordedAt: null },
      ])
    // by hand: the schema of now has columns 0061 adds after this point
    for (const one of [
      line(working, 0, bought),
      line(working, 1, null),
      line(working, 2, null),
      line(orphan, 0, null),
      line(parsed, 0, null),
    ]) {
      await sql`
        insert into receipt_lines (receipt_id, position, printed, price_minor, sum_minor, settled, expense_id)
        values (${one.receiptId}, ${one.position}, ${one.printed}, ${String(one.priceMinor)},
          ${String(one.sumMinor)}, ${one.settled}, ${one.expenseId})`
    }
    await db
      .insert(receiptLineImages)
      .values([row(working, 0), row(working, 1), row(orphan, 0), row(parsed, 0)])

    // the words those lines taught at «Записать» (MOL-240, round 3, Р3-4): the line bought, the line
    // whose purchase was removed, the line not recorded; and an erased person's word on the same key,
    // which nobody's lines settle
    const word = (actorId: string | null, position: number) => {
      const [said] = storeMemoryWords({ printed: `строка ${String(position)}`, sku: null })
      if (said === undefined) throw new Error('a line with letters says a word')
      return { id: randomUUID(), tin: '01282006', ...said, actorId, itemId: milk }
    }
    await db.insert(storeMemory).values([word(me, 0), word(me, 1), word(me, 2), word(null, 1)])

    await apply(own)
    // what SQL cannot find goes once the API listens: a text key is `toSearchKey` — on the schema of
    // the build that settles, every migration after 0061 applied
    for (const entry of journal.entries.filter((one) => one.idx > 61)) await apply(entry)
    // 0061: a line recorded before it is «as read» by its row confirmed (Р4-1): the purchase has no sum
    expect(await sql`select as_read from receipt_lines where receipt_id = ${working}`).toEqual([
      { as_read: true },
    ])
    // and a line no record judged — the receipt not recorded yet — stays null (Р6-1)
    expect(await sql`select as_read from receipt_lines where receipt_id = ${parsed}`).toEqual([
      { as_read: null },
    ])
    expect(await settleStoreMemory(db)).toBe(3)
    const words = await sql<{ actor_id: string | null; key: string }[]>`
      select actor_id, key from store_memory order by actor_id nulls last`
    expect(words).toEqual([
      { actor_id: me, key: word(me, 0).key },
      { actor_id: null, key: word(null, 1).key },
    ])

    const left = await sql<{ id: string }[]>`select id from receipts order by id`
    expect(left.map((one) => one.id).sort()).toEqual([working, parsed].sort())
    const lines = await sql<{ receipt_id: string; position: number }[]>`
      select receipt_id, position from receipt_lines order by receipt_id, position`
    expect(lines).toEqual(
      expect.arrayContaining([
        { receipt_id: working, position: 0 },
        { receipt_id: parsed, position: 0 },
      ]),
    )
    expect(lines).toHaveLength(2)
    const rows = await sql<{ receipt_id: string; position: number }[]>`
      select receipt_id, position from receipt_line_images`
    expect(rows).toHaveLength(2)
    expect(rows).toEqual(
      expect.arrayContaining([
        { receipt_id: working, position: 0 },
        { receipt_id: parsed, position: 0 },
      ]),
    )

    // from now on the keys hold it: the purchase takes its line and row, the trip its receipt
    await sql`delete from expenses where id = ${bought}`
    expect(await sql`select 1 from receipt_lines where receipt_id = ${working}`).toHaveLength(0)
    expect(await sql`select 1 from receipt_line_images where receipt_id = ${working}`).toHaveLength(
      0,
    )
    await sql`delete from trips where id = ${trip}`
    expect(await sql`select 1 from receipts where id = ${working}`).toHaveLength(0)
    // and a recorded receipt without its trip is refused
    await expect(
      sql`update receipts set status = 'recorded', recorded_at = now() where id = ${parsed}`,
    ).rejects.toThrow(/receipts_recorded_with_trip/)
  })
})
