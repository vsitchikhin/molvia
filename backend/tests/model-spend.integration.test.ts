import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { ownerNoticeSchema } from '@molvia/model'
import { createModelSpendRepository } from '@/db/model-spend-repository'
import { ownerNotices } from '@/db/schema'
import { connectDrizzle } from './db'
import { clearAll } from './fixtures'

// What reading receipts by a model costs, by month (MOL-272): the cap held in one statement a call,
// the worst reserved before a call and settled at its own after, the owner told once a step a month.

const { db, close } = connectDrizzle()
const spend = createModelSpendRepository(db, true)
const silent = createModelSpendRepository(db, false)
const MONTH = '2026-10-01'
const CAP = 200_000_000
const at = new Date('2026-10-20T12:00:00Z')

beforeEach(async () => {
  await clearAll(db)
})
afterAll(async () => {
  await clearAll(db)
  await close()
})

const told = async () =>
  (await db.select({ payload: ownerNotices.payload }).from(ownerNotices)).map((row) =>
    ownerNoticeSchema.parse(row.payload),
  )

describe('the cap (Т-4, В-2 «а»)', () => {
  it('lets a call through to the cap exactly, and refuses the one a micro-dollar past it', async () => {
    expect(await spend.reserve(MONTH, CAP - 8_000, CAP, at)).toBe(true)
    expect(await spend.reserve(MONTH, 8_001, CAP, at)).toBe(false)
    expect(await spend.reserve(MONTH, 8_000, CAP, at)).toBe(true)
    expect(await spend.month(MONTH)).toEqual({ spentMicroUsd: CAP, calls: 2, noticed: 100 })
  })

  it('refuses a first call of the month whose worst is past the cap, and keeps the month to tell', async () => {
    expect(await spend.reserve(MONTH, CAP + 1, CAP, at)).toBe(false)
    expect(await spend.month(MONTH)).toEqual({ spentMicroUsd: 0, calls: 0, noticed: 100 })
  })

  it('counts each month apart: a new month starts from nothing', async () => {
    expect(await spend.reserve(MONTH, CAP, CAP, at)).toBe(true)
    expect(await spend.reserve('2026-11-01', CAP, CAP, at)).toBe(true)
  })

  it('holds the cap when calls reserve at once: never past it, whatever their order', async () => {
    const calls = await Promise.all(
      Array.from({ length: 12 }, () => spend.reserve(MONTH, CAP / 10, CAP, at)),
    )
    expect(calls.filter(Boolean)).toHaveLength(10)
    expect((await spend.month(MONTH))?.spentMicroUsd).toBe(CAP)
  })
})

describe('a call settled', () => {
  it('puts what it cost in place of its worst', async () => {
    await spend.reserve(MONTH, 8_200, CAP, at)
    await spend.settle(MONTH, 8_200, 2_180, CAP, at)
    expect(await spend.month(MONTH)).toEqual({ spentMicroUsd: 2_180, calls: 1, noticed: 0 })
  })

  it('counts a call whose answer was not taken at what it cost too', async () => {
    await spend.reserve(MONTH, 8_200, CAP, at)
    await spend.settle(MONTH, 8_200, 8_200, CAP, at)
    expect((await spend.month(MONTH))?.spentMicroUsd).toBe(8_200)
  })

  it('keeps the worst of a call never settled: a process lost mid-call is counted at its most', async () => {
    await spend.reserve(MONTH, 8_200, CAP, at)
    expect((await spend.month(MONTH))?.spentMicroUsd).toBe(8_200)
  })
})

describe('the owner’s notices (В-2 «а»)', () => {
  it('tells half the cap at half exactly, not a micro-dollar before, and once a month', async () => {
    await spend.reserve(MONTH, CAP / 2, CAP, at)
    await spend.settle(MONTH, CAP / 2, CAP / 2 - 1, CAP, at)
    expect(await told()).toEqual([])
    await spend.reserve(MONTH, 1, CAP, at)
    await spend.settle(MONTH, 1, 1, CAP, at)
    await spend.reserve(MONTH, 1, CAP, at)
    await spend.settle(MONTH, 1, 1, CAP, at)
    expect(await told()).toEqual([
      { kind: 'model_spend', month: MONTH, step: 50, spentMicroUsd: CAP / 2, capMicroUsd: CAP },
    ])
  })

  it('tells nine tenths, then the stop, each once', async () => {
    await spend.reserve(MONTH, (CAP / 10) * 9, CAP, at)
    await spend.settle(MONTH, (CAP / 10) * 9, (CAP / 10) * 9, CAP, at)
    expect(await spend.reserve(MONTH, CAP, CAP, at)).toBe(false)
    expect(await spend.reserve(MONTH, CAP, CAP, at)).toBe(false)
    expect((await told()).map((n) => n.kind === 'model_spend' && n.step)).toEqual([90, 100])
  })

  it('queues nothing where nobody is there to tell', async () => {
    await silent.reserve(MONTH, CAP, CAP, at)
    await silent.settle(MONTH, CAP, CAP, CAP, at)
    expect(await silent.reserve(MONTH, 1, CAP, at)).toBe(false)
    expect(await told()).toEqual([])
    expect((await silent.month(MONTH))?.noticed).toBe(100)
  })
})
