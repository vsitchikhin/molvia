/**
 * Gate 0.2 (MOL-49): the share of people who gave five verdicts in their first two weeks. The
 * corners come from the task and from MOL-27's self-review, С-14.
 *
 * Verdicts are written through the repository's own `put` and `withdraw`, not inserted: the
 * gate's promises about withdrawn and re-rated verdicts are promises about those two paths.
 * Only a person whose window has closed is counted, so a verdict written now is moved back
 * onto the hour of their life the case needs — the way the 0.3 tests place events.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { and, eq, sql } from 'drizzle-orm'
import { GATE_RATINGS, GATE_RATINGS_WINDOW_HOURS } from '@molvia/model'
import { connectDrizzle } from './db'
import { clearAll, insertActor, insertItem } from './fixtures'
import { createVerdictRepository } from '@/db/verdicts-repository'
import { verdicts as verdictsTable } from '@/db/schema'

const { db, close } = connectDrizzle()
const verdicts = createVerdictRepository(db)

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const WINDOW = GATE_RATINGS_WINDOW_HOURS * HOUR

const now = Date.now()
const daysAgo = (days: number): Date => new Date(now - days * DAY)

// The release of 0.2 as the caller would pass it, and a cohort that reaches today.
const from = daysAgo(60)
const to = new Date(now + DAY)

beforeEach(async () => {
  await clearAll(db)
})

afterAll(async () => {
  await clearAll(db)
  await close()
})

function gate(window: { from: Date; to: Date } = { from, to }) {
  return verdicts.reachedRatings({
    ...window,
    ratings: GATE_RATINGS,
    windowHours: GATE_RATINGS_WINDOW_HOURS,
  })
}

/** A person who appeared this long ago — by default well past their two weeks. */
function personSeen(started: Date = daysAgo(30)): Promise<string> {
  return insertActor(db, { createdAt: started })
}

/**
 * A verdict given through `put`, then placed `hour` hours into the person's own life. Placed in
 * Postgres, from `created_at` itself: a JavaScript date keeps milliseconds and `created_at`
 * keeps microseconds, so a verdict put «exactly on the line» from JavaScript lands a fraction
 * before it (adversarial pass, test remark).
 */
async function rateAt(actorId: string, hour: number, itemId?: string): Promise<string> {
  const item = itemId ?? (await insertItem(db))
  await verdicts.put(actorId, { itemId: item, score: 4 })
  await db.execute(sql`
    update verdicts v set rated_at = a.created_at + make_interval(secs => ${hour * 3600}::double precision)
    from actors a
    where a.id = v.actor_id and v.actor_id = ${actorId}::uuid and v.item_id = ${item}::uuid`)
  return item
}

/** `count` verdicts on different items, spread over the first days of the window. */
async function rateMany(actorId: string, count: number): Promise<string[]> {
  const items: string[] = []
  for (let n = 0; n < count; n += 1) items.push(await rateAt(actorId, n * 24 + 1))
  return items
}

describe('gate 0.2: five verdicts in two weeks', () => {
  it('counts nobody when nobody has appeared', async () => {
    await expect(gate()).resolves.toEqual({ cohortSize: 0, reached: 0 })
  })

  it.each([
    [4, 0],
    [5, 1],
    [6, 1],
  ])('with %i verdicts in the window, %i reached the threshold', async (count, reached) => {
    await rateMany(await personSeen(), count)

    await expect(gate()).resolves.toEqual({ cohortSize: 1, reached })
  })

  it('counts a fifth verdict in the last hour of the second week', async () => {
    const actorId = await personSeen()
    await rateMany(actorId, 4)
    await rateAt(actorId, GATE_RATINGS_WINDOW_HOURS - 0.5)

    await expect(gate()).resolves.toEqual({ cohortSize: 1, reached: 1 })
  })

  it('does not count a fifth verdict in the first hour of the third week', async () => {
    const actorId = await personSeen()
    await rateMany(actorId, 4)
    await rateAt(actorId, GATE_RATINGS_WINDOW_HOURS)

    await expect(gate()).resolves.toEqual({ cohortSize: 1, reached: 0 })
  })

  it('counts a withdrawn verdict: five given, one taken back, is five', async () => {
    const actorId = await personSeen()
    const [first] = await rateMany(actorId, 5)
    await expect(verdicts.withdraw(actorId, first ?? '')).resolves.toBe(true)

    await expect(gate()).resolves.toEqual({ cohortSize: 1, reached: 1 })
  })

  it('keeps a verdict withdrawn and given again where it was first given', async () => {
    const actorId = await personSeen()
    const [first] = await rateMany(actorId, 5)
    const itemId = first ?? ''
    const [before] = await db
      .select({ ratedAt: verdictsTable.ratedAt })
      .from(verdictsTable)
      .where(and(eq(verdictsTable.actorId, actorId), eq(verdictsTable.itemId, itemId)))

    // Given again today — weeks after the window — through the same path the screen takes.
    await verdicts.withdraw(actorId, itemId)
    await verdicts.put(actorId, { itemId, score: 2 })

    const rows = await db
      .select({ ratedAt: verdictsTable.ratedAt })
      .from(verdictsTable)
      .where(eq(verdictsTable.actorId, actorId))
    expect(rows).toHaveLength(5)
    const [after] = await db
      .select({ ratedAt: verdictsTable.ratedAt })
      .from(verdictsTable)
      .where(and(eq(verdictsTable.actorId, actorId), eq(verdictsTable.itemId, itemId)))
    expect(after?.ratedAt).toEqual(before?.ratedAt)
    await expect(gate()).resolves.toEqual({ cohortSize: 1, reached: 1 })
  })

  it('counts one item rated five times as one verdict', async () => {
    const actorId = await personSeen()
    const itemId = await insertItem(db)
    for (const score of [1, 2, 3, 4, 5]) await rateAt(actorId, score, itemId)

    await expect(gate()).resolves.toEqual({ cohortSize: 1, reached: 0 })
  })

  it('keeps a person with no verdicts in the denominator', async () => {
    await rateMany(await personSeen(), 5)
    await personSeen()

    await expect(gate()).resolves.toEqual({ cohortSize: 2, reached: 1 })
  })

  it('counts each person by their own verdicts, not the items they share', async () => {
    const rater = await personSeen()
    const items = await rateMany(rater, 5)
    const neighbour = await personSeen()
    for (const itemId of items.slice(0, 4)) await rateAt(neighbour, 2, itemId)

    await expect(gate()).resolves.toEqual({ cohortSize: 2, reached: 1 })
  })

  it('takes a cohort from `from` inclusive to `to` exclusive', async () => {
    const start = daysAgo(40)
    const end = daysAgo(20)
    await rateMany(await personSeen(start), 5)
    await rateMany(await personSeen(end), 5)
    await personSeen(new Date(start.getTime() - 1))

    await expect(gate({ from: start, to: end })).resolves.toEqual({ cohortSize: 1, reached: 1 })
  })

  it('has no paid door: a person without access is counted', async () => {
    const actorId = await insertActor(db, { createdAt: daysAgo(30), sharedUntil: null })
    await rateMany(actorId, 5)

    await expect(gate()).resolves.toEqual({ cohortSize: 1, reached: 1 })
  })

  it('counts a person whose window closed a minute ago', async () => {
    await rateMany(await personSeen(new Date(Date.now() - WINDOW - MINUTE)), 5)

    await expect(gate()).resolves.toEqual({ cohortSize: 1, reached: 1 })
  })

  it('leaves out a person whose window is still open, even with five verdicts', async () => {
    await rateMany(await personSeen(new Date(Date.now() - WINDOW + MINUTE)), 5)
    await personSeen(daysAgo(5))

    await expect(gate()).resolves.toEqual({ cohortSize: 0, reached: 0 })
  })

  it('counts in hours across a daylight-saving change, whatever the session zone', async () => {
    // Europe/Berlin moves to summer time on 29.03.2026: fourteen calendar days from 20.03 noon
    // are 335 hours there, and a statement adding '14 days' would drop a verdict at 335:30.
    const inWindow = await personSeen(new Date('2026-03-20T12:00:00Z'))
    await rateMany(inWindow, 4)
    await rateAt(inWindow, GATE_RATINGS_WINDOW_HOURS - 0.5)
    const past = await personSeen(new Date('2026-03-20T12:00:00Z'))
    await rateMany(past, 4)
    await rateAt(past, GATE_RATINGS_WINDOW_HOURS)

    const answer = await db.transaction(async (tx) => {
      await tx.execute(sql`set local timezone = 'Europe/Berlin'`)
      return createVerdictRepository(tx).reachedRatings({
        from: new Date('2026-03-01T00:00:00Z'),
        to: new Date('2026-04-01T00:00:00Z'),
        ratings: GATE_RATINGS,
        windowHours: GATE_RATINGS_WINDOW_HOURS,
      })
    })

    expect(answer).toEqual({ cohortSize: 2, reached: 1 })
  })

  it('draws the line to the microsecond `created_at` carries', async () => {
    const actorId = await personSeen()
    await db.execute(
      sql`update actors set created_at = created_at - interval '0.000700 seconds' where id = ${actorId}::uuid`,
    )
    await rateMany(actorId, 4)
    const fifth = await rateAt(actorId, GATE_RATINGS_WINDOW_HOURS - 1 / 3600 / 1_000_000)

    await expect(gate()).resolves.toEqual({ cohortSize: 1, reached: 1 })

    await rateAt(actorId, GATE_RATINGS_WINDOW_HOURS, fifth)

    await expect(gate()).resolves.toEqual({ cohortSize: 1, reached: 0 })
  })
})

describe('gate 0.2: what it refuses to answer', () => {
  it.each([
    ['a fractional window', { windowHours: 335.5 }],
    ['a negative window', { windowHours: -2 }],
    ['a zero threshold', { ratings: 0 }],
    ['a fractional threshold', { ratings: 4.5 }],
    ['an invalid date', { from: new Date('not a date') }],
    ['an empty window', { to: from }],
    ['a window past int4', { windowHours: 2 ** 31 }],
    ['a threshold past int4', { ratings: 2 ** 31 }],
    ['a `to` at the end of JavaScript time', { to: new Date(8.64e15) }],
    ['a `from` at the start of JavaScript time', { from: new Date(-8.64e15) }],
  ])('refuses %s before the database is asked', async (_, patch) => {
    await personSeen()

    await expect(
      verdicts.reachedRatings({
        from,
        to,
        ratings: GATE_RATINGS,
        windowHours: GATE_RATINGS_WINDOW_HOURS,
        ...patch,
      }),
    ).rejects.toThrow(RangeError)
  })

  it('answers at the edges it accepts: the largest int4, and year 9999 as «until forever»', async () => {
    await personSeen()

    await expect(
      verdicts.reachedRatings({
        from: new Date('0001-01-01T00:00:00Z'),
        to: new Date('9999-12-31T23:59:59.999Z'),
        ratings: 2 ** 31 - 1,
        windowHours: GATE_RATINGS_WINDOW_HOURS,
      }),
    ).resolves.toEqual({ cohortSize: 1, reached: 0 })
  })
})
