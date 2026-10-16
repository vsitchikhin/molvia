import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { startVitest } from 'vitest/node'
import TestTimeReporter, {
  describeBreach,
  hookTimes,
  hookLimit,
  limitFor,
  ownHookTimeouts,
  redScope,
  testBreaches,
  type Breach,
  type HookTime,
  type RedScope,
} from './test-time-reporter'

describe('testBreaches', () => {
  it('holds a test to a tenth of its timeout: exactly a tenth passes, past it does not', () => {
    expect(testBreaches('a.test.ts', 't', 500, 5_000, [])).toEqual([])
    expect(testBreaches('a.test.ts', 't', 501, 5_000, [])).toEqual([
      { what: 'test', file: 'a.test.ts', name: 't', ms: 501, limit: 5_000 },
    ])
    expect(testBreaches('a.test.ts', 't', 2_400, 25_000, [])).toEqual([])
  })

  it('holds a bound to ten times what it met, and below the test’s timeout', () => {
    expect(testBreaches('a.test.ts', 't', 10, 5_000, [{ elapsed: 1.5, bound: 15 }])).toEqual([])
    expect(testBreaches('a.test.ts', 't', 10, 5_000, [{ elapsed: 1.6, bound: 15 }])).toEqual([
      { what: 'clock', file: 'a.test.ts', name: 't', ms: 1.6, limit: 15 },
    ])
    // a bound at vitest's limit is vitest's to hold, not the test's (MOL-265)
    expect(testBreaches('a.test.ts', 't', 10, 5_000, [{ elapsed: 300, bound: 5_000 }])).toEqual([
      { what: 'bound', file: 'a.test.ts', name: 't', ms: 5_000, limit: 5_000 },
    ])
    expect(testBreaches('a.test.ts', 't', 10, 30_000, [{ elapsed: 300, bound: 5_000 }])).toEqual([])
  })

  it('judges no time against a timeout of 0 or Infinity: vitest gives such a test none', () => {
    // adversarial round 1 of MOL-266, А8
    expect(testBreaches('a.test.ts', 't', 5, 0, [{ elapsed: 1, bound: 100 }])).toEqual([])
    expect(testBreaches('a.test.ts', 't', 9_000, Infinity, [])).toEqual([])
    expect(testBreaches('a.test.ts', 't', 1, 5_000, [])).toEqual([])
  })
})

describe('ownHookTimeouts', () => {
  const read = (source: string) =>
    ownHookTimeouts(source).map(({ kind, path, exact, timeout }) => [
      kind,
      path?.map(String) ?? null,
      exact,
      timeout,
    ])

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
    expect(
      own.map(({ kind, path, exact, timeout }) => [kind, path?.map(String), exact, timeout]),
    ).toEqual([
      ['beforeAll', [], true, 600_000],
      ['afterAll', [], true, null],
      ['afterAll', ['/^outer$/s', '/^by .*$/s'], false, 20_000],
      ['beforeAll', ['/^outer$/s'], true, 60_000],
    ])
    expect(own[2]?.path?.[1]?.test('by day')).toBe(true)
  })

  it('reads arithmetic, each’s placeholders, suite and a suite named by an expression', () => {
    // review round 1 of MOL-266, А3; round 2, Б3-3
    expect(
      read(`
        const MINUTE = 60 * 1000
        beforeAll(() => {}, 2 * MINUTE)
        describe.each(['light', 'dark'])('in %s', () => {
          afterAll(() => {}, (5 * 60_000))
        })
        describe.for([{ kind: 'day' }])('by $kind and %#', () => {
          beforeAll(() => {}, 30_000)
        })
        describe(Sheet.name, () => {
          beforeAll(() => {}, 4_000)
        })
        suite('served', () => {
          beforeAll(() => {}, 4_000)
        })
      `),
    ).toEqual([
      ['beforeAll', [], true, 120_000],
      ['afterAll', ['/^in .*$/s'], false, 300_000],
      ['beforeAll', ['/^by .* and .*$/s'], false, 30_000],
      ['beforeAll', ['/^.*$/s'], false, 4_000],
      ['beforeAll', ['/^served$/s'], true, 4_000],
    ])
  })

  it('reads a constant in its own scope, and a helper’s hook as anywhere', () => {
    // round 2, Б3-4 and Б3-2
    expect(
      read(`
        describe('a', () => {
          const LIMIT = 4_000
          beforeAll(() => {}, LIMIT)
        })
        describe('b', () => {
          const LIMIT = 1_000
          beforeAll(() => {}, LIMIT)
        })
        function startsSlowly() {
          beforeAll(() => {}, 4_000)
        }
        describe('served', () => {
          startsSlowly()
        })
      `),
    ).toEqual([
      ['beforeAll', ['/^a$/s'], true, 4_000],
      ['beforeAll', ['/^b$/s'], true, 1_000],
      ['beforeAll', null, false, 4_000],
    ])
  })

  it('takes undefined for the project’s, and anything not a number as unread (round 2, Б4)', () => {
    expect(ownHookTimeouts('beforeAll(fn, undefined)')[0]?.timeout).toBeNull()
    for (const second of [
      '+60_000',
      'process.env.CI ? 60_000 : 10_000',
      'Math.max(1_000, 60_000)',
      'IMPORTED_MS',
    ]) {
      expect(ownHookTimeouts(`beforeAll(fn, ${second})`)[0]?.timeout).toBe('unread')
    }
  })
})

describe('hookLimit', () => {
  it('sums the suite’s hooks of a kind, each its own or the project’s (round 2, Б3-1)', () => {
    const own = ownHookTimeouts(`
      describe('two', () => {
        beforeAll(() => {}, 4_000)
        beforeAll(() => {})
        afterAll(() => {}, 9_000)
      })
    `)
    expect(hookLimit(own, 'beforeAll', ['two'], 1_000)).toEqual({ limit: 5_000, unread: false })
    expect(hookLimit(own, 'afterAll', ['two'], 1_000)).toEqual({ limit: 9_000, unread: false })
    expect(hookLimit(own, 'beforeAll', ['other'], 1_000)).toEqual({ limit: 1_000, unread: false })
  })

  it('takes the exact suite before a guess, and the smaller guess where guesses differ (review №10)', () => {
    const own = ownHookTimeouts(`
      describe(Sheet.name, () => { beforeAll(async () => {}, 60_000) })
      describe('other', () => { beforeAll(async () => {}) })
      describe.each(rows)('row %s', () => { beforeAll(async () => {}, 30_000) })
    `)
    expect(hookLimit(own, 'beforeAll', ['other'], 10_000)).toEqual({ limit: 10_000, unread: false })
    expect(hookLimit(own, 'beforeAll', ['row 1'], 10_000)).toEqual({ limit: 30_000, unread: false })
    expect(hookLimit(own, 'beforeAll', ['ItemDetailsSheet'], 10_000)).toEqual({
      limit: 60_000,
      unread: false,
    })
  })

  it('holds a hook whose timeout is not read as the project’s, and says so', () => {
    const own = ownHookTimeouts('beforeAll(fn, IMPORTED_MS)')
    expect(hookLimit(own, 'beforeAll', [], 10_000)).toEqual({ limit: 10_000, unread: true })
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
  it('advises the limit as the rule writes it: ten times, rounded up to 5 s (review №11)', () => {
    expect([limitFor(1_204.2), limitFor(500), limitFor(501), limitFor(2_371)]).toEqual([
      15_000, 5_000, 10_000, 25_000,
    ])
  })

  it('names the file, the test, the time and the limit it needs', () => {
    const breach: Breach = {
      what: 'test',
      file: 'a.test.ts',
      name: 'x › y',
      ms: 2_371,
      limit: 5_000,
    }
    expect(describeBreach(breach)).toBe(
      'a.test.ts › x › y: the test took 2 371 ms against its timeout of 5 000, its beforeEach and afterEach included — give it 25 000',
    )
  })
})

describe('redScope', () => {
  it('reads the pull request’s files from the merge CI checks out', () => {
    const asked: string[][] = []
    const run = (...args: string[]): string => {
      asked.push(args)
      return args[0] === 'rev-list' ? 'merge base head\n' : 'a.test.ts\nbin/b.ts\n'
    }
    expect(redScope({ GITHUB_EVENT_NAME: 'pull_request' }, run)).toEqual({
      files: new Set(['a.test.ts', 'bin/b.ts']),
      said: 'red only in the 2 files of the pull request',
    })
    expect(asked[1]).toEqual(['diff', '--name-only', 'HEAD^1', 'HEAD'])
  })

  it('makes nothing red on a push, and everything where the merge cannot be read', () => {
    const never = (): string => {
      throw new Error('a push asks git nothing')
    }
    expect(redScope({ GITHUB_EVENT_NAME: 'push' }, never)).toEqual({
      files: new Set(),
      said: 'no pull request: every breach is a warning',
    })
    expect(redScope({ GITHUB_EVENT_NAME: 'pull_request' }, () => 'head parent\n')).toEqual({
      all: 'HEAD is not the merge of the pull request',
      said: 'every breach counts: HEAD is not the merge of the pull request',
    })
    const shallow = (): string => {
      throw new Error('unknown revision HEAD^1')
    }
    expect(redScope({ GITHUB_EVENT_NAME: 'pull_request' }, shallow)).toMatchObject({
      all: expect.stringContaining('unknown revision HEAD^1') as string,
    })
  })
})

describe('the verdict of a run', () => {
  const test = (file: string, duration: number) =>
    ({
      diagnostic: () => ({ duration }),
      options: { timeout: 5_000 },
      module: { moduleId: `${process.cwd()}/${file}` },
      meta: () => ({}),
      fullName: 'slow',
    }) as never

  const verdict = (scope: RedScope): { lines: string[]; exitCode: typeof process.exitCode } => {
    const reporter = new TestTimeReporter({ fail: true, scope })
    reporter.onTestCaseResult(test('ours.test.ts', 900))
    reporter.onTestCaseResult(test('theirs.test.ts', 800))
    const lines: string[] = []
    const write = process.stdout.write.bind(process.stdout)
    const before = process.exitCode
    process.stdout.write = (chunk: string | Uint8Array) => {
      lines.push(...String(chunk).split('\n').filter(Boolean))
      return true
    }
    try {
      reporter.onTestRunEnd()
      return { lines, exitCode: process.exitCode }
    } finally {
      process.stdout.write = write
      process.exitCode = before
    }
  }

  it('turns red for a file of the pull request and only warns for one outside it (В-4 «а»)', () => {
    const { lines, exitCode } = verdict({ files: new Set(['ours.test.ts']), said: 'red only in 1' })
    expect(exitCode).toBe(1)
    expect(lines.filter((line) => line.startsWith('[time] '))).toEqual([
      '[time] red only in 1',
      '[time] past the rule of MOL-243 — 1, see CLAUDE.md › Testing:',
      '[time] ours.test.ts › slow: the test took 900 ms against its timeout of 5 000, its beforeEach and afterEach included — give it 10 000',
      '[time] past the rule of MOL-243 outside the files of the pull request, a warning — 1, see CLAUDE.md › Testing:',
      '[time] theirs.test.ts › slow: the test took 800 ms against its timeout of 5 000, its beforeEach and afterEach included — give it 10 000',
    ])
  })

  it('must not fail a run whose breaches are all outside the pull request — a push to master', () => {
    expect(verdict({ files: new Set(), said: 'no pull request' }).exitCode).not.toBe(1)
  })

  it('fails on every breach, and says why, where the pull request’s files are not known', () => {
    const { lines, exitCode } = verdict({
      all: 'HEAD is not the merge of the pull request',
      said: 'every breach counts: HEAD is not the merge of the pull request',
    })
    expect(exitCode).toBe(1)
    expect(lines).toContain('[time] every breach counts: HEAD is not the merge of the pull request')
    expect(lines).toContain('[time] past the rule of MOL-243 — 2, see CLAUDE.md › Testing:')
  })
})

// A run of vitest of its own, on the fixture: the hooks' marks are the runner's tasks, an experimental
// door of vitest — a version that moves them turns this red rather than the reporter silent.
describe('a run of vitest', () => {
  it('measures the fixture’s hooks from the worker’s marks, reads its own timeout and keeps its bounds', async () => {
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
      '[time] clock bin/test-time-reporter.fixture.ts › inner > keeps what it bounded: 1 of 15 ms',
    )
    // a bound at vitest's limit, and nothing else of the fixture past the rule
    expect(measured.filter((l) => l.includes('past the rule'))).toEqual([
      '[time] past the rule of MOL-243 — 1, see CLAUDE.md › Testing:',
    ])
    expect(measured.filter((l) => l.includes('not below'))).toEqual([
      "[time] bin/test-time-reporter.fixture.ts › inner > keeps what it bounded: a bound on the clock of 5 000 ms is not below the test's timeout of 5 000 — vitest, not the test, would hold it",
    ])
  }, 60_000)
})
