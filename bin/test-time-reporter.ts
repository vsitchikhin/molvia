// The rule of MOL-243 held on every run (MOL-266): a test, a hook or a bound on the clock whose time,
// taken ten times, passes its limit is named here. The rule lives in `CLAUDE.md` › Testing; this is
// what makes a new test past it seen on its own run rather than once a busy runner has turned it red
// on somebody else's pull request.
//
// What is measured, and against what:
//   - a test — its duration, `beforeEach` and `afterEach` with it, against its timeout; vitest gives
//     those two hooks no time of their own to read, so a slow `beforeEach` behind a test of a long
//     timeout is not told from the test (the price, in `workspace.md`); a timeout of 0 is none;
//   - `beforeAll` and `afterAll` — from the worker's own marks on the runner's tasks (an experimental
//     door of vitest, held by this file's test): a suite's start to its first child's, its last
//     child's end to its own — against the hook's own timeout, read from the file, or the project's
//     `hookTimeout`; one the file gives but the parse cannot read is printed, never judged. The
//     reporter's own hook events come in batches, 100–200 ms late;
//   - a bound on the clock — what `expectWithin` kept in the test's meta: the duration against the
//     bound, and the bound against the test's timeout, which must stand above it.
//
// A breach is printed always, and fails the run only where `fail` says so — on CI — and only in a file
// the pull request changes (owner's decision В-4 «а», 15.10.2026): a run on a busy runner sets a new
// worst for some test now and then, and that is a red for whoever touches its file, never for a pull
// request that did not (`redScope`). The durations of every bound and of every hook past 300 ms are
// printed too: the log of CI is what the next measure is taken from.

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { relative } from 'node:path'
import ts from 'typescript'
import type { RunnerTask, RunnerTestFile } from 'vitest'
import { experimental_getRunnerTask as runnerTaskOf } from 'vitest/node'
import type { Reporter, TestCase, TestModule } from 'vitest/node'

/** The rule's own number: a limit stands at least this many times above the time it bounds. */
export const TIMES = 10

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
  // vitest's own word: a timeout of 0 or Infinity is no timeout at all (adversarial А8)
  const timed = timeout > 0 && Number.isFinite(timeout)
  if (timed && duration * TIMES > timeout)
    found.push({ what: 'test', file, name, ms: duration, limit: timeout })
  for (const { elapsed, bound } of clockBounds) {
    if (elapsed * TIMES > bound)
      found.push({ what: 'clock', file, name, ms: elapsed, limit: bound })
    if (timed && bound >= timeout)
      found.push({ what: 'bound', file, name, ms: bound, limit: timeout })
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
 * in: `beforeAll(fn, 60_000)`, arithmetic on numbers and the file's constants (`2 * 60_000`), or
 * `{ timeout }`. A suite named by a template or by `each`'s placeholders is matched with them read as
 * anything, a suite named by an expression (`X.name`) as anything at all. A timeout given but not
 * read — an imported constant — is `undefined`: the hook has one of its own, unknown.
 */
export function ownHookTimeouts(
  source: string,
  fileName = 'test.ts',
): { kind: HookTime['kind']; path: readonly RegExp[]; timeout: number | undefined }[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true)
  const constants = new Map<string, number>()
  const numberOf = (node: ts.Expression | undefined): number | undefined => {
    if (!node) return undefined
    if (ts.isNumericLiteral(node)) return Number(node.text.replace(/_/g, ''))
    if (ts.isIdentifier(node)) return constants.get(node.text)
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node))
      return numberOf(node.expression)
    if (ts.isBinaryExpression(node)) {
      const left = numberOf(node.left)
      const right = numberOf(node.right)
      if (left === undefined || right === undefined) return undefined
      switch (node.operatorToken.kind) {
        case ts.SyntaxKind.AsteriskToken:
          return left * right
        case ts.SyntaxKind.PlusToken:
          return left + right
        case ts.SyntaxKind.MinusToken:
          return left - right
        case ts.SyntaxKind.SlashToken:
          return left / right
        default:
          return undefined
      }
    }
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
  // twice: a constant may be made of one declared below it
  collect(sf)
  collect(sf)

  const ANYTHING = /^.*$/s
  // each's placeholders — %s, %d, %#, $name, $0.a — read as anything, as a template's substitutions are
  const PLACEHOLDER = /%[sdifjoOc#$]|\$[\w.]+/g
  const titleOf = (node: ts.Expression | undefined): RegExp => {
    if (!node) return ANYTHING
    const parts =
      ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
        ? [node.text]
        : ts.isTemplateExpression(node)
          ? [node.head.text, ...node.templateSpans.map((span) => span.literal.text)]
          : undefined
    if (!parts) return ANYTHING
    const escape = (part: string): string => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const each = (part: string): string => part.split(PLACEHOLDER).map(escape).join('.*')
    return new RegExp(`^${parts.map(each).join('.*')}$`, 's')
  }
  const found: { kind: HookTime['kind']; path: readonly RegExp[]; timeout: number | undefined }[] =
    []
  const walk = (node: ts.Node, path: readonly RegExp[]): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(sf).split('.')[0]
      if (callee === 'describe') {
        const title = titleOf(node.arguments[0])
        ts.forEachChild(node, (child) => {
          walk(child, [...path, title])
        })
        return
      }
      if ((callee === 'beforeAll' || callee === 'afterAll') && node.arguments[1]) {
        found.push({ kind: callee, path, timeout: numberOf(node.arguments[1]) })
      }
    }
    ts.forEachChild(node, (child) => {
      walk(child, path)
    })
  }
  walk(sf, [])
  return found
}

/** Which breaches turn the run red: those in `files`, or every one, for the reason `all` gives. */
export type RedScope = { readonly files: ReadonlySet<string> } | { readonly all: string }

const git = (...args: string[]): string => execFileSync('git', args, { encoding: 'utf8' })

/**
 * The files of the pull request CI runs on. CI checks out the merge of the pull request into its
 * base, whose first parent is the base, so `HEAD^1..HEAD` is what the pull request changes —
 * `fetch-depth: 2` in `ci.yml` brings that parent. A push to master is no pull request: no file is
 * its own, and every breach there is a warning. Where the merge cannot be read, every breach is red,
 * and the log says why: a guard that went quiet would never be noticed.
 */
export function redScope(env: NodeJS.ProcessEnv = process.env, run = git): RedScope {
  if (env.GITHUB_EVENT_NAME !== 'pull_request') return { files: new Set() }
  try {
    const parents = run('rev-list', '--parents', '-n', '1', 'HEAD').trim().split(/\s+/)
    if (parents.length !== 3) return { all: 'HEAD is not the merge of the pull request' }
    const files = run('diff', '--name-only', 'HEAD^1', 'HEAD').split('\n').filter(Boolean)
    return { files: new Set(files) }
  } catch (error) {
    return { all: `the merge of the pull request could not be read (${String(error)})` }
  }
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
      return `${where}: the test took ${number(breach.ms)} ms against its timeout of ${number(breach.limit)}, its beforeEach and afterEach included — give it at least ${need}`
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
  private readonly scope: RedScope | undefined
  private readonly root = process.cwd()

  constructor(options: { fail?: boolean; scope?: RedScope } = {}) {
    this.fail = options.fail ?? false
    this.scope = this.fail ? (options.scope ?? redScope()) : undefined
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
      const given = own.find((h) => h.kind === hook.kind && samePath(hook.path, h.path))
      const name = hook.path.length > 0 ? hook.path.join(' › ') : '(file)'
      if (given && given.timeout === undefined) {
        // its own timeout, which the parse cannot read: held against nothing rather than a wrong 10 s
        this.measured.push(
          `${hook.kind} ${file} › ${name}: ${number(hook.ms)} ms of its own timeout, not read`,
        )
        continue
      }
      const timeout = given?.timeout ?? limit
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
    const scope = this.scope
    const isRed = (breach: Breach): boolean =>
      scope !== undefined && ('all' in scope || scope.files.has(breach.file))
    const red = this.breaches.filter(isRed)
    const warned = this.breaches.filter((breach) => !isRed(breach))
    const print = (title: string, breaches: Breach[], level: 'error' | 'warning'): void => {
      if (breaches.length === 0) return
      log(`\n[time] ${title} — ${String(breaches.length)}, see CLAUDE.md › Testing:`)
      for (const breach of breaches) {
        const text = describeBreach(breach)
        log(`[time] ${text}`)
        if (process.env.GITHUB_ACTIONS) log(`::${level} file=${breach.file}::${text}`)
      }
    }
    if (scope && 'all' in scope) log(`\n[time] every breach counts: ${scope.all}`)
    print('past the rule of MOL-243', red, 'error')
    print(
      scope
        ? 'past the rule of MOL-243 outside the files of the pull request, a warning'
        : 'past the rule of MOL-243',
      warned,
      'warning',
    )
    if (red.length > 0) process.exitCode = 1
  }
}
