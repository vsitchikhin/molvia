import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { ownerNoticeSchema } from '@molvia/model'
import { eq } from 'drizzle-orm'
import { createModelSpendRepository } from '@/db/model-spend-repository'
import type { ModelCall } from '@/db/model-spend-repository'
import { actors, ownerNotices } from '@/db/schema'
import { connectDrizzle } from './db'
import { clearAll, insertActor } from './fixtures'
import { onlyRow } from './rows'

// What reading receipts by a model costs, by month (MOL-272): the cap held in one statement a call,
// the worst reserved before a call and settled at its own after, the owner told once a step a month; and
// each person's share of it (MOL-367).

const { db, close } = connectDrizzle()
const spend = createModelSpendRepository(db, true)
const silent = createModelSpendRepository(db, false)
const MONTH = '2026-10-01'
const CAP = 200_000_000
const at = new Date('2026-10-20T12:00:00Z')

// the cap's tests by one person whose share never binds, so that only the cap answers
let mine: ModelCall

beforeEach(async () => {
  await clearAll(db)
  mine = { actorId: await insertActor(db), capMicroUsd: CAP, shareMicroUsd: 2 * CAP }
})
afterAll(async () => {
  await clearAll(db)
  await close()
})

const told = async () =>
  (
    await db.select({ payload: ownerNotices.payload }).from(ownerNotices).orderBy(ownerNotices.id)
  ).map((row) => ownerNoticeSchema.parse(row.payload))

describe('the cap (Т-4, В-2 «а»)', () => {
  it('lets a call through to the cap exactly, and refuses the one a micro-dollar past it', async () => {
    expect(await spend.reserve(MONTH, CAP - 8_000, mine, at)).toBe('reserved')
    expect(await spend.reserve(MONTH, 8_001, mine, at)).toBe('cap')
    expect(await spend.reserve(MONTH, 8_000, mine, at)).toBe('reserved')
    expect(await spend.month(MONTH)).toEqual({ spentMicroUsd: CAP, calls: 2, noticed: 100 })
  })

  it('refuses a first call of the month whose worst is past the cap, and keeps the month to tell', async () => {
    expect(await spend.reserve(MONTH, CAP + 1, mine, at)).toBe('cap')
    expect(await spend.month(MONTH)).toEqual({ spentMicroUsd: 0, calls: 0, noticed: 100 })
  })

  it('counts each month apart: a new month starts from nothing', async () => {
    expect(await spend.reserve(MONTH, CAP, mine, at)).toBe('reserved')
    expect(await spend.reserve('2026-11-01', CAP, mine, at)).toBe('reserved')
  })

  it('holds the cap when calls reserve at once: never past it, whatever their order', async () => {
    const calls = await Promise.all(
      Array.from({ length: 12 }, () => spend.reserve(MONTH, CAP / 10, mine, at)),
    )
    expect(calls.filter((call) => call === 'reserved')).toHaveLength(10)
    expect((await spend.month(MONTH))?.spentMicroUsd).toBe(CAP)
  })
})

describe('a call settled', () => {
  it('puts what it cost in place of its worst', async () => {
    await spend.reserve(MONTH, 8_200, mine, at)
    await spend.settle(MONTH, 8_200, 2_180, mine, at)
    expect(await spend.month(MONTH)).toEqual({ spentMicroUsd: 2_180, calls: 1, noticed: 0 })
  })

  it('counts a call whose answer was not taken at what it cost too', async () => {
    await spend.reserve(MONTH, 8_200, mine, at)
    await spend.settle(MONTH, 8_200, 8_200, mine, at)
    expect((await spend.month(MONTH))?.spentMicroUsd).toBe(8_200)
  })

  it('keeps the worst of a call never settled: a process lost mid-call is counted at its most', async () => {
    await spend.reserve(MONTH, 8_200, mine, at)
    expect((await spend.month(MONTH))?.spentMicroUsd).toBe(8_200)
  })
})

describe('the owner’s notices (В-2 «а»)', () => {
  it('tells half the cap at half exactly, not a micro-dollar before, and once a month', async () => {
    await spend.reserve(MONTH, CAP / 2, mine, at)
    await spend.settle(MONTH, CAP / 2, CAP / 2 - 1, mine, at)
    expect(await told()).toEqual([])
    await spend.reserve(MONTH, 1, mine, at)
    await spend.settle(MONTH, 1, 1, mine, at)
    await spend.reserve(MONTH, 1, mine, at)
    await spend.settle(MONTH, 1, 1, mine, at)
    expect(await told()).toEqual([
      { kind: 'model_spend', month: MONTH, step: 50, spentMicroUsd: CAP / 2, capMicroUsd: CAP },
    ])
  })

  it('tells nine tenths, then the stop, each once', async () => {
    await spend.reserve(MONTH, (CAP / 10) * 9, mine, at)
    await spend.settle(MONTH, (CAP / 10) * 9, (CAP / 10) * 9, mine, at)
    expect(await spend.reserve(MONTH, CAP, mine, at)).toBe('cap')
    expect(await spend.reserve(MONTH, CAP, mine, at)).toBe('cap')
    expect((await told()).map((n) => n.kind === 'model_spend' && n.step)).toEqual([90, 100])
  })

  it('queues nothing where nobody is there to tell', async () => {
    await silent.reserve(MONTH, CAP, mine, at)
    await silent.settle(MONTH, CAP, CAP, mine, at)
    expect(await silent.reserve(MONTH, 1, mine, at)).toBe('cap')
    expect(await told()).toEqual([])
    expect((await silent.month(MONTH))?.noticed).toBe(100)
  })
})

describe('a person’s share (MOL-367, owner’s В-1…В-3 «а»)', () => {
  const SHARE = 2_000_000
  const share = async (actorId: string) =>
    onlyRow(
      await db
        .select({
          month: actors.modelMonth,
          spent: actors.modelSpentMicroUsd,
          told: actors.modelShareTold,
          updatedAt: actors.updatedAt,
        })
        .from(actors)
        .where(eq(actors.id, actorId)),
    )
  const callOf = async (): Promise<ModelCall> => ({
    actorId: await insertActor(db),
    capMicroUsd: CAP,
    shareMicroUsd: SHARE,
  })

  it('lets a call through to the share exactly, and refuses the one a micro-dollar past it — the month untouched', async () => {
    const boris = await callOf()
    expect(await spend.reserve(MONTH, SHARE - 8_000, boris, at)).toBe('reserved')
    expect(await spend.reserve(MONTH, 8_001, boris, at)).toBe('share')
    expect(await spend.month(MONTH)).toEqual({
      spentMicroUsd: SHARE - 8_000,
      calls: 1,
      noticed: 0,
    })
    expect(await spend.reserve(MONTH, 8_000, boris, at)).toBe('reserved')
    expect(await share(boris.actorId)).toMatchObject({ month: MONTH, spent: SHARE })
  })

  it('holds one person’s share apart from another’s', async () => {
    const boris = await callOf()
    const anna = await callOf()
    expect(await spend.reserve(MONTH, SHARE, boris, at)).toBe('reserved')
    expect(await spend.reserve(MONTH, 1, boris, at)).toBe('share')
    expect(await spend.reserve(MONTH, SHARE, anna, at)).toBe('reserved')
  })

  it('gives the share back where the cap refuses the call, and tells only the stop', async () => {
    const boris = await callOf()
    expect(await spend.reserve(MONTH, 1_000, boris, at)).toBe('reserved')
    expect(await spend.reserve(MONTH, 8_000, { ...boris, capMicroUsd: 8_999 }, at)).toBe('cap')
    expect(await share(boris.actorId)).toMatchObject({ month: MONTH, spent: 1_000, told: null })
    expect((await told()).map((n) => n.kind)).toEqual(['model_spend'])
  })

  it('starts a new month at nought, and a call of the old month settled after it moves nothing', async () => {
    const boris = await callOf()
    expect(await spend.reserve(MONTH, SHARE, boris, at)).toBe('reserved')
    expect(await spend.reserve('2026-11-01', SHARE, boris, at)).toBe('reserved')
    await spend.settle(MONTH, SHARE, 2_180, boris, at)
    expect(await share(boris.actorId)).toMatchObject({ month: '2026-11-01', spent: SHARE })
  })

  it('puts what a call cost in place of its worst in the share, and keeps the worst of one never settled', async () => {
    const boris = await callOf()
    await spend.reserve(MONTH, 8_200, boris, at)
    expect((await share(boris.actorId))?.spent).toBe(8_200)
    await spend.settle(MONTH, 8_200, 2_180, boris, at)
    expect((await share(boris.actorId))?.spent).toBe(2_180)
  })

  it('holds the share when one person’s calls reserve at once: never past it', async () => {
    const boris = await callOf()
    const calls = await Promise.all(
      Array.from({ length: 12 }, () => spend.reserve(MONTH, SHARE / 10, boris, at)),
    )
    expect(calls.filter((call) => call === 'reserved')).toHaveLength(10)
    expect((await share(boris.actorId))?.spent).toBe(SHARE)
    expect((await spend.month(MONTH))?.spentMicroUsd).toBe(SHARE)
  })

  it('tells the owner once a person a month, naming nobody', async () => {
    const boris = await callOf()
    const anna = await callOf()
    await spend.reserve(MONTH, SHARE, boris, at)
    expect(await spend.reserve(MONTH, 1, boris, at)).toBe('share')
    expect(await spend.reserve(MONTH, 1, boris, at)).toBe('share')
    expect(await spend.reserve(MONTH, SHARE + 1, anna, at)).toBe('share')
    expect(await spend.reserve('2026-11-01', SHARE + 1, boris, at)).toBe('share')
    expect(await told()).toEqual([
      { kind: 'model_share', month: MONTH, shareMicroUsd: SHARE },
      { kind: 'model_share', month: MONTH, shareMicroUsd: SHARE },
      { kind: 'model_share', month: '2026-11-01', shareMicroUsd: SHARE },
    ])
    expect(await silent.reserve(MONTH, SHARE + 1, await callOf(), at)).toBe('share')
    expect(await told()).toHaveLength(3)
  })

  it('is no change of the person’s row: `updated_at` stays', async () => {
    const boris = await callOf()
    const before = (await share(boris.actorId))?.updatedAt
    await spend.reserve(MONTH, SHARE, boris, at)
    await spend.settle(MONTH, SHARE, 2_180, boris, at)
    await spend.reserve(MONTH, SHARE, boris, at)
    expect(await share(boris.actorId)).toMatchObject({
      spent: 2_180,
      told: MONTH,
      updatedAt: before,
    })
  })

  it('refuses the call of a person erased while their receipt was read', async () => {
    const gone = { ...(await callOf()), actorId: '00000000-0000-4000-8000-000000000367' }
    expect(await spend.reserve(MONTH, 1, gone, at)).toBe('share')
    expect(await spend.month(MONTH)).toBeNull()
  })
})
