// Refuses a bound on a duration a test asserts other than through `expectWithin` (MOL-266): the time
// reporter (`bin/test-time-reporter.ts`) holds a bound to five times what it met and below the test's
// timeout only where `expectWithin` kept it, so a bound written as `expect(t1 - t0).toBeLessThan(N)`
// would be a bound on the clock the rule of MOL-243 never sees.
//
// Found by parsing, never by a line's pattern — a pattern missed three of eighteen (review of MOL-243,
// Р10-А1): a duration is a subtraction whose two sides are both readings of the clock
// (`performance.now()`, `Date.now()`, `process.hrtime.bigint()`, or a name given one), and whatever is
// made of it — a name, a function of the file that returns it, a call or a mention of that function —
// carries it. Refused is an upper bound on such a value: `toBeLessThan`, `toBeLessThanOrEqual`, or
// `expect(d < n)`. A lower bound is no breach of time, and the age of a stamp — `Date.now()` against a
// moment a row holds — is no duration: one side is not the clock (the rule's «the age of a stamp»).
//
// The price, named: a duration the code under test measures — `metrics`' lag — has no clock in the
// test to be found by; it goes to `expectWithin` by review, and the rule says so.
//
//   node bin/check-clock-bounds.mjs

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import process from 'node:process'
import ts from 'typescript'

/** The files a vitest run reads: tests and the helpers beside the integration tests. */
const FILES = ['*.test.ts', '*.test.mts', 'backend/tests/*.ts']

const CLOCK = /^(performance\.now|Date\.now|process\.hrtime\.bigint)$/
const UPPER = new Set(['toBeLessThan', 'toBeLessThanOrEqual'])

/**
 * Every bound on a duration in one file that does not go through `expectWithin`, as `line: text`.
 * @param {string} fileName
 * @param {string} source
 * @returns {string[]}
 */
export function rawBounds(fileName, source) {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true)
  const isClock = (node) => ts.isCallExpression(node) && CLOCK.test(node.expression.getText(sf))
  const readings = new Set()
  const carriers = new Set()

  const collectReadings = (node) => {
    if (ts.isVariableDeclaration(node) && node.initializer && isClock(node.initializer)) {
      readings.add(node.name.getText(sf))
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      isClock(node.right)
    ) {
      readings.add(node.left.getText(sf))
    }
    ts.forEachChild(node, collectReadings)
  }
  collectReadings(sf)

  const isReading = (node) => isClock(node) || (ts.isIdentifier(node) && readings.has(node.text))
  /** Whether a node holds a duration: a subtraction of two readings, or a name that carries one. */
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
      } else if (ts.isIdentifier(n) && carriers.has(n.text)) {
        found = true
      } else ts.forEachChild(n, walk)
    }
    walk(node)
    return found
  }
  // a name given a duration, and a function that returns one, carry it — until nothing new is found
  for (let grown = true; grown;) {
    grown = false
    const walk = (node) => {
      let name
      let body
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        name = node.name.text
        body = node.initializer
      } else if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        carries(node.right)
      ) {
        // `reached[code] = Date.now() - begun`: the object a duration is put into carries it
        let root = node.left
        while (ts.isElementAccessExpression(root) || ts.isPropertyAccessExpression(root))
          root = root.expression
        if (ts.isIdentifier(root) && !carriers.has(root.text)) {
          carriers.add(root.text)
          grown = true
        }
      } else if (ts.isFunctionDeclaration(node) && node.name && node.body) {
        name = node.name.text
        body = node.body
      }
      if (name && !carriers.has(name) && body) {
        const returned = []
        const returns = (n) => {
          if (ts.isReturnStatement(n) && n.expression) returned.push(n.expression)
          // an inner function's returns are its own
          if (n !== body && (ts.isFunctionLike(n) || ts.isClassLike(n))) return
          ts.forEachChild(n, returns)
        }
        const fn = ts.isArrowFunction(body) || ts.isFunctionExpression(body) ? body.body : body
        if (ts.isBlock(fn)) returns(fn)
        else returned.push(fn)
        if (returned.some(carries)) {
          carriers.add(name)
          grown = true
        }
      }
      ts.forEachChild(node, walk)
    }
    walk(sf)
  }

  const found = []
  const at = (node) =>
    `${String(sf.getLineAndCharacterOfPosition(node.getStart()).line + 1)}: ${node.getText(sf).split('\n')[0]}`
  const walk = (node) => {
    // expect(d).toBeLessThan(n), expect(d).toBeLessThanOrEqual(n)
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      UPPER.has(node.expression.name.text)
    ) {
      let subject = node.expression.expression
      while (ts.isPropertyAccessExpression(subject) && subject.name.text !== 'not')
        subject = subject.expression
      if (ts.isCallExpression(subject) && subject.expression.getText(sf) === 'expect') {
        const [measured] = subject.arguments
        if (measured && carries(measured)) found.push(at(node))
      }
    }
    // expect(d < n)
    if (ts.isCallExpression(node) && node.expression.getText(sf) === 'expect') {
      const [measured] = node.arguments
      if (
        measured &&
        ts.isBinaryExpression(measured) &&
        [ts.SyntaxKind.LessThanToken, ts.SyntaxKind.LessThanEqualsToken].includes(
          measured.operatorToken.kind,
        ) &&
        carries(measured.left)
      ) {
        found.push(at(node))
      }
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
  const problems = files.flatMap((file) =>
    rawBounds(file, readFileSync(file, 'utf8')).map((line) => `  ${file}:${line}`),
  )
  if (problems.length > 0) {
    console.error(
      `clock bounds: ${String(problems.length)} not through expectWithin (CLAUDE.md › Testing, MOL-266)`,
    )
    for (const problem of problems) console.error(problem)
    process.exitCode = 1
  }
}
