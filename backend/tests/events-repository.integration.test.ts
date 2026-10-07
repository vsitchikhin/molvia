import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { EVENT, STATISTICS_CONSENT_EDITION } from '@molvia/model'
import { connectDrizzle } from './db'
import { clearAll, insertActor, insertCounted } from './fixtures'
import { createEventRepository } from '@/db/events-repository'
import type { Conn } from '@/db/index'
import { actors, events } from '@/db/schema'

const { db, close } = connectDrizzle()
const repository = createEventRepository(db)

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
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

/**
 * A person who appeared on that day **and could see other people's data in their fourth
 * week** — the cohort of the gate (MOL-31, Р-20 and Р-24). Nothing is written to the log: the
 * cohort is read from `actors`, and the fixture used to seed `session_started` — an event no
 * code writes since MOL-8 withdrew it. A fixture describing a path the product does not take
 * is what kept the gate's own defect hidden (adversarial round 1, F2).
 */
async function actorSeenAt(started: Date): Promise<string> {
  return insertCounted(db, {
    createdAt: started,
    sharedUntil: new Date(started.getTime() + 40 * DAY),
  })
}

describe('week-four return', () => {
  it('counts nobody when nobody has been seen', async () => {
    await expect(repository.weekFourReturn('product', from, to)).resolves.toEqual({
      cohortSize: 0,
      returned: 0,
      pending: 0,
      withoutAccess: 0,
      withoutConsent: 0,
      optedOut: 0,
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
      pending: 0,
      withoutAccess: 0,
      withoutConsent: 0,
      optedOut: 0,
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
      pending: 0,
      withoutAccess: 0,
      withoutConsent: 0,
      optedOut: 0,
    })
    await expect(repository.weekFourReturn('product', from, to)).resolves.toEqual({
      cohortSize: 1,
      returned: 0,
      pending: 0,
      withoutAccess: 0,
      withoutConsent: 0,
      optedOut: 0,
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
      pending: 0,
      withoutAccess: 0,
      withoutConsent: 0,
      optedOut: 0,
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
      pending: 0,
      withoutAccess: 0,
      withoutConsent: 0,
      optedOut: 0,
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
      pending: 0,
      withoutAccess: 0,
      withoutConsent: 0,
      optedOut: 0,
    })
  })

  it('counts a person who never wrote a single event — the denominator is not the log', async () => {
    // Someone who could see other people's data and never came to look. Nothing of theirs is
    // in the log, and the gate must still be able to see that they did not come back:
    // building the cohort from the log put them outside it forever and left the threshold
    // measuring only those who had already returned (adversarial round 1, F2).
    await actorSeenAt(daysAgo(35))

    await expect(repository.weekFourReturn('product', from, to)).resolves.toEqual({
      cohortSize: 1,
      returned: 0,
      pending: 0,
      withoutAccess: 0,
      withoutConsent: 0,
      optedOut: 0,
    })
  })

  it('leaves out a person who never had access: they had nothing to come back to', async () => {
    // The numerator is behind a paid door, so a denominator of everyone who ever appeared
    // counts people who could not have produced an event at all, and the threshold reads
    // «stop» for a reason unrelated to the hypothesis (adversarial round 2, G1).
    await insertCounted(db, { createdAt: daysAgo(35) })

    await expect(repository.weekFourReturn('product', from, to)).resolves.toEqual({
      cohortSize: 0,
      returned: 0,
      pending: 0,
      withoutAccess: 1,
      withoutConsent: 0,
      optedOut: 0,
    })
  })

  it('leaves out a person whose access ran out before their fourth week', async () => {
    // Exactly the boundary: the fourth week opens at 504 hours, so access ending an hour
    // earlier is access they never had when the question was asked.
    const started = daysAgo(35)
    await insertCounted(db, {
      createdAt: started,
      sharedUntil: new Date(started.getTime() + 503 * HOUR),
    })
    await insertCounted(db, {
      createdAt: started,
      sharedUntil: new Date(started.getTime() + 504 * HOUR),
    })

    await expect(repository.weekFourReturn('product', from, to)).resolves.toEqual({
      cohortSize: 1,
      returned: 0,
      pending: 0,
      withoutAccess: 1,
      withoutConsent: 0,
      optedOut: 0,
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
      pending: 0,
      withoutAccess: 0,
      withoutConsent: 0,
      optedOut: 0,
    })
  })
})

describe('week-four return: a fourth week not over is no answer yet (MOL-91)', () => {
  const MINUTE = 60 * 1000
  const hoursAgo = (hours: number) => new Date(Date.now() - hours * HOUR)
  // A window that reaches today, as the gates script passes one.
  const gate = () => repository.weekFourReturn('product', daysAgo(60), new Date(Date.now() + DAY))

  it('names a person inside their fourth week as waiting, even one who already looked', async () => {
    // The very case the rule is for: counted now, they could only lower the rate — a visit
    // later this week would have made them a return.
    const actorId = await actorSeenAt(hoursAgo(600))
    await repository.record({
      actorId,
      type: EVENT.ADVICE_VIEWED,
      payload: { subject: 'product' },
      occurredAt: hoursAgo(600 - 510),
    })

    await expect(gate()).resolves.toEqual({
      cohortSize: 0,
      returned: 0,
      pending: 1,
      withoutAccess: 0,
      withoutConsent: 0,
      optedOut: 0,
    })
  })

  it('names a person whose fourth week has not begun as waiting', async () => {
    await actorSeenAt(hoursAgo(100))

    await expect(gate()).resolves.toEqual({
      cohortSize: 0,
      returned: 0,
      pending: 1,
      withoutAccess: 0,
      withoutConsent: 0,
      optedOut: 0,
    })
  })

  it('counts a person whose fourth week ended a minute ago, and waits for one a minute short', async () => {
    const done = await actorSeenAt(new Date(Date.now() - 672 * HOUR - MINUTE))
    await repository.record({
      actorId: done,
      type: EVENT.ADVICE_VIEWED,
      payload: { subject: 'product' },
      occurredAt: new Date(Date.now() - 672 * HOUR - MINUTE + 600 * HOUR),
    })
    await actorSeenAt(new Date(Date.now() - 672 * HOUR + MINUTE))

    await expect(gate()).resolves.toEqual({
      cohortSize: 1,
      returned: 1,
      pending: 1,
      withoutAccess: 0,
      withoutConsent: 0,
      optedOut: 0,
    })
  })

  it('names a newcomer without access as waiting: access may still be granted (adversarial А)', async () => {
    // Time first, access after. Judged by today's access, a person three days old read «no
    // access in week 4» eighteen days before that week, and moved the day access was granted.
    const newcomer = await insertCounted(db, { createdAt: hoursAgo(72) })
    await insertCounted(db, { createdAt: hoursAgo(100), sharedUntil: hoursAgo(1) })

    await expect(gate()).resolves.toEqual({
      cohortSize: 0,
      returned: 0,
      pending: 2,
      withoutAccess: 0,
      withoutConsent: 0,
      optedOut: 0,
    })

    // Granting access moves nobody: they were waiting either way.
    await db.execute(sql`
      update actors set shared_until = now() + interval '30 days' where id = ${newcomer}::uuid`)
    await expect(gate()).resolves.toEqual({
      cohortSize: 0,
      returned: 0,
      pending: 2,
      withoutAccess: 0,
      withoutConsent: 0,
      optedOut: 0,
    })
  })

  it('names as without access only a fourth week that is over — the three never overlap', async () => {
    await insertCounted(db, { createdAt: hoursAgo(700) }) // over, never had access
    await insertCounted(db, { createdAt: hoursAgo(700), sharedUntil: hoursAgo(700 - 503) })
    await actorSeenAt(hoursAgo(700)) // over, with access: the cohort
    await insertCounted(db, { createdAt: hoursAgo(600) }) // still going, no access: waiting

    await expect(gate()).resolves.toEqual({
      cohortSize: 1,
      returned: 0,
      pending: 1,
      withoutAccess: 2,
      withoutConsent: 0,
      optedOut: 0,
    })
  })
})

describe('week-four return: no consent to the statistics (MOL-236)', () => {
  const hoursAgo = (hours: number) => new Date(Date.now() - hours * HOUR)
  const gate = () => repository.weekFourReturn('product', daysAgo(60), new Date(Date.now() + DAY))

  it('leaves out whoever has not accepted edition 2, after access, and names them', async () => {
    await actorSeenAt(hoursAgo(700))
    const old = await actorSeenAt(hoursAgo(700))
    await db.update(actors).set({ consentVersion: 1 }).where(eq(actors.id, old))
    await insertActor(db, { createdAt: hoursAgo(700), sharedUntil: new Date(Date.now() + DAY) })
    // No access reached the fourth week: named there, not again here.
    await insertActor(db, { createdAt: hoursAgo(700) })

    await expect(gate()).resolves.toEqual({
      cohortSize: 1,
      returned: 0,
      pending: 0,
      withoutAccess: 1,
      withoutConsent: 2,
      optedOut: 0,
    })
  })
})

describe('week-four return: an objection to being counted (MOL-96)', () => {
  const hoursAgo = (hours: number) => new Date(Date.now() - hours * HOUR)
  const gate = () => repository.weekFourReturn('product', daysAgo(60), new Date(Date.now() + DAY))

  async function cameBack(actorId: string) {
    await db.execute(sql`
      insert into events (actor_id, type, payload, occurred_at)
      select id, ${EVENT.ADVICE_VIEWED}, '{"subject":"product"}'::jsonb, created_at + interval '530 hours'
      from actors where id = ${actorId}::uuid`)
  }

  /** Back on at `started` plus this interval, written in Postgres to keep the microseconds. */
  async function backOnAt(actorId: string, after: string) {
    await db.execute(sql`
      update actors set analytics_off_at = null, analytics_on_at = created_at + ${after}::interval
      where id = ${actorId}::uuid`)
  }

  it('leaves someone off out of both halves and names them, whatever rows are left', async () => {
    const off = await actorSeenAt(hoursAgo(700))
    await cameBack(off)
    await db.execute(sql`update actors set analytics_off_at = now() where id = ${off}::uuid`)
    await cameBack(await actorSeenAt(hoursAgo(700)))

    await expect(gate()).resolves.toEqual({
      cohortSize: 1,
      returned: 1,
      pending: 0,
      withoutAccess: 0,
      withoutConsent: 0,
      optedOut: 1,
    })
  })

  it('through the switch: a return erased with the log is an objection, not a person who stayed away', async () => {
    const actorId = await actorSeenAt(hoursAgo(700))
    await cameBack(actorId)
    await repository.chooseAnalytics(actorId, true)

    await expect(gate()).resolves.toMatchObject({
      cohortSize: 0,
      returned: 0,
      withoutConsent: 0,
      optedOut: 1,
    })
  })

  it('counts someone back on exactly as their fourth week began, and not a millisecond later (Р-3)', async () => {
    const onTime = await actorSeenAt(hoursAgo(700))
    await backOnAt(onTime, '504 hours')
    await cameBack(onTime)
    const late = await actorSeenAt(hoursAgo(700))
    await backOnAt(late, '504 hours 1 millisecond')
    await cameBack(late)

    await expect(gate()).resolves.toEqual({
      cohortSize: 1,
      returned: 1,
      pending: 0,
      withoutAccess: 0,
      withoutConsent: 0,
      optedOut: 1,
    })
  })

  it('keeps out someone back on after their fourth week too: that week was erased', async () => {
    const actorId = await actorSeenAt(hoursAgo(700))
    await backOnAt(actorId, '690 hours')

    await expect(gate()).resolves.toMatchObject({ cohortSize: 0, withoutConsent: 0, optedOut: 1 })
  })

  it('time first, access after, the objection last: each person on one line, the lines add up', async () => {
    const offAt = new Date()
    await insertCounted(db, { createdAt: hoursAgo(600), analyticsOffAt: offAt }) // waiting
    await insertCounted(db, { createdAt: hoursAgo(700), analyticsOffAt: offAt }) // no access
    const objected = await actorSeenAt(hoursAgo(700))
    await db.execute(sql`update actors set analytics_off_at = now() where id = ${objected}::uuid`)
    await actorSeenAt(hoursAgo(700)) // the cohort

    await expect(gate()).resolves.toEqual({
      cohortSize: 1,
      returned: 0,
      pending: 1,
      withoutAccess: 1,
      withoutConsent: 0,
      optedOut: 1,
    })
  })
})

/**
 * Moves a person's whole life `hours` into the past — their appearance, their access and their
 * log — so that a fourth week written today has ended by the time the gate reads it (MOL-91).
 * Hours relative to `created_at` stay exactly as they were, which is all the gate reads.
 */
async function lifeEarlier(conn: Conn, actorId: string, hours: number): Promise<void> {
  await conn.execute(sql`
    update actors set created_at = created_at - make_interval(hours => ${hours}),
      shared_until = shared_until - make_interval(hours => ${hours})
    where id = ${actorId}::uuid`)
  await conn.execute(sql`
    update events set occurred_at = occurred_at - make_interval(hours => ${hours})
    where actor_id = ${actorId}::uuid`)
}

describe("recording at most once a day of the person's own life", () => {
  const view = (actorId: string, subject: 'product' | 'venue' = 'product') =>
    ({ actorId, type: EVENT.ADVICE_VIEWED, payload: { subject } }) as const
  const ago = (ms: number) => new Date(Date.now() - ms)

  async function viewsOf(actorId: string) {
    return (await db.select().from(events)).filter(
      (row) => row.actorId === actorId && row.type === EVENT.ADVICE_VIEWED,
    )
  }

  it('writes the first one', async () => {
    const actorId = await insertCounted(db)

    await expect(repository.recordOncePerDay(view(actorId))).resolves.toBe(true)
    expect(await viewsOf(actorId)).toHaveLength(1)
  })

  it('writes nothing for whoever has not accepted edition 2 — the log rests on it (MOL-236)', async () => {
    const nobody = await insertActor(db)
    const old = await insertActor(db, { consentVersion: 1, consentedAt: new Date() })

    await expect(repository.recordOncePerDay(view(nobody))).resolves.toBe(false)
    await expect(repository.recordOncePerDay(view(old))).resolves.toBe(false)
    expect(await viewsOf(nobody)).toHaveLength(0)
    expect(await viewsOf(old)).toHaveLength(0)

    // Accepted, the very next visit is written.
    await db
      .update(actors)
      .set({ consentVersion: STATISTICS_CONSENT_EDITION })
      .where(eq(actors.id, old))
    await expect(repository.recordOncePerDay(view(old))).resolves.toBe(true)
  })

  it('writes nothing more in the same day of their life', async () => {
    // Appeared ten days and three hours ago: today of their life began three hours ago.
    const actorId = await insertCounted(db, { createdAt: ago(10 * DAY + 3 * HOUR) })
    await repository.record({ ...view(actorId), occurredAt: ago(10 * DAY + 3 * HOUR) })
    await repository.record({ ...view(actorId), occurredAt: ago(2 * HOUR) })

    await expect(repository.recordOncePerDay(view(actorId))).resolves.toBe(false)
    expect(await viewsOf(actorId)).toHaveLength(2)
  })

  it('writes a visit in week four even when the last row is under a day old', async () => {
    // The rolling window lost exactly this: an evening in week three swallowed the next
    // morning in week four, and the gate saw a person who came back as one who did not.
    const started = ago(21 * DAY + HOUR) // week four of their life began an hour ago
    // With access, because only then is there a visit to write and a cohort to count them in.
    const actorId = await insertCounted(db, {
      createdAt: started,
      sharedUntil: new Date(started.getTime() + 40 * DAY),
    })
    await repository.record({ ...view(actorId), occurredAt: started })
    await repository.record({ ...view(actorId), occurredAt: ago(2 * HOUR) }) // still week three

    await expect(repository.recordOncePerDay(view(actorId))).resolves.toBe(true)
    // Read once the week is over: a fourth week still going is no answer yet (MOL-91).
    await lifeEarlier(db, actorId, 168)
    await expect(
      repository.weekFourReturn('product', ago(28 * DAY + 2 * HOUR), ago(28 * DAY)),
    ).resolves.toEqual({
      cohortSize: 1,
      returned: 1,
      pending: 0,
      withoutAccess: 0,
      withoutConsent: 0,
      optedOut: 0,
    })
  })

  it('counts days and weeks the same in any time zone of the session', async () => {
    // `interval '1 day'` is a calendar day in the session's zone: across a clock change
    // «21 days» is 503 hours, and a visit at hour 503½ fell into week four there while in UTC
    // it was week three. Both now count hours.
    //
    // The zone is made up around today rather than named: a real one (Chile, 6 September 2026)
    // put its change inside the last three weeks only for a while, and then this test would
    // pass on the old arithmetic too. A POSIX rule whose summer time starts seventeen days ago
    // keeps the change inside both lives on whatever day the test runs: the one written today,
    // 21 days back, and the one the gate reads, moved two weeks further (self-review С-7). At ten
    // days the move left the change after the third week, and `interval '21 days'` passed there.
    const changeDay = new Date(Date.now() - 17 * DAY)
    // `Jn` counts 1..365 and never counts 29 February, so the day is taken in a common year.
    const julian =
      (Date.UTC(2001, changeDay.getUTCMonth(), changeDay.getUTCDate()) - Date.UTC(2001, 0, 1)) /
        DAY +
      1
    const summerEnds = ((julian + 60 - 1) % 365) + 1
    const shifting = `XST3XDT,J${String(julian)}/0,J${String(summerEnds)}/0`
    // A person with access past their fourth week, looking now at hour 503½ or 504½ of their
    // life — the last half hour of week three, the first of week four — and once more the evening
    // before. The gate is read once the fourth week is over, so they are in the cohort: comparing
    // two empty cohorts proved nothing (self-review С-1).
    async function scenario(zone: string, hour: number, withEvening: boolean) {
      await clearAll(db) // one person per reading, or the previous scenario's joins the cohort
      const started = ago(hour * HOUR)
      const actorId = await insertCounted(db, {
        createdAt: started,
        sharedUntil: new Date(started.getTime() + 40 * DAY),
      })
      return db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('timezone', ${zone}, true)`)
        const log = createEventRepository(tx)
        await log.record({ ...view(actorId), occurredAt: started })
        if (withEvening) await log.record({ ...view(actorId), occurredAt: ago(23 * HOUR) })

        const written = await log.recordOncePerDay(view(actorId))
        await lifeEarlier(tx, actorId, 336)
        const born = started.getTime() - 336 * HOUR
        const gate = await log.weekFourReturn(
          'product',
          new Date(born - HOUR),
          new Date(born + HOUR),
        )
        return { written, cohortSize: gate.cohortSize, returned: gate.returned }
      })
    }

    for (const [hour, returned] of [
      [503.5, 0],
      [504.5, 1],
    ] as const) {
      for (const withEvening of [false, true]) {
        const utc = await scenario('UTC', hour, withEvening)
        const shifted = await scenario(shifting, hour, withEvening)
        const at = `hour ${String(hour)}, evening before: ${String(withEvening)}`
        expect(shifted, at).toEqual(utc)
        expect(utc, at).toEqual({ written: utc.written, cohortSize: 1, returned })
      }
    }
  })

  it('keeps the product and venue halves apart', async () => {
    const actorId = await insertCounted(db)
    await repository.record(view(actorId, 'product'))

    await expect(repository.recordOncePerDay(view(actorId, 'venue'))).resolves.toBe(true)
    await expect(repository.recordOncePerDay(view(actorId, 'venue'))).resolves.toBe(false)
  })

  it('must not be held back by another type or by another actor', async () => {
    const actorId = await insertCounted(db)
    const someoneElse = await insertCounted(db)
    await repository.record({ actorId, type: EVENT.SESSION_STARTED })
    await repository.record(view(someoneElse))

    await expect(repository.recordOncePerDay(view(actorId))).resolves.toBe(true)
  })

  it('writes one row when two requests overlap on two connections', async () => {
    const actorId = await insertCounted(db)
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
