import { randomUUID } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { EVENT } from '@molvia/model'
import { connectDrizzle } from '../../tests/db'
import { createEventRepository } from './events-repository'
import { events } from './schema'

const { db, close } = connectDrizzle()
const repository = createEventRepository(db)

const DAY = 24 * 60 * 60 * 1000
const now = Date.now()
const daysAgo = (days: number): Date => new Date(now - days * DAY)

// A cohort window well clear of anything another test could write.
const from = daysAgo(40)
const to = daysAgo(30)

beforeEach(async () => {
  await db.delete(events)
})

afterAll(async () => {
  await db.delete(events)
  await close()
})

async function actorSeenAt(started: Date): Promise<string> {
  const actorId = randomUUID()
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
      type: EVENT.CATALOGUE_VIEWED,
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
      type: EVENT.CATALOGUE_VIEWED,
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
      type: EVENT.CATALOGUE_VIEWED,
      payload: { subject: 'product' },
      occurredAt: daysAgo(35 - 20), // day 20 — still the third week
    })

    const late = await actorSeenAt(daysAgo(35))
    await repository.record({
      actorId: late,
      type: EVENT.CATALOGUE_VIEWED,
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
        type: EVENT.CATALOGUE_VIEWED,
        payload: { subject: 'product' },
        occurredAt: daysAgo(35 - day),
      })
    }

    await expect(repository.weekFourReturn('product', from, to)).resolves.toEqual({
      cohortSize: 1,
      returned: 1,
    })
  })

  it('ignores actors first seen outside the cohort window', async () => {
    const actorId = await actorSeenAt(daysAgo(5))
    await repository.record({
      actorId,
      type: EVENT.CATALOGUE_VIEWED,
      payload: { subject: 'product' },
      occurredAt: daysAgo(1),
    })

    await expect(repository.weekFourReturn('product', from, to)).resolves.toEqual({
      cohortSize: 0,
      returned: 0,
    })
  })
})
