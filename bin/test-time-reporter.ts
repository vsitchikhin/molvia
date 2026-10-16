// The rule of MOL-243 held on every run (MOL-266): a test, a hook or a bound on the clock whose time,
// taken ten times, passes its limit is named here. The rule lives in `CLAUDE.md` › Testing; this is
// what makes a new test past it seen on its own run rather than once a busy runner has turned it red
// on somebody else's pull request.
//
// What is measured, and against what:
//   - a test — its duration, `beforeEach`, `afterEach` and `aroundEach` with it, against its timeout;
//     vitest gives those hooks no time of their own to read, so a slow `beforeEach` behind a test of a
//     long timeout is not told from the test (the price, in `workspace.md`); a timeout of 0 is none;
//   - `beforeAll` and `afterAll` — from the worker's own marks on the runner's tasks (an experimental
//     door of vitest, held by this file's test): a suite's start to its first child's, its last
//     child's end to its own — so the sum of the suite's hooks of that kind and of its `aroundAll`,
//     whose setup and teardown fall there, against the sum of their own timeouts, read from the file
//     (`hookLimit`), or the project's `hookTimeout`; one the parse cannot read is held as the
//     project's, and the advice asks for a number; a timeout of 0 or `Infinity` is none. The
//     reporter's own hook events come in batches, 100–200 ms late;
//   - a bound on the clock — what `expectWithin` kept in the test's meta: the duration against the
//     bound, and the bound against the test's timeout, which must stand above it; one met with every
//     clock fake is printed and held to nothing.
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
  /** A hook whose own timeout the parse could not read, held as the project's. */
  readonly unread?: boolean
  /** The suite's `aroundAll` stands in the sum of a `beforeAll` or `afterAll`. */
  readonly around?: boolean
}

interface ClockBound {
  readonly elapsed: number
  readonly bound: number
  /** Met with every clock fake: no duration (`expectWithin`). */
  readonly fake?: true
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
  for (const { elapsed, bound, fake } of clockBounds) {
    if (fake) continue
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

/** A `beforeAll`, `afterAll` or `aroundAll` of the file, as the parse reads it. */
export interface HookTimeout {
  readonly kind: HookTime['kind'] | 'aroundAll'
  /** The suites it stands in, by their titles; `null` — a helper of the file registers it, anywhere. */
  readonly path: readonly RegExp[] | null
  /** Whether every title on the path is a plain string: the hook's suite, not a guess at it. */
  readonly exact: boolean
  /** Its own timeout, `Infinity` for none; `null` — not given, the project's; `'unread'` — one the parse cannot read. */
  readonly timeout: number | null | 'unread'
}

/** One file as a program of its own, with nothing to resolve: enough for the binder to name its symbols. */
function bind(fileName: string, source: string): { sf: ts.SourceFile; checker: ts.TypeChecker } {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true)
  const options: ts.CompilerOptions = { noLib: true, noResolve: true, types: [] }
  const host = ts.createCompilerHost(options)
  host.getSourceFile = (name) => (name === fileName ? sf : undefined)
  host.fileExists = (name) => name === fileName
  host.readFile = (name) => (name === fileName ? source : undefined)
  return { sf, checker: ts.createProgram([fileName], options, host).getTypeChecker() }
}

/**
 * Every `beforeAll`, `afterAll` and `aroundAll` a file declares, with the timeout it gives itself: a
 * number, arithmetic on numbers and the file's constants (`2 * 60_000`) — read by the binder, each in
 * its own scope — or `{ timeout }`; 0 and `Infinity` are none, as vitest reads them; none given, or
 * `undefined`, is the project's. Anything else is `'unread'`: the limit is a number, and the reporter
 * says so rather than guess. A suite is `describe` or `suite`; one named by a template or by `each`'s
 * placeholders is matched with them read as anything, one named by an expression (`X.name`) as
 * anything at all — neither exact. A hook in a function of the file, a helper, stands in the suite
 * the helper is called in, beside the suite's own (review №14, adversarial В5), and in a suite the
 * helper declares, under it (review №16, Г5); one whose helper is called nowhere the parse sees stands
 * wherever it may.
 */
export function ownHookTimeouts(source: string, fileName = 'test.ts'): HookTimeout[] {
  const { sf, checker } = bind(fileName, source)
  // vitest's own word: a timeout of 0 or less, or Infinity, is no timeout at all (adversarial В5)
  const none = (ms: number): number => (ms > 0 && Number.isFinite(ms) ? ms : Infinity)
  const numberOf = (node: ts.Expression, depth = 0): number | null | 'unread' => {
    if (depth > 20) return 'unread'
    if (ts.isNumericLiteral(node)) return none(Number(node.text.replace(/_/g, '')))
    if (/^(Number\.POSITIVE_)?INFINITY$|^Infinity$/.test(node.getText(sf))) return Infinity
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node))
      return numberOf(node.expression, depth + 1)
    if (ts.isIdentifier(node)) {
      if (node.text === 'undefined') return null
      const declaration = checker.getSymbolAtLocation(node)?.valueDeclaration
      return declaration && ts.isVariableDeclaration(declaration) && declaration.initializer
        ? numberOf(declaration.initializer, depth + 1)
        : 'unread'
    }
    if (ts.isBinaryExpression(node)) {
      const left = numberOf(node.left, depth + 1)
      const right = numberOf(node.right, depth + 1)
      if (typeof left !== 'number' || typeof right !== 'number') return 'unread'
      switch (node.operatorToken.kind) {
        case ts.SyntaxKind.AsteriskToken:
          return none(left * right)
        case ts.SyntaxKind.PlusToken:
          return none(left + right)
        case ts.SyntaxKind.MinusToken:
          return none(left - right)
        case ts.SyntaxKind.SlashToken:
          return none(left / right)
        default:
          return 'unread'
      }
    }
    if (ts.isObjectLiteralExpression(node)) {
      const timeout = node.properties.find(
        (p): p is ts.PropertyAssignment =>
          ts.isPropertyAssignment(p) && p.name.getText(sf) === 'timeout',
      )
      return timeout ? numberOf(timeout.initializer, depth + 1) : null
    }
    return 'unread'
  }

  const ANYTHING = /^.*$/s
  // each's placeholders — %s, %d, %#, $name, $0.a — read as anything, as a template's substitutions are
  const PLACEHOLDER = /%[sdifjoOc#$]|\$[\w.]+/g
  const titleOf = (node: ts.Expression | undefined): { title: RegExp; exact: boolean } => {
    if (!node) return { title: ANYTHING, exact: false }
    const parts =
      ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
        ? [node.text]
        : ts.isTemplateExpression(node)
          ? [node.head.text, ...node.templateSpans.map((span) => span.literal.text)]
          : undefined
    if (!parts) return { title: ANYTHING, exact: false }
    const escape = (part: string): string => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const each = (part: string): string => part.split(PLACEHOLDER).map(escape).join('.*')
    const exact = parts.length === 1 && !PLACEHOLDER.test(parts[0] ?? '')
    PLACEHOLDER.lastIndex = 0
    return { title: new RegExp(`^${parts.map(each).join('.*')}$`, 's'), exact }
  }
  const HOOKS = ['beforeAll', 'afterAll', 'aroundAll'] as const
  type Kind = (typeof HOOKS)[number]
  const hookKind = (call: ts.CallExpression): Kind | undefined =>
    HOOKS.find((kind) => kind === call.expression.getText(sf))
  const timeoutOf = (call: ts.CallExpression): HookTimeout['timeout'] => {
    const second = call.arguments[1]
    return second ? numberOf(second) : null
  }
  const isSuite = (call: ts.CallExpression): boolean =>
    /^(describe|suite)$/.test(call.expression.getText(sf).split('.')[0] ?? '')
  /** The function of this file a call names, if any: a helper whose hooks stand where it is called. */
  const helperOf = (call: ts.CallExpression): ts.FunctionLikeDeclaration | undefined => {
    const declaration = ts.isIdentifier(call.expression)
      ? checker.getSymbolAtLocation(call.expression)?.valueDeclaration
      : undefined
    if (declaration?.getSourceFile() !== sf) return undefined
    if (ts.isFunctionDeclaration(declaration)) return declaration
    const init = ts.isVariableDeclaration(declaration) ? declaration.initializer : undefined
    return init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) ? init : undefined
  }
  /** Helpers whose hooks were placed in a suite, so they stand nowhere else. */
  const placed = new Set<ts.Node>()
  interface Registered {
    readonly kind: Kind
    readonly timeout: HookTimeout['timeout']
    /** The suites the helper itself declares around it, from where it is called. */
    readonly path: readonly RegExp[]
    readonly exact: boolean
  }
  /**
   * The hooks a helper registers, in the suites it declares itself (review №16, adversarial Г5), its own
   * helpers' with them — by their calls only, so a function declared inside counts once.
   */
  const hooksOf = (fn: ts.FunctionLikeDeclaration, seen: Set<ts.Node>): Registered[] => {
    // `seen` is the helpers being walked, not those walked once: a helper called twice registers twice (№18)
    if (seen.has(fn) || !fn.body) return []
    seen.add(fn)
    placed.add(fn)
    const hooks: Registered[] = []
    const look = (node: ts.Node, path: readonly RegExp[], exact: boolean): void => {
      if (ts.isCallExpression(node)) {
        const kind = hookKind(node)
        if (kind) {
          hooks.push({ kind, timeout: timeoutOf(node), path, exact })
          return
        }
        if (isSuite(node)) {
          const { title, exact: plain } = titleOf(node.arguments[0])
          for (const argument of node.arguments)
            if (ts.isArrowFunction(argument) || ts.isFunctionExpression(argument))
              look(argument.body, [...path, title], exact && plain)
          return
        }
        const helper = helperOf(node)
        if (helper)
          for (const hook of hooksOf(helper, seen))
            hooks.push({ ...hook, path: [...path, ...hook.path], exact: exact && hook.exact })
      }
      // a function declared here registers its hooks where it is called
      if (
        ts.isFunctionDeclaration(node) ||
        (ts.isFunctionLike(node) && ts.isVariableDeclaration(node.parent))
      )
        return
      ts.forEachChild(node, (child) => {
        look(child, path, exact)
      })
    }
    look(fn.body, [], true)
    seen.delete(fn)
    return hooks
  }
  const found: HookTimeout[] = []
  /** Hooks inside a function of the file, kept until it is known whether their helper was placed. */
  const loose: { owner: ts.Node | undefined; hook: HookTimeout }[] = []
  const ownerOf = (node: ts.Node): ts.Node | undefined =>
    ts.findAncestor(
      node.parent,
      (n) =>
        ts.isFunctionDeclaration(n) ||
        ((ts.isArrowFunction(n) || ts.isFunctionExpression(n)) &&
          ts.isVariableDeclaration(n.parent)),
    )
  const walk = (node: ts.Node, path: readonly RegExp[], exact: boolean, helper: boolean): void => {
    if (ts.isCallExpression(node)) {
      if (isSuite(node)) {
        const { title, exact: plain } = titleOf(node.arguments[0])
        for (const argument of node.arguments) {
          // the suite's own callback is the suite, not a helper
          if (ts.isArrowFunction(argument) || ts.isFunctionExpression(argument))
            walk(argument.body, [...path, title], exact && plain && !helper, helper)
        }
        return
      }
      const kind = hookKind(node)
      if (kind) {
        const hook = {
          kind,
          path: helper ? null : path,
          exact: !helper && exact,
          timeout: timeoutOf(node),
        }
        if (helper) loose.push({ owner: ownerOf(node), hook })
        else found.push(hook)
      }
      // withDb() in a suite: the helper's hooks are the suite's
      const called = helper ? undefined : helperOf(node)
      if (called)
        for (const hook of hooksOf(called, new Set()))
          found.push({
            kind: hook.kind,
            path: [...path, ...hook.path],
            exact: exact && hook.exact,
            timeout: hook.timeout,
          })
    }
    // past a function of the file that is not a suite's own callback, a hook is a helper's
    const inner = helper || ts.isFunctionLike(node)
    ts.forEachChild(node, (child) => {
      walk(child, path, exact, inner)
    })
  }
  walk(sf, [], true, false)
  for (const { owner, hook } of loose) if (!owner || !placed.has(owner)) found.push(hook)
  return found
}

/**
 * The limit a measured `beforeAll` or `afterAll` of a suite is held to: every hook of that kind the
 * suite declares, and its `aroundAll`, since the worker's marks give their sum — each its own timeout,
 * or the project's; one with none makes the sum none, `Infinity`. The hooks of exactly that suite
 * first; else those of a suite guessed at (a template, `each`, an expression, a helper called nowhere
 * seen), the smallest of their sums where they differ (review №10). `unread` where one of them gives a
 * timeout the parse cannot read: it is held as the project's, and the advice says why; `around` where
 * an `aroundAll` is in the sum, so the breach names it.
 */
export function hookLimit(
  own: readonly HookTimeout[],
  kind: HookTime['kind'],
  names: readonly string[],
  project: number,
): { limit: number; unread: boolean; around: boolean } {
  const matches = (hook: HookTimeout): boolean =>
    (hook.kind === kind || hook.kind === 'aroundAll') &&
    (hook.path === null ||
      (hook.path.length === names.length && names.every((name, at) => hook.path?.[at]?.test(name))))
  const candidates = own.filter(matches)
  const exact = candidates.filter((hook) => hook.exact)
  const sum = (
    hooks: readonly HookTimeout[],
  ): { limit: number; unread: boolean; around: boolean } => ({
    limit: hooks.reduce(
      (total, hook) => total + (typeof hook.timeout === 'number' ? hook.timeout : project),
      0,
    ),
    unread: hooks.some((hook) => hook.timeout === 'unread'),
    around: hooks.some((hook) => hook.kind === 'aroundAll'),
  })
  const projects = { limit: project, unread: false, around: false }
  if (exact.length > 0) return sum(exact)
  if (candidates.length === 0) return projects
  // a guess: by where each came from, the hooks of one source summed, the smallest sum taken
  const bySource = new Map<string, HookTimeout[]>()
  for (const hook of candidates) {
    const source = hook.path === null ? 'helper' : hook.path.map(String).join('/')
    bySource.set(source, [...(bySource.get(source) ?? []), hook])
  }
  return [...bySource.values()].map(sum).sort((a, b) => a.limit - b.limit)[0] ?? projects
}

/**
 * Which breaches turn the run red: those in `files`, or every one, for the reason `all` gives; `said` is
 * the line the log opens the verdict with, so a run with no breach still shows the merge was read.
 */
export type RedScope =
  | { readonly files: ReadonlySet<string>; readonly said: string }
  | { readonly all: string; readonly said: string }

const git = (...args: string[]): string => execFileSync('git', args, { encoding: 'utf8' })

/**
 * The files of the pull request CI runs on. CI checks out the merge of the pull request into its
 * base, whose first parent is the base, so `HEAD^1..HEAD` is what the pull request changes —
 * `fetch-depth: 2` in `ci.yml` brings that parent. A push to master is no pull request: no file is
 * its own, and every breach there is a warning. Where the merge cannot be read, every breach is red,
 * and the log says why: a guard that went quiet would never be noticed.
 */
export function redScope(env: NodeJS.ProcessEnv = process.env, run = git): RedScope {
  const all = (why: string): RedScope => ({ all: why, said: `every breach counts: ${why}` })
  if (env.GITHUB_EVENT_NAME !== 'pull_request')
    return { files: new Set(), said: 'no pull request: every breach is a warning' }
  try {
    const parents = run('rev-list', '--parents', '-n', '1', 'HEAD').trim().split(/\s+/)
    if (parents.length !== 3) return all('HEAD is not the merge of the pull request')
    const files = run('diff', '--name-only', 'HEAD^1', 'HEAD').split('\n').filter(Boolean)
    return {
      files: new Set(files),
      said: `red only in the ${String(files.length)} files of the pull request`,
    }
  } catch (error) {
    return all(`the merge of the pull request could not be read (${String(error)})`)
  }
}

/** Thousands parted by a plain space, as the project writes them — never the locale's no-break one. */
const number = (ms: number): string => String(Math.round(ms)).replace(/\B(?=(\d{3})+$)/g, ' ')

/** A limit as the rule writes it: ten times the time, rounded up to 5 s (`workspace.md`). */
export const limitFor = (ms: number): number => Math.ceil((ms * TIMES) / 5_000) * 5_000

export function describeBreach(breach: Breach): string {
  const where = `${breach.file} › ${breach.name}`
  const need = number(limitFor(breach.ms))
  switch (breach.what) {
    case 'test':
      return `${where}: the test took ${number(breach.ms)} ms against its timeout of ${number(breach.limit)}, its beforeEach and afterEach included — give it ${need}`
    case 'beforeAll':
    case 'afterAll': {
      const hooks = breach.around ? `${breach.what} with aroundAll` : breach.what
      return breach.unread
        ? `${where}: ${hooks} took ${number(breach.ms)} ms, held to the project's ${number(breach.limit)}: its own timeout is not a number the reporter reads — write it as one, ${need}`
        : `${where}: ${hooks} took ${number(breach.ms)} ms against its timeout of ${number(breach.limit)} — give it ${need}`
    }
    case 'clock':
      return `${where}: a bound on the clock of ${number(breach.limit)} ms was met at ${number(breach.ms)} — the bound needs at least ${number(Math.ceil(breach.ms * TIMES))}, or the work held otherwise`
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
    for (const { elapsed, bound, fake } of bounds) {
      this.measured.push(
        `clock ${file} › ${test.fullName}: ${number(elapsed)} of ${number(bound)} ms${fake ? ', every clock fake — held to nothing' : ''}`,
      )
    }
    this.breaches.push(...testBreaches(file, test.fullName, diagnostic.duration, timeout, bounds))
  }

  onTestModuleEnd(module: TestModule): void {
    const file = this.fileOf(module.moduleId)
    const limit = module.project.config.hookTimeout
    let source: string | undefined
    let own: ReturnType<typeof ownHookTimeouts> | undefined
    for (const hook of hookTimes(runnerTaskOf(module))) {
      if (hook.ms <= HOOK_PRINTED_MS && hook.ms * TIMES <= limit) {
        // a quick hook is judged only where the file may give it a limit of its own (adversarial В6)
        source ??= readFileSync(module.moduleId, 'utf8')
        if (!/\b(beforeAll|afterAll|aroundAll)\s*\(/.test(source)) continue
      }
      own ??= ownHookTimeouts(source ?? readFileSync(module.moduleId, 'utf8'), module.moduleId)
      const { limit: timeout, unread, around } = hookLimit(own, hook.kind, hook.path, limit)
      const breach = hook.ms * TIMES > timeout
      if (hook.ms <= HOOK_PRINTED_MS && !breach) continue
      const name = hook.path.length > 0 ? hook.path.join(' › ') : '(file)'
      const of = Number.isFinite(timeout) ? `of ${number(timeout)} ms` : 'ms, no timeout'
      this.measured.push(
        `${hook.kind} ${file} › ${name}: ${number(hook.ms)} ${of}${unread ? ', its own not read' : ''}`,
      )
      if (breach) {
        this.breaches.push({
          what: hook.kind,
          file,
          name,
          ms: hook.ms,
          limit: timeout,
          unread,
          around,
        })
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
    const scope = this.scope
    if (scope) log(`\n[time] ${scope.said}`)
    if (this.breaches.length === 0) return
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
