import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import type { Sql } from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { testDatabaseUrl } from './db'
import { insertActor, insertItem, insertPlace, insertTrip } from './fixtures'
import { MIGRATIONS } from '@/db/migrate'
import * as schema from '@/db/schema'
import { expenses, receiptLineImages, receiptLines, receipts } from '@/db/schema'

/**
 * 0060 on a database that holds what `SET NULL` left behind (MOL-240): a recorded receipt whose trip
 * was removed for good, a line whose purchase was removed, a line not recorded at «Записать», a
 * cut-out row of such a line. They go before the keys and the check are added — or the API does not
 * start — and nothing of a receipt still at work goes with them.
 *
 * Its own database, created and dropped here, as in `migration-0012.integration.test.ts`: the chain
 * has to be left one step short of 0060. The rows are written with the schema as it is now — 0060
 * changes no column, so its inserts are the same on the database before it.
 */
interface JournalEntry {
  readonly idx: number
  readonly tag: string
}

const journal = JSON.parse(readFileSync(`${MIGRATIONS}/meta/_journal.json`, 'utf8')) as {
  entries: readonly JournalEntry[]
}

const url = new URL(testDatabaseUrl())
const database = `${url.pathname.slice(1)}_0060`
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

describe('0060: what a removed trip or purchase left of its receipt', () => {
  it('removes the orphans, then makes the receipt go with its trip and the line with its purchase', async () => {
    const before = journal.entries.filter((entry) => entry.idx < 60)
    const [sixty] = journal.entries.filter((entry) => entry.idx === 60)
    expect(sixty?.tag).toBe('0060_receipt_goes_with_trip')
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
      printed: `строка ${position}`,
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
      readText: `строка ${position}`,
      confirmedText: `строка ${position}`,
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
    await db
      .insert(receiptLines)
      .values([
        line(working, 0, bought),
        line(working, 1, null),
        line(working, 2, null),
        line(orphan, 0, null),
        line(parsed, 0, null),
      ])
    await db
      .insert(receiptLineImages)
      .values([row(working, 0), row(working, 1), row(orphan, 0), row(parsed, 0)])

    await apply(sixty as JournalEntry)

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
