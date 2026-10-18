// Refuses a bound on a duration a test asserts other than through `expectWithin` (MOL-266): the time
// reporter (`bin/test-time-reporter.ts`) holds a bound to ten times what it met and below the test's
// timeout only where `expectWithin` kept it, so a bound written as `expect(t1 - t0).toBeLessThan(N)`
// would be a bound on the clock the rule of MOL-243 never sees.
//
// Found by parsing, never by a line's pattern — a pattern missed three of eighteen (review of MOL-243,
// Р10-А1). Names are resolved by TypeScript's own binder, so a name reads the clock only in its own
// scope: the age of a stamp held under a name another test gave a reading is left alone.
//
// A reading of the clock: `performance.now()`, `Date.now()`, `process.hrtime()` and its `bigint()`,
// `new Date()` and its `getTime()`, through `globalThis`, `Number()`, `Math.floor(… / 1000)`, under another
// name (`perf_hooks`' and `node:process`' own, `{ now } = Date`, `.bind`); a function of the file that
// returns one (`const now = () => performance.now()`); a name, a field, a field of a class
// (`this.start`) or a shorthand field given one; an array of them — pushed, by index, `at()`. A duration:
// a subtraction of two readings, or of a deadline from a reading, and whatever is made of it — a name, a
// field, an object or array it is put in (`=`, `+=`, `push`) or taken apart from, a function of the file,
// a method or a getter that returns it, a call of one that subtracts a reading it takes from the clock
// however it rounds (`since(t0)`), `process.hrtime(t0)`, `performance.measure()`. A budget is a duration
// taken from a number (`200 - d`, `left -= d`, `deadline - Date.now()`) or divided into one (a rate,
// `1000 / ms`), kept through `Math.max` and `Math.min`, and a lower bound on it is an upper bound on the
// duration.
//
// Refused is an upper bound on a duration, and a lower bound on a budget — `toBeLessThan`,
// `toBeLessThanOrEqual`, chai's `lessThan`, `below`, `lt`, `lte`, `most`, `within`, `toBeCloseTo`; `not`
// before a lower bound; a lower bound with the duration on the other side; a comparison under `expect`,
// `expect.soft` or any `assert`, asserted true or false (`toBe(false)`, `isFalse`, `!`, `&&`); `toSatisfy`
// with a comparison, inline or a function of the file; `if (d > n)` that throws or fails; a call of a
// function of the file that bounds its parameter so — and a deadline: a reading bounded by a reading plus
// a number (`expect(Date.now()).toBeLessThan(deadline)`). A lower bound is no breach of time, two readings
// against each other included; the age of a stamp — the clock against a moment a row holds — is no
// duration, as one side is not the clock; and a bound where every clock it reads is one
// `vi.useFakeTimers()` holds still is not one either: no runner moves fake time. What fakes a clock at a
// bound is read in the order vitest runs it, and in doubt a clock is real — a bound refused here is still
// lawful through `expectWithin`: the file's body whole, then its suites' bodies, as vitest collects
// them, then `beforeAll` — both only where no other test, no hook but its own, nothing they call and
// not the test itself, which may run again, touches the timers — `beforeEach` in the order registered,
// a helper's too, the test's own statements before the bound, a helper of the file they call; what may
// not run (a branch, a loop, a try) keeps only what both ways hold, a finally always runs, and anything
// else that may touch the timers — `? :`, `&&`, a callback handed to a call — lets them go; a bound in
// a hook, a helper, `onTestFinished`, a callback not awaited where it is written or one handed to a
// function that touches the timers starts from real clocks. And all of it only in a file that touches
// the timers in ways read in order — each a call, in the file's body, a callback or a function of the
// file — with no reference handed over or kept, no string, method or class, no hook or test under
// another name, no fixture, no `vi.setConfig`, no `it.beforeEach`, no timer call kept by a call for
// later — written there or a function of the file named anywhere but as a call or a hook's — no
// concurrent tests, by `.concurrent` or the options, no options under a name, and no config of its
// directory that names `fakeTimers`, `concurrent` or `extends`, reads a file or takes settings from a file
// of the repository, or has a setup file that touches them or imports what does, or loads a module any
// way but a static import; no clock put back by hand or by another name (a member of `vi`, a property
// definer, the global object referred to but not read through), nothing that touches the timers in a
// default of a parameter, no command line that gives vitest a setting: else no bound there is let go. A callback runs where it is written only for a call known to run it before it returns
// — a `then` only on what touches no timers. `useRealTimers()` lets go, `toFake` and `toNotFake` choose,
// `shouldAdvanceTime` and a tick mode but `manual` move fake time with the real one, options not read
// whole leave every clock real; a clock taken under another name keeps the real one.
//
// The price, named (`workspace.md`): what is not in the lists above is not seen — a duration the code
// under test measures (`metrics`' lag), a helper imported from another file, a reading kept in a
// structure the lists do not name, a fake clock turned on by a helper of another file, by an earlier test,
// by a hook a helper registers or outside what is read for sure (held as real). Those go to
// `expectWithin`, or are left, by review.
//
//   node bin/check-clock-bounds.mjs

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import process from 'node:process'
import ts from 'typescript'

/** The files a vitest run reads: tests, the helpers beside the integration tests, a package's test helpers. */
const FILES = ['*.test.ts', '*.test.mts', 'backend/tests/*.ts', 'packages/*/tests/*.ts']

/** A reading of the clock, with `globalThis.`, `window.` or `self.` taken off and other names resolved. */
const CLOCK = /^(performance\.now|Date\.now|process\.hrtime\.bigint|process\.hrtime)$/
/** What a reading is still a reading through: a cast, and whole seconds of it. */
const SAME = /^(Number|BigInt|Math\.(round|floor|ceil|trunc))$/
/** A duration the platform measures itself. */
const MEASURED = /^(performance\.measure|process\.hrtime)$/
/** What another name may stand for: a clock, or what holds one. */
const CLOCK_PATHS = new Set([
  'performance',
  'Date',
  'process',
  'process.hrtime',
  'performance.now',
  'Date.now',
  'process.hrtime.bigint',
])
/** The clocks of `vi.useFakeTimers({ toFake })`, by their names there. */
const CLOCKS = ['performance', 'Date', 'hrtime']
/** A matcher that bounds its subject from above — and, under `not`, from below. */
const UPPER = new Set([
  'toBeLessThan',
  'toBeLessThanOrEqual',
  'lessThan',
  'below',
  'lt',
  'lte',
  'most',
  'within',
  'toBeCloseTo',
])
/** A matcher that bounds its subject from below — and its argument from above. */
const LOWER = new Set([
  'toBeGreaterThan',
  'toBeGreaterThanOrEqual',
  'greaterThan',
  'above',
  'gt',
  'gte',
  'least',
])
/** What asserts its subject false: `expect(c).toBeFalsy()`, chai's `.false`. */
const FALSY = new Set(['toBeFalsy', 'false', 'notOk'])
/** What asserts its subject equal to its argument: `expect(c).toBe(false)`. */
const EQUAL = new Set(['toBe', 'toEqual', 'toStrictEqual', 'equal', 'equals', 'eq', 'eql'])
const EXPECT = new Set(['expect', 'expect.soft', 'chai.expect'])
const LESS = [ts.SyntaxKind.LessThanToken, ts.SyntaxKind.LessThanEqualsToken]
const MORE = [ts.SyntaxKind.GreaterThanToken, ts.SyntaxKind.GreaterThanEqualsToken]
const SUITE = /^(describe|suite)$/

/** One file as a program of its own, with nothing to resolve: enough for the binder to name its symbols. */
function bind(fileName, source) {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true)
  const options = { noLib: true, noResolve: true, types: [], allowJs: true }
  const host = ts.createCompilerHost(options)
  host.getSourceFile = (name) => (name === fileName ? sf : undefined)
  host.fileExists = (name) => name === fileName
  host.readFile = (name) => (name === fileName ? source : undefined)
  const checker = ts.createProgram([fileName], options, host).getTypeChecker()
  return { sf, checker }
}

/**
 * Every bound on a duration in one file that does not go through `expectWithin`, as `line: text`.
 * @param {string} fileName
 * @param {string} source
 * @param {{ setupTouchesTimers?: boolean }} [options] — a setup file of the run touches the timers
 * @returns {string[]}
 */
export function rawBounds(fileName, source, { setupTouchesTimers = false } = {}) {
  const { sf, checker } = bind(fileName, source)

  /** @type {Map<ts.Symbol, number>} */
  const ids = new Map()
  const keyOfSymbol = (symbol) => {
    if (!ids.has(symbol)) ids.set(symbol, ids.size)
    return `#${String(ids.get(symbol))}`
  }
  const symbolKey = (id) => {
    const symbol = checker.getSymbolAtLocation(id)
    return symbol ? keyOfSymbol(symbol) : `global:${id.text}`
  }
  const bare = (node) => {
    let n = node
    while (
      ts.isParenthesizedExpression(n) ||
      ts.isAsExpression(n) ||
      ts.isNonNullExpression(n) ||
      ts.isAwaitExpression(n) ||
      ts.isTypeAssertionExpression(n) ||
      ts.isSatisfiesExpression(n)
    )
      n = n.expression
    return n
  }
  /** Another name of a clock or of what holds one: `perf` of `perf_hooks`, `{ now } = Date`. */
  const aliases = new Map()
  /** An expression as text, another name of a clock resolved: `perf.now` is `performance.now`. */
  const resolvedText = (expression) => {
    let root = bare(expression)
    const rest = []
    while (ts.isPropertyAccessExpression(root)) {
      rest.unshift(root.name.text)
      root = bare(root.expression)
    }
    const alias = ts.isIdentifier(root) ? aliases.get(symbolKey(root)) : undefined
    const head = alias ? alias.path : root.getText(sf)
    return [head, ...rest]
      .join('.')
      .replace(/^(globalThis|window|self)\./, '')
      .replace(/\s+/g, '')
  }
  /** Whether an expression reaches a clock through a name that holds it whole, faked or not. */
  const heldThrough = (expression) => {
    let root = bare(expression)
    while (ts.isPropertyAccessExpression(root)) root = bare(root.expression)
    return ts.isIdentifier(root) && aliases.get(symbolKey(root))?.held === true
  }
  const calleeText = (call) => resolvedText(call.expression)
  const classKey = (node) => {
    let n = node.parent
    while (n && !ts.isClassLike(n)) n = n.parent
    return n?.name ? symbolKey(n.name) : undefined
  }
  /** An instance of a class of the file is keyed by its class, so `watch.elapsed` is `Stopwatch.elapsed`. */
  const instances = new Map()
  /** A name or a chain of fields from one, as a key its declaration shares; `undefined` for anything else. */
  const keyOf = (node) => {
    const n = bare(node)
    if (ts.isIdentifier(n)) {
      const key = symbolKey(n)
      return instances.get(key) ?? key
    }
    if (n.kind === ts.SyntaxKind.ThisKeyword) return classKey(n)
    if (ts.isPropertyAccessExpression(n)) {
      const root = keyOf(n.expression)
      return root === undefined ? undefined : `${root}.${n.name.text}`
    }
    return undefined
  }
  /** The key a function, a method or a getter is called by, from where it is declared. */
  const declaredKey = (fn) => {
    const parent = fn.parent
    if ((ts.isFunctionDeclaration(fn) || ts.isFunctionExpression(fn)) && fn.name)
      return symbolKey(fn.name)
    if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name))
      return symbolKey(parent.name)
    const accessor = ts.isMethodDeclaration(fn) || ts.isGetAccessorDeclaration(fn)
    if (accessor && ts.isClassLike(parent) && parent.name)
      return `${symbolKey(parent.name)}.${fn.name.getText(sf)}`
    if (ts.isPropertyDeclaration(parent) && ts.isClassLike(parent.parent) && parent.parent.name)
      return `${symbolKey(parent.parent.name)}.${parent.name.getText(sf)}`
    const member = accessor ? fn : ts.isPropertyAssignment(parent) ? parent : undefined
    const object = member?.parent
    if (
      member &&
      object &&
      ts.isObjectLiteralExpression(object) &&
      ts.isVariableDeclaration(object.parent) &&
      ts.isIdentifier(object.parent.name)
    )
      return `${symbolKey(object.parent.name)}.${member.name.getText(sf)}`
    return undefined
  }
  /** What a value is under the arithmetic that keeps its kind: `Math.round(x)`, `x / 1000`, `x * 1e-3`. */
  const core = (node) => {
    const n = bare(node)
    if (ts.isCallExpression(n) && SAME.test(calleeText(n)) && n.arguments.length === 1)
      return core(n.arguments[0])
    if (
      ts.isBinaryExpression(n) &&
      [ts.SyntaxKind.SlashToken, ts.SyntaxKind.AsteriskToken].includes(n.operatorToken.kind) &&
      ts.isNumericLiteral(bare(n.right))
    )
      return core(n.left)
    return n
  }

  const readings = new Set()
  /** Functions of the file that return a reading: `const now = () => performance.now()`. */
  const clocks = new Set()
  /** Names holding a reading plus a number: a deadline. */
  const deadlines = new Set()
  const carriers = new Set()
  /** Names holding a duration taken from a number: `left -= d`. */
  const budgets = new Set()
  /** Functions that return a duration. */
  const timers = new Set()
  /** Functions that subtract a parameter from the clock, by the parameter's place: `since(t0)`. */
  const since = new Map()
  /** Functions that bound a parameter from above, by its place: `within(d)`. */
  const bounders = new Map()
  /** Functions whose answer bounds their parameter — `above`, `below` or both: `(ms) => ms < 200`. */
  const predicates = new Map()

  const isNewDate = (node) => {
    const n = bare(node)
    return ts.isNewExpression(n) && resolvedText(n.expression) === 'Date' && !n.arguments?.length
  }
  const isReading = (node) => {
    const n = core(node)
    if (isNewDate(n)) return true
    if (ts.isCallExpression(n)) {
      const callee = calleeText(n)
      // process.hrtime() alone is a reading; with a reading it is a duration
      if (CLOCK.test(callee)) return callee !== 'process.hrtime' || n.arguments.length === 0
      const key = keyOf(n.expression)
      if (key !== undefined && clocks.has(key)) return true
      if (ts.isPropertyAccessExpression(n.expression)) {
        const method = n.expression.name.text
        // new Date().getTime(), started.getTime(), calls.at(-1)
        if (['getTime', 'valueOf', 'at'].includes(method)) return isReading(n.expression.expression)
      }
      return false
    }
    // +new Date()
    if (ts.isPrefixUnaryExpression(n) && n.operator === ts.SyntaxKind.PlusToken)
      return isReading(n.operand)
    // calls.at(-1) ?? Infinity
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
      return isReading(n.left)
    // marks[1]
    if (ts.isElementAccessExpression(n)) return isReading(n.expression)
    const key = keyOf(n)
    return key !== undefined && readings.has(key)
  }
  /** A reading plus a number, or a name given one: what a deadline is. */
  const isDeadline = (node) => {
    const n = core(node)
    if (ts.isBinaryExpression(n)) {
      const op = n.operatorToken.kind
      const either = (side) => isReading(side) || isDeadline(side)
      if (op === ts.SyntaxKind.PlusToken) return either(n.left) || either(n.right)
      if (op === ts.SyntaxKind.MinusToken)
        return either(n.left) && ts.isNumericLiteral(bare(n.right))
      return false
    }
    const key = ts.isIdentifier(n) || ts.isPropertyAccessExpression(n) ? keyOf(n) : undefined
    return key !== undefined && deadlines.has(key)
  }
  /** The place of a parameter of the function `fn` that `node` names, or -1. */
  const parameterAt = (node, fn) => {
    const n = bare(node)
    if (!ts.isIdentifier(n)) return -1
    const declaration = checker.getSymbolAtLocation(n)?.valueDeclaration
    return declaration && ts.isParameter(declaration) && declaration.parent === fn
      ? fn.parameters.indexOf(declaration)
      : -1
  }
  /**
   * Which way a value moves with a duration: 1 — a duration, a name, field or function that carries
   * one, a call that subtracts its reading from the clock, a duration the platform measured, anywhere in
   * it; -1 — a budget, a duration taken from a number; 0 — neither.
   */
  const sign = (node) => {
    const n = core(node)
    if (ts.isPrefixUnaryExpression(n) && n.operator === ts.SyntaxKind.MinusToken)
      return -sign(n.operand)
    if (ts.isBinaryExpression(n)) {
      const op = n.operatorToken.kind
      if (op === ts.SyntaxKind.MinusToken) {
        if (isReading(n.left) && (isReading(n.right) || isDeadline(n.right))) return 1
        if (isDeadline(n.left) && isReading(n.right)) return -1
        return sign(n.left) || -sign(n.right)
      }
      if (op === ts.SyntaxKind.PlusToken || op === ts.SyntaxKind.AsteriskToken) {
        const left = sign(n.left)
        const right = sign(n.right)
        return left === 1 || right === 1 ? 1 : left || right
      }
      // a rate: `1000 / ms` falls as the duration grows (adversarial Г4)
      if (op === ts.SyntaxKind.SlashToken) return sign(n.left) || -sign(n.right)
    }
    if (ts.isCallExpression(n)) {
      const callee = calleeText(n)
      // Math.max(0, deadline - Date.now()): each argument moves its answer the same way
      if (/^Math\.(max|min)$/.test(callee)) {
        const ways = n.arguments.map(sign)
        return ways.includes(1) ? 1 : ways.includes(-1) ? -1 : 0
      }
      if (MEASURED.test(callee) && (callee !== 'process.hrtime' || n.arguments.length > 0)) return 1
      const key = keyOf(n.expression)
      const places = key === undefined ? undefined : since.get(key)
      if (places?.some((place) => n.arguments[place] && isReading(n.arguments[place]))) return 1
    }
    if (ts.isIdentifier(n) || ts.isPropertyAccessExpression(n)) {
      const key = keyOf(n)
      if (key !== undefined && (carriers.has(key) || timers.has(key))) return 1
      if (key !== undefined && budgets.has(key)) return -1
      // a field's own name is no mention of anything
      return ts.isPropertyAccessExpression(n) && sign(n.expression) === 1 ? 1 : 0
    }
    let found = 0
    ts.forEachChild(n, (child) => {
      if (found === 0 && sign(child) === 1) found = 1
    })
    return found
  }
  const carries = (node) => sign(node) === 1

  /**
   * What an assertion that `node` is `truth` bounds, as pairs held `small < big`: `d < n` true, `d >= n`
   * false, `!`, and each side of `&&` asserted true or of `||` asserted false.
   */
  const asserted = (node, truth) => {
    const n = node && bare(node)
    if (!n) return []
    if (ts.isPrefixUnaryExpression(n) && n.operator === ts.SyntaxKind.ExclamationToken)
      return asserted(n.operand, !truth)
    if (!ts.isBinaryExpression(n)) return []
    const op = n.operatorToken.kind
    if (op === ts.SyntaxKind.AmpersandAmpersandToken)
      return truth ? [...asserted(n.left, true), ...asserted(n.right, true)] : []
    if (op === ts.SyntaxKind.BarBarToken)
      return truth ? [] : [...asserted(n.left, false), ...asserted(n.right, false)]
    const less = LESS.includes(op)
    if (!less && !MORE.includes(op)) return []
    return less === truth ? [{ small: n.left, big: n.right }] : [{ small: n.right, big: n.left }]
  }
  /** What `expect(c)` asserts `c` to be, by what follows it: `.toBe(false)`, `.not`, `.toBeFalsy()`. */
  const expectedTruth = (call) => {
    let truth = true
    for (let n = call; ts.isPropertyAccessExpression(n.parent) && n.parent.expression === n;) {
      n = n.parent
      const name = n.name.text
      if (name === 'not' || FALSY.has(name)) truth = !truth
      const asked = n.parent
      if (EQUAL.has(name) && ts.isCallExpression(asked) && asked.expression === n) {
        const value = asked.arguments[0] && bare(asked.arguments[0])
        if (value?.kind === ts.SyntaxKind.FalseKeyword) truth = !truth
      }
    }
    return truth
  }
  /** What `assert.…(c, …)` asserts `c` to be. */
  const assertedTruth = (callee, call) => {
    const method = callee.split('.').pop()
    if (['isFalse', 'notOk', 'isNotOk', 'isNotTrue'].includes(method)) return false
    const value = call.arguments[1] && bare(call.arguments[1])
    const negated = /^not/.test(method)
    if (value?.kind === ts.SyntaxKind.FalseKeyword) return negated
    if (value?.kind === ts.SyntaxKind.TrueKeyword) return !negated
    return true
  }
  /** Which way the answer of a check — `toSatisfy`'s, or a predicate of the file — bounds its parameter. */
  const parameterBounds = (fn) => {
    const answers = []
    if (ts.isBlock(fn.body)) {
      const returns = (n) => {
        if (ts.isReturnStatement(n) && n.expression) answers.push(n.expression)
        if (n !== fn.body && ts.isFunctionLike(n)) return
        ts.forEachChild(n, returns)
      }
      returns(fn.body)
    } else answers.push(fn.body)
    const ways = new Set()
    for (const { small, big } of answers.flatMap((answer) => asserted(answer, true))) {
      if (parameterAt(small, fn) === 0) ways.add('above')
      if (parameterAt(big, fn) === 0) ways.add('below')
    }
    return ways
  }

  const fails = (statement) => {
    let found = false
    const walk = (n) => {
      if (found) return
      if (ts.isThrowStatement(n)) found = true
      else if (ts.isCallExpression(n) && /(^|\.)fail$/.test(calleeText(n))) found = true
      else if (!ts.isFunctionLike(n)) ts.forEachChild(n, walk)
    }
    walk(statement)
    return found
  }

  /** What a node asserts, as pairs held `small < big`; a side left out is any value. */
  const boundedAbove = (node) => {
    // if (d > n) throw …, if (d > n) expect.fail(…)
    if (ts.isIfStatement(node) && fails(node.thenStatement)) return asserted(node.expression, false)
    const pairs = []
    if (!ts.isCallExpression(node)) return pairs
    const callee = calleeText(node)
    // expect(d < n).toBe(true), expect(d > n).toBe(false), expect.soft(n > d).toBeTruthy()
    if (EXPECT.has(callee)) pairs.push(...asserted(node.arguments[0], expectedTruth(node)))
    // assert(d < n), assert.isFalse(d > n), assert.strictEqual(d < n, true)
    if (/^(chai\.)?assert(\.\w+)?$/.test(callee))
      pairs.push(...asserted(node.arguments[0], assertedTruth(callee, node)))
    // assert.isBelow(d, n), assert.isAtMost(d, n), assert.isAbove(n, d), assert.isAtLeast(n, d)
    if (/^assert\.(isBelow|isAtMost)$/.test(callee) && node.arguments[0])
      pairs.push({ small: node.arguments[0], big: node.arguments[1] })
    if (/^assert\.(isAbove|isAtLeast)$/.test(callee) && node.arguments[1])
      pairs.push({ small: node.arguments[1], big: node.arguments[0] })
    // expect(d).….matcher(n)
    if (ts.isPropertyAccessExpression(node.expression)) {
      const matcher = node.expression.name.text
      let negated = false
      let subject = node.expression.expression
      while (ts.isPropertyAccessExpression(subject)) {
        if (subject.name.text === 'not') negated = !negated
        subject = subject.expression
      }
      if (ts.isCallExpression(subject) && EXPECT.has(calleeText(subject)) && subject.arguments[0]) {
        const [value] = subject.arguments
        const [argument] = node.arguments
        if (UPPER.has(matcher) && !negated) pairs.push({ small: value, big: argument })
        if (LOWER.has(matcher) && negated) pairs.push({ small: value, big: argument })
        if (LOWER.has(matcher) && !negated && argument) pairs.push({ small: argument, big: value })
        // not.toBeLessThan(n) bounds from below; toBeCloseTo bounds both ways, `not` neither
        if (UPPER.has(matcher) && negated !== (matcher === 'toBeCloseTo') && argument)
          pairs.push({ small: argument, big: value })
        // toSatisfy((ms) => ms < n), toSatisfy((ms) => { return ms < n }), toSatisfy(fast)
        const check = argument && bare(argument)
        if (matcher === 'toSatisfy' && check && !negated) {
          const inline = ts.isArrowFunction(check) || ts.isFunctionExpression(check)
          const key = inline ? undefined : keyOf(check)
          const ways = inline ? parameterBounds(check) : (predicates.get(key) ?? new Set())
          if (ways.has('above')) pairs.push({ small: value, big: undefined })
          if (ways.has('below')) pairs.push({ small: undefined, big: value })
        }
      }
    }
    return pairs
  }
  /** A pair that bounds a duration from above: the duration small, a budget big, or a deadline met. */
  const breaks = ({ small, big }) =>
    (small !== undefined && sign(small) === 1) ||
    (big !== undefined && sign(big) === -1) ||
    (small !== undefined && big !== undefined && isReading(small) && isDeadline(big))

  const enclosingFunction = (node) => {
    let n = node.parent
    while (n && !ts.isFunctionLike(n)) n = n.parent
    return n
  }
  const add = (map, key, at) => {
    const places = map.get(key) ?? []
    if (places.includes(at)) return false
    map.set(key, [...places, at])
    return true
  }
  /** What another name stands for, if it is a clock or holds one: `performance.now.bind(performance)`. */
  const clockPath = (node) => {
    const n = bare(node)
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      n.expression.name.text === 'bind'
    )
      return clockPath(n.expression.expression)
    if (!ts.isIdentifier(n) && !ts.isPropertyAccessExpression(n)) return undefined
    const path = resolvedText(n)
    if (/^(globalThis|window|self)$/.test(path)) return ''
    return CLOCK_PATHS.has(path) ? path : undefined
  }

  // Learn the readings, the carriers and the helpers until nothing new is learnt.
  for (let grown = true; grown;) {
    grown = false
    const learn = (key, set) => {
      if (key === undefined || set.has(key)) return
      set.add(key)
      grown = true
    }
    /** A name standing for a clock; `held` — it keeps the clock it was given, which no fake replaces. */
    const alias = (id, path, held) => {
      const key = symbolKey(id)
      if (aliases.get(key)?.path === path) return
      aliases.set(key, { path, held })
      grown = true
    }
    /** A value given to a name or a field: a reading, a duration, a budget or a deadline. */
    const given = (key, value) => {
      if (key === undefined || !value) return
      const v = bare(value)
      if (isReading(v)) learn(key, readings)
      else if (ts.isArrayLiteralExpression(v) && v.elements.some(isReading)) learn(key, readings)
      else if (sign(v) === 1) learn(key, carriers)
      else if (sign(v) === -1) learn(key, budgets)
      else if (isDeadline(v)) learn(key, deadlines)
    }
    const walk = (node) => {
      // import { performance as perf } from 'node:perf_hooks', import { hrtime } from 'node:process'
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        const from = node.moduleSpecifier.text.replace(/^node:/, '')
        const clause = node.importClause
        const bindings = clause?.namedBindings
        if (from === 'process' && clause?.name) alias(clause.name, 'process', false)
        if (from === 'process' && bindings && ts.isNamespaceImport(bindings))
          alias(bindings.name, 'process', false)
        if (bindings && ts.isNamedImports(bindings))
          for (const element of bindings.elements) {
            const name = (element.propertyName ?? element.name).text
            if (from === 'perf_hooks' && name === 'performance')
              alias(element.name, 'performance', true)
            if (from === 'process' && name === 'hrtime') alias(element.name, 'process.hrtime', true)
          }
      }
      if (ts.isVariableDeclaration(node) && node.initializer) {
        const path = clockPath(node.initializer)
        if (path !== undefined && ts.isIdentifier(node.name) && path !== '')
          // const perf = performance, const now = Date.now, const now = performance.now.bind(performance)
          alias(node.name, path, path !== 'process')
        else if (path !== undefined && ts.isObjectBindingPattern(node.name)) {
          // const { now } = Date, const { hrtime } = process, const { performance } = globalThis
          for (const element of node.name.elements) {
            const name = (element.propertyName ?? element.name).getText(sf)
            const whole = path === '' ? name : `${path}.${name}`
            if (CLOCK_PATHS.has(whole) && ts.isIdentifier(element.name))
              alias(element.name, whole, whole !== 'process')
          }
        } else if (ts.isIdentifier(node.name)) {
          given(symbolKey(node.name), node.initializer)
          const init = bare(node.initializer)
          const made = ts.isNewExpression(init) && ts.isIdentifier(init.expression)
          // a class of this file only: `new Date()` is a reading, not an instance
          if (
            made &&
            checker.getSymbolAtLocation(init.expression)?.valueDeclaration?.getSourceFile() ===
              sf &&
            ts.isClassLike(checker.getSymbolAtLocation(init.expression).valueDeclaration)
          ) {
            const of = symbolKey(init.expression)
            const own = symbolKey(node.name)
            if (instances.get(own) !== of) {
              instances.set(own, of)
              grown = true
            }
          }
        } else if (carries(node.initializer)) {
          // const { elapsed } = measure(), const [s, ns] = process.hrtime(t0)
          const names = (pattern) => {
            for (const element of pattern.elements) {
              if (!ts.isBindingElement(element)) continue
              if (ts.isIdentifier(element.name)) learn(symbolKey(element.name), carriers)
              else names(element.name)
            }
          }
          names(node.name)
        }
      }
      if (
        ts.isVariableDeclaration(node) &&
        node.initializer &&
        ts.isObjectBindingPattern(node.name) &&
        ts.isCallExpression(bare(node.initializer)) &&
        keyOf(bare(node.initializer).expression) !== undefined
      ) {
        // const { bot, calls } = botAsking(): each name as the field the function's object gave it
        const from = keyOf(bare(node.initializer).expression)
        for (const element of node.name.elements) {
          if (!ts.isIdentifier(element.name)) continue
          const field = `${from}().${(element.propertyName ?? element.name).getText(sf)}`
          if (readings.has(field)) learn(symbolKey(element.name), readings)
          else if (carriers.has(field)) learn(symbolKey(element.name), carriers)
        }
        if (timers.has(from))
          for (const element of node.name.elements)
            if (ts.isIdentifier(element.name)) learn(symbolKey(element.name), carriers)
      }
      if (ts.isPropertyDeclaration(node) && node.initializer) {
        const owner = classKey(node)
        if (owner !== undefined) given(`${owner}.${node.name.getText(sf)}`, node.initializer)
      }
      if (ts.isBinaryExpression(node)) {
        const op = node.operatorToken.kind
        if (op === ts.SyntaxKind.EqualsToken && isReading(node.right))
          learn(keyOf(node.left), readings)
        else if (op === ts.SyntaxKind.MinusEqualsToken && carries(node.right))
          // left -= d: what is left of a budget
          learn(keyOf(node.left), budgets)
        else if (
          (op === ts.SyntaxKind.EqualsToken || op === ts.SyntaxKind.PlusEqualsToken) &&
          carries(node.right)
        ) {
          // `reached[code] = Date.now() - begun`, `total += …`: the field, and what it is put in, carry it
          learn(keyOf(node.left), carriers)
          let root = node.left
          while (ts.isElementAccessExpression(root) || ts.isPropertyAccessExpression(root))
            root = root.expression
          learn(keyOf(root), carriers)
        }
      }
      // took.push(d), calls.push(Date.now())
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        ['push', 'unshift'].includes(node.expression.name.text)
      ) {
        const into = keyOf(node.expression.expression)
        if (node.arguments.some(isReading)) learn(into, readings)
        else if (node.arguments.some(carries)) learn(into, carriers)
      }
      // const mark = { started: performance.now() }, const mark = { t0 }
      if (
        (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) &&
        ts.isObjectLiteralExpression(node.parent) &&
        ts.isVariableDeclaration(node.parent.parent) &&
        ts.isIdentifier(node.parent.parent.name)
      ) {
        const key = `${symbolKey(node.parent.parent.name)}.${node.name.getText(sf)}`
        if (ts.isPropertyAssignment(node)) given(key, node.initializer)
        else {
          // { t0 }: the value is the variable, not the field the binder names here
          const value = checker.getShorthandAssignmentValueSymbol(node)
          const valueKey = value ? keyOfSymbol(value) : undefined
          if (valueKey !== undefined && readings.has(valueKey)) learn(key, readings)
          else if (valueKey !== undefined && carriers.has(valueKey)) learn(key, carriers)
        }
      }
      if (ts.isFunctionLike(node) && 'body' in node && node.body) {
        const key = declaredKey(node)
        if (key !== undefined) {
          const returned = []
          const returns = (n) => {
            if (ts.isReturnStatement(n) && n.expression) returned.push(n.expression)
            // an inner function's returns are its own
            if (n !== node.body && (ts.isFunctionLike(n) || ts.isClassLike(n))) return
            ts.forEachChild(n, returns)
          }
          if (ts.isBlock(node.body)) returns(node.body)
          else returned.push(node.body)
          // return { bot, calls }: what each field of the answer holds
          for (const value of returned) {
            const v = bare(value)
            if (!ts.isObjectLiteralExpression(v)) continue
            for (const property of v.properties) {
              const field = `${key}().${property.name?.getText(sf) ?? ''}`
              if (ts.isPropertyAssignment(property)) given(field, property.initializer)
              if (ts.isShorthandPropertyAssignment(property)) {
                const held = checker.getShorthandAssignmentValueSymbol(property)
                const heldKey = held ? keyOfSymbol(held) : undefined
                if (heldKey !== undefined && readings.has(heldKey)) learn(field, readings)
                else if (heldKey !== undefined && carriers.has(heldKey)) learn(field, carriers)
              }
            }
          }
          if (returned.some(isReading)) learn(key, clocks)
          else if (returned.some(carries)) learn(key, timers)
          const ways = parameterBounds(node)
          if (ways.size > (predicates.get(key)?.size ?? 0)) {
            predicates.set(key, ways)
            grown = true
          }
          for (const value of returned) {
            const v = core(value)
            if (ts.isBinaryExpression(v) && v.operatorToken.kind === ts.SyntaxKind.MinusToken) {
              const at = isReading(v.left)
                ? parameterAt(v.right, node)
                : isReading(v.right)
                  ? parameterAt(v.left, node)
                  : -1
              if (at >= 0 && add(since, key, at)) grown = true
            }
          }
        }
      }
      for (const { small } of boundedAbove(node)) {
        const fn = enclosingFunction(node)
        const at = fn && small !== undefined ? parameterAt(small, fn) : -1
        const key = at >= 0 ? declaredKey(fn) : undefined
        if (key !== undefined && add(bounders, key, at)) grown = true
      }
      ts.forEachChild(node, walk)
    }
    walk(sf)
  }

  // What each name, field and function of the file is given, for the clocks a value is read from.
  const values = new Map()
  const put = (key, value) => {
    if (key !== undefined && value) values.set(key, [...(values.get(key) ?? []), value])
  }
  const index = (node) => {
    if (ts.isVariableDeclaration(node) && node.initializer) {
      const names = (name) => {
        if (ts.isIdentifier(name)) put(symbolKey(name), node.initializer)
        else
          for (const element of name.elements) if (ts.isBindingElement(element)) names(element.name)
      }
      names(node.name)
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
    ) {
      put(keyOf(node.left), node.right)
      let root = node.left
      while (ts.isElementAccessExpression(root) || ts.isPropertyAccessExpression(root))
        root = root.expression
      put(keyOf(root), node.right)
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ['push', 'unshift'].includes(node.expression.name.text)
    )
      for (const argument of node.arguments) put(keyOf(node.expression.expression), argument)
    if (ts.isPropertyDeclaration(node) && node.initializer) {
      const owner = classKey(node)
      if (owner !== undefined) put(`${owner}.${node.name.getText(sf)}`, node.initializer)
    }
    if (
      ts.isPropertyAssignment(node) &&
      ts.isObjectLiteralExpression(node.parent) &&
      ts.isVariableDeclaration(node.parent.parent) &&
      ts.isIdentifier(node.parent.parent.name)
    )
      put(`${symbolKey(node.parent.parent.name)}.${node.name.getText(sf)}`, node.initializer)
    if (ts.isFunctionLike(node) && 'body' in node && node.body) {
      const key = declaredKey(node)
      if (key !== undefined && !ts.isBlock(node.body)) put(key, node.body)
      if (key !== undefined && ts.isBlock(node.body)) {
        const returns = (n) => {
          if (ts.isReturnStatement(n) && n.expression) put(key, n.expression)
          if (n !== node.body && (ts.isFunctionLike(n) || ts.isClassLike(n))) return
          ts.forEachChild(n, returns)
        }
        returns(node.body)
      }
    }
    ts.forEachChild(node, index)
  }
  index(sf)
  /** The clocks a value is read from — `performance`, `Date`, `hrtime`, or `held` for one no fake replaces. */
  const clocksOf = (node) => {
    const kinds = new Set()
    const seen = new Set()
    const visit = (key) => {
      if (key === undefined || seen.has(key)) return
      seen.add(key)
      for (const value of values.get(key) ?? []) walk(value)
    }
    const walk = (n) => {
      if (ts.isCallExpression(n) || ts.isNewExpression(n)) {
        const callee = resolvedText(n.expression)
        const kind = /^performance\./.test(callee)
          ? 'performance'
          : /^Date(\.now)?$/.test(callee)
            ? 'Date'
            : /^process\.hrtime/.test(callee)
              ? 'hrtime'
              : undefined
        if (kind) kinds.add(heldThrough(n.expression) ? 'held' : kind)
      }
      if (ts.isShorthandPropertyAssignment(n)) {
        const value = checker.getShorthandAssignmentValueSymbol(n)
        if (value) visit(keyOfSymbol(value))
      }
      if (
        ts.isIdentifier(n) ||
        ts.isPropertyAccessExpression(n) ||
        n.kind === ts.SyntaxKind.ThisKeyword
      )
        visit(keyOf(n))
      ts.forEachChild(n, walk)
    }
    walk(node)
    return kinds
  }

  /** A property's own name, quoted or not; `undefined` for a computed one. */
  const nameOfProperty = (p) =>
    p.name && (ts.isIdentifier(p.name) || ts.isStringLiteralLike(p.name)) ? p.name.text : undefined
  /** The clocks `vi.useFakeTimers(options)` holds still; options it cannot read whole leave every clock real. */
  const fakedBy = (call) => {
    const options = call.arguments[0] && bare(call.arguments[0])
    if (!options) return new Set(CLOCKS)
    if (!ts.isObjectLiteralExpression(options)) return new Set()
    // a spread, a shorthand or a computed name: what it holds is not read (adversarial Г3)
    if (
      options.properties.some((p) => !ts.isPropertyAssignment(p) || nameOfProperty(p) === undefined)
    )
      return new Set()
    const option = (name) => options.properties.find((p) => nameOfProperty(p) === name)
    const advance = option('shouldAdvanceTime')
    if (advance && advance.initializer.kind !== ts.SyntaxKind.FalseKeyword) return new Set()
    const list = (name) => {
      const p = option(name)
      if (!p) return null
      const v = bare(p.initializer)
      return ts.isArrayLiteralExpression(v) && v.elements.every(ts.isStringLiteralLike)
        ? v.elements.map((e) => e.text)
        : undefined
    }
    const toFake = list('toFake')
    const toNotFake = list('toNotFake')
    if (toFake === undefined || toNotFake === undefined) return new Set()
    // an empty toFake fakes everything, as @sinonjs/fake-timers reads it
    if (toFake?.length) return new Set(CLOCKS.filter((clock) => toFake.includes(clock)))
    return new Set(CLOCKS.filter((clock) => !toNotFake?.includes(clock)))
  }
  /** The function of this file an expression names, if any. */
  const functionNamed = (expression) => {
    const e = bare(expression)
    if (ts.isFunctionLike(e)) return e
    const declaration = ts.isIdentifier(e)
      ? checker.getSymbolAtLocation(e)?.valueDeclaration
      : undefined
    if (!declaration || declaration.getSourceFile() !== sf) return undefined
    if (ts.isFunctionDeclaration(declaration)) return declaration
    const init = ts.isVariableDeclaration(declaration) && declaration.initializer
    return init && ts.isFunctionLike(bare(init)) ? bare(init) : undefined
  }
  const bodyOf = (fn) =>
    fn && ts.isFunctionLike(fn) && fn.body
      ? ts.isBlock(fn.body)
        ? fn.body.statements
        : [fn.body]
      : []
  const nameOfCall = (call) =>
    ts.isPropertyAccessExpression(call.expression)
      ? call.expression.name.text
      : call.expression.getText(sf)
  const calleeRoot = (call) => calleeRootOf(call.expression)
  const calleeRootOf = (expression) => {
    let e = expression
    while (ts.isPropertyAccessExpression(e) || ts.isCallExpression(e)) e = e.expression
    return ts.isIdentifier(e) ? e.text : ''
  }
  /** Whether a call is awaited, or its value given, where it stands. */
  const awaitedInPlace = (call) => {
    let n = call.parent
    while (ts.isParenthesizedExpression(n)) n = n.parent
    return ts.isAwaitExpression(n) || ts.isReturnStatement(n)
  }
  /**
   * A call that runs its callback before what it returns settles: `vi.waitFor`, a promise's `then` — on
   * what touches no timers, since that runs first (adversarial round 8, З1).
   */
  const RUNS_NOW = /^(vi\.waitFor|vi\.waitUntil|expect\.poll)$/
  const runsInPlace = (call) =>
    awaitedInPlace(call) &&
    (RUNS_NOW.test(calleeText(call)) ||
      (ts.isPropertyAccessExpression(call.expression) &&
        /^(then|catch|finally)$/.test(call.expression.name.text) &&
        !touchesTimers(call.expression.expression)))
  const TEST = /^(it|test)$/
  const HOOK = /^(before|after|around)(All|Each)$/
  const TIMERS = new Set(['useFakeTimers', 'useRealTimers', 'setTimerTickMode'])
  const intersect = (a, b) => new Set([...a].filter((kind) => b.has(kind)))
  /** After a test: what runs there is no part of the test's time as written (adversarial Д4). */
  const AFTER = /^(onTestFinished|onTestFailed)$/
  const touching = new Map()
  /** Whether anything in a node may touch the timers: a timer call or a function of the file that makes one. */
  const touchesTimers = (node) => {
    let found = false
    const look = (n) => {
      if (found) return
      if (ts.isIdentifier(n) && TIMERS.has(n.text)) {
        found = true
        return
      }
      const fn = ts.isIdentifier(n) ? functionNamed(n) : undefined
      if (fn?.body && fn.body !== node) {
        if (!touching.has(fn)) {
          touching.set(fn, false)
          touching.set(fn, touchesTimers(fn.body))
        }
        if (touching.get(fn)) {
          found = true
          return
        }
      }
      ts.forEachChild(n, look)
    }
    look(node)
    return found
  }

  // What runs is read in order; what may or may not run keeps only the clocks both ways hold still — in
  // doubt a clock is real, since a bound refused here is still lawful through `expectWithin` (round 4, Г1).
  /**
   * The clocks held still after a chain of calls in an expression: `vi.useFakeTimers().setSystemTime(…)`;
   * anything else that may touch the timers — `? :`, `&&`, a callback handed to a call — lets them go (Д4).
   */
  const calls = (expression, state, depth) => {
    if (!ts.isCallExpression(bare(expression))) return touchesTimers(expression) ? new Set() : state
    const chain = []
    for (
      let c = bare(expression);
      c !== undefined && ts.isCallExpression(c);
      c = ts.isPropertyAccessExpression(c.expression) ? bare(c.expression.expression) : undefined
    )
      chain.unshift(c)
    let now = state
    for (const call of chain) {
      const name = nameOfCall(call)
      if (name === 'useFakeTimers') now = fakedBy(call)
      else if (name === 'useRealTimers') now = new Set()
      // vi.setSystemTime with real timers fakes Date alone
      else if (name === 'setSystemTime' && now.size === 0) now = new Set(['Date'])
      // any mode but `manual` moves fake time by itself, as shouldAdvanceTime does (Г2)
      else if (name === 'setTimerTickMode') {
        const mode = call.arguments[0] && bare(call.arguments[0])
        if (!(mode && ts.isStringLiteralLike(mode) && mode.text === 'manual')) now = new Set()
      } else if (depth < 5) {
        // a function of the file, or one called where it is written: (async () => { … })()
        const helper = functionNamed(call.expression)
        if (helper) now = steps(bodyOf(helper), now, depth + 1)
      }
      if (call.arguments.some(touchesTimers)) now = new Set()
    }
    // what the chain is called on: [vi.useRealTimers].forEach(…)
    const base = chain[0] && ts.isPropertyAccessExpression(chain[0].expression)
    if (base && touchesTimers(chain[0].expression.expression)) now = new Set()
    return now
  }
  /** The clocks held still after one statement — or an arrow's body — runs. */
  const step = (node, state, depth) => {
    if (ts.isBlock(node)) return steps(node.statements, state, depth)
    if (ts.isExpressionStatement(node)) return calls(node.expression, state, depth)
    if (ts.isVariableStatement(node))
      return node.declarationList.declarations.reduce(
        (now, d) => (d.initializer ? calls(d.initializer, now, depth) : now),
        state,
      )
    if (ts.isTryStatement(node)) {
      // a try may stop anywhere, a catch may not run; the finally always runs
      let now = intersect(state, step(node.tryBlock, state, depth))
      if (node.catchClause) now = intersect(now, step(node.catchClause.block, now, depth))
      return node.finallyBlock ? step(node.finallyBlock, now, depth) : now
    }
    const branches = ts.isIfStatement(node)
      ? [node.thenStatement, node.elseStatement]
      : ts.isIterationStatement(node, false) || ts.isLabeledStatement(node)
        ? [node.statement]
        : ts.isSwitchStatement(node)
          ? node.caseBlock.clauses.map((clause) => ts.factory.createBlock(clause.statements))
          : undefined
    if (branches)
      return branches.reduce(
        (now, branch) => (branch ? intersect(now, step(branch, state, depth)) : now),
        state,
      )
    if (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) return state
    if (ts.isStatement(node)) return touchesTimers(node) ? new Set() : state
    return calls(node, state, depth)
  }
  const steps = (statements, state, depth = 0) =>
    statements.reduce((now, statement) => step(statement, now, depth), state)
  /**
   * The clocks held still once the file is collected: as vitest does it, a body whole first, then each of
   * its suites' bodies in order (adversarial Д1).
   */
  const collected = (statements, state) => {
    const suites = []
    let now = statements.reduce((before, statement) => {
      const call = ts.isExpressionStatement(statement) && bare(statement.expression)
      if (call && ts.isCallExpression(call) && SUITE.test(calleeRoot(call))) {
        const fn = call.arguments.map(bare).find((a) => ts.isFunctionLike(a))
        if (fn) suites.push(fn)
        return before
      }
      return step(statement, before, 0)
    }, state)
    for (const fn of suites) now = collected(bodyOf(fn), now)
    return now
  }
  const callOf = (fn) =>
    ts.isCallExpression(fn.parent) && fn.parent.arguments.includes(fn) ? fn.parent : undefined
  const declaredName = (fn) =>
    ts.isFunctionDeclaration(fn)
      ? fn.name
      : ts.isVariableDeclaration(fn.parent) && ts.isIdentifier(fn.parent.name)
        ? fn.parent.name
        : undefined
  const referencesTo = (symbol, declared) => {
    const found = []
    const look = (n) => {
      if (ts.isIdentifier(n) && n !== declared && checker.getSymbolAtLocation(n) === symbol)
        found.push(n)
      ts.forEachChild(n, look)
    }
    look(sf)
    return found
  }
  const timerCalls = []
  const gather = (n) => {
    if (ts.isCallExpression(n) && TIMERS.has(nameOfCall(n))) timerCalls.push(n)
    ts.forEachChild(n, gather)
  }
  gather(sf)
  /**
   * Whether a node may run after the file is collected and before the test `test`, outside the hooks of
   * its own suites read in order: another test, any other hook, a function called from one — and the test
   * itself, which `each`, `retry` or `repeats` may run again from where it ended (adversarial Д3).
   */
  const runsBetween = (node, test, own, seen) => {
    // a function handed over by name runs as what it is handed to: afterEach(realClock)
    const handed = ts.isIdentifier(node) ? callOf(node) : undefined
    if (handed) {
      if (own.has(node)) return false
      const root = calleeRoot(handed)
      if (TEST.test(root) || HOOK.test(root) || SUITE.test(root)) return true
    }
    for (let n = node.parent; n; n = n.parent) {
      if (n === test) return true
      if (!ts.isFunctionLike(n)) continue
      const call = callOf(n)
      if (call) {
        const root = calleeRoot(call)
        if (SUITE.test(root)) return false
        if (TEST.test(root)) return true
        if (HOOK.test(root)) return !own.has(n)
        continue
      }
      const id = declaredName(n)
      const symbol = id && checker.getSymbolAtLocation(id)
      if (!symbol || seen.has(symbol)) return true
      seen.add(symbol)
      return referencesTo(symbol, id).some((ref) => runsBetween(ref, test, own, seen))
    }
    return false
  }
  /** The clocks held still as a test's own body begins. */
  const beforeTest = (test) => {
    const levels = []
    for (let n = test.parent; n; n = n.parent) {
      if (ts.isSourceFile(n)) levels.unshift(n.statements)
      else if (ts.isFunctionLike(n) && callOf(n) && SUITE.test(calleeRoot(callOf(n))))
        levels.unshift(bodyOf(n))
    }
    // in the order they are registered, a helper's where it is called (adversarial Д2)
    const registered = (statements, kind, depth) =>
      statements.flatMap((statement) => {
        const call = ts.isExpressionStatement(statement) && bare(statement.expression)
        if (!call || !ts.isCallExpression(call)) return []
        if (calleeText(call) === kind) return call.arguments[0] ? [call.arguments[0]] : []
        const helper = depth < 5 && !SUITE.test(calleeRoot(call)) && functionNamed(call.expression)
        return helper ? registered(bodyOf(helper), kind, depth + 1) : []
      })
    const hooks = (kind) => levels.flatMap((statements) => registered(statements, kind, 0))
    const beforeAll = hooks('beforeAll')
    const beforeEach = hooks('beforeEach')
    const own = new Set([...beforeAll, ...beforeEach].map(bare))
    const between = timerCalls.some((call) => runsBetween(call, test, own, new Set()))
    // what another test or hook may do between, the collection and its beforeAll are no longer sure of
    let state = between ? new Set() : collected(sf.statements, new Set())
    if (!between) for (const hook of beforeAll) state = steps(bodyOf(functionNamed(hook)), state)
    for (const hook of beforeEach) state = steps(bodyOf(functionNamed(hook)), state)
    return state
  }
  /**
   * The clocks held still where a node runs: in a test, what runs before its body and its statements
   * before the node; in a hook or a helper, only its own statements, since its caller is not read (Г1-7).
   */
  const fakedAt = (node) => {
    let start
    let test = false
    for (let n = node.parent; n && start === undefined; n = n.parent) {
      if (!ts.isFunctionLike(n)) continue
      const call = callOf(n)
      const root = call ? calleeRoot(call) : ''
      // a callback the test runs as it goes: waitFor(() => …) — not one run after it, nor one handed to a
      // function of the file that touches the timers around it: withRealClock(() => …) (Д4)
      // — and only one awaited where it is written: `.then(() => …)` kept for later runs whenever (Е4) — by
      // a call that runs it before it returns: an awaited call may only keep it, as `on(handler)` does (Ж4)
      const handedTo = call && functionNamed(call.expression)
      if (
        call &&
        !TEST.test(root) &&
        !SUITE.test(root) &&
        !HOOK.test(root) &&
        !AFTER.test(root) &&
        !(handedTo?.body && touchesTimers(handedTo.body)) &&
        runsInPlace(call)
      )
        continue
      start = n
      test = TEST.test(root)
    }
    const path = []
    for (let child = node, n = node.parent; n && n !== start; child = n, n = n.parent)
      if (ts.isBlock(n) || ts.isSourceFile(n)) path.unshift({ block: n, child })
    let state = test ? beforeTest(start) : new Set()
    path.forEach(({ block, child }, at) => {
      state = steps(block.statements.slice(0, Math.max(0, block.statements.indexOf(child))), state)
      const inner = path[at + 1]?.block
      if (!inner || child === inner) return
      // entering a finally the try ran first, a catch after a try that may have stopped anywhere
      if (ts.isTryStatement(child)) {
        if (inner === child.finallyBlock || inner === child.catchClause?.block)
          state = intersect(state, step(child.tryBlock, state, 0))
        if (inner === child.finallyBlock && child.catchClause)
          state = intersect(state, step(child.catchClause.block, state, 0))
      }
      // a loop's body ran before, as many times as it did
      if (ts.isIterationStatement(child, false))
        state = intersect(state, step(child.statement, state, 0))
    })
    return state
  }
  /**
   * Whether the file touches the timers only in ways read in order (adversarial round 6, Е1–Е6): every
   * mention of a timer call a call itself, in the file's body, a callback or a function of the file —
   * never a reference handed over or kept (`afterEach(vi.useRealTimers)`, `const real = vi.useRealTimers`),
   * a string (`vi['useRealTimers']`), a method or a class; no hook or test under another name, no
   * fixture (`test.extend`), no hook given anything but a function of the file, no setup file that
   * touches the timers; and (round 7) no `vi.setConfig`, no `it.beforeEach`, no timer call handed to a
   * call that keeps it for later, no concurrent tests, no config that sets `fakeTimers` or runs tests
   * concurrently. Else no bound in the file is let go as fake: what touches the timers is not read.
   */
  const readable = (() => {
    if (setupTouchesTimers) return false
    let ok = true
    const named = (fn) =>
      ts.isFunctionDeclaration(fn) ||
      ((ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) &&
        (ts.isVariableDeclaration(fn.parent) || callOf(fn) !== undefined))
    const look = (n) => {
      if (!ok) return
      const text = ts.isIdentifier(n) || ts.isStringLiteralLike(n) ? n.text : undefined
      if (text !== undefined && TIMERS.has(text)) {
        const access = n.parent
        const called =
          ts.isIdentifier(n) &&
          ((ts.isPropertyAccessExpression(access) &&
            access.name === n &&
            ts.isCallExpression(access.parent) &&
            access.parent.expression === access) ||
            (ts.isCallExpression(access) && access.expression === n))
        const owner = ts.findAncestor(n.parent, ts.isFunctionLike)
        // a default of a parameter runs at the call, not in the body the parse reads (adversarial К1)
        const inDefault = ts.findAncestor(
          n.parent,
          (a) => ts.isParameter(a) || ts.isFunctionLike(a),
        )
        if (!called || (owner && !named(owner)) || (inDefault && ts.isParameter(inDefault)))
          ok = false
      }
      // import { afterEach as after } from 'vitest'
      if (
        ts.isImportSpecifier(n) &&
        n.propertyName &&
        /^(it|test|describe|suite|(before|after|around)(All|Each)|onTestFinished|onTestFailed)$/.test(
          n.propertyName.text,
        )
      )
        ok = false
      // test.extend({ … }): a fixture runs where vitest puts it, after beforeEach or before
      if (
        ts.isPropertyAccessExpression(n) &&
        n.name.text === 'extend' &&
        TEST.test(calleeRootOf(n))
      )
        ok = false
      if (ts.isCallExpression(n)) {
        const name = nameOfCall(n)
        // vi.setConfig({ fakeTimers }): what a later useFakeTimers() fakes is no longer its argument (Ж1)
        if (name === 'setConfig') ok = false
        // it.beforeEach(…): a hook under the test's name, registered in its own order (Ж5)
        if (/^(before|after|around)(All|Each)$/.test(name) && calleeText(n) !== name) ok = false
        // a timer call kept by an ordinary call for later: cleanups.push(() => vi.useRealTimers()) (Ж3),
        // or a function of the file that makes one, by its name: cleanups.push(realClock) (З2)
        const root = calleeRoot(n)
        const ordinary =
          !TEST.test(root) && !SUITE.test(root) && !HOOK.test(root) && !AFTER.test(root)
        if (ordinary && !runsInPlace(n) && n.arguments.some((a) => touchesTimers(bare(a))))
          ok = false
      }
      // options under a name or made by a call: what they set is not read (review №21, adversarial И2) —
      // a timeout named by a number of the file excepted
      if (
        ts.isCallExpression(n) &&
        (TEST.test(calleeRoot(n)) || SUITE.test(calleeRoot(n))) &&
        !(
          ts.isPropertyAccessExpression(n.expression) &&
          /^(each|for|skipIf|runIf)$/.test(n.expression.name.text)
        ) &&
        n.arguments.slice(1).some((a) => {
          const v = bare(a)
          if (ts.isFunctionLike(v) || ts.isObjectLiteralExpression(v) || ts.isNumericLiteral(v))
            return false
          const declaration = ts.isIdentifier(v)
            ? checker.getSymbolAtLocation(v)?.valueDeclaration
            : undefined
          const init =
            declaration && ts.isVariableDeclaration(declaration)
              ? declaration.initializer
              : undefined
          return !(init && /^[\d_\s*+\-/().]+$/.test(init.getText(sf)))
        })
      )
        ok = false
      // a function of the file that touches the timers, kept or handed over by its name anywhere but
      // as a call or to a hook — [realClock], { reset: realClock }, const reset = realClock (И1)
      if (ts.isIdentifier(n) && !TIMERS.has(n.text)) {
        const parent = n.parent
        const declared =
          (ts.isFunctionDeclaration(parent) || ts.isVariableDeclaration(parent)) &&
          parent.name === n
        const called = ts.isCallExpression(parent) && parent.expression === n
        const hooked =
          ts.isCallExpression(parent) &&
          parent.arguments.includes(n) &&
          (HOOK.test(calleeRoot(parent)) || TEST.test(calleeRoot(parent)))
        if (!declared && !called && !hooked) {
          const fn = functionNamed(n)
          if (fn?.body && touchesTimers(fn.body)) ok = false
        }
      }
      // describe('s', { concurrent: true }, …), in the options too (review №20)
      if (
        ts.isCallExpression(n) &&
        (TEST.test(calleeRoot(n)) || SUITE.test(calleeRoot(n))) &&
        n.arguments.some(
          (a) =>
            ts.isObjectLiteralExpression(bare(a)) &&
            bare(a).properties.some(
              (p) =>
                (ts.isSpreadAssignment(p) ||
                  nameOfProperty(p) === 'concurrent' ||
                  nameOfProperty(p) === undefined) &&
                !(ts.isPropertyAssignment(p) && p.initializer.kind === ts.SyntaxKind.FalseKeyword),
            ),
        )
      )
        ok = false
      // the clocks put back by hand: vi.stubGlobal, Object.defineProperty(globalThis, …), a spy or an
      // assignment on a clock (adversarial К2) — what fake timers hold is no longer theirs
      if (ts.isCallExpression(n)) {
        const callee = calleeText(n)
        const target = n.arguments[0] && resolvedText(n.arguments[0])
        if (/(^|\.)(stubGlobal|unstubAllGlobals)$/.test(callee)) ok = false
        if (
          /^(Object\.(defineProperty|defineProperties|assign)|Reflect\.(defineProperty|set))$/.test(
            callee,
          ) &&
          target !== undefined &&
          /^(globalThis|window|self|global|performance|Date|process(\.hrtime)?)$/.test(target)
        )
          ok = false
        if (
          /(^|\.)spyOn$/.test(callee) &&
          target !== undefined &&
          /^(performance|Date|process|globalThis)/.test(target)
        )
          ok = false
      }
      if (
        ts.isBinaryExpression(n) &&
        n.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        /^(performance|Date|process\.hrtime)(\.|$)/.test(resolvedText(n.left))
      )
        ok = false
      // a default of a parameter that may touch the timers, through a function of the file too (Л1)
      if (ts.isParameter(n) && n.initializer && touchesTimers(n.initializer)) ok = false
      // vi's members, Object.defineProperty and its kin, or the global object under another name — a
      // reference to one not called or read through where it stands (Л2)
      if (ts.isPropertyAccessExpression(n)) {
        const parent = n.parent
        const used =
          (ts.isCallExpression(parent) && parent.expression === n) ||
          (ts.isPropertyAccessExpression(parent) && parent.expression === n)
        if (!used && calleeRootOf(n) === 'vi') ok = false
        if (
          !used &&
          /^(Object|Reflect)\.(defineProperty|defineProperties|assign|set)$/.test(resolvedText(n))
        )
          ok = false
      }
      if (ts.isIdentifier(n) && /^(globalThis|window|self|global)$/.test(n.text)) {
        const parent = n.parent
        if (!(ts.isPropertyAccessExpression(parent) && parent.expression === n)) ok = false
      }
      // describe.concurrent, it.concurrent: the tests run side by side, and the clocks are one (№19)
      if (
        ts.isPropertyAccessExpression(n) &&
        n.name.text === 'concurrent' &&
        (TEST.test(calleeRootOf(n)) || SUITE.test(calleeRootOf(n)))
      )
        ok = false
      // afterEach(helpers.cleanup): a hook given what the parse cannot read
      if (ts.isCallExpression(n) && (HOOK.test(calleeRoot(n)) || AFTER.test(calleeRoot(n)))) {
        const fn = n.arguments[0] && bare(n.arguments[0])
        if (fn && !ts.isFunctionLike(fn) && !functionNamed(fn)) ok = false
      }
      ts.forEachChild(n, look)
    }
    look(sf)
    return ok
  })()
  /** Whether every clock the values read is one fake timers hold still where the node runs. */
  const fake = (node, read) => {
    if (!readable) return false
    const kinds = new Set(read.filter(Boolean).flatMap((value) => [...clocksOf(value)]))
    const faked = fakedAt(node)
    return [...(kinds.size > 0 ? kinds : CLOCKS)].every((kind) => faked.has(kind))
  }

  const found = []
  const at = (node) =>
    `${String(sf.getLineAndCharacterOfPosition(node.getStart()).line + 1)}: ${node.getText(sf).split('\n')[0]}`
  const walk = (node) => {
    let raw = boundedAbove(node).some((pair) => breaks(pair) && !fake(node, [pair.small, pair.big]))
    if (!raw && ts.isCallExpression(node)) {
      const key = keyOf(node.expression)
      const places = key === undefined ? undefined : bounders.get(key)
      raw = Boolean(
        places?.some((place) => {
          const argument = node.arguments[place]
          return argument && carries(argument) && !fake(node, [argument])
        }),
      )
    }
    if (raw) found.push(at(node))
    ts.forEachChild(node, walk)
  }
  walk(sf)
  return found
}

/**
 * The directories whose test files a vitest config leaves unsure about the timers (adversarial Е6, Ж1, Ж2,
 * З3, З4, И3–И6, К3, К4, review №19, №22, №23): its setup files — and the files of this repository they
 * import, `./…`, `@/…`, a workspace package, a `#…` subpath — touch them, or one cannot be read or
 * followed, or loads a module any way but a static import; or the config names `fakeTimers`,
 * `concurrent` other than `false`, `extends`, reads a file, takes settings from a file of this
 * repository or loads a module any way but a static import. A setup file runs in every test file of
 * its run, so its hooks stand between any two tests.
 * @param {{ path: string, text: string }[]} configs
 * @param {(path: string) => string | undefined} read
 * @returns {string[]}
 */
export function unsureDirectories(configs, read) {
  // what may touch the timers or the clocks in a setup file — the same as the test file reads, not a list
  // of the calls that do (review №24, adversarial Л3): the clocks by name, a spy, the global object, a
  // module loaded by another name
  // module loaded by another name — wherever vitest is at hand to hook it there; the timers' own calls anywhere
  const TOUCH = /useFakeTimers|useRealTimers|setTimerTickMode|setConfig|stubGlobal/
  const HOOKED =
    /defineProperty|\bDate\b|performance|hrtime|spyOn|globalThis|\bwindow\b|\bassign\b|importActual|importMock|\brequire\b|\bimport\s*\(/
  const VITEST = /['"]vitest['"]|\bglobals\s*:\s*true/
  const touchesClock = (text) => TOUCH.test(text) || (VITEST.test(text) && HOOKED.test(text))
  /**
   * What a file loads, parsed: the specifiers of its static `import … from '…'`, `import '…'` and
   * `export … from '…'`, and whether it loads anything any other way — `import()`, `require`,
   * `createRequire`, `vi.importActual`, `vi.importMock`, `import.meta.glob` — which is not read
   * (review №23, adversarial К3, К4).
   */
  const modulesOf = (text, file) => {
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
    const specs = []
    let loose = false
    const look = (n) => {
      if (
        (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) &&
        n.moduleSpecifier &&
        ts.isStringLiteral(n.moduleSpecifier)
      )
        specs.push(n.moduleSpecifier.text)
      if (ts.isCallExpression(n)) {
        const callee = n.expression
        const name = ts.isPropertyAccessExpression(callee)
          ? callee.name.text
          : ts.isIdentifier(callee)
            ? callee.text
            : ''
        if (callee.kind === ts.SyntaxKind.ImportKeyword || /import|require/i.test(name))
          loose = true
      }
      if (
        ts.isMetaProperty(n) &&
        ts.isPropertyAccessExpression(n.parent) &&
        n.parent.name.text === 'glob'
      )
        loose = true
      ts.forEachChild(n, look)
    }
    look(sf)
    return { specs, loose }
  }
  const json = (path) => {
    try {
      const text = read(path)
      return text === undefined ? undefined : JSON.parse(text)
    } catch {
      return undefined
    }
  }
  /** Where a workspace package (`@molvia/model/…`) or a subpath import (`#model/…`) leads, if anywhere. */
  const resolved = (spec, from) => {
    if (spec.startsWith('@molvia/')) {
      const [, name, ...rest] = spec.split('/')
      for (const dir of [`packages/${name}`, name, `deploy/${name}`]) {
        const manifest = json(join(dir, 'package.json'))
        if (manifest?.name !== `@molvia/${name}`) continue
        const exports = manifest.exports
        const key = rest.length > 0 ? `./${rest.join('/')}` : '.'
        const target = typeof exports === 'string' && key === '.' ? exports : exports?.[key]
        return typeof target === 'string' ? join(dir, target) : undefined
      }
      return undefined
    }
    for (let dir = dirname(from); dir !== '.' && dir !== '/' && dir !== ''; dir = dirname(dir)) {
      const imports = json(join(dir, 'package.json'))?.imports
      if (!imports) continue
      // as Node resolves it: the key itself, else the pattern of the longest head (adversarial И5)
      const exact = imports[spec]
      if (exact !== undefined) return typeof exact === 'string' ? join(dir, exact) : undefined
      const [pattern, target] =
        Object.entries(imports)
          .filter(([key]) => key.includes('*'))
          .filter(([key]) => {
            const [head, tail = ''] = key.split('*')
            return (
              spec.startsWith(head) &&
              spec.endsWith(tail) &&
              spec.length >= head.length + tail.length
            )
          })
          .sort(([a], [b]) => b.indexOf('*') - a.indexOf('*'))[0] ?? []
      if (typeof pattern !== 'string' || typeof target !== 'string') return undefined
      const [head, tail = ''] = pattern.split('*')
      return join(dir, target.replace('*', spec.slice(head.length, spec.length - tail.length)))
    }
    return undefined
  }
  /** An import of this repository: relative, `@/`, a workspace package, a subpath import. */
  const local = (spec) =>
    /^\.{1,2}\//.test(spec) ||
    spec.startsWith('@/') ||
    spec.startsWith('#') ||
    spec.startsWith('@molvia/')
  const packageRoot = (file) => {
    for (let dir = dirname(file); dir !== '.' && dir !== '/' && dir !== ''; dir = dirname(dir))
      if (read(join(dir, 'package.json')) !== undefined) return dir
    return '.'
  }
  const touches = (file, root, seen) => {
    if (seen.has(file)) return false
    seen.add(file)
    const candidates = /\.[cm]?[jt]s$/.test(file)
      ? [file]
      : ['.ts', '.mts', '.js', '/index.ts'].map((end) => `${file}${end}`)
    const found = candidates.find((path) => read(path) !== undefined)
    const text = found === undefined ? undefined : read(found)
    if (found === undefined || text === undefined) return true
    if (touchesClock(text)) return true
    const { specs, loose } = modulesOf(text, found)
    if (loose) return true
    return specs.some((spec) => {
      if (!local(spec)) return false
      if (spec.startsWith('@/')) return touches(join(root, 'src', spec.slice(2)), root, seen)
      if (/^\.{1,2}\//.test(spec)) return touches(join(dirname(file), spec), root, seen)
      const target = resolved(spec, file)
      // a package's own `@/` is its own `src`
      return target === undefined || touches(target, packageRoot(target), seen)
    })
  }
  return configs
    .filter(({ path, text }) => {
      const root = dirname(path)
      if (/\bfakeTimers\b/.test(text)) return true
      // concurrent anywhere but as `concurrent: false` — quoted, short, by an expression (И3, №22)
      const concurrent = [...text.matchAll(/\bconcurrent\b/g)].length
      const off = [...text.matchAll(/\bconcurrent['"]?\s*:\s*false\b/g)].length
      if (concurrent > off) return true
      // settings that come from elsewhere than this text: a project's `extends`, a file read (И6)
      if (/\bextends\b|\breadFile|\bJSON\.parse\b|\brequire\s*\(/.test(text)) return true
      // a config is read by its own text: one that takes settings from a file of this repository, or loads
      // a module any way but a static import, is not read whole (adversarial З4, К4, review №23)
      const { specs, loose } = modulesOf(text, path)
      if (loose || specs.some(local)) return true
      const list =
        /setupFiles\s*:\s*\[([^\]]*)\]/.exec(text)?.[1] ??
        /setupFiles\s*:\s*(['"][^'"]+['"])/.exec(text)?.[1] ??
        (/setupFiles/.test(text) ? '"?"' : '')
      return [...list.matchAll(/['"]([^'"]+)['"]/g)].some(([, setup]) =>
        touches(join(root, setup), root, new Set()),
      )
    })
    .map(({ path }) => dirname(path))
}

/**
 * Whether a command line of the repository gives vitest a setting the configs do not show (adversarial
 * К5): every word after `vitest` is `run`, a config, a project, a report or a file, or the run is unsure —
 * `--sequence.concurrent`, `--setupFiles` and the rest set what the check cannot read.
 * After `npm run … --` too, which npm hands to the script; and a `-c` only to a config the check reads.
 * @param {string[]} texts — package.json files, the Makefile, the workflows
 * @param {string[]} [configs] — the configs the check reads
 * @returns {boolean}
 */
export function vitestFlagsUnsure(texts, configs = []) {
  // what touches no clock: the command, a project, what is reported, a file — and a config the check reads
  const SAFE =
    /^(run|--run|--project|--passWithNoTests|--silent|--coverage|--reporter|--outputFile|--bail|--shard|[^-].*)$/
  const known = (path) =>
    configs.length === 0 || configs.some((config) => config.endsWith(path.replace(/^\.\//, '')))
  const unsure = (rest) => {
    const words = rest.trim().split(/\s+/).filter(Boolean)
    return words.some((word, at) => {
      const [flag, value] = word.split('=')
      if (flag === '-c' || flag === '--config') {
        const path = value ?? words[at + 1]
        return path === undefined || !known(path)
      }
      if (at > 0 && (words[at - 1] === '-c' || words[at - 1] === '--config')) return false
      return !SAFE.test(flag ?? '')
    })
  }
  // the scripts that run vitest, by their names in every package.json: what npm hands them after `--`
  // reaches vitest (Л4)
  const scripts = new Set(
    texts.flatMap((text) => {
      try {
        return Object.entries(JSON.parse(text).scripts ?? {})
          .filter(([, command]) => /\bvitest\b/.test(String(command)))
          .map(([name]) => name)
      } catch {
        return []
      }
    }),
  )
  return texts.some(
    (text) =>
      [...text.matchAll(/\bvitest\b([^"\n&|;]*)/g)].some(([, rest]) => unsure(rest)) ||
      [
        ...text.matchAll(
          /\bnpm\s+(?:run(?:-script)?\s+)?(?:-\S+\s+)*([\w:.-]+)[^"\n&|;]*?\s--\s([^"\n&|;]*)/g,
        ),
      ].some(
        ([, name, rest]) => (scripts.has(name ?? '') || name === 'test') && unsure(rest ?? ''),
      ),
  )
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop() ?? '')) {
  const files = execFileSync('git', ['ls-files', ...FILES], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter(Boolean)
  const configs = execFileSync('git', ['ls-files', '*vitest*.config.*'], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((path) => ({ path, text: readFileSync(path, 'utf8') }))
  const unsure = unsureDirectories(configs, (path) =>
    existsSync(path) && statSync(path).isFile() ? readFileSync(path, 'utf8') : undefined,
  )
  const commands = execFileSync(
    'git',
    ['ls-files', 'package.json', '*/package.json', 'Makefile', '.github/workflows/*.yml'],
    { encoding: 'utf8' },
  )
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((path) => readFileSync(path, 'utf8'))
  if (
    vitestFlagsUnsure(
      commands,
      configs.map(({ path }) => path),
    )
  )
    unsure.push('.')
  const problems = files.flatMap((file) => {
    const source = readFileSync(file, 'utf8')
    // a file that never reads the clock holds no duration: the binder is spared it
    if (!/\.now\b|\bDate\b|hrtime/.test(source)) return []
    const setupTouchesTimers = unsure.some((dir) => dir === '.' || file.startsWith(`${dir}/`))
    return rawBounds(file, source, { setupTouchesTimers }).map((line) => `  ${file}:${line}`)
  })
  if (problems.length > 0) {
    console.error(
      `clock bounds: ${String(problems.length)} not through expectWithin (CLAUDE.md › Testing, MOL-266)`,
    )
    for (const problem of problems) console.error(problem)
    process.exitCode = 1
  }
}
