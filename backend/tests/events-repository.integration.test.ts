import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { EVENT } from '@molvia/model'
import { connectDrizzle } from './db'
import { clearAll, insertActor } from './fixtures'
import { createEventRepository } from '@/db/events-repository'
import { events } from '@/db/schema'

const { db, close } = connectDrizzle()
const repository = createEventRepository(db)

const DAY = 24 * 60 * 60 * 1000
const now = Date.now()
const daysAgo = (days: number): Date => new Date(now - days * DAY)

// A cohort window well clear of anything another test could write.
const from = daysAgo(40)
const to = daysAgo(30)

// The whole graph, not just these two tables: `actors` is protected by RESTRICT from trips,
// verdicts and picks, so a leftover trip from any other file would make this one fail with
// 23503 and look like a schema defect.
beforeEach(async () => {
  await clearAll(db)
})

afterAll(async () => {
  await clearAll(db)
  await close()
})

async function actorSeenAt(started: Date): Promise<string> {
  const actorId = await insertActor(db)
  await repository.record({ actorId, type: EVENT.SESSION_STARTED, occurredAt: started })
  return actorId
}

describe('week-four return', () => {
  it('counts nobody when nobody has been seen', async () => {
    await expect(repository.weekFourReturn('product', from, to)).resolves.toEqual({
      cohortSize: 0,
      returned: 0,
    })
  })

  it('counts an actor who came back in their fourth week', async () => {
    const actorId = await actorSeenAt(daysAgo(35))
    await repository.record({
      actorId,
      type: EVENT.ADVICE_VIEWED,
      payload: { subject: 'product' },
      occurredAt: daysAgo(35 - 24), // day 24 of their own life, inside week four
    })

    await expect(repository.weekFourReturn('product', from, to)).resolves.toEqual({
      cohortSize: 1,
      returned: 1,
    })
  })

  it('measures products and venues separately, as the threshold demands', async () => {
    const actorId = await actorSeenAt(daysAgo(35))
    await repository.record({
      actorId,
      type: EVENT.ADVICE_VIEWED,
      payload: { subject: 'venue' },
      occurredAt: daysAgo(35 - 24),
    })

    await expect(repository.weekFourReturn('venue', from, to)).resolves.toEqual({
      cohortSize: 1,
      returned: 1,
    })
    await expect(repository.weekFourReturn('product', from, to)).resolves.toEqual({
      cohortSize: 1,
      returned: 0,
    })
  })

  it('does not count a return on the boundary days outside the fourth week', async () => {
    const early = await actorSeenAt(daysAgo(35))
    await repository.record({
      actorId: early,
      type: EVENT.ADVICE_VIEWED,
      payload: { subject: 'product' },
      occurredAt: daysAgo(35 - 20), // day 20 — still the third week
    })

    const late = await actorSeenAt(daysAgo(35))
    await repository.record({
      actorId: late,
      type: EVENT.ADVICE_VIEWED,
      payload: { subject: 'product' },
      occurredAt: daysAgo(35 - 28), // day 28 — the fifth week has begun
    })

    await expect(repository.weekFourReturn('product', from, to)).resolves.toEqual({
      cohortSize: 2,
      returned: 0,
    })
  })

  it('counts a returning actor once, however many times they looked', async () => {
    const actorId = await actorSeenAt(daysAgo(35))
    for (const day of [22, 24, 26]) {
      await repository.record({
        actorId,
        type: EVENT.ADVICE_VIEWED,
        payload: { subject: 'product' },
        occurredAt: daysAgo(35 - day),
      })
    }

    await expect(repository.weekFourReturn('product', from, to)).resolves.toEqual({
      cohortSize: 1,
      returned: 1,
    })
  })

  it('does not count the search: its event answered a question the gate no longer asks', async () => {
    // `catalogue_viewed` meant «came back to enter a purchase». The gate asks about coming
    // back to *read* other people's data, so from MOL-31 it counts `advice_viewed` and
    // nothing else — the old rows stay in the log and are not read (Р-15, Р-18).
    const actorId = await actorSeenAt(daysAgo(35))
    await repository.record({
      actorId,
      type: EVENT.CATALOGUE_VIEWED,
      payload: { subject: 'product' },
      occurredAt: daysAgo(35 - 24),
    })

    await expect(repository.weekFourReturn('product', from, to)).resolves.toEqual({
      cohortSize: 1,
      returned: 0,
    })
  })

  it('ignores actors first seen outside the cohort window', async () => {
    const actorId = await actorSeenAt(daysAgo(5))
    await repository.record({
      actorId,
      type: EVENT.ADVICE_VIEWED,
      payload: { subject: 'product' },
      occurredAt: daysAgo(1),
    })

    await expect(repository.weekFourReturn('product', from, to)).resolves.toEqual({
      cohortSize: 0,
      returned: 0,
    })
  })
})

describe("recording at most once a day of the person's own life", () => {
  const HOUR = 60 * 60 * 1000
  const view = (actorId: string, subject: 'product' | 'venue' = 'product') =>
    ({ actorId, type: EVENT.ADVICE_VIEWED, payload: { subject } }) as const
  const ago = (ms: number) => new Date(Date.now() - ms)

  async function viewsOf(actorId: string) {
    return (await db.select().from(events)).filter(
      (row) => row.actorId === actorId && row.type === EVENT.ADVICE_VIEWED,
    )
  }

  it('writes the first one', async () => {
    const actorId = await insertActor(db)

    await expect(repository.recordOncePerDay(view(actorId))).resolves.toBe(true)
    expect(await viewsOf(actorId)).toHaveLength(1)
  })

  it('writes nothing more in the same day of their life', async () => {
    const actorId = await insertActor(db)
    // First seen ten days and three hours ago: today of their life began three hours ago.
    await repository.record({ ...view(actorId), occurredAt: ago(10 * DAY + 3 * HOUR) })
    await repository.record({ ...view(actorId), occurredAt: ago(2 * HOUR) })

    await expect(repository.recordOncePerDay(view(actorId))).resolves.toBe(false)
    expect(await viewsOf(actorId)).toHaveLength(2)
  })

  it('writes a visit in week four even when the last row is under a day old', async () => {
    // The rolling window lost exactly this: an evening in week three swallowed the next
    // morning in week four, and the gate saw a person who came back as one who did not.
    const actorId = await insertActor(db)
    const started = ago(21 * DAY + HOUR) // week four of their life began an hour ago
    await repository.record({ ...view(actorId), occurredAt: started })
    await repository.record({ ...view(actorId), occurredAt: ago(2 * HOUR) }) // still week three

    await expect(repository.recordOncePerDay(view(actorId))).resolves.toBe(true)
    await expect(
      repository.weekFourReturn('product', ago(21 * DAY + 2 * HOUR), ago(21 * DAY)),
    ).resolves.toEqual({ cohortSize: 1, returned: 1 })
  })

  it('counts days and weeks the same in any time zone of the session', async () => {
    // `interval '1 day'` is a calendar day in the session's zone: across a clock change
    // «21 days» is 503 hours, and a visit at hour 503½ fell into week four there while in UTC
    // it was week three. Both now count hours.
    //
    // The zone is made up around today rather than named: a real one (Chile, 6 September 2026)
    // put its change inside the last three weeks only for a while, and then this test would
    // pass on the old arithmetic too. A POSIX rule whose summer time starts ten days ago keeps
    // the change inside the window on whatever day the test runs.
    const tenDaysAgo = new Date(Date.now() - 10 * DAY)
    // `Jn` counts 1..365 and never counts 29 February, so the day is taken in a common year.
    const julian =
      (Date.UTC(2001, tenDaysAgo.getUTCMonth(), tenDaysAgo.getUTCDate()) - Date.UTC(2001, 0, 1)) /
        DAY +
      1
    const summerEnds = ((julian + 60 - 1) % 365) + 1
    const shifting = `XST3XDT,J${String(julian)}/0,J${String(summerEnds)}/0`
    async function scenario(zone: string, withEvening: boolean) {
      const actorId = await insertActor(db)
      return db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('timezone', ${zone}, true)`)
        const log = createEventRepository(tx)
        const started = ago(21 * DAY - HOUR / 2)
        await log.record({ ...view(actorId), occurredAt: started })
        if (withEvening) await log.record({ ...view(actorId), occurredAt: ago(23 * HOUR) })

        const written = await log.recordOncePerDay(view(actorId))
        const gate = await log.weekFourReturn(
          'product',
          new Date(started.getTime() - HOUR),
          new Date(started.getTime() + HOUR),
        )
        return { written, returned: gate.returned }
      })
    }

    for (const withEvening of [false, true]) {
      const utc = await scenario('UTC', withEvening)
      const shifted = await scenario(shifting, withEvening)
      expect(shifted, `evening before: ${String(withEvening)}`).toEqual(utc)
    }
  })

  it('keeps the product and venue halves apart', async () => {
    const actorId = await insertActor(db)
    await repository.record(view(actorId, 'product'))

    await expect(repository.recordOncePerDay(view(actorId, 'venue'))).resolves.toBe(true)
    await expect(repository.recordOncePerDay(view(actorId, 'venue'))).resolves.toBe(false)
  })

  it('must not be held back by another type or by another actor', async () => {
    const actorId = await insertActor(db)
    const someoneElse = await insertActor(db)
    await repository.record({ actorId, type: EVENT.SESSION_STARTED })
    await repository.record(view(someoneElse))

    await expect(repository.recordOncePerDay(view(actorId))).resolves.toBe(true)
  })

  it('writes one row when two requests overlap on two connections', async () => {
    const actorId = await insertActor(db)
    const one = connectDrizzle()
    const other = connectDrizzle()
    try {
      const written = await Promise.all([
        createEventRepository(one.db).recordOncePerDay(view(actorId)),
        createEventRepository(other.db).recordOncePerDay(view(actorId)),
      ])

      expect(written.filter(Boolean)).toHaveLength(1)
      expect(await viewsOf(actorId)).toHaveLength(1)
    } finally {
      await one.close()
      await other.close()
    }
  })
})
