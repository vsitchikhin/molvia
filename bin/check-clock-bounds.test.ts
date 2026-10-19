import { describe, expect, it } from 'vitest'
import { rawBounds, unsureDirectories, vitestFlagsUnsure } from './check-clock-bounds.mjs'

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

  // review round 3 of MOL-266: adversarial В1 — the listed forms the other way round, the clock under another name
  it.each([
    [
      'a comparison asserted false',
      `${START}expect(performance.now() - started > 200).toBe(false)`,
    ],
    ['… toBeFalsy()', `${START}expect(performance.now() - started >= 200).toBeFalsy()`],
    ['… not.toBe(true)', `${START}expect(performance.now() - started > 200).not.toBe(true)`],
    ['assert.isFalse', `${START}assert.isFalse(performance.now() - started > 200)`],
    ['assert.notOk', `${START}assert.notOk(performance.now() - started > 200)`],
    ['assert(!(…))', `${START}assert(!(performance.now() - started > 200))`],
    [
      'a range with &&',
      `${START}const took = performance.now() - started\nexpect(took >= 0 && took < 200).toBe(true)`,
    ],
    [
      'toSatisfy with a range',
      `${START}expect(performance.now() - started).toSatisfy((ms: number) => ms >= 0 && ms < 200)`,
    ],
    [
      'toSatisfy with !(…)',
      `${START}expect(performance.now() - started).toSatisfy((ms: number) => !(ms > 200))`,
    ],
    [
      'if (!(d < n)) throw',
      `${START}if (!(performance.now() - started < 200)) throw new Error('slow')`,
    ],
    ['the budget left', `${START}expect(200 - (performance.now() - started)).toBeGreaterThan(0)`],
    [
      'the budget, -=',
      `${START}let left = 200\nleft -= performance.now() - started\nexpect(left).toBeGreaterThan(0)`,
    ],
    [
      'what is left of a deadline',
      `const deadline = Date.now() + 200\nwork()\nexpect(deadline - Date.now()).toBeGreaterThan(0)`,
    ],
    [
      'the clock past a deadline',
      `const deadline = Date.now() + 200\nwork()\nexpect(Date.now() - deadline).toBeLessThan(0)`,
    ],
    [
      'a getter of a class of the file',
      `class Stopwatch { private start = performance.now(); get ms() { return performance.now() - this.start } }\nconst watch = new Stopwatch()\nexpect(watch.ms).toBeLessThan(200)`,
    ],
    [
      'now bound to performance',
      `const now = performance.now.bind(performance)\nconst t0 = now()\nexpect(now() - t0).toBeLessThan(200)`,
    ],
    [
      'now taken apart from Date',
      `const { now } = Date\nconst t0 = now()\nexpect(now() - t0).toBeLessThan(200)`,
    ],
    [
      'performance of node:perf_hooks under another name',
      `import { performance as perf } from 'node:perf_hooks'\nconst t0 = perf.now()\nexpect(perf.now() - t0).toBeLessThan(200)`,
    ],
    [
      'hrtime of node:process',
      `import { hrtime } from 'node:process'\nconst t0 = hrtime.bigint()\nexpect(hrtime.bigint() - t0).toBeLessThan(200_000_000n)`,
    ],
  ])('finds the bound written as %s', (_, source) => {
    expect(rawBounds('a.test.ts', source)).toHaveLength(1)
  })

  it('leaves alone a lower bound between two readings (adversarial В4)', () => {
    expect(
      lines(`
        const t0 = Date.now()
        work()
        const t1 = Date.now()
        expect(t1).toBeGreaterThanOrEqual(t0)
        expect(t0).toBeLessThanOrEqual(t1)
        expect(t1 > t0).toBe(true)
        expect(t1 - t0).toBeGreaterThanOrEqual(0)
      `),
    ).toEqual([])
  })

  // adversarial В2 and review №13: what fakes a clock is read where the bound stands, in the order vitest runs it
  const BOUND = `const t0 = performance.now()\nawait wait(300)\nexpect(performance.now() - t0).toBeLessThan(1_000)`
  it.each([
    [
      'useRealTimers() before it',
      `it('x', async () => {\nvi.useFakeTimers()\nvi.useRealTimers()\n${BOUND}\n})`,
    ],
    [
      'the test turning real time back after the file’s beforeEach',
      `beforeEach(() => {\nvi.useFakeTimers()\n})\nit('x', async () => {\nvi.useRealTimers()\n${BOUND}\n})`,
    ],
    ['useFakeTimers() after it', `it('x', async () => {\n${BOUND}\nvi.useFakeTimers()\n})`],
    [
      'toNotFake: performance',
      `it('x', async () => {\nvi.useFakeTimers({ toNotFake: ['performance'] })\n${BOUND}\n})`,
    ],
    [
      'shouldAdvanceTime',
      `it('x', async () => {\nvi.useFakeTimers({ shouldAdvanceTime: true })\n${BOUND}\n})`,
    ],
    [
      'options the parse cannot read',
      `it('x', async () => {\nvi.useFakeTimers(OPTIONS)\n${BOUND}\n})`,
    ],
    [
      'a clock taken under another name before the fake',
      `const { now } = performance\nit('x', async () => {\nvi.useFakeTimers()\nconst t0 = now()\nawait wait(300)\nexpect(now() - t0).toBeLessThan(1_000)\n})`,
    ],
  ])('finds a bound on real time beside fake timers — %s', (_, source) => {
    expect(rawBounds('a.test.ts', source)).toHaveLength(1)
  })

  // adversarial В3: and a bound on fake time is let go however the file says it fakes
  const FAKE = `const back = Date.now()\nawait vi.advanceTimersByTimeAsync(20_000)\nexpect(Date.now() - back).toBeLessThan(30_000)`
  it.each([
    [
      'a file that mentions process and performance elsewhere',
      `const CI = process.env.CI // performance left real\nit('x', async () => {\nvi.useFakeTimers({ toFake: ['Date'] })\n${FAKE}\n})`,
    ],
    [
      'a hook with an expression body',
      `beforeEach(() => vi.useFakeTimers())\nit('x', async () => {\n${FAKE}\n})`,
    ],
    [
      'a helper of the file',
      `function fakeClock(): void {\nvi.useFakeTimers()\n}\nit('x', async () => {\nfakeClock()\n${FAKE}\n})`,
    ],
    [
      'an outer suite’s beforeAll',
      `describe('a', () => {\nbeforeAll(() => {\nvi.useFakeTimers()\n})\ndescribe('b', () => {\nit('x', async () => {\n${FAKE}\n})\n})\n})`,
    ],
    [
      'vi.setSystemTime alone, which fakes Date',
      `it('x', async () => {\nvi.setSystemTime(0)\n${FAKE}\n})`,
    ],
  ])('leaves alone a bound on fake time — %s', (_, source) => {
    expect(rawBounds('a.test.ts', source)).toEqual([])
  })

  // review round 4 of MOL-266: №15 and adversarial Г1–Г3 — what may let the fake go between is read as letting it
  // go: in doubt a clock is real, and a bound refused here is still lawful through expectWithin
  const REAL = `const t0 = performance.now()\nawait wait(300)\nexpect(performance.now() - t0).toBeLessThan(1_000)`
  it.each([
    [
      'useRealTimers() at the file’s end',
      `vi.useFakeTimers()\nit('x', async () => {\n${REAL}\n})\nvi.useRealTimers()`,
    ],
    [
      'a sibling suite collected after it',
      `describe('a', () => {\nvi.useFakeTimers()\nit('x', async () => {\n${REAL}\n})\n})\ndescribe('b', () => {\nvi.useRealTimers()\n})`,
    ],
    [
      'afterEach letting go of beforeAll',
      `beforeAll(() => {\nvi.useFakeTimers()\n})\nafterEach(() => {\nvi.useRealTimers()\n})\nit('first', () => {})\nit('x', async () => {\n${REAL}\n})`,
    ],
    [
      'an earlier test letting go',
      `beforeAll(() => {\nvi.useFakeTimers()\n})\nit('first', () => {\nvi.useRealTimers()\n})\nit('x', async () => {\n${REAL}\n})`,
    ],
    [
      'an earlier suite’s afterAll letting go',
      `beforeAll(() => {\nvi.useFakeTimers()\n})\ndescribe('a', () => {\nafterAll(() => {\nvi.useRealTimers()\n})\nit('first', () => {})\n})\ndescribe('b', () => {\nit('x', async () => {\n${REAL}\n})\n})`,
    ],
    [
      'a beforeEach given by reference',
      `const realClock = (): void => {\nvi.useRealTimers()\n}\nbeforeAll(() => {\nvi.useFakeTimers()\n})\nbeforeEach(realClock)\nit('x', async () => {\n${REAL}\n})`,
    ],
    [
      'a helper an afterEach calls',
      `function realClock(): void {\nvi.useRealTimers()\n}\nbeforeAll(() => {\nvi.useFakeTimers()\n})\nafterEach(() => {\nrealClock()\n})\nit('x', async () => {\n${REAL}\n})`,
    ],
    [
      'useRealTimers() in a finally',
      `it('x', async () => {\nvi.useFakeTimers()\ntry {\nawait vi.advanceTimersByTimeAsync(10)\n} finally {\nvi.useRealTimers()\n}\n${REAL}\n})`,
    ],
    [
      'useRealTimers() in a branch',
      `it('x', async () => {\nvi.useFakeTimers()\nif (slow) vi.useRealTimers()\n${REAL}\n})`,
    ],
    [
      'a helper’s bound — its caller is not read',
      `beforeEach(() => {\nvi.useFakeTimers()\n})\nasync function bounded(): Promise<void> {\n${REAL}\n}\nit('x', async () => {\nvi.useRealTimers()\nawait bounded()\n})`,
    ],
    [
      'setTimerTickMode, which moves fake time with the real one',
      `it('x', async () => {\nvi.useFakeTimers()\nvi.setTimerTickMode('interval', 20)\n${REAL}\n})`,
    ],
    ['a spread of options', `it('x', async () => {\nvi.useFakeTimers({ ...OPTIONS })\n${REAL}\n})`],
    [
      'a name in toNotFake',
      `it('x', async () => {\nvi.useFakeTimers({ toNotFake: [REAL_CLOCK] })\n${REAL}\n})`,
    ],
    [
      'a quoted shouldAdvanceTime',
      `it('x', async () => {\nvi.useFakeTimers({ 'shouldAdvanceTime': true })\n${REAL}\n})`,
    ],
  ])('finds a bound on real time beside fake timers — %s', (_, source) => {
    expect(rawBounds('a.test.ts', source)).toHaveLength(1)
  })

  it.each([
    [
      'beforeEach fakes, afterEach lets go',
      `beforeEach(() => {\nvi.useFakeTimers()\n})\nafterEach(() => {\nvi.useRealTimers()\n})\nit('first', () => {})\nit('x', async () => {\n${FAKE}\n})`,
    ],
    [
      'the test fakes after the file’s afterEach let go — bot/src/assemble.test.ts',
      `afterEach(() => {\nvi.useRealTimers()\n})\nit('x', async () => {\nvi.useFakeTimers()\n${FAKE}\n})`,
    ],
    [
      'beforeAll with no other test or hook touching the timers',
      `beforeAll(() => {\nvi.useFakeTimers()\n})\nit('first', () => {})\nit('x', async () => {\n${FAKE}\n})`,
    ],
    [
      'a manual tick mode',
      `it('x', async () => {\nvi.useFakeTimers()\nvi.setTimerTickMode('manual')\n${FAKE}\n})`,
    ],
    [
      'a bound inside a callback the test runs',
      `it('x', async () => {\nvi.useFakeTimers()\nconst back = Date.now()\nawait vi.advanceTimersByTimeAsync(20_000)\nawait vi.waitFor(() => {\nexpect(Date.now() - back).toBeLessThan(30_000)\n})\n})`,
    ],
  ])('leaves alone a bound on fake time — %s', (_, source) => {
    expect(rawBounds('a.test.ts', source)).toEqual([])
  })

  // adversarial Г4: a rate falls as the duration grows, and Math.max keeps a budget a budget
  it.each([
    [
      'a rate bounded below',
      `${START}const ms = performance.now() - started\nexpect(1_000 / ms).toBeGreaterThan(5)`,
    ],
    [
      'items a second',
      `${START}const ms = performance.now() - started\nexpect(items / (ms / 1_000)).toBeGreaterThanOrEqual(1_000)`,
    ],
    [
      'what is left through Math.max',
      `const deadline = Date.now() + 200\nwork()\nexpect(Math.max(0, deadline - Date.now())).toBeGreaterThan(0)`,
    ],
  ])('finds the bound written as %s', (_, source) => {
    expect(rawBounds('a.test.ts', source)).toHaveLength(1)
  })

  // review round 5 of MOL-266: №17 and adversarial Д1–Д4 — what touches the timers outside the order read lets them go
  it.each([
    [
      'useFakeTimers() at the file’s end, run before the suites’ bodies',
      `describe('a', () => {\nvi.useRealTimers()\nit('x', async () => {\n${REAL}\n})\n})\nvi.useFakeTimers()`,
    ],
    [
      'a helper’s beforeEach registered after the suite’s own',
      `beforeEach(() => {\nvi.useFakeTimers()\n})\nfunction realEach(): void {\nbeforeEach(() => {\nvi.useRealTimers()\n})\n}\nrealEach()\nit('x', async () => {\n${REAL}\n})`,
    ],
    [
      'the test run again from where it ended',
      `beforeAll(() => {\nvi.useFakeTimers()\n})\nit.each([1, 2])('x %i', async () => {\n${REAL}\nvi.useRealTimers()\n})`,
    ],
    [
      'a let-go in ? :',
      `it('x', async () => {\nvi.useFakeTimers()\nREAL_TIME ? vi.useRealTimers() : vi.advanceTimersByTime(0)\n${REAL}\n})`,
    ],
    [
      'a let-go behind &&',
      `it('x', async () => {\nvi.useFakeTimers()\nREAL_TIME && vi.useRealTimers()\n${REAL}\n})`,
    ],
    [
      'a let-go in a callback of .then',
      `it('x', async () => {\nvi.useFakeTimers()\nawait Promise.resolve().then(() => vi.useRealTimers())\n${REAL}\n})`,
    ],
    [
      'a let-go handed to forEach',
      `it('x', async () => {\nvi.useFakeTimers()\n;[vi.useRealTimers].forEach((f) => f())\n${REAL}\n})`,
    ],
    [
      'a let-go in a function called where it stands',
      `beforeEach(() => {\nvi.useFakeTimers()\n})\nit('x', async () => {\nawait (async () => {\nvi.useRealTimers()\n})()\n${REAL}\n})`,
    ],
    [
      'the bound handed to a helper that lets go around it',
      `function withRealClock(fn: () => Promise<void>) {\nvi.useRealTimers()\ntry {\nreturn fn()\n} finally {\nvi.useFakeTimers()\n}\n}\nbeforeEach(() => {\nvi.useFakeTimers()\n})\nit('x', async () => {\nawait withRealClock(async () => {\n${REAL}\n})\n})`,
    ],
    [
      'the bound in onTestFinished, which runs after the test',
      `it('x', async () => {\nvi.useFakeTimers()\nonTestFinished(async () => {\n${REAL}\n})\nvi.useRealTimers()\n})`,
    ],
  ])('finds a bound on real time beside fake timers — %s', (_, source) => {
    expect(rawBounds('a.test.ts', source)).toHaveLength(1)
  })

  it.each([
    [
      'the test fakes itself and lets go in a finally after the bound',
      `it('x', async () => {\nvi.useFakeTimers()\ntry {\n${FAKE}\n} finally {\nvi.useRealTimers()\n}\n})`,
    ],
    [
      'it.each faking itself',
      `it.each([1, 2])('x %i', async () => {\nvi.useFakeTimers()\n${FAKE}\nvi.useRealTimers()\n})`,
    ],
    [
      'beforeEach given a helper that fakes',
      `function fakeClock(): void {\nvi.useFakeTimers()\n}\nbeforeEach(fakeClock)\nafterEach(() => {\nvi.useRealTimers()\n})\nit('x', async () => {\n${FAKE}\n})`,
    ],
  ])('leaves alone a bound on fake time — %s', (_, source) => {
    expect(rawBounds('a.test.ts', source)).toEqual([])
  })

  // review round 6 of MOL-266, adversarial Е1–Е6: a file that touches the timers in a way not read in order lets
  // no bound go as fake
  const AFTER_FIRST = `beforeAll(() => {\nvi.useFakeTimers()\n})`
  it.each([
    [
      'afterEach handed vi.useRealTimers itself',
      `${AFTER_FIRST}\nafterEach(vi.useRealTimers)\nit('first', () => {})\nit('x', async () => {\n${REAL}\n})`,
    ],
    [
      'onTestFinished handed it in the test before',
      `${AFTER_FIRST}\nit('first', () => {\nonTestFinished(vi.useRealTimers)\n})\nit('x', async () => {\n${REAL}\n})`,
    ],
    [
      'afterEach imported under another name',
      `import { afterEach as after } from 'vitest'\n${AFTER_FIRST}\nafter(() => {\nvi.useRealTimers()\n})\nit('first', () => {})\nit('x', async () => {\n${REAL}\n})`,
    ],
    [
      'the let-go kept under another name',
      `const realClock = vi.useRealTimers\nbeforeEach(() => {\nvi.useFakeTimers()\n})\nit('x', async () => {\nrealClock()\n${REAL}\n})`,
    ],
    [
      'the let-go taken apart under another name',
      `const { useRealTimers: realClock } = vi\nbeforeEach(() => {\nvi.useFakeTimers()\n})\nit('x', async () => {\nrealClock()\n${REAL}\n})`,
    ],
    [
      'the let-go by a string',
      `beforeEach(() => {\nvi.useFakeTimers()\n})\nit('x', async () => {\nvi['useRealTimers']()\n${REAL}\n})`,
    ],
    [
      'the let-go bound',
      `const realClock = vi.useRealTimers.bind(vi)\nbeforeEach(() => {\nvi.useFakeTimers()\n})\nit('x', async () => {\nrealClock()\n${REAL}\n})`,
    ],
    [
      'a method of an object',
      `const clock = { real() {\nvi.useRealTimers()\n} }\nbeforeEach(() => {\nvi.useFakeTimers()\n})\nit('x', async () => {\nclock.real()\n${REAL}\n})`,
    ],
    [
      'a static method of a class',
      `class Clock { static real(): void {\nvi.useRealTimers()\n} }\nbeforeEach(() => {\nvi.useFakeTimers()\n})\nit('x', async () => {\nClock.real()\n${REAL}\n})`,
    ],
    [
      'a fixture the test asks for',
      `const it = base.extend<{ real: undefined }>({ real: async ({}, use) => {\nvi.useRealTimers()\nawait use(undefined)\n} })\nbeforeEach(() => {\nvi.useFakeTimers()\n})\nit('x', async ({ real }) => {\n${REAL}\n})`,
    ],
    [
      'a callback kept for later, run after the let-go',
      `beforeEach(() => {\nvi.useFakeTimers()\n})\nit('x', async () => {\nlet t0 = 0\nconst done = ready.then(() => {\nexpect(performance.now() - t0).toBeLessThan(1_000)\n})\nvi.useRealTimers()\nt0 = performance.now()\nawait done\n})`,
    ],
  ])('finds a bound on real time beside fake timers — %s', (_, source) => {
    expect(rawBounds('a.test.ts', source)).toHaveLength(1)
  })

  it('lets no bound go as fake where a setup file of the run touches the timers (adversarial Е6)', () => {
    const source = `beforeEach(() => {\nvi.useFakeTimers()\n})\nit('x', async () => {\n${FAKE}\n})`
    expect(rawBounds('a.test.ts', source)).toEqual([])
    expect(rawBounds('a.test.ts', source, { setupTouchesTimers: true })).toHaveLength(1)
    const files: Record<string, string> = {
      'backend/tests/setup-worker.ts': "import { testDatabaseUrl } from './db'",
      'backend/tests/db.ts': "import * as schema from '@/db/schema'",
      'backend/src/db/schema.ts': "import { pgTable } from 'drizzle-orm/pg-core'",
      'bot/setup.ts': "import './clock-reset'",
      'bot/clock-reset.ts': 'afterEach(() => vi.useRealTimers())',
    }
    const read = (path: string): string | undefined => files[path]
    const config = (path: string, text: string) => ({ path, text })
    expect(
      unsureDirectories(
        [
          config('backend/vitest.integration.config.ts', "setupFiles: ['./tests/setup-worker.ts']"),
          config('frontend/vitest.config.ts', 'export default {}'),
        ],
        read,
      ),
    ).toEqual([])
    // round 7, Ж2: a setup file that only imports what touches the timers; one that cannot be read
    expect(
      unsureDirectories([config('bot/vitest.config.ts', "setupFiles: ['./setup.ts']")], read),
    ).toEqual(['bot'])
    expect(
      unsureDirectories([config('bot/vitest.config.ts', "setupFiles: './gone.ts'")], read),
    ).toEqual(['bot'])
    // round 7, Ж1 and review №19: fake timers or concurrency set by the config
    expect(
      unsureDirectories(
        [
          config('frontend/vitest.config.ts', "test: { fakeTimers: { toFake: ['Date'] } }"),
          config('packages/model/vitest.config.ts', 'test: { sequence: { concurrent: true } }'),
        ],
        read,
      ),
    ).toEqual(['frontend', 'packages/model'])
    // round 8, З3: a dynamic import, a workspace package and a subpath import are followed; what leads
    // nowhere is unsure
    const more: Record<string, string> = {
      ...files,
      'bot/dynamic.ts': "await import('./clock-reset')",
      'bot/package-setup.ts': "import '@molvia/model/testing/clock'",
      'bot/subpath-setup.ts': "import '#bot/reset'",
      'bot/package.json': JSON.stringify({
        name: '@molvia/bot',
        imports: { '#bot/*': './src/*.ts' },
      }),
      'bot/src/reset.ts': 'afterEach(() => vi.useRealTimers())',
      'packages/model/package.json': JSON.stringify({
        name: '@molvia/model',
        exports: { '.': './src/index.ts', './testing/clock': './tests/support/clock.ts' },
      }),
      'packages/model/tests/support/clock.ts': "import { expect } from 'vitest'",
      'bot/gone-package.ts': "import '@molvia/nowhere'",
    }
    const at = (setup: string) =>
      unsureDirectories(
        [config('bot/vitest.config.ts', `setupFiles: ['./${setup}']`)],
        (path) => more[path],
      )
    expect(at('dynamic.ts')).toEqual(['bot'])
    expect(at('package-setup.ts')).toEqual([])
    expect(at('subpath-setup.ts')).toEqual(['bot'])
    expect(at('gone-package.ts')).toEqual(['bot'])
    // round 8, З4: settings taken from a file of this repository, and concurrency by an expression
    expect(
      unsureDirectories(
        [
          config(
            'bot/vitest.config.ts',
            "import { shared } from './vitest.shared'\nexport default { test: { ...shared } }",
          ),
          config(
            'frontend/vitest.config.ts',
            'test: { sequence: { concurrent: !process.env.CI } }',
          ),
          config(
            'backend/vitest.config.ts',
            "test: { exclude: [...configDefaults.exclude, '**/*.attack.*'] }",
          ),
        ],
        read,
      ),
    ).toEqual(['bot', 'frontend'])
    // round 9, И3 and И6: concurrent quoted or short, a project's extends, settings read from a file
    expect(
      unsureDirectories(
        [
          config('bot/vitest.config.ts', "test: { sequence: { 'concurrent': true } }"),
          config(
            'frontend/vitest.config.ts',
            'const concurrent = true\ntest: { sequence: { concurrent } }',
          ),
          config(
            'vitest.config.ts',
            "projects: [{ extends: './bin/vitest.shared.ts', test: { name: 'bin' } }]",
          ),
          config(
            'deploy/watch/vitest.config.ts',
            "test: JSON.parse(readFileSync('./shared.json', 'utf8'))",
          ),
          config('packages/model/vitest.config.ts', 'test: { sequence: { concurrent: false } }'),
        ],
        read,
      ),
    ).toEqual(['bot', 'frontend', '.', 'deploy/watch'])
    // round 9, И4: an import by a template or a name, a glob
    const imports: Record<string, string> = {
      ...more,
      'bot/template.ts': 'await import(`./clock-reset`)',
      'bot/named.ts': "const where = './clock-reset'\nawait import(where)",
      'bot/glob.ts': "import.meta.glob('./clock-*.ts', { eager: true })",
    }
    const via = (setup: string) =>
      unsureDirectories(
        [config('bot/vitest.config.ts', `setupFiles: ['./${setup}']`)],
        (path) => imports[path],
      )
    for (const setup of ['template.ts', 'named.ts', 'glob.ts']) expect(via(setup)).toEqual(['bot'])
    // round 9, И5: a subpath key matched whole, not by its start
    const keyed: Record<string, string> = {
      'bot/package.json': JSON.stringify({
        name: '@molvia/bot',
        imports: { '#clock': './clock.ts', '#clock-reset': './clock-reset.ts' },
      }),
      'bot/clock.ts': 'export {}',
      'bot/clock-reset.ts': 'afterEach(() => vi.useRealTimers())',
      'bot/setup.ts': "import '#clock-reset'",
    }
    expect(
      unsureDirectories(
        [config('bot/vitest.config.ts', "setupFiles: ['./setup.ts']")],
        (path) => keyed[path],
      ),
    ).toEqual(['bot'])
    // round 10, №23, К3 and К4: a module loaded any way but a static import, in a setup file or a config
    const loaders: Record<string, string> = {
      ...more,
      'bot/actual.ts': "await vi.importActual('./clock-reset')",
      'bot/required.ts':
        "import { createRequire } from 'node:module'\ncreateRequire(import.meta.url)('./clock-reset')",
    }
    for (const setup of ['actual.ts', 'required.ts'])
      expect(
        unsureDirectories(
          [config('bot/vitest.config.ts', `setupFiles: ['./${setup}']`)],
          (path) => loaders[path],
        ),
      ).toEqual(['bot'])
    for (const text of [
      'const { shared } = await import(`./vitest.shared`)',
      'const shared = (await import(where)).default',
      "const shared = Object.values(import.meta.glob('./vitest.shared.ts', { eager: true }))",
    ])
      expect(unsureDirectories([config('bot/vitest.config.ts', text)], read)).toEqual(['bot'])
  })

  // review round 7 of MOL-266: №19 and adversarial Ж1, Ж3–Ж5 — the file is no longer read as sure
  it.each([
    [
      'vi.setConfig with fakeTimers',
      `vi.setConfig({ fakeTimers: { shouldAdvanceTime: true } })\nbeforeEach(() => {\nvi.useFakeTimers()\n})\nit('x', async () => {\n${REAL}\n})`,
    ],
    [
      'a let-go kept for a hook',
      `const cleanups: Array<() => void> = []\ncleanups.push(() => vi.useRealTimers())\n${AFTER_FIRST}\nafterEach(() => {\nfor (const cleanup of cleanups) cleanup()\n})\nit('first', () => {})\nit('x', async () => {\n${REAL}\n})`,
    ],
    [
      'the bound handed to an awaited call that only keeps it',
      `const handlers: Array<() => void> = []\nconst on = async (handler: () => void): Promise<void> => {\nhandlers.push(handler)\n}\nbeforeEach(() => {\nvi.useFakeTimers()\n})\nit('x', async () => {\nlet t0 = 0\nawait on(() => {\nexpect(performance.now() - t0).toBeLessThan(1_000)\n})\nvi.useRealTimers()\nt0 = performance.now()\nfor (const handler of handlers) handler()\n})`,
    ],
    [
      'it.beforeEach letting go after the file’s',
      `beforeEach(() => {\nvi.useFakeTimers()\n})\nit.beforeEach(() => {\nvi.useRealTimers()\n})\nit('x', async () => {\n${REAL}\n})`,
    ],
    [
      'concurrent tests side by side',
      `describe.concurrent('s', () => {\nit('a', async () => {\nawait tick()\nvi.useRealTimers()\n})\nit('b', async () => {\nvi.useFakeTimers()\n${FAKE}\n})\n})`,
    ],
  ])('finds a bound on real time beside fake timers — %s', (_, source) => {
    expect(rawBounds('a.test.ts', source)).toHaveLength(1)
  })

  // review round 8 of MOL-266: №20 and adversarial З1–З2
  it.each([
    [
      'concurrent in a suite’s options',
      `describe('s', { concurrent: true }, () => {\nit('a', async () => {\nawait tick()\nvi.useRealTimers()\n})\nit('b', async () => {\nvi.useFakeTimers()\n${FAKE}\n})\n})`,
    ],
    [
      'concurrent in a test’s options',
      `it('a', { concurrent: true }, async () => {\nawait tick()\nvi.useRealTimers()\n})\nit('b', { concurrent: true }, async () => {\nvi.useFakeTimers()\n${FAKE}\n})`,
    ],
    [
      'the bound in a then after what lets go',
      `async function realWork(): Promise<void> {\nvi.useRealTimers()\nawait wait(300)\n}\nbeforeEach(() => {\nvi.useFakeTimers()\n})\nit('x', async () => {\nconst t0 = performance.now()\nawait realWork().then(() => {\nexpect(performance.now() - t0).toBeLessThan(1_000)\n})\n})`,
    ],
    [
      'a let-go kept for a hook by its name',
      `function realClock(): void {\nvi.useRealTimers()\n}\nconst cleanups: Array<() => void> = []\ncleanups.push(realClock)\n${AFTER_FIRST}\nafterEach(() => {\nfor (const cleanup of cleanups) cleanup()\n})\nit('first', () => {})\nit('x', async () => {\n${REAL}\n})`,
    ],
  ])('finds a bound on real time beside fake timers — %s', (_, source) => {
    expect(rawBounds('a.test.ts', source)).toHaveLength(1)
  })

  it('leaves alone a fake bound beside a test whose options say concurrent: false', () => {
    expect(
      rawBounds(
        'a.test.ts',
        `it('x', { concurrent: false, timeout: 10_000 }, async () => {\nvi.useFakeTimers()\n${FAKE}\n})`,
      ),
    ).toEqual([])
  })

  // review round 9 of MOL-266: №21 and adversarial И1–И2
  it.each([
    ...['[realClock]', 'new Set([realClock])', '{ reset: realClock }'].map((kept) => [
      `the let-go kept as ${kept}`,
      `function realClock(): void {\nvi.useRealTimers()\n}\nconst cleanups = ${kept}\n${AFTER_FIRST}\nafterEach(() => {\nrun(cleanups)\n})\nit('first', () => {})\nit('x', async () => {\n${REAL}\n})`,
    ]),
    [
      'the let-go under an alias',
      `function realClock(): void {\nvi.useRealTimers()\n}\nconst reset = realClock\n${AFTER_FIRST}\nafterEach(() => {\nreset()\n})\nit('first', () => {})\nit('x', async () => {\n${REAL}\n})`,
    ],
    [
      'options under a name',
      `const opts = { concurrent: true }\nit('a', opts, async () => {\nawait tick()\nvi.useRealTimers()\n})\nit('b', opts, async () => {\nvi.useFakeTimers()\n${FAKE}\n})`,
    ],
    [
      'options made by a call',
      `describe('s', options(), () => {\nit('a', async () => {\nvi.useRealTimers()\n})\nit('b', async () => {\nvi.useFakeTimers()\n${FAKE}\n})\n})`,
    ],
  ])('finds a bound on real time beside fake timers — %s', (_, source) => {
    expect(rawBounds('a.test.ts', source)).toHaveLength(1)
  })

  it('leaves alone a fake bound whose test has a timeout named by a number of the file', () => {
    expect(
      rawBounds(
        'a.test.ts',
        `const SLOW_MS = 2 * 60_000\nit('x', async () => {\nvi.useFakeTimers()\n${FAKE}\n}, SLOW_MS)`,
      ),
    ).toEqual([])
  })

  // review round 10 of MOL-266: adversarial К1, К2 and К5
  it.each([
    [
      'a let-go in a default of a parameter',
      `function prepare(utils = vi.useRealTimers()): typeof vi {\nreturn utils\n}\nbeforeEach(() => {\nvi.useFakeTimers()\n})\nit('x', async () => {\nprepare()\n${REAL}\n})`,
    ],
    ...[
      "vi.stubGlobal('performance', REAL_CLOCK)",
      "Object.defineProperty(globalThis, 'performance', { value: REAL_CLOCK })",
      "vi.spyOn(performance, 'now').mockImplementation(realNow)",
      'performance.now = realNow',
    ].map((back) => [
      `the clock put back by hand: ${back}`,
      `beforeEach(() => {\nvi.useFakeTimers()\n${back}\n})\nit('x', async () => {\n${REAL}\n})`,
    ]),
  ])('finds a bound on real time beside fake timers — %s', (_, source) => {
    expect(rawBounds('a.test.ts', source)).toHaveLength(1)
  })

  it('reads a command line that gives vitest a setting the configs do not show (adversarial К5)', () => {
    expect(
      vitestFlagsUnsure(['"test": "vitest run && vitest run -c vitest.integration.config.ts"']),
    ).toBe(false)
    expect(vitestFlagsUnsure(['"test": "vitest run --coverage"'])).toBe(false)
    expect(vitestFlagsUnsure(['"test": "vitest run --sequence.concurrent"'])).toBe(true)
    expect(vitestFlagsUnsure(['test:\n\tnpx vitest run --setupFiles ./setup.ts'])).toBe(true)
  })

  // review round 11 of MOL-266: №24 and adversarial Л1–Л4
  it.each([
    [
      'a default of a parameter that calls what lets go',
      `function realClock(): typeof vi {\nreturn vi.useRealTimers()\n}\nfunction prepare(utils = realClock()): typeof vi {\nreturn utils\n}\nbeforeEach(() => {\nvi.useFakeTimers()\n})\nit('x', async () => {\nprepare()\n${REAL}\n})`,
    ],
    ...[
      "const stub = vi.stubGlobal\nbeforeEach(() => {\nvi.useFakeTimers()\nstub('performance', REAL_CLOCK)\n})",
      "const define = Object.defineProperty\nbeforeEach(() => {\nvi.useFakeTimers()\ndefine(globalThis, 'performance', { value: REAL_CLOCK })\n})",
      'const g = globalThis\nbeforeEach(() => {\nvi.useFakeTimers()\ng.performance = REAL_CLOCK\n})',
    ].map((back) => [
      `the clock put back under another name: ${back.slice(0, back.indexOf('\n'))}`,
      `${back}\nit('x', async () => {\n${REAL}\n})`,
    ]),
  ])('finds a bound on real time beside fake timers — %s', (_, source) => {
    expect(rawBounds('a.test.ts', source)).toHaveLength(1)
  })

  it('reads a setup file that puts a clock back by hand, or loads a module under another name (№24, Л3)', () => {
    const config = { path: 'bot/vitest.config.ts', text: "setupFiles: ['./setup.ts']" }
    for (const setup of [
      "import { afterEach } from 'vitest'\nconst realNow = Date.now\nafterEach(() => {\nDate.now = realNow\n})",
      "import { afterEach, vi } from 'vitest'\nafterEach(() => {\nvi.spyOn(performance, 'now').mockRestore()\n})",
      "import { afterEach } from 'vitest'\nafterEach(() => {\nObject.assign(globalThis, { performance: REAL })\n})",
      "import { vi } from 'vitest'\nconst load = vi.importActual\nawait load('./clock-reset')",
    ])
      expect(
        unsureDirectories([config], (path) => (path === 'bot/setup.ts' ? setup : undefined)),
      ).toEqual(['bot'])
    // a file that cannot hook — no vitest in it — may name Date freely
    expect(
      unsureDirectories([config], (path) =>
        path === 'bot/setup.ts' ? 'export const at = (d: Date): number => d.getTime()' : undefined,
      ),
    ).toEqual([])
  })

  it('reads what npm hands a script that runs vitest, and a config the check does not read (Л4)', () => {
    const scripts = JSON.stringify({ scripts: { test: 'vitest run', lint: 'eslint .' } })
    expect(vitestFlagsUnsure([scripts, 'test:\n\tnpm run test -- --sequence.concurrent'])).toBe(
      true,
    )
    expect(vitestFlagsUnsure([scripts, '- run: npm test -- --sequence.concurrent'])).toBe(true)
    expect(vitestFlagsUnsure([scripts, 'lint:\n\tnpm run lint -- --fix'])).toBe(false)
    expect(
      vitestFlagsUnsure(
        ['"test": "vitest run -c clock.config.ts"'],
        ['backend/vitest.integration.config.ts'],
      ),
    ).toBe(true)
    expect(
      vitestFlagsUnsure(
        ['"test": "vitest run -c vitest.integration.config.ts"'],
        ['backend/vitest.integration.config.ts'],
      ),
    ).toBe(false)
  })

  // adversarial round 12 of MOL-266: М1–М2
  it.each([
    [
      'a default inside what a parameter takes apart',
      `function realClock(): typeof vi {\nreturn vi.useRealTimers()\n}\nfunction prepare({ utils = realClock() } = {}): typeof vi {\nreturn utils\n}\nbeforeEach(() => {\nvi.useFakeTimers()\n})\nit('x', async () => {\nprepare()\n${REAL}\n})`,
    ],
    [
      'a field of a class',
      `class Clock {\nreadonly utils = vi.useRealTimers()\n}\nbeforeEach(() => {\nvi.useFakeTimers()\n})\nit('x', async () => {\nnew Clock()\n${REAL}\n})`,
    ],
    ...[
      "const { stubGlobal: put } = vi\nbeforeEach(() => {\nvi.useFakeTimers()\nput('performance', REAL_CLOCK)\n})",
      "const { defineProperty: define } = Object\nbeforeEach(() => {\nvi.useFakeTimers()\ndefine(performance, 'now', { value: realNow })\n})",
      "const O = Object\nbeforeEach(() => {\nvi.useFakeTimers()\nO.defineProperty(performance, 'now', { value: realNow })\n})",
    ].map((back) => [
      `vi or Object under another name: ${back.slice(0, back.indexOf('\n'))}`,
      `${back}\nit('x', async () => {\n${REAL}\n})`,
    ]),
  ])('finds a bound on real time beside fake timers — %s', (_, source) => {
    expect(rawBounds('a.test.ts', source)).toHaveLength(1)
  })

  it('reads a setup file with what it imports as one, and a list of setup files written out (М3)', () => {
    const files: Record<string, string> = {
      'bot/setup.ts':
        "import { afterEach } from 'vitest'\nimport { realClock } from './clock'\nafterEach(realClock)",
      'bot/clock.ts': 'export const realClock = (): void => {\nglobalThis.performance = REAL\n}',
    }
    const read = (path: string): string | undefined => files[path]
    const at = (text: string) => unsureDirectories([{ path: 'bot/vitest.config.ts', text }], read)
    expect(at("setupFiles: ['./setup.ts']")).toEqual(['bot'])
    expect(at('setupFiles: [SETUP]')).toEqual(['bot'])
    expect(at('setupFiles: [`./setup.ts`]')).toEqual(['bot'])
  })

  it('reads a command line by its words (М4, М5)', () => {
    const scripts = JSON.stringify({ scripts: { test: 'vitest run', check: 'npm run test --' } })
    const unsure = (line: string) =>
      vitestFlagsUnsure(
        [scripts, line],
        ['bot/vitest.config.ts', 'backend/vitest.integration.config.ts'],
      )
    expect(unsure('npx vitest run --project "bot" --sequence.concurrent')).toBe(true)
    expect(unsure('test:\n\tnpx vitest run \\\n\t\t--sequence.concurrent')).toBe(true)
    expect(unsure('test:\n\tnpx vitest run $(FLAGS)')).toBe(true)
    expect(unsure('npm run -w @molvia/bot test -- --sequence.concurrent')).toBe(true)
    expect(unsure('npm --prefix bot test -- --sequence.concurrent')).toBe(true)
    expect(unsure('npm run check -- --sequence.concurrent')).toBe(true)
    expect(unsure('npx vitest run -c test.config.ts')).toBe(true)
    expect(unsure('npx vitest run -c vitest.integration.config.ts')).toBe(false)
    expect(unsure('npm run -w @molvia/bot test')).toBe(false)
  })

  // adversarial round 13 of MOL-266: Н1–Н5
  it.each([
    [
      'a static block of a class',
      `vi.useFakeTimers()\nclass Clock {\nreadonly n = 1\nstatic {\nvi.useRealTimers()\n}\n}\nit('x', async () => {\n${REAL}\n})`,
    ],
    [
      'a clock assigned by a computed key',
      `const KEY = 'now'\nbeforeEach(() => {\nvi.useFakeTimers()\nperformance[KEY] = realNow\n})\nit('x', async () => {\n${REAL}\n})`,
    ],
    [
      'Object in a field',
      `const tools = { O: Object }\nbeforeEach(() => {\nvi.useFakeTimers()\ntools.O.defineProperty(performance, 'now', { value: realNow })\n})\nit('x', async () => {\n${REAL}\n})`,
    ],
    [
      'Object handed to a call',
      `const put = (o: ObjectConstructor): void => {\no.defineProperty(performance, 'now', { value: realNow })\n}\nbeforeEach(() => {\nvi.useFakeTimers()\nput(Object)\n})\nit('x', async () => {\n${REAL}\n})`,
    ],
  ])('finds a bound on real time beside fake timers — %s', (_, source) => {
    expect(rawBounds('a.test.ts', source)).toHaveLength(1)
  })

  it('reads vitest at hand by globals in the config (Н3)', () => {
    const files: Record<string, string> = {
      'bot/setup.ts':
        '/// <reference types="vitest/globals" />\nafterEach(() => {\nglobalThis.performance = REAL\n})',
    }
    const read = (path: string): string | undefined => files[path]
    expect(
      unsureDirectories(
        [
          {
            path: 'bot/vitest.config.ts',
            text: "test: { globals: true, setupFiles: ['./setup.ts'] }",
          },
        ],
        read,
      ),
    ).toEqual(['bot'])
  })

  it('reads a YAML value whole, every spelling of vitest, npm past any option, and xargs (Н4, Н5)', () => {
    const scripts = JSON.stringify({ scripts: { test: 'vitest run' } })
    const unsure = (text: string) => vitestFlagsUnsure([scripts, text], ['bot/vitest.config.ts'])
    expect(
      unsure(
        'jobs:\n  t:\n    steps:\n      - run: >\n          npx vitest run\n          --sequence.concurrent',
      ),
    ).toBe(true)
    expect(unsure('      - run: npx vitest run\n          --sequence.concurrent')).toBe(true)
    expect(unsure('node node_modules/vitest/vitest.mjs run --sequence.concurrent')).toBe(true)
    expect(unsure('npx vitest@5.0.2 run --sequence.concurrent')).toBe(true)
    expect(unsure('echo --sequence.concurrent | xargs npx vitest run')).toBe(true)
    expect(unsure('npm --loglevel warn run test -- --sequence.concurrent')).toBe(true)
    // a comment and a string holding the word are no command — the lock's own text
    expect(unsure('# vitest finds its command past options (`-c … watch`)')).toBe(false)
    expect(unsure('    watch) endless="vitest $arg" ;;')).toBe(false)
  })

  // review round 13 of MOL-266 (№25–26) and adversarial round 14 (О1–О5)
  it.each([
    [
      'a class whose extends calls what lets go',
      `function realBase(): new () => object {\nvi.useRealTimers()\nreturn class {}\n}\nvi.useFakeTimers()\nclass Clock extends realBase() {\nreadonly n = 1\n}\nit('x', async () => {\n${REAL}\n})`,
    ],
    [
      'a clock handed to a function that puts it back',
      `const put = (p: Performance): void => {\np.now = realNow\n}\nbeforeEach(() => {\nvi.useFakeTimers({ toFake: ['performance'] })\nput(performance)\n})\nit('x', async () => {\n${REAL}\n})`,
    ],
  ])('finds a bound on real time beside fake timers — %s', (_, source) => {
    expect(rawBounds('a.test.ts', source)).toHaveLength(1)
  })

  it('reads a setup file that puts every global property back (О3)', () => {
    const setup =
      "import { afterEach } from 'vitest'\nconst saved = Object.getOwnPropertyDescriptors(global)\nafterEach(() => {\nObject.defineProperties(global, saved)\n})"
    expect(
      unsureDirectories(
        [{ path: 'bot/vitest.config.ts', text: "setupFiles: ['./setup.ts']" }],
        (path) => (path === 'bot/setup.ts' ? setup : undefined),
      ),
    ).toEqual(['bot'])
  })

  it('reads a quoted command as a command, and node --run as npm run (№25–26, О4–О5)', () => {
    const scripts = JSON.stringify({ scripts: { test: 'vitest run' } })
    const unsure = (text: string) => vitestFlagsUnsure([scripts, text], ['bot/vitest.config.ts'])
    expect(unsure('test:\n\tsh -c "npx vitest run --sequence.concurrent"')).toBe(true)
    expect(unsure("bash -c 'npx vitest run --sequence.concurrent'")).toBe(true)
    expect(unsure('eval "npx vitest run --sequence.concurrent"')).toBe(true)
    expect(unsure('node --run test -- --sequence.concurrent')).toBe(true)
    // the lock's own text: an assignment's value and what echo prints stay data
    expect(unsure('    watch) endless="vitest $arg" ;;')).toBe(false)
    expect(unsure('echo "one-at-a-time:" \\\n  "use `npx vitest run …`" >&2')).toBe(false)
  })
})
