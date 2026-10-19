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
// `process.uptime()`, `performance.timeOrigin` plus one, `new Date()` and its `getTime()`, through
// `globalThis`, `Number()`, `Math.floor(… / 1000)`, under another name (`perf_hooks`' and `node:process`'
// own, `{ now } = Date`, `.bind`); a function of the file that
// returns one (`const now = () => performance.now()`); a name, a field, a field of a class
// (`this.start`) or a shorthand field given one; an array of them — pushed, by index, `at()`, each element
// `for … of` it or a callback of its own (`forEach`, `every`, `some`, `filter`, …) takes, by a plain name or
// taken apart; what a name of the file but an import is handed by a method of its own and gives back
// (`map.set`, `map.get`), a store a helper fills through its parameter, an object whole and by its fields —
// `.length`, `.size` and a spy's `mock` being counts. A duration:
// a subtraction of two readings, or of a deadline from a reading, and whatever is made of it — a name, a
// field, an object or array it is put in (`=`, `+=`, `push`) or taken apart from, a function of the file,
// a method or a getter that returns it, a call of one that subtracts a reading it takes from the clock
// however it rounds (`since(t0)`), a parameter of a function of the file handed one — a method of an object
// or a class of the file too, by its symbol — a callback a helper of the file hands one to, what a
// generator of the file yields, `process.hrtime(t0)`,
// `performance.measure()` and the entries read back (`getEntriesByName`, `getEntriesByType`). A budget is
// a duration taken from a number (`200 - d`, `left -= d`, `deadline - Date.now()`) or divided into one (a rate,
// `1000 / ms`), kept through `Math.max` and `Math.min`, and a lower bound on it is an upper bound on the
// duration.
//
// Refused is an upper bound on a duration, and a lower bound on a budget — `toBeLessThan`,
// `toBeLessThanOrEqual`, chai's `lessThan`, `below`, `lt`, `lte`, `most`, `within`, `toBeCloseTo`; `not`
// before a lower bound; a lower bound with the duration on the other side; a comparison under `expect`,
// `expect.soft` or any `assert`, asserted true or false (`toBe(false)`, `isFalse`, `!`, `&&`); `toSatisfy`
// with a comparison, inline or a function of the file; `if (d > n)` that throws or fails; a call of a
// function of the file that bounds its parameter so — and a deadline: a reading bounded by a reading plus
// a number (`expect(Date.now()).toBeLessThan(deadline)`), or a reading less a number below a reading
// (`expect(t1 - 1_000).toBeLessThan(t0)`). And a comparison of time no assertion reads where it stands —
// kept in a name, returned by a callback, a condition — in doubt a bound, a lower one asserted where it
// stands instead; but a loop's condition, a wait, and a mark against zero — a name given a negative
// number — are not; a budget or an overage against zero is. What is none and held so only in doubt says it
// at the end of its line or on a line of its own above: `// not a duration: <why>`, never over the clock
// read straight, and printed on every run. A lower bound is no breach of time, two readings
// against each other included; the age of a stamp — the clock against a moment a row holds — is no
// duration, as one side is not the clock.
//
// Fake time is no exception here: a bound under `vi.useFakeTimers()` goes through `expectWithin` as any
// other, and is held as real. Whether a clock stood still while it measured is a fact of the run, not of
// the text — a command line, a config, a setup file, the order vitest runs hooks in, each can leave it
// real — and fourteen rounds of review never closed reading it from the text (MOL-266, round 15), nor two
// more from a mark read at the bound (round 16). Under fake timers a test bounds the schedule by the time
// it moves them by, never by a clock.
//
// What this is: a guard against a bound written the ordinary way, not against a form built to slip past
// it. What the lists above do not name is not seen — a duration the code under test measures
// (`metrics`' lag), a helper imported from another file, a reading kept in a structure the lists do not
// name, a clock reached through `vm`, `eval` or reflection. Those go to `expectWithin` by review, and a
// form found that hides an ordinary bound is a new line here, not a reason to read the run.
//
//   node bin/check-clock-bounds.mjs

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import process from 'node:process'
import ts from 'typescript'

/** The files a vitest run reads: tests, the helpers beside the integration tests, a package's test helpers. */
const FILES = ['*.test.ts', '*.test.mts', 'backend/tests/*.ts', 'packages/*/tests/*.ts']

/** A reading of the clock, with `globalThis.`, `window.` or `self.` taken off and other names resolved. */
const CLOCK =
  /^(performance\.now|Date\.now|process\.hrtime\.bigint|process\.hrtime|process\.uptime)$/
/** What a reading is still a reading through: a cast, and whole seconds of it. */
const SAME = /^(Number|BigInt|Math\.(round|floor|ceil|trunc))$/
/** A duration the platform measures itself. */
const MEASURED =
  /^(performance\.(measure|getEntries|getEntriesByName|getEntriesByType)|process\.hrtime)$/
/** What another name may stand for: a clock, or what holds one. */
const CLOCK_PATHS = new Set([
  'performance',
  'Date',
  'process',
  'process.hrtime',
  'performance.now',
  'Date.now',
  'process.hrtime.bigint',
  'process.uptime',
])
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
/** The methods of an array that hand each element to their callback, by the places it takes them in. */
const ITERATE = new Map([
  ...[
    'forEach',
    'every',
    'some',
    'filter',
    'find',
    'findLast',
    'findIndex',
    'findLastIndex',
    'map',
    'flatMap',
  ].map((name) => [name, [0]]),
  ['reduce', [1]],
  ['reduceRight', [1]],
  ['sort', [0, 1]],
])
/** A count of what a store holds is no time (review №32, adversarial Ф4). */
const COUNT = new Set(['length', 'size'])
const LESS = [ts.SyntaxKind.LessThanToken, ts.SyntaxKind.LessThanEqualsToken]
const MORE = [ts.SyntaxKind.GreaterThanToken, ts.SyntaxKind.GreaterThanEqualsToken]

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
 * The bounds on a duration in one file that do not go through `expectWithin` (`found`), and those a note
 * says are no duration (`noted`), each as `line: text`.
 * @param {string} fileName
 * @param {string} source
 * @returns {{ found: string[], noted: string[] }}
 */
export function boundsOf(fileName, source) {
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
    // rows[0]: any element of a store, by its fields (`rows[0].took`)
    if (ts.isElementAccessExpression(n)) {
      const root = keyOf(n.expression)
      return root === undefined ? undefined : `${root}[]`
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
        if (['getTime', 'valueOf', 'at', 'get'].includes(method))
          return isReading(n.expression.expression)
      }
      return false
    }
    // +new Date()
    if (ts.isPrefixUnaryExpression(n) && n.operator === ts.SyntaxKind.PlusToken)
      return isReading(n.operand)
    // calls.at(-1) ?? Infinity
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
      return isReading(n.left)
    // performance.timeOrigin + performance.now(): the clock as a moment of the epoch (adversarial Т5)
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const origin = (side) =>
        ts.isPropertyAccessExpression(bare(side)) && resolvedText(side) === 'performance.timeOrigin'
      return (origin(n.left) && isReading(n.right)) || (origin(n.right) && isReading(n.left))
    }
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
  /** A reading less what is no clock: `t1 - 1_000`, which held below a reading is a deadline (adversarial Т4). */
  const isLowered = (node) => {
    const n = core(node)
    return (
      ts.isBinaryExpression(n) &&
      n.operatorToken.kind === ts.SyntaxKind.MinusToken &&
      (isReading(n.left) || isLowered(n.left)) &&
      !isReading(n.right) &&
      !isDeadline(n.right) &&
      sign(n.right) === 0
    )
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
  /** Whether a field of the file under `key`, or of an element of it, carries a duration. */
  const fieldsCarry = (key) => {
    for (const k of carriers) if (k.startsWith(`${key}.`) || k.startsWith(`${key}[].`)) return true
    return false
  }
  /** Whether fields under `at` are known to carry: `report.took`, `rows[].took`. */
  const fieldsUnder = (at) => {
    for (const k of carriers) if (k.startsWith(`${at}.`)) return true
    for (const k of readings) if (k.startsWith(`${at}.`)) return true
    return false
  }
  /** Whether what a field is read from is a store of durations whole, not an object of other fields too. */
  const receiverCarries = (node) => {
    const n = bare(node)
    if (ts.isElementAccessExpression(n)) return receiverCarries(n.expression)
    if (ts.isIdentifier(n) || ts.isPropertyAccessExpression(n)) {
      const key = keyOf(n)
      return key !== undefined && (carriers.has(key) || timers.has(key))
    }
    return sign(n) === 1
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
      if (ts.isPropertyAccessExpression(n)) {
        // a count is no time: took.length, byName.size, spy.mock.calls (review №32, adversarial Ф4)
        if (COUNT.has(n.name.text) || /(^|\.)mock(\.|$)/.test(n.getText(sf))) return 0
        // a field's own name is no mention of anything; a field of a store of durations is one
        return receiverCarries(n.expression) ? 1 : 0
      }
      // an object of the file used whole — spread, handed on, gone through — is what its fields are
      return key !== undefined && fieldsCarry(key) ? 1 : 0
    }
    // { d }: the value is the variable, not the field the binder names there
    if (ts.isShorthandPropertyAssignment(n)) {
      const value = checker.getShorthandAssignmentValueSymbol(n)
      const key = value ? keyOfSymbol(value) : undefined
      return key !== undefined && (carriers.has(key) || timers.has(key)) ? 1 : 0
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

  /** A field's own name, quoted or not; `undefined` for a computed one. */
  const nameOfField = (name) =>
    ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)
      ? name.text
      : undefined
  /** Whether an expression is rooted in an import: `vi`, a module — a name of another file holds nothing here. */
  const imported = (node) => {
    let n = bare(node)
    while (ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n))
      n = bare(n.expression)
    if (!ts.isIdentifier(n)) return false
    const declarations = checker.getSymbolAtLocation(n)?.declarations ?? []
    return declarations.some(
      (d) => ts.isImportSpecifier(d) || ts.isImportClause(d) || ts.isNamespaceImport(d),
    )
  }
  /** The function of this file an expression is or names: `(d) => …`, `fast`. */
  const functionOf = (expression) => {
    const e = bare(expression)
    if (ts.isArrowFunction(e) || ts.isFunctionExpression(e)) return e
    if (!ts.isIdentifier(e) && !ts.isPropertyAccessExpression(e)) return undefined
    // check.fast(d), clock.real(): a method of an object or a class of the file, by its symbol (У4)
    const target = ts.isPropertyAccessExpression(e) ? e.name : e
    const declaration = checker.getSymbolAtLocation(target)?.valueDeclaration
    if (!declaration || declaration.getSourceFile() !== sf) return undefined
    if (
      (ts.isFunctionDeclaration(declaration) || ts.isMethodDeclaration(declaration)) &&
      declaration.body
    )
      return declaration
    const init =
      ts.isVariableDeclaration(declaration) ||
      ts.isPropertyAssignment(declaration) ||
      ts.isPropertyDeclaration(declaration)
        ? declaration.initializer && bare(declaration.initializer)
        : undefined
    return init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) ? init : undefined
  }
  /** The comparisons an assertion reads, through `!`, `&&` and `||`: each is judged there, by its truth. */
  const judged = new Set()
  const judge = (node) => {
    const n = node && bare(node)
    if (!n) return
    if (ts.isPrefixUnaryExpression(n) && n.operator === ts.SyntaxKind.ExclamationToken)
      return judge(n.operand)
    if (!ts.isBinaryExpression(n)) return
    const op = n.operatorToken.kind
    if (op === ts.SyntaxKind.AmpersandAmpersandToken || op === ts.SyntaxKind.BarBarToken) {
      judge(n.left)
      judge(n.right)
    } else if (LESS.includes(op) || MORE.includes(op)) judged.add(n)
  }
  /** Whether a comparison is what a loop waits on: `while (performance.now() - t0 < 300)` is a wait, no bound. */
  const loopCondition = (node) => {
    let n = node
    for (;;) {
      const p = n.parent
      const logical =
        ts.isBinaryExpression(p) &&
        [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken].includes(
          p.operatorToken.kind,
        )
      const not = ts.isPrefixUnaryExpression(p) && p.operator === ts.SyntaxKind.ExclamationToken
      if (!ts.isParenthesizedExpression(p) && !logical && !not) break
      n = p
    }
    const p = n.parent
    return (
      ((ts.isWhileStatement(p) || ts.isDoStatement(p)) && p.expression === n) ||
      (ts.isForStatement(p) && p.condition === n)
    )
  }
  /** Whether a comparison sets a duration, a budget or a deadline against something. */
  const comparesTime = (n) => {
    // against zero or below it a duration is told from a mark, `failAt < 0`: no time is bounded so
    const zero = (side) => {
      const v = bare(side)
      return (
        (ts.isNumericLiteral(v) && Number(v.text) === 0) ||
        (ts.isPrefixUnaryExpression(v) && v.operator === ts.SyntaxKind.MinusToken)
      )
    }
    // a budget against zero is what is left of the time, `deadline - Date.now() > 0`: a bound (№30)
    // a mark is a name, `failAt < 0`; what is made of a duration against zero, `d - 1_000 > 0`, is a bound (Ф1)
    const mark = (side) => {
      const v = bare(side)
      const key = ts.isIdentifier(v) || ts.isPropertyAccessExpression(v) ? keyOf(v) : undefined
      return key !== undefined && marks.has(key) && sign(v) !== -1
    }
    if ((zero(n.left) && mark(n.right)) || (zero(n.right) && mark(n.left))) return false
    if (sign(n.left) !== 0 || sign(n.right) !== 0) return true
    const point = (side) => isReading(side) || isDeadline(side) || isLowered(side)
    return point(n.left) && point(n.right) && !(isReading(n.left) && isReading(n.right))
  }

  /** What a node asserts, as pairs held `small < big`; a side left out is any value. */
  const boundedAbove = (node) => {
    // if (d > n) throw …, if (d > n) expect.fail(…)
    if (ts.isIfStatement(node) && fails(node.thenStatement)) {
      judge(node.expression)
      return asserted(node.expression, false)
    }
    const pairs = []
    if (!ts.isCallExpression(node)) return pairs
    const callee = calleeText(node)
    // expect(d < n).toBe(true), expect(d > n).toBe(false), expect.soft(n > d).toBeTruthy()
    if (EXPECT.has(callee)) {
      judge(node.arguments[0])
      pairs.push(...asserted(node.arguments[0], expectedTruth(node)))
    }
    // assert(d < n), assert.isFalse(d > n), assert.strictEqual(d < n, true)
    if (/^(chai\.)?assert(\.\w+)?$/.test(callee)) {
      judge(node.arguments[0])
      pairs.push(...asserted(node.arguments[0], assertedTruth(callee, node)))
    }
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
    (small !== undefined && big !== undefined && isReading(small) && isDeadline(big)) ||
    (small !== undefined &&
      big !== undefined &&
      isLowered(small) &&
      (isReading(big) || isDeadline(big)))

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

  /** Names given a negative number, a mark of «not yet»: `let failAt = -1` (Х4, №36). */
  const marks = new Set()
  /** Names a method of their own filled with a duration — a helper's parameter fills its argument (Х5). */
  const filled = new Set()
  /** The calls a function of the file makes of a callback it is given, by the callback's place. */
  const calledBack = new Map()

  // Learn the readings, the carriers and the helpers until nothing new is learnt.
  for (let grown = true; grown;) {
    grown = false
    const learn = (key, set) => {
      if (key === undefined || set.has(key)) return
      set.add(key)
      grown = true
    }
    /** The fields of an object literal, each under `key.field`. */
    const shape = (key, object) => {
      for (const property of object.properties) {
        const name = property.name && nameOfField(property.name)
        if (name === undefined) continue
        if (ts.isPropertyAssignment(property)) given(`${key}.${name}`, property.initializer)
        if (ts.isShorthandPropertyAssignment(property)) {
          const value = checker.getShorthandAssignmentValueSymbol(property)
          const valueKey = value ? keyOfSymbol(value) : undefined
          if (valueKey !== undefined && readings.has(valueKey)) learn(`${key}.${name}`, readings)
          else if (valueKey !== undefined && carriers.has(valueKey))
            learn(`${key}.${name}`, carriers)
        }
      }
    }
    /** A name standing for another key: what it is read by, it reads there (`row.took` is `rows[].took`). */
    const standFor = (name, key) => {
      const own = symbolKey(name)
      if (own === key || instances.get(own) === key) return
      instances.set(own, key)
      grown = true
    }
    /**
     * What a binding takes from `value`: a store of durations whole gives a duration to each name; an
     * object, or a store of objects (`element`), gives each name its own field.
     */
    const take = (name, value, element) => {
      const v = bare(value)
      const key = ts.isIdentifier(v) || ts.isPropertyAccessExpression(v) ? keyOf(v) : undefined
      // the fields known, each name is its own field — `{ tries }` beside `took` is a count (Ф4)
      const at = key === undefined ? undefined : element ? `${key}[]` : key
      if (at !== undefined && fieldsUnder(at)) {
        if (ts.isIdentifier(name)) return standFor(name, at)
        if (ts.isObjectBindingPattern(name)) {
          for (const e of name.elements) {
            const field = nameOfField(e.propertyName ?? e.name)
            if (field === undefined || !ts.isIdentifier(e.name)) continue
            const k = `${at}.${field}`
            if (readings.has(k)) learn(symbolKey(e.name), readings)
            else if (carriers.has(k)) learn(symbolKey(e.name), carriers)
          }
          return
        }
      }
      if (isReading(v)) learnNames(name, readings)
      else if (carries(v)) learnNames(name, carriers)
    }
    /** Each name a binding gives — `d`, `{ took }`, `[, ms]` — as what its value is. */
    const learnNames = (name, set) => {
      if (ts.isIdentifier(name)) learn(symbolKey(name), set)
      else
        for (const element of name.elements)
          if (ts.isBindingElement(element)) learnNames(element.name, set)
    }
    /** A name standing for a clock. */
    const alias = (id, path) => {
      const key = symbolKey(id)
      if (aliases.get(key)?.path === path) return
      aliases.set(key, { path })
      grown = true
    }
    /** A value given to a name or a field: a reading, a duration, a budget or a deadline. */
    const given = (key, value) => {
      if (key === undefined || !value) return
      const v = bare(value)
      // { took: d, retries: 1 }: each field by its own name, so a count beside a duration is a count (Ф4)
      if (ts.isObjectLiteralExpression(v)) shape(key, v)
      // [{ took: d, tries: 1 }]: each field of the elements by its name
      if (
        ts.isArrayLiteralExpression(v) &&
        v.elements.length > 0 &&
        v.elements.every((e) => ts.isObjectLiteralExpression(bare(e)))
      ) {
        for (const e of v.elements) shape(`${key}[]`, bare(e))
      }
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
        if (from === 'process' && clause?.name) alias(clause.name, 'process')
        if (from === 'process' && bindings && ts.isNamespaceImport(bindings))
          alias(bindings.name, 'process')
        if (bindings && ts.isNamedImports(bindings))
          for (const element of bindings.elements) {
            const name = (element.propertyName ?? element.name).text
            if (from === 'perf_hooks' && name === 'performance') alias(element.name, 'performance')
            if (from === 'process' && name === 'hrtime') alias(element.name, 'process.hrtime')
          }
      }
      if (ts.isVariableDeclaration(node) && node.initializer) {
        const path = clockPath(node.initializer)
        if (path !== undefined && ts.isIdentifier(node.name) && path !== '')
          // const perf = performance, const now = Date.now, const now = performance.now.bind(performance)
          alias(node.name, path)
        else if (path !== undefined && ts.isObjectBindingPattern(node.name)) {
          // const { now } = Date, const { hrtime } = process, const { performance } = globalThis
          for (const element of node.name.elements) {
            const name = (element.propertyName ?? element.name).getText(sf)
            const whole = path === '' ? name : `${path}.${name}`
            if (CLOCK_PATHS.has(whole) && ts.isIdentifier(element.name)) alias(element.name, whole)
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
      // took.push(d), calls.push(Date.now()), took.set('a', d): what a name of the file is handed by any
      // method of its own holds it, and whatever is read from it back carries it (У2) — a function of the
      // file is handed it in its parameter instead
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        !ITERATE.has(node.expression.name.text) &&
        !functionOf(node.expression) &&
        !imported(node.expression.expression)
      ) {
        // what a name of the file is handed by a method of its own it holds, and gives back — a store
        // made anywhere, a field of an object, a wrapper (Х1, №35); a count of it is no time (`.length`)
        const into = keyOf(node.expression.expression)
        if (into !== undefined && !into.startsWith('global:')) {
          for (const a of node.arguments)
            if (ts.isObjectLiteralExpression(bare(a))) shape(`${into}[]`, bare(a))
          if (node.arguments.some(isReading)) learn(into, readings)
          else if (node.arguments.some(carries)) {
            learn(into, carriers)
            learn(into, filled)
          }
        }
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
            // function* durations(): what it yields is what it gives (Ф2)
            if (ts.isYieldExpression(n) && n.expression && !n.asteriskToken)
              returned.push(n.expression)
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
      const negative = (value) => {
        const v = value && bare(value)
        return (
          v !== undefined &&
          ts.isPrefixUnaryExpression(v) &&
          v.operator === ts.SyntaxKind.MinusToken &&
          ts.isNumericLiteral(bare(v.operand))
        )
      }
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        negative(node.initializer)
      )
        learn(symbolKey(node.name), marks)
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        negative(node.right)
      )
        learn(keyOf(node.left), marks)
      // for (const d of took): each element is what the array holds (adversarial Т1)
      if (ts.isForOfStatement(node) && ts.isVariableDeclarationList(node.initializer)) {
        const [declaration] = node.initializer.declarations
        // for (const { took } of rows), for (const [, ms] of Object.entries(times)) (У1)
        if (declaration) take(declaration.name, node.expression, true)
      }
      if (ts.isCallExpression(node)) {
        /** A parameter of a function given what a value is: a reading or a duration. */
        const hand = (fn, place, value, element = false) => {
          const parameter = fn.parameters[place]
          if (!parameter) return
          // a helper that bounds the parameter is refused where it is called, once
          const bounded = declaredKey(fn)
          if (bounded !== undefined && bounders.get(bounded)?.includes(place)) return
          // rows.every(({ took }) => took < 1_000): each name the parameter gives (У1)
          take(parameter.name, value, element)
        }
        // took.forEach((d) => …), took.every(fast): the callback is handed what the array holds (Т1)
        const method = ts.isPropertyAccessExpression(node.expression)
          ? ITERATE.get(node.expression.name.text)
          : undefined
        const callback = method && node.arguments[0] && functionOf(node.arguments[0])
        if (callback)
          for (const place of method) hand(callback, place, node.expression.expression, true)
        // slow(took): a function of the file is handed what each argument is (Т2)
        const called = functionOf(node.expression)
        if (called)
          node.arguments.forEach((argument, place) => {
            hand(called, place, argument)
            // record(ds): what the helper's parameter was filled with, its argument holds (Х5)
            const parameter = called.parameters[place]
            const at =
              parameter && ts.isIdentifier(parameter.name) ? symbolKey(parameter.name) : undefined
            if (at !== undefined && filled.has(at)) {
              learn(keyOf(argument), carriers)
              learn(keyOf(argument), filled)
            }
          })
        // then(performance.now() - t0) in a helper: what it hands the callback it was given, the callback
        // of each call of the helper takes (Ф3)
        const callee = bare(node.expression)
        const declaration = ts.isIdentifier(callee)
          ? checker.getSymbolAtLocation(callee)?.valueDeclaration
          : undefined
        if (declaration && ts.isParameter(declaration) && ts.isFunctionLike(declaration.parent)) {
          const helper = declaration.parent
          const place = helper.parameters.indexOf(declaration)
          const handed = calledBack.get(helper) ?? []
          if (!handed.some((h) => h.call === node)) {
            calledBack.set(helper, [...handed, { place, call: node }])
            grown = true
          }
        }
        if (called)
          for (const { place, call } of calledBack.get(called) ?? []) {
            const callback = node.arguments[place] && functionOf(node.arguments[place])
            if (callback)
              call.arguments.forEach((argument, at) => {
                hand(callback, at, argument)
              })
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

  /** Whether a line says what it compares is no duration: `// not a duration: a count of retries`. */
  const lines = sf.text.split('\n')
  const NOT_TIME = /\/\/\s*not a duration:\s*\S/
  const declared = (node) => {
    const line = sf.getLineAndCharacterOfPosition(node.getStart()).line
    const above = lines[line - 1] ?? ''
    // the line above counts only as a line of its own, never the end of the line before (Х3)
    return NOT_TIME.test(lines[line] ?? '') || (/^\s*\/\//.test(above) && NOT_TIME.test(above))
  }
  /**
   * Whether a side is a duration read straight: the clock, a name it was given, a difference of them. The
   * note never takes those (review №34): it is for what is held as time only in doubt — a field of an
   * object, an element of a store, a comparison kept apart.
   */
  const direct = (side) => {
    const n = side && core(side)
    if (!n) return false
    if (isReading(n) || isDeadline(n) || isLowered(n)) return true
    if (ts.isIdentifier(n)) {
      const key = keyOf(n)
      return key !== undefined && (carriers.has(key) || budgets.has(key) || timers.has(key))
    }
    if (ts.isPrefixUnaryExpression(n)) return direct(n.operand)
    if (ts.isBinaryExpression(n)) return direct(n.left) || direct(n.right)
    if (ts.isCallExpression(n) && /^Math\.(max|min|abs)$/.test(calleeText(n)))
      return n.arguments.some(direct)
    return false
  }
  /** Each note that let a bound go, as `line: text`, for the log: review reads them there. */
  const noted = []

  const found = []
  const at = (node) =>
    `${String(sf.getLineAndCharacterOfPosition(node.getStart()).line + 1)}: ${node.getText(sf).split('\n')[0]}`
  const walk = (node) => {
    const pairs = boundedAbove(node).filter((pair) => breaks(pair))
    let raw = pairs.length > 0
    let straight = pairs.some(({ small, big }) => direct(small) || direct(big))
    // a comparison of time no assertion reads where it stands — kept in a name, handed to a callback, a
    // condition — is held as a bound: in doubt it is one, and `expectWithin` is its lawful spelling (Т1, Т2)
    if (
      !raw &&
      ts.isBinaryExpression(node) &&
      (LESS.includes(node.operatorToken.kind) || MORE.includes(node.operatorToken.kind)) &&
      !judged.has(node) &&
      !loopCondition(node) &&
      comparesTime(node)
    ) {
      raw = true
      straight = direct(node.left) || direct(node.right)
    }
    if (!raw && ts.isCallExpression(node)) {
      const key = keyOf(node.expression)
      const places = key === undefined ? undefined : bounders.get(key)
      const handed = (places ?? [])
        .map((place) => node.arguments[place])
        .filter((argument) => argument && carries(argument))
      raw = handed.length > 0
      straight = handed.some(direct)
    }
    // a lawful spelling of what is held as time in doubt and is none — a count kept beside a duration
    if (raw && !straight && declared(node)) noted.push(at(node))
    else if (raw) found.push(at(node))
    ts.forEachChild(node, walk)
  }
  walk(sf)
  return { found, noted }
}

/**
 * Every bound on a duration in one file that does not go through `expectWithin`, as `line: text`.
 * @param {string} fileName
 * @param {string} source
 * @returns {string[]}
 */
export function rawBounds(fileName, source) {
  return boundsOf(fileName, source).found
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop() ?? '')) {
  const files = execFileSync('git', ['ls-files', ...FILES], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter(Boolean)
  const notes = []
  const problems = files.flatMap((file) => {
    const source = readFileSync(file, 'utf8')
    // a file that never reads the clock holds no duration: the binder is spared it
    if (!/\.now\b|\bDate\b|hrtime|uptime/.test(source)) return []
    const { found, noted } = boundsOf(file, source)
    notes.push(...noted.map((line) => `  ${file}:${line}`))
    return found.map((line) => `  ${file}:${line}`)
  })
  // what a note let go is printed on every run, so review finds it in the log (review №34)
  if (notes.length > 0) {
    console.log(
      `clock bounds: ${String(notes.length)} let go by «not a duration» — review reads them:`,
    )
    for (const note of notes) console.log(note)
  }
  if (problems.length > 0) {
    console.error(
      `clock bounds: ${String(problems.length)} not through expectWithin — a lower bound is asserted where it stands, expect(d).toBeGreaterThanOrEqual(n) (CLAUDE.md › Testing, MOL-266)`,
    )
    for (const problem of problems) console.error(problem)
    process.exitCode = 1
  }
}
