import { describe, expect, it } from 'vitest'
import { rawBounds } from './check-clock-bounds.mjs'

const START = `const started = performance.now()\nwork()\n`

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

  // adversarial round 1 of MOL-266, А4: each a bound vitest or chai takes, each passed by the first parse
  it.each([
    ['expect.soft', `${START}expect.soft(performance.now() - started).toBeLessThan(200)`],
    ['the bound on the left', `${START}expect(200).toBeGreaterThan(performance.now() - started)`],
    ['not.toBeGreaterThan', `${START}expect(performance.now() - started).not.toBeGreaterThan(200)`],
    ['chai lessThan', `${START}expect(performance.now() - started).lessThan(200)`],
    ['chai below', `${START}expect(performance.now() - started).to.be.below(200)`],
    ['assert(d < n)', `${START}assert(performance.now() - started < 200)`],
    ['assert.isBelow', `${START}assert.isBelow(performance.now() - started, 200)`],
    ['expect(n > d)', `${START}expect(200 > performance.now() - started).toBe(true)`],
    ['toSatisfy', `${START}expect(performance.now() - started).toSatisfy((ms) => ms < 200)`],
    [
      'globalThis.performance',
      `const started = globalThis.performance.now()\nexpect(globalThis.performance.now() - started).toBeLessThan(200)`,
    ],
    [
      'new Date().getTime()',
      `const started = new Date().getTime()\nexpect(new Date().getTime() - started).toBeLessThan(200)`,
    ],
    [
      'Number(hrtime)',
      `const started = Number(process.hrtime.bigint())\nexpect(Number(process.hrtime.bigint()) - started).toBeLessThan(200_000_000)`,
    ],
    [
      'a reading kept on an object',
      `const state = { started: 0 }\nstate.started = performance.now()\nexpect(performance.now() - state.started).toBeLessThan(200)`,
    ],
    [
      'a duration destructured from a helper',
      `const measure = () => { const s = performance.now(); work(); return { elapsed: performance.now() - s } }\nconst { elapsed } = measure()\nexpect(elapsed).toBeLessThan(200)`,
    ],
    [
      'a helper that subtracts its parameter from the clock',
      `const since = (from: number) => performance.now() - from\n${START}expect(since(started)).toBeLessThan(200)`,
    ],
    [
      'a helper that bounds its parameter',
      `const within = (ms: number) => { expect(ms).toBeLessThan(200) }\n${START}within(performance.now() - started)`,
    ],
    [
      'a method of an object',
      `const clock = { took(s: number) { return performance.now() - s } }\n${START}expect(clock.took(started)).toBeLessThan(200)`,
    ],
  ])('finds the bound written as %s', (_, source) => {
    expect(rawBounds('a.test.ts', source)).toHaveLength(1)
  })

  it('reads a name in its own scope: the age of a stamp under a name another test gave a reading', () => {
    // adversarial round 1 of MOL-266, А5
    expect(
      lines(`
        it('a', () => {
          const started = performance.now()
          expect(performance.now() - started).toBeLessThan(200)
        })
        it('b', async () => {
          const started = (await row()).createdAt.getTime()
          expect(Date.now() - started).toBeLessThan(60_000)
        })
      `),
    ).toEqual([4])
  })

  it('leaves alone a helper that subtracts a stamp, and a helper bounding what is no duration', () => {
    expect(
      lines(`
        const since = (from: number) => Date.now() - from
        expect(since(row.createdAt.getTime())).toBeLessThan(60_000)
        const within = (n: number) => { expect(n).toBeLessThan(3) }
        within(items.length)
        // a lower bound, however written
        const started = performance.now()
        expect(180).toBeLessThan(performance.now() - started)
        expect(performance.now() - started).not.toBeLessThan(180)
        expect(performance.now() - started > 180).toBe(true)
      `),
    ).toEqual([])
  })

  // review round 2 of MOL-266: №9 and adversarial Б1 — each a bound the parse of round 1 let through
  it.each([
    [
      'a deadline',
      `const deadline = Date.now() + 100\nwork()\nexpect(Date.now()).toBeLessThan(deadline)`,
    ],
    [
      'a reading against a reading plus a number',
      `const t0 = Date.now()\nwork()\nexpect(Date.now()).toBeLessThanOrEqual(t0 + 100)`,
    ],
    [
      'a now() of the file',
      `const now = () => performance.now()\nconst started = now()\nexpect(now() - started).toBeLessThan(200)`,
    ],
    [
      'now taken apart from performance',
      `const { now } = performance\nconst started = now()\nexpect(now() - started).toBeLessThan(200)`,
    ],
    [
      'a helper that rounds',
      `const since = (from: number) => Math.round(performance.now() - from)\n${START}expect(since(started)).toBeLessThan(200)`,
    ],
    [
      'a helper in seconds',
      `const since = (from: number) => (performance.now() - from) / 1000\n${START}expect(since(started)).toBeLessThan(0.2)`,
    ],
    [
      'durations summed by +=',
      `let total = 0\nfor (const x of xs) { const s = performance.now(); work(x); total += performance.now() - s }\nexpect(total).toBeLessThan(200)`,
    ],
    [
      'durations pushed',
      `const took: number[] = []\nfor (const x of xs) { const s = performance.now(); work(x); took.push(performance.now() - s) }\nexpect(Math.max(...took)).toBeLessThan(200)`,
    ],
    [
      'readings pushed',
      `const calls: number[] = []\nconst back = Date.now()\nwork(() => calls.push(Date.now()))\nexpect((calls.at(-1) ?? Infinity) - back).toBeLessThan(200)`,
    ],
    [
      'readings by index',
      `const marks = [performance.now()]\nwork()\nmarks.push(performance.now())\nexpect(marks[1] - marks[0]).toBeLessThan(200)`,
    ],
    [
      'readings in the answer of a helper',
      `function asking() { const calls: number[] = []; work(() => calls.push(Date.now())); return { calls } }\nconst { calls } = asking()\nconst back = Date.now()\nexpect((calls.at(-1) ?? Infinity) - back).toBeLessThan(200)`,
    ],
    [
      'a class of the file',
      `class Stopwatch { start = performance.now(); elapsed() { return performance.now() - this.start } }\nconst watch = new Stopwatch()\nexpect(watch.elapsed()).toBeLessThan(200)`,
    ],
    [
      'a shorthand field',
      `const t0 = performance.now()\nconst mark = { t0 }\nexpect(performance.now() - mark.t0).toBeLessThan(200)`,
    ],
    ['if … throw', `${START}if (performance.now() - started > 200) throw new Error('too slow')`],
    ['if … expect.fail', `${START}if (performance.now() - started > 200) expect.fail('too slow')`],
    [
      'toSatisfy with a block',
      `${START}expect(performance.now() - started).toSatisfy((ms: number) => { return ms < 200 })`,
    ],
    [
      'toSatisfy with a named check',
      `${START}const fast = (ms: number) => ms < 200\nexpect(performance.now() - started).toSatisfy(fast)`,
    ],
    [
      'assert.strictEqual of a comparison',
      `${START}assert.strictEqual(performance.now() - started < 200, true)`,
    ],
    ['toBeCloseTo', `${START}expect(performance.now() - started).toBeCloseTo(0, -3)`],
    [
      'hrtime(t0)',
      `const t0 = process.hrtime()\nconst [s, ns] = process.hrtime(t0)\nexpect(s * 1000 + ns / 1e6).toBeLessThan(200)`,
    ],
    [
      'performance.measure',
      `performance.mark('a')\nconst { duration } = performance.measure('work', 'a')\nexpect(duration).toBeLessThan(200)`,
    ],
    [
      'a Date kept whole',
      `const started = new Date()\nexpect(new Date().getTime() - started.getTime()).toBeLessThan(200)`,
    ],
    [
      'seconds of the clock',
      `const started = Math.floor(Date.now() / 1000)\nexpect(Math.floor(Date.now() / 1000) - started).toBeLessThan(2)`,
    ],
    [
      'a clock fake timers leave real',
      `vi.useFakeTimers({ toFake: ['Date'] })\n${START}expect(performance.now() - started).toBeLessThan(200)`,
    ],
  ])('finds the bound written as %s', (_, source) => {
    expect(rawBounds('a.test.ts', source)).toHaveLength(1)
  })

  it('leaves alone a bound on fake time — no runner moves it (adversarial Б2)', () => {
    // bot/src/assemble.test.ts › «Telegram лежал полчаса…»: readings in a helper's answer, under fake timers
    const helper = `function asking() { const calls: number[] = []; work(() => calls.push(Date.now())); return { calls } }\n`
    const bound = `const { calls } = asking()\nconst back = Date.now()\nawait vi.advanceTimersByTimeAsync(30_000)\nexpect((calls.at(-1) ?? Infinity) - back).toBeLessThan(30_000)`
    expect(lines(`${helper}it('x', async () => {\nvi.useFakeTimers()\n${bound}\n})`)).toEqual([])
    expect(
      lines(
        `${helper}beforeEach(() => {\nvi.useFakeTimers()\n})\nit('x', async () => {\n${bound}\n})`,
      ),
    ).toEqual([])
    expect(
      lines(`${helper}it('x', async () => {\nvi.useFakeTimers({ toFake: ['Date'] })\n${bound}\n})`),
    ).toEqual([])
    // the control: the same bound on the real clock is refused
    expect(lines(`${helper}it('x', async () => {\n${bound}\n})`)).toEqual([6])
  })

  it('leaves alone what bounds a stamp or a duration from below, however written', () => {
    expect(
      lines(`
        const row = await get()
        expect(Date.now()).toBeGreaterThan(row.at)
        const expires = new Date(row.expiresAt)
        expect(expires.getTime() - Date.now()).toBeLessThan(DAY)
        const s = performance.now()
        if (performance.now() - s < 5) throw new Error('too fast')
        expect(performance.now() - s).not.toBeCloseTo(0, -3)
      `),
    ).toEqual([])
  })
})
