/**
 * The reader behind `dist/gates.js` (MOL-91): both gates in one read-only snapshot. The gates
 * themselves are pinned by their own files; this one holds the transaction and the wiring.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { connectDrizzle } from './db'
import { clearAll, insertActor } from './fixtures'
import { createGatesReader } from '@/db/gates-reader'

const { db, close } = connectDrizzle()
const reader = createGatesReader(db)

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
const window = { from: new Date(Date.now() - 60 * DAY), to: new Date(Date.now() + DAY) }

beforeEach(async () => {
  await clearAll(db)
})

afterAll(async () => {
  await clearAll(db)
  await close()
})

describe('the gates reader', () => {
  it('reads both gates over one window, with the moment they were judged by', async () => {
    const before = Date.now()
    await insertActor(db, { createdAt: new Date(Date.now() - 40 * DAY) })
    await insertActor(db, {
      createdAt: new Date(Date.now() - 10 * DAY),
      sharedUntil: new Date(Date.now() + 30 * DAY),
    })

    const report = await reader.read(window)

    expect(report.ratings).toEqual({ cohortSize: 1, reached: 0, pending: 1 })
    const waiting = { cohortSize: 0, returned: 0, pending: 1, withoutAccess: 1 }
    expect(report.products).toEqual(waiting)
    expect(report.venues).toEqual(waiting)
    expect(report.readAt.getTime()).toBeGreaterThanOrEqual(before - 1000)
    expect(report.readAt.getTime()).toBeLessThanOrEqual(Date.now() + 1000)
  })

  it('reads inside a read-only, repeatable-read transaction', async () => {
    // What «it cannot write even by mistake» and «one snapshot» rest on: the mode of the
    // transaction the reader opens, asked of Postgres from inside it rather than taken on trust.
    const modes: unknown[] = []
    const watched = new Proxy(db, {
      get(target, property, receiver) {
        if (property !== 'transaction') return Reflect.get(target, property, receiver) as unknown
        const transaction: typeof db.transaction = async (body, config) =>
          target.transaction(async (tx) => {
            const [mode] = await tx.execute(sql`
              select current_setting('transaction_read_only') as read_only,
                     current_setting('transaction_isolation') as isolation`)
            modes.push(mode)
            return body(tx)
          }, config)
        return transaction
      },
    })

    await createGatesReader(watched).read(window)

    expect(modes).toEqual([{ read_only: 'on', isolation: 'repeatable read' }])
  })
})
