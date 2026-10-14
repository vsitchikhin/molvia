import { describe, expect, it } from 'vitest'
import { rawBounds } from './check-clock-bounds.mjs'

const lines = (source: string): number[] =>
  rawBounds('a.test.ts', source).map((found) => Number(found.split(':')[0]))

describe('rawBounds', () => {
  it('finds an upper bound on a subtraction of two readings of the clock, written any way', () => {
    expect(
      lines(`
        const started = performance.now()
        expect(performance.now() - started).toBeLessThan(200)
        expect(Date.now() - Date.now()).toBeLessThanOrEqual(5)
        const took = performance.now() - started
        expect(took).toBeLessThan(5)
        expect(took < 5).toBe(true)
        let again = 0
        again = Date.now()
        expect(Date.now() - again).toBeLessThan(5)
      `),
    ).toEqual([3, 4, 6, 7, 10])
  })

  it('follows a duration through a helper of the file, a mention of it and an object it is put in', () => {
    // picture's `timed`, bot/assemble's `lagBetween` (review of MOL-243, Р10-А1)
    expect(
      lines(`
        const timed = () => {
          const started = performance.now()
          work()
          return performance.now() - started
        }
        expect(Math.min(...Array.from({ length: 5 }, timed))).toBeLessThan(15)
        async function lagBetween() {
          const reached = {}
          const begun = Date.now()
          reached.a = Date.now() - begun
          return reached.b - reached.a
        }
        const lag = await lagBetween()
        expect(lag).toBeLessThan(150)
      `),
    ).toEqual([7, 15])
  })

  it('leaves alone what is no upper bound on a duration', () => {
    expect(
      lines(`
        const started = performance.now()
        expectWithin(performance.now() - started, 200)
        // a lower bound
        expect(performance.now() - started).toBeGreaterThanOrEqual(180)
        expect(performance.now() - started).not.toBeLessThan(180)
        // the age of a stamp: one side is a row's moment, not the clock
        expect(Date.now() - row.createdAt.getTime()).toBeLessThan(60_000)
        expect(Date.now() - latestVisitAt).toBeLessThan(60_000)
        // a fake clock's equality
        expect(Date.now() - started).toBe(217_000)
        // a helper that returns no duration
        const count = () => items.length - 1
        expect(count()).toBeLessThan(3)
      `),
    ).toEqual([])
  })
})
