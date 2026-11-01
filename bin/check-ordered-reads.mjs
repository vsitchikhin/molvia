// Refuses a read of Postgres with no ORDER BY that an integration test compares by position (MOL-323):
// without one Postgres promises no order, and `clearAll` empties the tables by `DELETE`, so a row inserted
// later may come back first. «То же фото дважды» in `feedback-bot` read its four words so and failed on a
// pull request that touched only the PWA (CI 41022785698).
//
// Found by parsing, as `check-clock-bounds.mjs` is, names resolved by TypeScript's binder. A read with no
// order: a chain of Drizzle with `select…` and `from` and no `orderBy`; `findMany` with no `orderBy`; a
// template with `select` and no `order by` — handed to `execute` or tagged on its own (postgres.js); a
// function of the file that returns one. What keeps it so: `await`, parentheses, a cast, and the methods
// that keep an order (`map`, `filter`, `flatMap`, `flat`, `slice`); `sort` and `toSorted` give it one; any
// other method — `find`, `some`, `length` — ends it. A name given it is followed by its symbol.
//
// Compared by position: `toEqual`, `toStrictEqual` or `toMatchObject` with an array of two or more written
// there, under `expect` or `expect.soft`; an index past 0 or below it (`rows[1]`, `rows.at(-1)`); taken
// apart into two or more (`const [a, b] = rows`). The first row alone (`const [row] = …`, `rows[0]`) is the
// read of one row, and is left alone.
//
// What this is: a guard against the ordinary form, not against one built to slip past it. Not seen: an array
// expected that is not written in place (`toEqual(expected)`), a helper of another file, `order by` in a
// subquery only, a read handed to a function as an argument. Those go to review.
//
//   node bin/check-ordered-reads.mjs

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import process from 'node:process'
import ts from 'typescript'

/** The files that read Postgres: the integration tests of the API. */
const FILES = ['backend/*.integration.test.ts']

/** A file that names none of these reads nothing: the binder is spared it. */
export const MAY_READ = /\bselect\b|findMany/i

/** The methods an array of rows keeps its order through. */
const KEEPS = new Set(['map', 'filter', 'flatMap', 'flat', 'slice'])
/** The methods that give it an order of their own. */
const ORDERS = new Set(['sort', 'toSorted'])
/** The matchers that compare an array element by element. */
const COMPARES = new Set(['toEqual', 'toStrictEqual', 'toMatchObject'])

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

/** Whether a template reads with no order: `select` in it and no `order by`. */
const unorderedTemplate = (template) => {
  const text = template.getText()
  return /\bselect\b/i.test(text) && !/\border\s+by\b/i.test(text)
}

/** The names of a chain of calls and fields, outermost first: `db.select().from(t).where(c)`. */
const chainOf = (node) => {
  const names = []
  let n = node
  for (;;) {
    if (ts.isCallExpression(n)) n = n.expression
    else if (ts.isPropertyAccessExpression(n)) {
      names.push(n.name.text)
      n = n.expression
    } else return names
  }
}

/**
 * Every read with no order that one file compares by position, as `line: text`.
 * @param {string} fileName
 * @param {string} source
 * @returns {string[]}
 */
export function unorderedReads(fileName, source) {
  const { sf, checker } = bind(fileName, source)
  const symbolOf = (node) => checker.getSymbolAtLocation(node)
  /** The functions of the file that return a read with no order, by their symbol. */
  const helpers = new Set()

  const isRead = (node) => {
    if (ts.isTaggedTemplateExpression(node)) {
      // handed to `execute`, the call is the read
      const handed = ts.isCallExpression(node.parent) && node.parent.arguments.includes(node)
      return !handed && unorderedTemplate(node.template)
    }
    if (!ts.isCallExpression(node)) return false
    if (ts.isIdentifier(node.expression)) return helpers.has(symbolOf(node.expression))
    if (!ts.isPropertyAccessExpression(node.expression)) return false
    // the outermost call of its chain only: `.where(…)`, not the `.from(…)` inside it
    if (ts.isPropertyAccessExpression(node.parent) && node.parent.expression === node) return false
    const method = node.expression.name.text
    const names = chainOf(node)
    if (names.some((name) => name.startsWith('select')) && names.includes('from'))
      return !names.includes('orderBy')
    if (method === 'findMany') {
      const [query] = node.arguments
      return !(
        query &&
        ts.isObjectLiteralExpression(query) &&
        query.properties.some((p) => p.name && p.name.getText() === 'orderBy')
      )
    }
    if (method === 'execute') {
      const [query] = node.arguments
      return Boolean(
        query && ts.isTaggedTemplateExpression(query) && unorderedTemplate(query.template),
      )
    }
    return false
  }

  /**
   * What an expression of rows in order with no order becomes: where it is used, or none — given an order,
   * or ended by a method that keeps none.
   */
  const climb = (node) => {
    let n = node
    for (;;) {
      const p = n.parent
      if (
        ts.isAwaitExpression(p) ||
        ts.isParenthesizedExpression(p) ||
        ts.isAsExpression(p) ||
        ts.isNonNullExpression(p) ||
        ts.isSatisfiesExpression(p)
      ) {
        n = p
        continue
      }
      if (ts.isPropertyAccessExpression(p) && p.expression === n && ts.isCallExpression(p.parent)) {
        const method = p.name.text
        if (ORDERS.has(method)) return undefined
        if (KEEPS.has(method)) {
          n = p.parent
          continue
        }
        if (method === 'at') return { use: p.parent, of: n }
        return undefined
      }
      return { use: p, of: n }
    }
  }

  const literalIndex = (node) => {
    if (!node) return undefined
    if (ts.isNumericLiteral(node)) return Number(node.text)
    if (
      ts.isPrefixUnaryExpression(node) &&
      node.operator === ts.SyntaxKind.MinusToken &&
      ts.isNumericLiteral(node.operand)
    )
      return -Number(node.operand.text)
    return undefined
  }

  /** Why a use compares by position, or none. */
  const positional = ({ use, of }) => {
    if (ts.isElementAccessExpression(use) && use.expression === of) {
      const index = literalIndex(use.argumentExpression)
      return index !== undefined && index !== 0 ? `[${String(index)}]` : undefined
    }
    if (ts.isCallExpression(use) && ts.isPropertyAccessExpression(use.expression)) {
      const index = literalIndex(use.arguments[0])
      if (use.expression.name.text === 'at' && index !== undefined && index !== 0)
        return `.at(${String(index)})`
    }
    if (ts.isVariableDeclaration(use) && ts.isArrayBindingPattern(use.name))
      return use.name.elements.length >= 2 ? 'taken apart' : undefined
    if (
      ts.isCallExpression(use) &&
      use.arguments[0] === of &&
      /^expect(\.soft)?$/.test(use.expression.getText())
    ) {
      const matcher = use.parent
      if (!ts.isPropertyAccessExpression(matcher) || !COMPARES.has(matcher.name.text))
        return undefined
      const call = matcher.parent
      const [expected] = ts.isCallExpression(call) ? call.arguments : []
      return expected && ts.isArrayLiteralExpression(expected) && expected.elements.length >= 2
        ? `${matcher.name.text}([${String(expected.elements.length)}])`
        : undefined
    }
    return undefined
  }

  /** The function a `return` or an arrow's body hands its value out of, by the name it was given. */
  const returnedBy = ({ use, of }) => {
    let f
    if (ts.isReturnStatement(use)) {
      f = use.parent
      while (f && !ts.isFunctionLike(f)) f = f.parent
    } else if (ts.isArrowFunction(use) && use.body === of) f = use
    if (!f) return undefined
    if (ts.isFunctionDeclaration(f) && f.name) return symbolOf(f.name)
    if (ts.isVariableDeclaration(f.parent) && ts.isIdentifier(f.parent.name))
      return symbolOf(f.parent.name)
    return undefined
  }

  const reads = []
  const collect = (node) => {
    if (isRead(node)) reads.push(node)
    ts.forEachChild(node, collect)
  }
  // a helper may return a call of another helper: found until nothing new is
  for (let size = -1; size !== helpers.size;) {
    size = helpers.size
    reads.length = 0
    collect(sf)
    for (const read of reads) {
      const at = climb(read)
      const helper = at && returnedBy(at)
      if (helper) helpers.add(helper)
    }
  }

  /** The names given a read, by their symbol, with the read they hold. */
  const named = new Map()
  const found = []
  const line = (node) => sf.getLineAndCharacterOfPosition(node.getStart()).line + 1
  const lines = source.split('\n')
  const report = (read, why) =>
    found.push(`${String(line(read))}: ${(lines[line(read) - 1] ?? '').trim()} — ${why}`)
  for (const read of reads) {
    const at = climb(read)
    if (!at) continue
    if (ts.isVariableDeclaration(at.use) && ts.isIdentifier(at.use.name)) {
      named.set(symbolOf(at.use.name), read)
      continue
    }
    const why = positional(at)
    if (why) report(read, why)
  }
  const uses = (node) => {
    if (
      ts.isIdentifier(node) &&
      !(ts.isVariableDeclaration(node.parent) && node.parent.name === node)
    ) {
      const read = named.get(symbolOf(node))
      const at = read && climb(node)
      const why = at && positional(at)
      if (why) report(read, `${node.text} ${why} at ${String(line(node))}`)
    }
    ts.forEachChild(node, uses)
  }
  uses(sf)
  return [...new Set(found)].sort((a, b) => Number.parseInt(a) - Number.parseInt(b))
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop() ?? '')) {
  const files = execFileSync('git', ['ls-files', ...FILES], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter(Boolean)
  const problems = files.flatMap((file) => {
    const source = readFileSync(file, 'utf8')
    if (!MAY_READ.test(source)) return []
    return unorderedReads(file, source).map((found) => `  ${file}:${found}`)
  })
  if (problems.length > 0) {
    console.error(
      `ordered reads: ${String(problems.length)} compared by position with no ORDER BY — order by the table's own column, .orderBy(t.id) or .orderBy(t.position) (.claude/rules/testing.md, MOL-323)`,
    )
    for (const problem of problems) console.error(problem)
    process.exitCode = 1
  }
}
