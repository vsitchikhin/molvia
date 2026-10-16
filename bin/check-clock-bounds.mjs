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
// `new Date()` and its `getTime()`, through `globalThis`, `Number()`, `Math.floor(… / 1000)`; a function of
// the file that returns one (`const now = () => performance.now()`, `const { now } = performance`); a
// name, a field, a field of a class (`this.start`) or a shorthand field given one; an array of them —
// pushed, by index, `at()`. A duration: a subtraction of two readings and whatever is made of it — a
// name, a field, an object or array it is put in (`=`, `+=`, `push`) or taken apart from, a function of
// the file or a method that returns it, a call of one that subtracts a reading it takes from the clock
// however it rounds (`since(t0)`), `process.hrtime(t0)`, `performance.measure()`.
//
// Refused is an upper bound on a duration — `toBeLessThan`, `toBeLessThanOrEqual`, chai's `lessThan`,
// `below`, `lt`, `lte`, `most`, `within`, `toBeCloseTo`; `not` before a lower bound; a lower bound with
// the duration on the other side; a comparison under `expect`, `expect.soft` or any `assert`; `toSatisfy`
// with a comparison, inline or a function of the file; `if (d > n)` that throws or fails; a call of a
// function of the file that bounds its parameter so — and a deadline: a reading bounded by a reading
// plus a number (`expect(Date.now()).toBeLessThan(deadline)`). A lower bound is no breach of time; the age
// of a stamp — the clock against a moment a row holds — is no duration, as one side is not the clock;
// and a bound where `vi.useFakeTimers()` fakes that clock is not one either: no runner moves fake time.
//
// The price, named (`workspace.md`): what is not in the lists above is not seen — a duration the code
// under test measures (`metrics`' lag), a helper imported from another file, a reading kept in a
// structure the lists do not name, a fake clock turned on by a helper of another file. Those go to
// `expectWithin`, or are left, by review.
//
//   node bin/check-clock-bounds.mjs

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import process from 'node:process'
import ts from 'typescript'

/** The files a vitest run reads: tests, the helpers beside the integration tests, a package's test helpers. */
const FILES = ['*.test.ts', '*.test.mts', 'backend/tests/*.ts', 'packages/*/tests/*.ts']

/** A reading of the clock, with `globalThis.`, `window.` or `self.` taken off first. */
const CLOCK = /^(performance\.now|Date\.now|process\.hrtime\.bigint|process\.hrtime)$/
/** What a reading is still a reading through: a cast, and whole seconds of it. */
const SAME = /^(Number|BigInt|Math\.(round|floor|ceil|trunc))$/
/** A duration the platform measures itself. */
const MEASURED = /^(performance\.measure|process\.hrtime)$/
/** Which fake of `vi.useFakeTimers({ toFake })` each clock is. */
const FAKED_AS = { performance: 'performance', Date: 'Date', process: 'hrtime' }
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
const EXPECT = new Set(['expect', 'expect.soft', 'chai.expect'])
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
  const calleeText = (call) =>
    call.expression
      .getText(sf)
      .replace(/^(globalThis|window|self)\./, '')
      .replace(/\s+/g, '')
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
  /** The key a function or a method is called by, from where it is declared. */
  const declaredKey = (fn) => {
    const parent = fn.parent
    if ((ts.isFunctionDeclaration(fn) || ts.isFunctionExpression(fn)) && fn.name)
      return symbolKey(fn.name)
    if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name))
      return symbolKey(parent.name)
    if (ts.isMethodDeclaration(fn) && ts.isClassLike(parent) && parent.name)
      return `${symbolKey(parent.name)}.${fn.name.getText(sf)}`
    if (ts.isPropertyDeclaration(parent) && ts.isClassLike(parent.parent) && parent.parent.name)
      return `${symbolKey(parent.parent.name)}.${parent.name.getText(sf)}`
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
  /** Functions that return a duration. */
  const timers = new Set()
  /** Functions that subtract a parameter from the clock, by the parameter's place: `since(t0)`. */
  const since = new Map()
  /** Functions that bound a parameter from above, by its place: `within(d)`. */
  const bounders = new Map()
  /** Functions whose answer is their parameter compared from above: `const fast = (ms) => ms < 200`. */
  const predicates = new Set()

  const isNewDate = (node) => {
    const n = bare(node)
    return ts.isNewExpression(n) && n.expression.getText(sf) === 'Date' && !n.arguments?.length
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
  /** Whether anything in a value is a reading or a deadline: what a deadline is bounded by. */
  const mentionsReading = (node) => {
    let found = false
    const walk = (n) => {
      if (found) return
      if (isReading(n)) found = true
      else if (ts.isIdentifier(n) || ts.isPropertyAccessExpression(n)) {
        const key = keyOf(n)
        if (key !== undefined && deadlines.has(key)) found = true
        else if (ts.isPropertyAccessExpression(n)) walk(n.expression)
      } else ts.forEachChild(n, walk)
    }
    walk(node)
    return found
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
   * carries one, a call that subtracts its reading from the clock, a duration the platform measured —
   * anywhere inside it.
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
        const callee = calleeText(n)
        if (MEASURED.test(callee) && (callee !== 'process.hrtime' || n.arguments.length > 0)) {
          found = true
          return
        }
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

  /** A check of `toSatisfy`, or a predicate of the file: whether it bounds its parameter from above. */
  const boundsItsParameter = (fn) => {
    const answers = []
    if (ts.isBlock(fn.body)) {
      const returns = (n) => {
        if (ts.isReturnStatement(n) && n.expression) answers.push(n.expression)
        if (n !== fn.body && ts.isFunctionLike(n)) return
        ts.forEachChild(n, returns)
      }
      returns(fn.body)
    } else answers.push(fn.body)
    return answers.some((answer) => {
      const a = bare(answer)
      if (!ts.isBinaryExpression(a)) return false
      if (LESS.includes(a.operatorToken.kind)) return parameterAt(a.left, fn) === 0
      if (MORE.includes(a.operatorToken.kind)) return parameterAt(a.right, fn) === 0
      return false
    })
  }

  /** The sides of a comparison: what is bounded from above, and by what — of its failing case, `if`'s. */
  const comparison = (node, failing = false) => {
    const c = node && bare(node)
    if (!c || !ts.isBinaryExpression(c)) return []
    const below = failing ? MORE : LESS
    const above = failing ? LESS : MORE
    if (below.includes(c.operatorToken.kind)) return [{ measured: c.left, limit: c.right }]
    if (above.includes(c.operatorToken.kind)) return [{ measured: c.right, limit: c.left }]
    return []
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

  /** What a node bounds from above, if anything: each measured value and what it is held below. */
  const boundedAbove = (node) => {
    // if (d > n) throw …, if (d > n) expect.fail(…)
    if (ts.isIfStatement(node) && fails(node.thenStatement))
      return comparison(node.expression, true)
    const pairs = []
    if (!ts.isCallExpression(node)) return pairs
    const callee = calleeText(node)
    // expect(d < n), assert(n > d), assert.strictEqual(d < n, true)
    if (EXPECT.has(callee) || /^(chai\.)?assert(\.\w+)?$/.test(callee))
      pairs.push(...comparison(node.arguments[0]))
    // assert.isBelow(d, n), assert.isAtMost(d, n), assert.isAbove(n, d), assert.isAtLeast(n, d)
    if (/^assert\.(isBelow|isAtMost)$/.test(callee) && node.arguments[0])
      pairs.push({ measured: node.arguments[0], limit: node.arguments[1] })
    if (/^assert\.(isAbove|isAtLeast)$/.test(callee) && node.arguments[1])
      pairs.push({ measured: node.arguments[1], limit: node.arguments[0] })
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
        if (UPPER.has(matcher) && !negated) pairs.push({ measured: value, limit: argument })
        if (LOWER.has(matcher) && negated) pairs.push({ measured: value, limit: argument })
        if (LOWER.has(matcher) && !negated && argument)
          pairs.push({ measured: argument, limit: value })
        if (UPPER.has(matcher) && negated && argument && matcher !== 'toBeCloseTo')
          pairs.push({ measured: argument, limit: value })
        // toSatisfy((ms) => ms < n), toSatisfy((ms) => { return ms < n }), toSatisfy(fast)
        const check = argument && bare(argument)
        if (matcher === 'toSatisfy' && check && !negated) {
          const inline =
            (ts.isArrowFunction(check) || ts.isFunctionExpression(check)) &&
            boundsItsParameter(check)
          const key = keyOf(check)
          if (inline || (key !== undefined && predicates.has(key)))
            pairs.push({ measured: value, limit: undefined })
        }
      }
    }
    return pairs
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
    /** A value given to a name or a field: a reading, a duration, or a deadline. */
    const given = (key, value) => {
      if (key === undefined || !value) return
      const v = bare(value)
      if (isReading(v)) learn(key, readings)
      else if (ts.isArrayLiteralExpression(v) && v.elements.some(isReading)) learn(key, readings)
      else if (carries(v)) learn(key, carriers)
      else if (mentionsReading(v)) learn(key, deadlines)
    }
    const walk = (node) => {
      if (ts.isVariableDeclaration(node) && node.initializer) {
        if (ts.isIdentifier(node.name)) {
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
        } else if (
          ts.isObjectBindingPattern(node.name) &&
          /^(globalThis\.)?performance$/.test(node.initializer.getText(sf))
        ) {
          // const { now } = performance
          for (const element of node.name.elements) {
            const name = (element.propertyName ?? element.name).getText(sf)
            if (name === 'now' && ts.isIdentifier(element.name))
              learn(symbolKey(element.name), clocks)
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
          if (boundsItsParameter(node)) learn(key, predicates)
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
      for (const { measured } of boundedAbove(node)) {
        const fn = enclosingFunction(node)
        const at = fn ? parameterAt(measured, fn) : -1
        const key = at >= 0 ? declaredKey(fn) : undefined
        if (key !== undefined && add(bounders, key, at)) grown = true
      }
      ts.forEachChild(node, walk)
    }
    walk(sf)
  }

  // Which clocks `vi.useFakeTimers()` fakes where a bound stands: its scope, or a hook of it.
  const used = new Set(
    [...source.matchAll(/\b(performance|Date|process)\b/g)].map((m) => FAKED_AS[m[1]]),
  )
  const fakesIn = (statements) => {
    const kinds = new Set()
    const look = (statement) => {
      if (!ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression)) return
      const call = statement.expression
      const callee = calleeText(call)
      if (/(^|\.)useFakeTimers$/.test(callee)) {
        const options = call.arguments[0] && bare(call.arguments[0])
        const toFake =
          options && ts.isObjectLiteralExpression(options)
            ? options.properties.find((p) => p.name?.getText(sf) === 'toFake')
            : undefined
        const list =
          toFake && ts.isPropertyAssignment(toFake) ? bare(toFake.initializer) : undefined
        if (list && ts.isArrayLiteralExpression(list)) {
          for (const e of list.elements) if (ts.isStringLiteralLike(e)) kinds.add(e.text)
        } else for (const kind of Object.values(FAKED_AS)) kinds.add(kind)
      }
      // beforeEach(() => { vi.useFakeTimers() })
      if (/^(beforeEach|beforeAll)$/.test(callee)) {
        const fn = call.arguments[0] && bare(call.arguments[0])
        if (fn && ts.isFunctionLike(fn) && fn.body && ts.isBlock(fn.body))
          for (const kind of fakesIn(fn.body.statements)) kinds.add(kind)
      }
    }
    statements.forEach(look)
    return kinds
  }
  const fake = (node) => {
    const kinds = new Set()
    for (let n = node; n; n = n.parent) {
      if (ts.isBlock(n) || ts.isSourceFile(n))
        for (const kind of fakesIn(n.statements)) kinds.add(kind)
    }
    return [...used].every((kind) => kinds.has(kind))
  }

  const found = []
  const at = (node) =>
    `${String(sf.getLineAndCharacterOfPosition(node.getStart()).line + 1)}: ${node.getText(sf).split('\n')[0]}`
  const walk = (node) => {
    const bound = boundedAbove(node).some(
      ({ measured, limit }) =>
        carries(measured) || (isReading(measured) && limit !== undefined && mentionsReading(limit)),
    )
    let raw = bound
    if (!raw && ts.isCallExpression(node)) {
      const key = keyOf(node.expression)
      const places = key === undefined ? undefined : bounders.get(key)
      raw = Boolean(
        places?.some((place) => node.arguments[place] && carries(node.arguments[place])),
      )
    }
    if (raw && !fake(node)) found.push(at(node))
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
