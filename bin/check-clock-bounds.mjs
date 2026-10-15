// Refuses a bound on a duration a test asserts other than through `expectWithin` (MOL-266): the time
// reporter (`bin/test-time-reporter.ts`) holds a bound to ten times what it met and below the test's
// timeout only where `expectWithin` kept it, so a bound written as `expect(t1 - t0).toBeLessThan(N)`
// would be a bound on the clock the rule of MOL-243 never sees.
//
// Found by parsing, never by a line's pattern — a pattern missed three of eighteen (review of MOL-243,
// Р10-А1). A duration is a subtraction whose two sides are both readings of the clock
// (`performance.now()`, `Date.now()`, `new Date().getTime()`, `process.hrtime.bigint()`, through
// `globalThis` or `Number()` too, or a name or a field given one), and whatever is made of it carries
// it: whatever is made of it, a name, a field or an object it is put in or taken apart from, a function
// of the file that returns it, and a call of one that subtracts a reading it takes from the clock
// (`since(t0)`).
// Names are resolved by TypeScript's own binder, so a name reads the clock only in its own scope: the
// age of a stamp held under a name another test gave a reading is left alone (adversarial А5).
//
// Refused is an upper bound on such a value, in any spelling vitest or chai takes: `toBeLessThan`,
// `toBeLessThanOrEqual`, `lessThan`, `below`, `lt`, `lte`, `most`, `within`; `not` before a lower bound;
// a lower bound with the duration on the other side (`expect(n).toBeGreaterThan(d)`); a comparison
// under `expect`, `expect.soft`, `assert` (`expect(d < n)`, `assert(n > d)`); `assert.isBelow`,
// `assert.isAtMost`; `toSatisfy` with a comparison; and a call of a function of the file that bounds
// its own parameter so (`within(d)`). A lower bound is no breach of time, and the age of a stamp —
// `Date.now()` against a moment a row holds — is no duration: one side is not the clock.
//
// The price, named (CLAUDE.md, `workspace.md`): a duration the code under test measures — `metrics`'
// lag — has no clock in the test to be found by, and a helper of another file, imported, is not
// followed. Those go to `expectWithin` by review.
//
//   node bin/check-clock-bounds.mjs

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import process from 'node:process'
import ts from 'typescript'

/** The files a vitest run reads: tests, the helpers beside the integration tests, a package's test helpers. */
const FILES = ['*.test.ts', '*.test.mts', 'backend/tests/*.ts', 'packages/*/tests/*.ts']

/** A reading of the clock, with `globalThis.`, `window.` or `self.` taken off first. */
const CLOCK = /^(performance\.now|Date\.now|process\.hrtime\.bigint)$/
/** Wrappers that keep a reading a reading. */
const SAME = /^(Number|BigInt)$/
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
const EXPECT = new Set(['expect', 'expect.soft', 'chai.expect'])
const ASSERT = new Set(['assert', 'assert.ok', 'assert.isTrue', 'chai.assert'])
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
 * Every bound on a duration in one file that does not go through `expectWithin`, as `line: text`.
 * @param {string} fileName
 * @param {string} source
 * @returns {string[]}
 */
export function rawBounds(fileName, source) {
  const { sf, checker } = bind(fileName, source)

  /** @type {Map<ts.Symbol, number>} */
  const ids = new Map()
  const symbolKey = (id) => {
    const symbol = checker.getSymbolAtLocation(id)
    if (!symbol) return `global:${id.text}`
    if (!ids.has(symbol)) ids.set(symbol, ids.size)
    return `#${String(ids.get(symbol))}`
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
  /** A name or a chain of fields from one, as a key its declaration shares; `undefined` for anything else. */
  const keyOf = (node) => {
    const n = bare(node)
    if (ts.isIdentifier(n)) return symbolKey(n)
    if (ts.isPropertyAccessExpression(n)) {
      const root = keyOf(n.expression)
      return root === undefined ? undefined : `${root}.${n.name.text}`
    }
    return undefined
  }
  /** The key a function or a method is called by, from where it is declared. */
  const declaredKey = (fn) => {
    const parent = fn.parent
    if ((ts.isFunctionDeclaration(fn) || ts.isFunctionExpression(fn)) && fn.name)
      return symbolKey(fn.name)
    if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name))
      return symbolKey(parent.name)
    const member = ts.isMethodDeclaration(fn)
      ? fn
      : ts.isPropertyAssignment(parent)
        ? parent
        : undefined
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
  const calleeText = (call) =>
    call.expression
      .getText(sf)
      .replace(/^(globalThis|window|self)\./, '')
      .replace(/\s+/g, '')

  const readings = new Set()
  const carriers = new Set()
  /** Functions that return a duration. */
  const timers = new Set()
  /** Functions that subtract a parameter from the clock, by the parameter's place: `since(t0)`. */
  const since = new Map()
  /** Functions that bound a parameter from above, by its place: `within(d)`. */
  const bounders = new Map()

  const isReading = (node) => {
    const n = bare(node)
    if (ts.isCallExpression(n)) {
      const callee = calleeText(n)
      if (CLOCK.test(callee)) return true
      if (SAME.test(callee) && n.arguments.length === 1) return isReading(n.arguments[0])
      // new Date().getTime(), new Date().valueOf()
      if (
        ts.isPropertyAccessExpression(n.expression) &&
        ['getTime', 'valueOf'].includes(n.expression.name.text)
      ) {
        const date = bare(n.expression.expression)
        return (
          ts.isNewExpression(date) &&
          date.expression.getText(sf) === 'Date' &&
          !date.arguments?.length
        )
      }
      return false
    }
    // +new Date()
    if (ts.isPrefixUnaryExpression(n) && n.operator === ts.SyntaxKind.PlusToken) {
      const date = bare(n.operand)
      return (
        ts.isNewExpression(date) &&
        date.expression.getText(sf) === 'Date' &&
        !date.arguments?.length
      )
    }
    const key = keyOf(n)
    return key !== undefined && readings.has(key)
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
   * Whether a value holds a duration: a subtraction of two readings, a name, field or function that
   * carries one, or a call that subtracts its reading from the clock — anywhere inside it.
   */
  const carries = (node) => {
    let found = false
    const walk = (n) => {
      if (found) return
      if (
        ts.isBinaryExpression(n) &&
        n.operatorToken.kind === ts.SyntaxKind.MinusToken &&
        isReading(n.left) &&
        isReading(n.right)
      ) {
        found = true
        return
      }
      if (ts.isCallExpression(n)) {
        const key = keyOf(n.expression)
        const places = key === undefined ? undefined : since.get(key)
        if (places?.some((place) => n.arguments[place] && isReading(n.arguments[place]))) {
          found = true
          return
        }
      }
      if (ts.isIdentifier(n) || ts.isPropertyAccessExpression(n)) {
        const key = keyOf(n)
        if (key !== undefined && (carriers.has(key) || timers.has(key))) {
          found = true
          return
        }
        // a field's own name is no mention of anything
        if (ts.isPropertyAccessExpression(n)) walk(n.expression)
        return
      }
      ts.forEachChild(n, walk)
    }
    walk(node)
    return found
  }

  /** What an expression's value is bounded by from above, if anything: the measured sides of `node`. */
  const boundedAbove = (node) => {
    const measured = []
    if (!ts.isCallExpression(node)) return measured
    const callee = calleeText(node)
    // expect(d < n), assert(n > d)
    if (EXPECT.has(callee) || ASSERT.has(callee)) {
      const condition = node.arguments[0] && bare(node.arguments[0])
      if (condition && ts.isBinaryExpression(condition)) {
        if (LESS.includes(condition.operatorToken.kind)) measured.push(condition.left)
        if (MORE.includes(condition.operatorToken.kind)) measured.push(condition.right)
      }
    }
    // assert.isBelow(d, n), assert.isAtMost(d, n), assert.isAbove(n, d), assert.isAtLeast(n, d)
    if (/^assert\.(isBelow|isAtMost)$/.test(callee) && node.arguments[0])
      measured.push(node.arguments[0])
    if (/^assert\.(isAbove|isAtLeast)$/.test(callee) && node.arguments[1])
      measured.push(node.arguments[1])
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
        if (UPPER.has(matcher) && !negated) measured.push(value)
        if (LOWER.has(matcher) && negated) measured.push(value)
        if (LOWER.has(matcher) && !negated && node.arguments[0]) measured.push(node.arguments[0])
        if (UPPER.has(matcher) && negated && node.arguments[0]) measured.push(node.arguments[0])
        // toSatisfy((ms) => ms < n)
        const check = node.arguments[0] && bare(node.arguments[0])
        if (
          matcher === 'toSatisfy' &&
          check &&
          ts.isArrowFunction(check) &&
          !ts.isBlock(check.body)
        ) {
          const body = bare(check.body)
          const own = (side) => parameterAt(side, check) === 0
          if (ts.isBinaryExpression(body)) {
            if (LESS.includes(body.operatorToken.kind) && own(body.left)) measured.push(value)
            if (MORE.includes(body.operatorToken.kind) && own(body.right)) measured.push(value)
          }
        }
      }
    }
    return measured
  }

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

  // Learn the readings, the carriers and the helpers until nothing new is learnt.
  for (let grown = true; grown;) {
    grown = false
    const learn = (key, set) => {
      if (key === undefined || set.has(key)) return
      set.add(key)
      grown = true
    }
    const walk = (node) => {
      if (ts.isVariableDeclaration(node) && node.initializer) {
        if (ts.isIdentifier(node.name)) {
          if (isReading(node.initializer)) learn(symbolKey(node.name), readings)
          else if (carries(node.initializer)) learn(symbolKey(node.name), carriers)
        } else if (carries(node.initializer)) {
          // const { elapsed } = measure(): every name taken from a duration's object carries it
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
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
        if (isReading(node.right)) learn(keyOf(node.left), readings)
        else if (carries(node.right)) {
          // `reached[code] = Date.now() - begun`: the field, and the object it is put in, carry it
          learn(keyOf(node.left), carriers)
          let root = node.left
          while (ts.isElementAccessExpression(root) || ts.isPropertyAccessExpression(root))
            root = root.expression
          learn(keyOf(root), carriers)
        }
      }
      if (ts.isPropertyAssignment(node) && ts.isVariableDeclaration(node.parent.parent)) {
        const owner = node.parent.parent
        if (ts.isIdentifier(owner.name)) {
          const key = `${symbolKey(owner.name)}.${node.name.getText(sf)}`
          if (isReading(node.initializer)) learn(key, readings)
          else if (carries(node.initializer)) learn(key, carriers)
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
          if (!timers.has(key) && returned.some(carries)) learn(key, timers)
          for (const value of returned) {
            const v = bare(value)
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
      for (const measured of boundedAbove(node)) {
        const fn = enclosingFunction(node)
        const at = fn ? parameterAt(measured, fn) : -1
        const key = at >= 0 ? declaredKey(fn) : undefined
        if (key !== undefined && add(bounders, key, at)) grown = true
      }
      ts.forEachChild(node, walk)
    }
    walk(sf)
  }

  const found = []
  const at = (node) =>
    `${String(sf.getLineAndCharacterOfPosition(node.getStart()).line + 1)}: ${node.getText(sf).split('\n')[0]}`
  const walk = (node) => {
    if (boundedAbove(node).some(carries)) found.push(at(node))
    else if (ts.isCallExpression(node)) {
      const key = keyOf(node.expression)
      const places = key === undefined ? undefined : bounders.get(key)
      if (places?.some((place) => node.arguments[place] && carries(node.arguments[place])))
        found.push(at(node))
    }
    ts.forEachChild(node, walk)
  }
  walk(sf)
  return found
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop() ?? '')) {
  const files = execFileSync('git', ['ls-files', ...FILES], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter(Boolean)
  const problems = files.flatMap((file) => {
    const source = readFileSync(file, 'utf8')
    // a file that never reads the clock holds no duration: the binder is spared it
    if (!/\.now\(|\bDate\b|hrtime/.test(source)) return []
    return rawBounds(file, source).map((line) => `  ${file}:${line}`)
  })
  if (problems.length > 0) {
    console.error(
      `clock bounds: ${String(problems.length)} not through expectWithin (CLAUDE.md › Testing, MOL-266)`,
    )
    for (const problem of problems) console.error(problem)
    process.exitCode = 1
  }
}
