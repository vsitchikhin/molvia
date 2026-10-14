// The rule of MOL-243 held on every run (MOL-266): a test, a hook or a bound on the clock whose time,
// taken five times, passes its limit is named here. The rule lives in `CLAUDE.md` › Testing; this is
// what makes a new test past it seen on its own run rather than once a busy runner has turned it red
// on somebody else's pull request.
//
// What is measured, and against what:
//   - a test — its duration, `beforeEach` and `afterEach` with it, against its timeout;
//   - `beforeAll` and `afterAll` — from the worker's own marks on the runner's tasks (an experimental
//     door of vitest, held by this file's test): a suite's start to its first child's, its last
//     child's end to its own — against the hook's own timeout, read from the file, or the project's
//     `hookTimeout`. The reporter's own hook events come in batches, 100–200 ms late;
//   - a bound on the clock — what `expectWithin` kept in the test's meta: the duration against the
//     bound, and the bound against the test's timeout, which must stand above it.
//
// A breach is printed always, and fails the run only where `fail` says so — on CI. The durations of
// every bound and of every hook past a fifth of a second are printed too: the log of CI is what the
// next measure is taken from.

import { readFileSync } from 'node:fs'
import { relative } from 'node:path'
import ts from 'typescript'
import type { RunnerTask, RunnerTestFile } from 'vitest'
import { experimental_getRunnerTask as runnerTaskOf } from 'vitest/node'
import type { Reporter, TestCase, TestModule } from 'vitest/node'

/** The rule's own number: a limit stands at least this many times above the time it bounds. */
export const TIMES = 5

/** A hook is printed past this, as vitest prints a slow test. */
const HOOK_PRINTED_MS = 300

export type Measured = 'test' | 'beforeAll' | 'afterAll' | 'clock' | 'bound'

export interface Breach {
  readonly what: Measured
  readonly file: string
  readonly name: string
  /** What was measured — for `bound`, the bound itself. */
  readonly ms: number
  /** What it is held against — for `bound`, the test's timeout. */
  readonly limit: number
}

interface ClockBound {
  readonly elapsed: number
  readonly bound: number
}

const isClockBound = (value: unknown): value is ClockBound =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as ClockBound).elapsed === 'number' &&
  typeof (value as ClockBound).bound === 'number'

/** What one test breaks: its time against its timeout, and each of its bounds on the clock. */
export function testBreaches(
  file: string,
  name: string,
  duration: number,
  timeout: number,
  clockBounds: readonly ClockBound[],
): Breach[] {
  const found: Breach[] = []
  if (duration * TIMES > timeout)
    found.push({ what: 'test', file, name, ms: duration, limit: timeout })
  for (const { elapsed, bound } of clockBounds) {
    if (elapsed * TIMES > bound)
      found.push({ what: 'clock', file, name, ms: elapsed, limit: bound })
    if (bound >= timeout) found.push({ what: 'bound', file, name, ms: bound, limit: timeout })
  }
  return found
}

export interface HookTime {
  readonly kind: 'beforeAll' | 'afterAll'
  /** The suites from the file down, by name; empty for the file's own hooks. */
  readonly path: readonly string[]
  readonly ms: number
}

const started = (task: RunnerTask): number | undefined => task.result?.startTime
const ended = (task: RunnerTask): number | undefined =>
  task.result?.startTime === undefined || task.result.duration === undefined
    ? undefined
    : task.result.startTime + task.result.duration

/**
 * How long each suite's `beforeAll` and `afterAll` ran, from the marks the worker put on the tasks:
 * the gap before a suite's first child started and after its last one ended. A suite with no hooks
 * shows a gap of a millisecond or so, which nobody reads.
 */
export function hookTimes(file: RunnerTestFile): HookTime[] {
  const times: HookTime[] = []
  const walk = (suite: RunnerTask, path: readonly string[]): void => {
    if (suite.type !== 'suite') return
    const children = suite.tasks.filter((child) => started(child) !== undefined)
    const begun = started(suite)
    const over = ended(suite)
    const first = children.map(started).filter((at) => at !== undefined)
    const last = children.map(ended).filter((at) => at !== undefined)
    if (begun !== undefined && first.length > 0) {
      times.push({ kind: 'beforeAll', path, ms: Math.min(...first) - begun })
    }
    if (over !== undefined && last.length > 0) {
      times.push({ kind: 'afterAll', path, ms: over - Math.max(...last) })
    }
    for (const child of suite.tasks) walk(child, [...path, child.name])
  }
  walk(file, [])
  return times
}

/**
 * The timeouts a file gives its `beforeAll` and `afterAll` itself, by the path of suites they stand
 * in: `beforeAll(fn, 60_000)`, a constant of the file in that place, or `{ timeout }`. A suite named
 * by a template is matched with its substitutions read as anything.
 */
export function ownHookTimeouts(
  source: string,
  fileName = 'test.ts',
): { kind: HookTime['kind']; path: readonly RegExp[]; timeout: number }[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true)
  const constants = new Map<string, number>()
  const numberOf = (node: ts.Expression | undefined): number | undefined => {
    if (!node) return undefined
    if (ts.isNumericLiteral(node)) return Number(node.text.replace(/_/g, ''))
    if (ts.isIdentifier(node)) return constants.get(node.text)
    if (ts.isObjectLiteralExpression(node)) {
      const timeout = node.properties.find(
        (p): p is ts.PropertyAssignment =>
          ts.isPropertyAssignment(p) && p.name.getText(sf) === 'timeout',
      )
      return numberOf(timeout?.initializer)
    }
    return undefined
  }
  const collect = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const value = numberOf(node.initializer)
      if (value !== undefined) constants.set(node.name.text, value)
    }
    ts.forEachChild(node, collect)
  }
  collect(sf)

  const titleOf = (node: ts.Expression | undefined): RegExp | undefined => {
    if (!node) return undefined
    const parts =
      ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
        ? [node.text]
        : ts.isTemplateExpression(node)
          ? [node.head.text, ...node.templateSpans.map((span) => span.literal.text)]
          : undefined
    if (!parts) return undefined
    const escape = (part: string): string => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`^${parts.map(escape).join('.*')}$`, 's')
  }
  const found: { kind: HookTime['kind']; path: readonly RegExp[]; timeout: number }[] = []
  const walk = (node: ts.Node, path: readonly RegExp[]): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(sf).split('.')[0]
      if (callee === 'describe') {
        const title = titleOf(node.arguments[0])
        if (title) {
          ts.forEachChild(node, (child) => {
            walk(child, [...path, title])
          })
          return
        }
      }
      if (callee === 'beforeAll' || callee === 'afterAll') {
        const timeout = numberOf(node.arguments[1])
        if (timeout !== undefined) found.push({ kind: callee, path, timeout })
      }
    }
    ts.forEachChild(node, (child) => {
      walk(child, path)
    })
  }
  walk(sf, [])
  return found
}

const samePath = (names: readonly string[], patterns: readonly RegExp[]): boolean =>
  names.length === patterns.length && names.every((name, at) => patterns[at]?.test(name))

/** Thousands parted by a plain space, as the project writes them — never the locale's no-break one. */
const number = (ms: number): string => String(Math.round(ms)).replace(/\B(?=(\d{3})+$)/g, ' ')

export function describeBreach(breach: Breach): string {
  const where = `${breach.file} › ${breach.name}`
  const need = number(breach.ms * TIMES)
  switch (breach.what) {
    case 'test':
      return `${where}: the test took ${number(breach.ms)} ms against its timeout of ${number(breach.limit)} — give it at least ${need}`
    case 'beforeAll':
    case 'afterAll':
      return `${where}: ${breach.what} took ${number(breach.ms)} ms against its timeout of ${number(breach.limit)} — give it at least ${need}`
    case 'clock':
      return `${where}: a bound on the clock of ${number(breach.limit)} ms was met at ${number(breach.ms)} — the bound needs at least ${need}, or the work held otherwise`
    case 'bound':
      return `${where}: a bound on the clock of ${number(breach.ms)} ms is not below the test's timeout of ${number(breach.limit)} — vitest, not the test, would hold it`
  }
}

export default class TestTimeReporter implements Reporter {
  private readonly breaches: Breach[] = []
  private readonly measured: string[] = []
  private readonly fail: boolean
  private readonly root = process.cwd()

  constructor(options: { fail?: boolean } = {}) {
    this.fail = options.fail ?? false
  }

  private fileOf(moduleId: string): string {
    return relative(this.root, moduleId)
  }

  onTestCaseResult(test: TestCase): void {
    const diagnostic = test.diagnostic()
    const timeout = test.options.timeout
    if (!diagnostic || timeout === undefined) return
    const file = this.fileOf(test.module.moduleId)
    const bounds = (test.meta().clockBounds ?? []).filter(isClockBound)
    for (const { elapsed, bound } of bounds) {
      this.measured.push(
        `clock ${file} › ${test.fullName}: ${number(elapsed)} of ${number(bound)} ms`,
      )
    }
    this.breaches.push(...testBreaches(file, test.fullName, diagnostic.duration, timeout, bounds))
  }

  onTestModuleEnd(module: TestModule): void {
    const file = this.fileOf(module.moduleId)
    const limit = module.project.config.hookTimeout
    let own: ReturnType<typeof ownHookTimeouts> | undefined
    for (const hook of hookTimes(runnerTaskOf(module))) {
      if (hook.ms <= HOOK_PRINTED_MS && hook.ms * TIMES <= limit) continue
      own ??= ownHookTimeouts(readFileSync(module.moduleId, 'utf8'), module.moduleId)
      const timeout =
        own.find((h) => h.kind === hook.kind && samePath(hook.path, h.path))?.timeout ?? limit
      const name = hook.path.length > 0 ? hook.path.join(' › ') : '(file)'
      this.measured.push(
        `${hook.kind} ${file} › ${name}: ${number(hook.ms)} of ${number(timeout)} ms`,
      )
      if (hook.ms * TIMES > timeout) {
        this.breaches.push({ what: hook.kind, file, name, ms: hook.ms, limit: timeout })
      }
    }
  }

  onTestRunEnd(): void {
    const log = (line: string): void => {
      process.stdout.write(`${line}\n`)
    }
    if (this.measured.length > 0) {
      log(
        `\n[time] what the rule of MOL-243 measures beside the tests (${String(this.measured.length)}):`,
      )
      for (const line of this.measured) log(`[time] ${line}`)
    }
    if (this.breaches.length === 0) return
    log(
      `\n[time] past the rule of MOL-243 — ${String(this.breaches.length)}, see CLAUDE.md › Testing:`,
    )
    for (const breach of this.breaches) {
      const text = describeBreach(breach)
      log(`[time] ${text}`)
      if (process.env.GITHUB_ACTIONS)
        log(`::${this.fail ? 'error' : 'warning'} file=${breach.file}::${text}`)
    }
    if (this.fail) process.exitCode = 1
  }
}
