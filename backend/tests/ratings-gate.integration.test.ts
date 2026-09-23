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

async function startOf(actorId: string): Promise<Date> {
  const rows = await db.execute<{ created_at: string }>(
    sql`select created_at from actors where id = ${actorId}::uuid`,
  )
  return new Date(rows[0]?.created_at ?? Number.NaN)
}

/** A verdict given through `put`, then placed `hour` hours into the person's own life. */
async function rateAt(actorId: string, hour: number, itemId?: string): Promise<string> {
  const item = itemId ?? (await insertItem(db))
  await verdicts.put(actorId, { itemId: item, score: 4 })
  const ratedAt = new Date((await startOf(actorId)).getTime() + hour * HOUR)
  await db
    .update(verdictsTable)
    .set({ ratedAt })
    .where(and(eq(verdictsTable.actorId, actorId), eq(verdictsTable.itemId, item)))
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
})
