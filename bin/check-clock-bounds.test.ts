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

  // adversarial round 17 of MOL-266, Т1–Т5: what an array hands on, a comparison no assertion reads where it
  // stands, entries read back, a deadline the other way round, the clock as a moment of the epoch
  it.each([
    ['for of', `for (const d of took) expect(d).toBeLessThan(1_000)`],
    ['forEach', `took.forEach((d) => {\nexpect(d).toBeLessThan(1_000)\n})`],
    ['every', `expect(took.every((d) => d < 1_000)).toBe(true)`],
    ['some', `expect(took.some((d) => d > 1_000)).toBe(false)`],
    ['filter', `expect(took.filter((d) => d > 1_000)).toHaveLength(0)`],
    [
      'every, by a function of the file',
      `const fast = (d: number) => d < 1_000\nexpect(took.every(fast)).toBe(true)`,
    ],
    ['a comparison kept in a name', `const slow = took[0] > 1_000\nexpect(slow).toBe(false)`],
    ['a ternary', `expect(took[0] > 1_000 ? 'slow' : 'fast').toBe('fast')`],
    [
      'a function of the file handed the duration',
      `function slow(d: number) {\nreturn d > 1_000\n}\nexpect(slow(took[0])).toBe(false)`,
    ],
  ])('finds a bound on what an array of durations holds — %s', (_, bound) => {
    const source = `it('x', () => {\nconst took: number[] = []\nconst t0 = performance.now()\ntook.push(performance.now() - t0)\n${bound}\n})`
    expect(rawBounds('a.test.ts', source)).not.toEqual([])
  })

  // review №30 and adversarial round 18 of MOL-266, У1–У4: a name taken apart, a Map, a budget against zero, a method
  it.each([
    [
      'for of, taken apart',
      `const rows = [{ name: 'a', took: took[0] }]\nfor (const { took: ms } of rows) expect(ms).toBeLessThan(1_000)`,
    ],
    [
      'for of an entry',
      `const times = { a: took[0] }\nfor (const [, ms] of Object.entries(times)) expect(ms).toBeLessThan(1_000)`,
    ],
    [
      'a callback taking apart',
      `const rows = [{ ms: took[0] }]\nexpect(rows.every(({ ms }) => ms < 1_000)).toBe(true)`,
    ],
    [
      'a Map, read back',
      `const byName = new Map<string, number>()\nbyName.set('a', took[0])\nexpect(byName.get('a')).toBeLessThan(1_000)`,
    ],
    [
      'a Map, gone through',
      `const byName = new Map<string, number>()\nbyName.set('a', took[0])\nfor (const ms of byName.values()) expect(ms).toBeLessThan(1_000)`,
    ],
    ['a budget against zero in a name', `const ok = 1_000 - took[0] > 0\nexpect(ok).toBe(true)`],
    [
      'a deadline left against zero',
      `const deadline = Date.now() + 1_000\nconst inTime = deadline - Date.now() > 0\nexpect(inTime).toBe(true)`,
    ],
    [
      'for of an entry of the array',
      `for (const [, ms] of took.entries()) expect(ms).toBeLessThan(1_000)`,
    ],
    [
      'for of the values of a shorthand',
      `const d = took[0]\nfor (const ms of Object.values({ d })) expect(ms).toBeLessThan(1_000)`,
    ],
    [
      'a method of an object of the file',
      `const check = { fast: (ms: number) => ms < 1_000 }\nexpect(check.fast(took[0])).toBe(true)`,
    ],
  ])('finds a bound handed on — %s', (_, bound) => {
    const source = `it('x', () => {\nconst took: number[] = []\nconst t0 = performance.now()\ntook.push(performance.now() - t0)\n${bound}\n})`
    expect(rawBounds('a.test.ts', source)).not.toEqual([])
  })

  // adversarial round 19 of MOL-266, Ф1–Ф3: an overage against zero, a generator, a callback a helper hands it
  it.each([
    [
      'an overage against zero in a name',
      `const slow = took[0] - 1_000 > 0\nexpect(slow).toBe(false)`,
    ],
    [
      'a generator of the file',
      `function* durations() {\nyield performance.now() - t0\n}\nfor (const ms of durations()) expect(ms).toBeLessThan(1_000)`,
    ],
    [
      'a callback a helper of the file hands it',
      `function timed(then: (ms: number) => void) {\nthen(performance.now() - t0)\n}\ntimed((ms) => {\nexpect(ms).toBeLessThan(1_000)\n})`,
    ],
  ])('finds a bound handed on — %s', (_, bound) => {
    const source = `it('x', () => {\nconst took: number[] = []\nconst t0 = performance.now()\ntook.push(performance.now() - t0)\n${bound}\n})`
    expect(rawBounds('a.test.ts', source)).not.toEqual([])
  })

  // review №32 and adversarial Ф4: a count beside a duration is a count, and only a store the file made holds one
  it.each([
    [
      'a component handed a duration',
      `await wrapper.setProps({ ms: d })\nexpect(wrapper.findAll('li').length).toBeLessThan(5)`,
    ],
    [
      'fake time moved by one',
      `vi.advanceTimersByTime(d)\nexpect(spy.mock.calls.length).toBeLessThan(3)`,
    ],
    [
      'the size of a Map',
      `const m = new Map<string, number>()\nm.set('a', d)\nexpect(m.size).toBeLessThan(3)`,
    ],
    [
      'a logger given one',
      `logger.info('took', d)\nexpect(logger.info.mock.calls.length).toBeLessThan(3)`,
    ],
    [
      'an emitter given one',
      `app.emit('tick', d)\nexpect(app.emit.mock.calls.length > 2).toBe(false)`,
    ],
    [
      'the length of a store of durations',
      `const rows: number[] = []\nrows.push(d)\nexpect(rows.length).toBeLessThan(3)`,
    ],
    [
      'another field of an object',
      `const report = { took: d, retries: 1 }\nexpect(report.retries).toBeLessThan(3)`,
    ],
    [
      'another field of the rows, taken apart',
      `const rows = [{ took: d, tries: 1 }]\nfor (const { tries } of rows) expect(tries).toBeLessThan(3)`,
    ],
    [
      'a line that says it is no duration',
      `// not a duration: a count of what was read\nexpect(d).toBeLessThan(3)`,
    ],
  ])('leaves alone what is no duration — %s', (_, code) => {
    const source = `it('x', async () => {\nconst t0 = performance.now()\nconst d = performance.now() - t0\n${code}\n})`
    expect(rawBounds('a.test.ts', source)).toEqual([])
  })

  it('still finds the duration a field of the same object or rows holds (Ф4)', () => {
    expect(
      lines(`
        const t0 = performance.now()
        const d = performance.now() - t0
        const report = { took: d, retries: 1 }
        expect(report.took).toBeLessThan(1_000)
        const rows = [{ took: d, tries: 1 }]
        for (const { took } of rows) expect(took).toBeLessThan(1_000)
        for (const row of rows) expect(row.took).toBeLessThan(1_000)
        expect(rows[0].took).toBeLessThan(1_000)
        expect(Math.max(...rows.map((row) => row.took))).toBeLessThan(1_000)
      `),
    ).toEqual([5, 7, 8, 9, 10])
  })

  it('finds entries read back, a deadline the other way round and the clock as a moment (Т3–Т5)', () => {
    expect(
      lines(`
        performance.measure('x', 'a', 'b')
        expect(performance.getEntriesByName('x')[0].duration).toBeLessThan(1_000)
        const [entry] = performance.getEntriesByType('measure')
        expect(entry.duration).toBeLessThan(1_000)
        const t0 = performance.now()
        const t1 = performance.now()
        expect(t1 - 1_000).toBeLessThan(t0)
        const e0 = performance.timeOrigin + performance.now()
        expect(performance.timeOrigin + performance.now() - e0).toBeLessThan(1_000)
      `),
    ).toEqual([3, 5, 8, 10])
  })

  it('leaves alone a wait, a mark against zero and a lower bound kept apart', () => {
    expect(
      lines(`
        const t0 = performance.now()
        while (performance.now() - t0 < 300) {}
        let failAt = -1
        if (failAt < 0) failAt = performance.now() - t0
        expect(failAt).toBeGreaterThanOrEqual(250)
        expect(performance.now() - t0 >= 250).toBe(true)
      `),
    ).toEqual([])
  })

  it('reads process.uptime() as a clock, by its own name and taken apart (adversarial round 16, Р4)', () => {
    expect(
      lines(`
        const t0 = process.uptime()
        expect(process.uptime() - t0).toBeLessThan(1)
        const { uptime } = process
        expect(uptime() - t0).toBeLessThan(1)
      `),
    ).toEqual([3, 5])
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

  it('refuses a bound on fake time as any other: whether a clock is fake is the run’s (MOL-266, round 15)', () => {
    // bot/src/assemble.test.ts › «Telegram лежал полчаса…»: readings in a helper's answer, under fake timers —
    // the bound goes through expectWithin and is held as real, or the timers moved say it (round 16)
    const helper = `function asking() { const calls: number[] = []; work(() => calls.push(Date.now())); return { calls } }\n`
    const bound = `const { calls } = asking()\nconst back = Date.now()\nawait vi.advanceTimersByTimeAsync(30_000)\nexpect((calls.at(-1) ?? Infinity) - back).toBeLessThan(30_000)`
    expect(lines(`${helper}it('x', async () => {\nvi.useFakeTimers()\n${bound}\n})`)).toEqual([7])
    expect(
      lines(
        `${helper}beforeEach(() => {\nvi.useFakeTimers()\n})\nit('x', async () => {\n${bound}\n})`,
      ),
    ).toEqual([9])
    expect(lines(`${helper}it('x', async () => {\n${bound}\n})`)).toEqual([6])
    expect(
      lines(
        `${helper}it('x', async () => {\nvi.useFakeTimers()\nconst { calls } = asking()\nconst back = Date.now()\nawait vi.advanceTimersByTimeAsync(30_000)\nexpectWithin((calls.at(-1) ?? Infinity) - back, 30_000)\n})`,
      ),
    ).toEqual([])
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
  ])('refuses a bound on fake time as any other — %s', (_, source) => {
    expect(rawBounds('a.test.ts', source)).not.toEqual([])
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
  ])('refuses a bound on fake time as any other — %s', (_, source) => {
    expect(rawBounds('a.test.ts', source)).not.toEqual([])
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
  ])('refuses a bound on fake time as any other — %s', (_, source) => {
    expect(rawBounds('a.test.ts', source)).not.toEqual([])
  })
})
