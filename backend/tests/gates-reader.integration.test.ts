/**
 * The reader behind `dist/gates.js` (MOL-91): both gates in one read-only snapshot. The gates
 * themselves are pinned by their own files; this one holds the transaction and the wiring.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { connectDrizzle } from './db'
import { clearAll, insertActor } from './fixtures'
import { createGatesReader } from '@/db/gates-reader'
import { erasures, loginDays, reminderDays } from '@/db/schema'

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
    expect(report.erased.count).toBe(0)
    expect(report.readAt.getTime()).toBeGreaterThanOrEqual(before - 1000)
    expect(report.readAt.getTime()).toBeLessThanOrEqual(Date.now() + 1000)
  })

  it('counts the erased of the weeks the window touches, whole weeks in Yerevan', async () => {
    await db.insert(erasures).values([
      { appearedWeek: '2026-09-28', erased: 5 }, // the week before
      { appearedWeek: '2026-10-05', erased: 2 },
      { appearedWeek: '2026-10-12', erased: 1 },
      { appearedWeek: '2026-10-19', erased: 7 }, // the week after
    ])

    // Wednesday the 7th to Sunday the 18th, the latter taken in whole: `to` is Monday the 19th
    // at 00:00 in Yerevan, and its last millisecond is still the week of the 12th.
    const report = await reader.read({
      from: new Date('2026-10-07T00:00:00+04:00'),
      to: new Date('2026-10-19T00:00:00+04:00'),
    })

    expect(report.erased).toEqual({ count: 3, firstWeek: '2026-10-05', lastWeek: '2026-10-12' })
  })

  it('reads the login funnel of the days the window touches, whole days in Yerevan (MOL-68)', async () => {
    const counts = {
      again: 0,
      confirmed: 1,
      declined: 0,
      collected: 1,
      expiredUnconfirmed: 0,
      expiredConfirmed: 0,
      refused: 0,
    }
    await db.insert(loginDays).values([
      { day: '2026-10-06', started: 9, ...counts }, // the day before
      { day: '2026-10-07', started: 1, ...counts },
      { day: '2026-10-18', started: 2, ...counts },
      { day: '2026-10-19', started: 9, ...counts }, // the day after
    ])

    // From Wednesday the 7th at noon to Sunday the 18th taken in whole: `to` is the 19th at 00:00
    // in Yerevan, and its last millisecond is still the 18th.
    const report = await reader.read({
      from: new Date('2026-10-07T12:00:00+04:00'),
      to: new Date('2026-10-19T00:00:00+04:00'),
    })

    expect(report.logins.firstDay).toBe('2026-10-07')
    expect(report.logins.lastDay).toBe('2026-10-18')
    expect(report.logins.days.map((day) => [day.day, day.started])).toEqual([
      ['2026-10-07', 1],
      ['2026-10-18', 2],
    ])
  })

  it('sums the reminder counters of the days the window touches (MOL-101)', async () => {
    const counts = { firstSteps: 1, secondSteps: 1, thirdSteps: 1, items: 3, rated: 1 }
    await db.insert(reminderDays).values([
      { day: '2026-10-06', ...counts }, // the day before
      { day: '2026-10-07', ...counts },
      { day: '2026-10-18', ...counts, rated: 2 },
      { day: '2026-10-19', ...counts }, // the day after
    ])

    const report = await reader.read({
      from: new Date('2026-10-07T12:00:00+04:00'),
      to: new Date('2026-10-19T00:00:00+04:00'),
    })

    expect(report.reminders).toEqual({
      firstDay: '2026-10-07',
      lastDay: '2026-10-18',
      firstSteps: 2,
      secondSteps: 2,
      thirdSteps: 2,
      items: 6,
      rated: 3,
    })
  })

  it('reads zeros for days without a reminder', async () => {
    const report = await reader.read({
      from: new Date('2026-10-07T00:00:00+04:00'),
      to: new Date('2026-10-08T00:00:00+04:00'),
    })
    expect(report.reminders).toMatchObject({ firstSteps: 0, items: 0, rated: 0 })
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
