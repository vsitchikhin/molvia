import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { startVitest } from 'vitest/node'
import TestTimeReporter, {
  describeBreach,
  hookTimes,
  ownHookTimeouts,
  testBreaches,
  type Breach,
  type HookTime,
} from './test-time-reporter'

describe('testBreaches', () => {
  it('holds a test to a fifth of its timeout: exactly a fifth passes, past it does not', () => {
    expect(testBreaches('a.test.ts', 't', 1_000, 5_000, [])).toEqual([])
    expect(testBreaches('a.test.ts', 't', 1_001, 5_000, [])).toEqual([
      { what: 'test', file: 'a.test.ts', name: 't', ms: 1_001, limit: 5_000 },
    ])
    expect(testBreaches('a.test.ts', 't', 1_001, 25_000, [])).toEqual([])
  })

  it('holds a bound to five times what it met, and below the test’s timeout', () => {
    expect(testBreaches('a.test.ts', 't', 10, 5_000, [{ elapsed: 3, bound: 15 }])).toEqual([])
    expect(testBreaches('a.test.ts', 't', 10, 5_000, [{ elapsed: 3.1, bound: 15 }])).toEqual([
      { what: 'clock', file: 'a.test.ts', name: 't', ms: 3.1, limit: 15 },
    ])
    // a bound at vitest's limit is vitest's to hold, not the test's (MOL-265)
    expect(testBreaches('a.test.ts', 't', 10, 5_000, [{ elapsed: 300, bound: 5_000 }])).toEqual([
      { what: 'bound', file: 'a.test.ts', name: 't', ms: 5_000, limit: 5_000 },
    ])
    expect(testBreaches('a.test.ts', 't', 10, 30_000, [{ elapsed: 300, bound: 5_000 }])).toEqual([])
  })
})

describe('ownHookTimeouts', () => {
  it('reads a hook’s own timeout by the suites it stands in, a constant and a template too', () => {
    const own = ownHookTimeouts(`
      const LOAD_MS = 600_000
      beforeAll(async () => {}, LOAD_MS)
      afterAll(() => {})
      describe('outer', () => {
        describe(\`by \${kind}\`, () => {
          afterAll(() => {}, { timeout: 20_000 })
        })
        beforeAll(() => {}, 60_000)
      })
    `)
    expect(own.map(({ kind, path, timeout }) => [kind, path.map(String), timeout])).toEqual([
      ['beforeAll', [], 600_000],
      ['afterAll', ['/^outer$/s', '/^by .*$/s'], 20_000],
      ['beforeAll', ['/^outer$/s'], 60_000],
    ])
    expect(own[1]?.path[1]?.test('by day')).toBe(true)
  })
})

describe('hookTimes', () => {
  it('reads beforeAll and afterAll from the gaps around a suite’s children', () => {
    const at = (startTime: number, duration: number) => ({ startTime, duration })
    const file = {
      type: 'suite',
      name: 'a.test.ts',
      result: at(1_000, 900),
      tasks: [
        { type: 'test', name: 'first', result: at(1_250, 50), tasks: [] },
        {
          type: 'suite',
          name: 'inner',
          result: at(1_300, 400),
          tasks: [{ type: 'test', name: 'second', result: at(1_400, 100) }],
        },
        { type: 'test', name: 'skipped' },
      ],
    }
    expect(hookTimes(file as never)).toEqual<HookTime[]>([
      { kind: 'beforeAll', path: [], ms: 250 },
      { kind: 'afterAll', path: [], ms: 200 },
      { kind: 'beforeAll', path: ['inner'], ms: 100 },
      { kind: 'afterAll', path: ['inner'], ms: 200 },
    ])
  })
})

describe('describeBreach', () => {
  it('names the file, the test, the time and the limit it needs', () => {
    const breach: Breach = {
      what: 'test',
      file: 'a.test.ts',
      name: 'x › y',
      ms: 2_371,
      limit: 5_000,
    }
    expect(describeBreach(breach)).toBe(
      'a.test.ts › x › y: the test took 2 371 ms against its timeout of 5 000 — give it at least 11 855',
    )
  })
})

// A run of vitest of its own, on the fixture: the hooks' marks are the runner's tasks, an experimental
// door of vitest — a version that moves them turns this red rather than the reporter silent.
const RUN_MS = 60_000

describe('a run of vitest', () => {
  it(
    'measures the fixture’s hooks from the worker’s marks, reads its own timeout and keeps its bounds',
    async () => {
      const out = mkdtempSync(join(tmpdir(), 'test-time-'))
      const lines: string[] = []
      const write = process.stdout.write.bind(process.stdout)
      process.stdout.write = (chunk: string | Uint8Array) => {
        lines.push(...String(chunk).split('\n'))
        return true
      }
      try {
        const vitest = await startVitest(
          ['bin/test-time-reporter.fixture.ts'],
          {
            watch: false,
            config: false,
            include: ['bin/test-time-reporter.fixture.ts'],
            reporters: [],
          },
          { cacheDir: out },
          { stdout: process.stdout, stderr: process.stderr },
        )
        const reporter = new TestTimeReporter({ fail: false })
        // the run is over by now: the reporter reads the modules as vitest handed them
        for (const module of vitest.state.getTestModules()) {
          for (const test of module.children.allTests()) reporter.onTestCaseResult(test)
          reporter.onTestModuleEnd(module)
        }
        reporter.onTestRunEnd()
        await vitest.close()
      } finally {
        process.stdout.write = write
        rmSync(out, { recursive: true, force: true })
      }
      const measured = lines.filter((line) => line.startsWith('[time] '))
      const ms = (prefix: string): number => {
        const line = measured.find((l) => l.startsWith(`[time] ${prefix}`))
        expect(line, prefix).toBeDefined()
        return Number(/: ([\d\s ]+) of/.exec(line ?? '')?.[1]?.replace(/\s/g, ''))
      }
      // waits the fixture sets: the marks may only add to them
      expect(ms('beforeAll bin/test-time-reporter.fixture.ts › (file)')).toBeGreaterThanOrEqual(315)
      expect(ms('afterAll bin/test-time-reporter.fixture.ts › (file)')).toBeGreaterThanOrEqual(305)
      expect(measured).toContainEqual(
        expect.stringMatching(/beforeAll .* › \(file\): .* of 30 000 ms$/),
      )
      expect(measured).toContainEqual(
        expect.stringMatching(/afterAll .* › \(file\): .* of 10 000 ms$/),
      )
      expect(measured).toContain(
        '[time] clock bin/test-time-reporter.fixture.ts › inner > keeps what it bounded: 3 of 15 ms',
      )
      // a bound at vitest's limit, and nothing else of the fixture past the rule
      expect(measured.filter((l) => l.includes('past the rule'))).toEqual([
        '[time] past the rule of MOL-243 — 1, see CLAUDE.md › Testing:',
      ])
      expect(measured.filter((l) => l.includes('not below'))).toEqual([
        "[time] bin/test-time-reporter.fixture.ts › inner > keeps what it bounded: a bound on the clock of 5 000 ms is not below the test's timeout of 5 000 — vitest, not the test, would hold it",
      ])
    },
    RUN_MS,
  )
})
