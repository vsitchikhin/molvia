// Refuses a read of Postgres with no ORDER BY whose rows an integration test uses in an order (MOL-323):
// without one Postgres promises no order, and `clearAll` empties the tables by `DELETE`, so a row inserted
// later may come back first. «То же фото дважды» in `feedback-bot` read its four words so and failed on a
// pull request that touched only the PWA (CI 41022785698).
//
// Found by parsing, as `check-clock-bounds.mjs` is, names resolved by TypeScript's binder.
//
// **A read with no order**: a chain of Drizzle with `select…` and `from` and no `orderBy` that names a
// column (`orderBy()` renders no ORDER BY); `findMany` with no `orderBy`; a template with `select` and
// `from` and no `order by` of the statement itself — not in parentheses, a comment or a string — handed to
// `execute` or tagged on its own (postgres.js); a function of the file that returns one, named first or
// not. **A read in the order of chance** is one whose order is decided by a column of chance, read from the
// schema: a uuid (`randomUUID()`) or a moment, whoever writes it — `now()` is one for every row of a
// transaction, a repository writes one for a whole batch, and a test writes what it likes. An order is
// decided by its columns up to the first identity of the schema — what follows one decides nothing, in a
// read of one table: through a join a parent's identity repeats with every child — and a column of chance
// among them decides the ties of those before it.
//
// **The rule is closed** (review of MOL-323, rounds 1–8): a list of the uses that compare by position
// missed one more each time it was attacked. So it goes the other way round. Rows are followed through
// `await`, a cast, the methods that keep an order (`map`, `filter`, `flatMap`, `flat`, `slice`),
// `JSON.stringify`, a spread of them alone, a branch of `?:`, `??` or `||`, an object they are put in, a
// name they are given — declared, assigned or taken from an array (`Promise.all`) — and a function of the
// file that returns them. Rows with no order may end only where their order cannot tell: their length,
// their first row (`[0]`, `at(0)`, `const [row] = …`), `find`, `some`, `every`, `includes` — never by a
// callback handed the index of a row, by a parameter or the rest of its arguments, nor by one that changes
// anything outside it — a name, a field, a method of a name from outside called (`seen.push`,
// `next.next()`), a function of this file from outside called (a spy, `record(row)`), a name from outside
// handed to a call — nor by one the parse cannot read (built by a call, a method, an import; `Boolean`,
// `String` and `Number` are read) — `reduce`, `sort`, `toSorted`, a `for … of`, a `Set`, a `Map`,
// `inArray`, `notInArray`, `Object.fromEntries`, `typeof`, discarded; under `expect`: `toHaveLength`,
// `toContain` and `toContainEqual` of the rows — of them made one string nothing but its length —
// `toBeDefined`, `toBeUndefined`, `toBeTruthy`, `toBeFalsy`, a `not` of any of them and of no other,
// `toEqual` of one row or none written in place, or of `expect.arrayContaining`. Rows in the order of
// chance may besides be compared with another read in the same order, if it is total — a unique key of
// every table it reads among its columns, every part of the key a column and none of them NULL unless its
// NULLs are one, else its ties lie as the heap does — by the same columns, a snapshot with a snapshot of
// the same helper, the read, a name given it, or either through the methods that keep an order — never with
// anything the test builds. Anything else is refused, and the fix is an order, never a use the check does
// not know.
//
// What this is: a guard against the ordinary form, not against one built to slip past it. **The price,
// named, by class:** an order of ties is taken as an order — a column every row read shares
// (`.orderBy(t.threadId)` under `eq(t.threadId, …)`), a parent's identity through a join, which its
// children share, a `sort` whose key repeats, an `order by` of SQL text by whatever it names; a moment
// before an identity is refused even where the test wrote the moments itself — the parse cannot tell who
// did, and the identity alone is the order; a row picked as the one — the first, `find`, a key of a `Map`
// or `Object.fromEntries` — is taken as the only one: where more qualify, the first in the heap answers, or
// for a key the last; what a `for … of` or a `reduce` collects is not followed — a sum is their ordinary
// use; a callback that calls a method of a name from outside is refused even where the method is pure
// (`want.includes(r.x)`) — the parse cannot tell; a function handed in as a parameter is not followed; a
// field of an object of rows is not followed; a helper of another file is not followed. Those go to review.
//
//   node bin/check-ordered-reads.mjs

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import process from 'node:process'
import ts from 'typescript'

/** The files that read Postgres: the integration tests of the API. */
const FILES = ['backend/*.integration.test.ts']
/** Where a column is a uuid, a moment or an identity. */
const SCHEMA = 'backend/src/db/schema.ts'

/** A file that names none of these reads nothing: the binder is spared it. */
export const MAY_READ = /\bselect|findMany/i

/** The methods an array of rows keeps its order through. */
const KEEPS = new Set(['map', 'filter', 'flatMap', 'flat', 'slice'])
/** The methods whose answer no order of the rows can change, or that give them one. */
const ORDERLESS = new Set(['find', 'some', 'every', 'includes', 'reduce', 'sort', 'toSorted'])
/** Where a callback is handed the index of a row: the second parameter, `reduce`'s third; a comparator never. */
const INDEX_AT = { reduce: 2, sort: Infinity, toSorted: Infinity }
/** The platform's casts: a callback of the first argument alone. */
const CASTS = new Set(['Boolean', 'String', 'Number'])
/** The methods handed a value, not a callback. */
const NO_CALLBACK = new Set(['includes', 'slice', 'flat', 'sort', 'toSorted'])
/** What is handed the rows whole and keeps no order of them. */
const ORDERLESS_CALLS = new Set(['Set', 'Map', 'inArray', 'notInArray', 'Object.fromEntries'])
/** The matchers whose verdict no order of the rows can change. */
const ORDERLESS_MATCHERS = new Set([
  'toHaveLength',
  'toContain',
  'toContainEqual',
  'toBeDefined',
  'toBeUndefined',
  'toBeTruthy',
  'toBeFalsy',
])
/** The matchers that compare one value with another, an array element by element. */
const COMPARES = new Set(['toEqual', 'toStrictEqual', 'toMatchObject', 'toBe'])

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

/** The calls of a chain, outermost first: `db.select().from(t).where(c)`, `uuid('id').primaryKey()`. */
const callsOf = (node) => {
  const calls = []
  let n = node
  for (;;) {
    if (ts.isCallExpression(n)) {
      calls.push(n)
      n = n.expression
    } else if (ts.isPropertyAccessExpression(n)) n = n.expression
    else return calls
  }
}

/** The name a call of a chain is made by: `primaryKey`, or `uuid` for the root. */
const calledAs = (call) =>
  ts.isPropertyAccessExpression(call.expression)
    ? call.expression.name.text
    : ts.isIdentifier(call.expression)
      ? call.expression.text
      : undefined

/** Whether a column of the schema is chance: a uuid, or a moment, whoever writes it. */
const chanceColumn = (initializer) =>
  callsOf(initializer).some((call) => /^(uuid|timestamp)$/.test(calledAs(call) ?? ''))

/** Whether a column of the schema is an identity: unique, and the order of insertion of one writer. */
const identityColumn = (initializer) =>
  callsOf(initializer).some((call) =>
    /^(generated(Always|ByDefault)AsIdentity|serial|bigserial|smallserial)$/.test(
      calledAs(call) ?? '',
    ),
  )

/**
 * The columns of the schema whose order is chance, as `table.column` by the names the tests import.
 * @param {string} source
 * @returns {Set<string>}
 */
export function chanceColumns(source) {
  return columnsWhere(source, chanceColumn)
}

/**
 * The identity columns of the schema, as `table.column`: where one stands in an order, what follows decides nothing.
 * @param {string} source
 * @returns {Set<string>}
 */
export function identityColumns(source) {
  return columnsWhere(source, identityColumn)
}

/**
 * The unique keys of the schema, each as its columns `table.column`: a primary key or a unique of a column, an
 * identity, and the keys of a table — `primaryKey({ columns })`, `unique().on(…)`, a `uniqueIndex` with no `where`.
 * An order that holds one of them is total: two reads of the same rows by it agree (review round 7, Ж3).
 * @param {string} source
 * @returns {string[][]}
 */
export function uniqueKeys(source) {
  const sf = ts.createSourceFile(SCHEMA, source, ts.ScriptTarget.Latest, true)
  const keys = []
  for (const statement of sf.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      const init = declaration.initializer
      if (!ts.isIdentifier(declaration.name) || !init || !ts.isCallExpression(init)) continue
      if (init.expression.getText(sf) !== 'pgTable') continue
      const table = declaration.name.text
      const [, columns, extras] = init.arguments
      // the columns that hold no NULL: a key with NULL in it is no key — its NULLs are distinct (round 8, З1)
      const filled = new Set()
      if (columns && ts.isObjectLiteralExpression(columns))
        for (const column of columns.properties) {
          if (!ts.isPropertyAssignment(column)) continue
          const name = `${table}.${column.name.getText(sf)}`
          const names = callsOf(column.initializer).map(calledAs)
          const primary = names.includes('primaryKey') || identityColumn(column.initializer)
          if (primary || names.includes('notNull')) filled.add(name)
          if (primary || (names.includes('unique') && filled.has(name))) keys.push([name])
        }
      if (!extras || !(ts.isArrowFunction(extras) || ts.isFunctionExpression(extras))) continue
      const param = extras.parameters[0]?.name.getText(sf)
      const columnOf = (node) =>
        ts.isPropertyAccessExpression(node) && node.expression.getText(sf) === param
          ? `${table}.${node.name.text}`
          : undefined
      // a key whole: every part a column — an expression left out would shorten it (round 8, №17) — and no NULL
      // in it unless its NULLs are one
      const add = (parts, nullsAreOne) => {
        if (parts.length === 0 || parts.some((part) => !part)) return
        if (nullsAreOne || parts.every((part) => filled.has(part))) keys.push(parts)
      }
      const visit = (node) => {
        if (ts.isCallExpression(node) && !ts.isPropertyAccessExpression(node.parent)) {
          const calls = callsOf(node)
          const names = calls.map(calledAs)
          const root = names.at(-1)
          if (root === 'primaryKey') {
            const [config] = calls.at(-1).arguments
            const listed =
              config && ts.isObjectLiteralExpression(config)
                ? config.properties.find((p) => p.name?.getText(sf) === 'columns')
                : undefined
            if (
              listed &&
              ts.isPropertyAssignment(listed) &&
              ts.isArrayLiteralExpression(listed.initializer)
            )
              add(listed.initializer.elements.map(columnOf), true)
          }
          if ((root === 'unique' || root === 'uniqueIndex') && !names.includes('where')) {
            const on = calls.find((call) => calledAs(call) === 'on')
            if (on) add(on.arguments.map(columnOf), names.includes('nullsNotDistinct'))
          }
        }
        ts.forEachChild(node, visit)
      }
      visit(extras.body)
    }
  }
  return keys.filter((key) => key.length > 0)
}

function columnsWhere(source, is) {
  const sf = ts.createSourceFile(SCHEMA, source, ts.ScriptTarget.Latest, true)
  const found = new Set()
  for (const statement of sf.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      const init = declaration.initializer
      if (!ts.isIdentifier(declaration.name) || !init || !ts.isCallExpression(init)) continue
      if (init.expression.getText(sf) !== 'pgTable') continue
      const columns = init.arguments[1]
      if (!columns || !ts.isObjectLiteralExpression(columns)) continue
      for (const column of columns.properties)
        if (ts.isPropertyAssignment(column) && is(column.initializer))
          found.add(`${declaration.name.text}.${column.name.getText(sf)}`)
    }
  }
  return found
}

/**
 * A template's SQL, read once from the start: what `${…}` holds put aside, strings and comments taken out in
 * the order they come — `'--'` is a string — and what stands outside every parenthesis apart.
 */
const sqlOf = (template) => {
  const text = ts.isNoSubstitutionTemplateLiteral(template)
    ? template.text
    : [template.head.text, ...template.templateSpans.map((span) => span.literal.text)].join(' ? ')
  let all = ''
  let outside = ''
  let depth = 0
  for (let i = 0; i < text.length; i++) {
    const rest = text.slice(i)
    let skip = 0
    if (text[i] === "'") skip = /^'(?:[^']|'')*'?/.exec(rest)?.[0].length ?? 1
    else if (rest.startsWith('--')) skip = /^--[^\n]*/.exec(rest)?.[0].length ?? 2
    else if (rest.startsWith('/*'))
      skip = rest.includes('*/') ? rest.indexOf('*/') + 2 : rest.length
    if (skip > 0) {
      all += ' '
      if (depth === 0) outside += ' '
      i += skip - 1
      continue
    }
    if (text[i] === '(') depth++
    all += text[i]
    if (depth === 0) outside += text[i]
    if (text[i] === ')') depth--
  }
  return { all, outside }
}

/** Whether a template reads rows with no order: `select … from` and no `order by` of the statement itself. */
const unorderedTemplate = (template) => {
  const { all, outside } = sqlOf(template)
  return /\bselect\b/i.test(all) && /\bfrom\b/i.test(all) && !/\border\s+by\b/i.test(outside)
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

/**
 * Every read with no order that one file uses in an order, as `line: text — why`.
 * @param {string} fileName
 * @param {string} source
 * @param {Set<string>} [chance] the columns of the schema whose order is chance, as `table.column`
 * @param {Set<string>} [identity] the identity columns of the schema, as `table.column`
 * @param {string[][]} [keys] the unique keys of the schema, each as its columns `table.column`
 * @returns {string[]}
 */
export function unorderedReads(
  fileName,
  source,
  chance = new Set(),
  identity = new Set(),
  keys = [],
) {
  const { sf, checker } = bind(fileName, source)
  const symbolOf = (node) => checker.getSymbolAtLocation(node)
  /**
   * The functions of the file that return a read, by their symbol, with its order: `none`, or `chance:` and the
   * columns of its order, so that two reads in the order of chance are told the same order or not.
   */
  const helpers = new Map()
  /**
   * The order of what a name or a helper holds, met by another read: none if either has none, else the orders of
   * chance of all its parts — a snapshot of several tables is one order, the same for every call of its helper.
   */
  const merged = (known, order) => {
    if (!known || known === order) return order
    if (known === 'none' || order === 'none') return 'none'
    const parts = new Set([...known.slice(7).split(' | '), ...order.slice(7).split(' | ')])
    return `chance:${[...parts].sort().join(' | ')}`
  }
  const isChance = (order) => order?.startsWith('chance:') ?? false

  /** The column an argument of `orderBy` names, `asc` and `desc` taken off. */
  const columnOf = (argument) =>
    ts.isCallExpression(argument) && /^(asc|desc)$/.test(argument.expression.getText(sf))
      ? argument.arguments[0]
      : argument
  const named = (argument, columns) => {
    const a = columnOf(argument)
    return Boolean(a) && ts.isPropertyAccessExpression(a) && columns.has(a.getText(sf))
  }

  /**
   * What order a node reads in, if it reads: `none`, `chance:<columns>`, or undefined — ordered, or no read.
   * The order is its columns up to the first identity: what follows one decides nothing (review round 4, №11).
   */
  const readOf = (node) => {
    if (ts.isTaggedTemplateExpression(node)) {
      // handed to `execute`, the call is the read
      const handed = ts.isCallExpression(node.parent) && node.parent.arguments.includes(node)
      return !handed && unorderedTemplate(node.template) ? 'none' : undefined
    }
    if (!ts.isCallExpression(node)) return undefined
    if (ts.isIdentifier(node.expression)) return helpers.get(symbolOf(node.expression))
    if (!ts.isPropertyAccessExpression(node.expression)) return undefined
    // the outermost call of its chain only: `.where(…)`, not the `.from(…)` inside it
    if (ts.isPropertyAccessExpression(node.parent) && node.parent.expression === node)
      return undefined
    const method = node.expression.name.text
    const calls = callsOf(node).filter((call) => ts.isPropertyAccessExpression(call.expression))
    const names = calls.map(calledAs)
    if (names.some((name) => name?.startsWith('select')) && names.includes('from')) {
      const columns = calls
        .filter((call) => calledAs(call) === 'orderBy')
        .flatMap((call) => [...call.arguments])
      if (columns.length === 0) return 'none'
      // an identity is unique in its own table only: through a join a parent's repeats with every child, and the
      // columns after it decide the children's order (review round 5, Д1)
      const joined = names.some((name) => /join/i.test(name ?? ''))
      const unique = joined ? -1 : columns.findIndex((column) => named(column, identity))
      const deciding = unique === -1 ? columns : columns.slice(0, unique + 1)
      const texts = deciding.map((column) => columnOf(column)?.getText(sf))
      // the tables a read takes its rows from: a key of one is unique only among its own rows (review round 8, З2)
      const tables = calls
        .filter((call) => calledAs(call) === 'from' || /join/i.test(calledAs(call) ?? ''))
        .map((call) => call.arguments[0]?.getText(sf))
      const of = (table) => (column) => column.startsWith(`${table}.`)
      // a column of chance decides the ties of those before it: the order is chance
      if (!deciding.some((column) => named(column, chance))) return undefined
      // total where a unique key of every table read is among its columns: only then is it one order (Ж3, З2)
      const total = tables.every((table) =>
        keys.some((key) => key.every(of(table)) && key.every((column) => texts.includes(column))),
      )
      return `chance:${total ? '!' : ''}${deciding.map((column) => column.getText(sf)).join(', ')}`
    }
    if (method === 'findMany') {
      const [query] = node.arguments
      const ordered =
        query &&
        ts.isObjectLiteralExpression(query) &&
        query.properties.some((p) => p.name && p.name.getText(sf) === 'orderBy')
      return ordered ? undefined : 'none'
    }
    if (method === 'execute') {
      const [query] = node.arguments
      const unordered =
        query && ts.isTaggedTemplateExpression(query) && unorderedTemplate(query.template)
      return unordered ? 'none' : undefined
    }
    return undefined
  }

  /** The value `expect` was handed, from a matcher of it: `expect(a).not.toEqual` → `a`. */
  const subjectOf = (matcher) => {
    let e = matcher.expression
    while (ts.isPropertyAccessExpression(e) && /^(not|resolves|rejects)$/.test(e.name.text))
      e = e.expression
    return ts.isCallExpression(e) && /^expect(\.soft)?$/.test(e.expression.getText(sf))
      ? e.arguments[0]
      : undefined
  }
  const negated = (matcher) => {
    for (let e = matcher.expression; ts.isPropertyAccessExpression(e); e = e.expression)
      if (e.name.text === 'not') return true
    return false
  }

  /** The function a callback is, written in place or named: `(row, i) => …`, `inOrder`. */
  const functionOf = (node) => {
    if (!node) return undefined
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return node
    const declaration = ts.isIdentifier(node) ? symbolOf(node)?.valueDeclaration : undefined
    if (declaration && ts.isFunctionDeclaration(declaration)) return declaration
    const init =
      declaration && ts.isVariableDeclaration(declaration) ? declaration.initializer : undefined
    return init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) ? init : undefined
  }

  /**
   * Why the callback a method of rows is handed may tell their order: it takes the index of a row, or it is one
   * the parse cannot read — built by a call, a method, an import (review round 4, Г4) — and in doubt it does.
   */
  const callbackDoubt = (call, method) => {
    const [argument] = call.arguments
    if (!argument || NO_CALLBACK.has(method)) return undefined
    // the platform's casts take their first argument and nothing else (review round 5, №14)
    if (ts.isIdentifier(argument) && CASTS.has(argument.text)) return undefined
    const callback = functionOf(argument)
    if (!callback) return 'by a callback the check cannot read'
    if (callback.parameters.length > (INDEX_AT[method] ?? 1)) return 'by index'
    // an index without a parameter for it: the rest of the arguments, or a count kept outside (Д3)
    if (callback.parameters.some((parameter) => parameter.dotDotDotToken)) return 'by index'
    return countsOutside(callback) ? 'by what it changes outside' : undefined
  }

  /** Whether a function changes a name declared outside it: `texts[i++]`, `n += 1`. */
  const countsOutside = (callback) => {
    let changes = false
    const outside = (target) => {
      let root = target
      while (
        ts.isPropertyAccessExpression(root) ||
        ts.isElementAccessExpression(root) ||
        ts.isParenthesizedExpression(root) ||
        ts.isNonNullExpression(root)
      )
        root = root.expression
      const declaration = ts.isIdentifier(root) ? symbolOf(root)?.valueDeclaration : undefined
      return Boolean(
        declaration && !(declaration.pos >= callback.pos && declaration.end <= callback.end),
      )
    }
    const visit = (node) => {
      // a call of a method of a name from outside: `seen.push(row)`, `next.next()` (review round 6, Е1)
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        outside(node.expression.expression)
      )
        changes = true
      // or a function of this file from outside called, which may change what it likes: a spy, `record(row)` (Ж1);
      // a parameter of a function around it is handed in, not followed — the price
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        outside(node.expression) &&
        !ts.isParameter(symbolOf(node.expression)?.valueDeclaration ?? node)
      )
        changes = true
      // or a name from outside handed to a call, which may change it: `Object.assign(out, row)`
      if (ts.isCallExpression(node) && node.arguments.some((a) => ts.isIdentifier(a) && outside(a)))
        changes = true
      if (
        (ts.isPostfixUnaryExpression(node) || ts.isPrefixUnaryExpression(node)) &&
        [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(node.operator) &&
        outside(node.operand)
      )
        changes = true
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
        node.operatorToken.kind <= ts.SyntaxKind.LastAssignment &&
        outside(node.left)
      )
        changes = true
      ts.forEachChild(node, visit)
    }
    visit(callback.body)
    return changes
  }

  /** The names given a read, by their symbol, with its order. */
  const names = new Map()
  /**
   * Whether a value is rows in the same order of chance: a read of them by the same columns, or a name given one,
   * through the methods that keep an order (`before.map(…)`, review round 4, Г1, Г2).
   */
  const sameChance = (node, order) => {
    let n = node
    for (;;) {
      if (ts.isAwaitExpression(n) || ts.isParenthesizedExpression(n) || ts.isAsExpression(n))
        n = n.expression
      else if (
        ts.isCallExpression(n) &&
        ts.isPropertyAccessExpression(n.expression) &&
        KEEPS.has(n.expression.name.text)
      )
        n = n.expression.expression
      else break
    }
    // the same order, and a total one: an order with ties gives the ties as the heap lies (Ж3)
    const total =
      isChance(order) &&
      order
        .slice(7)
        .split(' | ')
        .every((part) => part.startsWith('!'))
    return total && (ts.isIdentifier(n) ? names.get(symbolOf(n)) : readOf(n)) === order
  }

  /**
   * Where rows go: `{ free }` where their order cannot tell; `{ name }` given to a name; `{ helper }`
   * returned by a function of the file; `{ why, againstRead }` used in an order — `againstRead` where they
   * are compared with rows read in the order of chance too.
   */
  const fate = (node, order) => {
    let n = node
    /** Whether the rows have been made one string: `toContain` of it reads them in place (Ж2). */
    let text = false
    for (;;) {
      const p = n.parent
      if (
        ts.isAwaitExpression(p) ||
        ts.isParenthesizedExpression(p) ||
        ts.isAsExpression(p) ||
        ts.isNonNullExpression(p) ||
        ts.isSatisfiesExpression(p) ||
        (ts.isConditionalExpression(p) && p.condition !== n) ||
        (ts.isBinaryExpression(p) &&
          [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken].includes(
            p.operatorToken.kind,
          )) ||
        ((ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) &&
          ts.isObjectLiteralExpression(p.parent))
      ) {
        n = ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p) ? p.parent : p
        continue
      }
      if (
        ts.isSpreadElement(p) &&
        ts.isArrayLiteralExpression(p.parent) &&
        p.parent.elements.length === 1
      ) {
        n = p.parent
        continue
      }
      if (ts.isPropertyAccessExpression(p) && p.expression === n) {
        const name = p.name.text
        // a method of the rows made one string reads them in place, whatever its name (round 8, З3)
        if (text)
          return name === 'length' ? { free: true } : { why: `.${name} of the rows as text` }
        if (!ts.isCallExpression(p.parent) || p.parent.expression !== p)
          return name === 'length' ? { free: true } : { why: `.${name}` }
        const doubt =
          ORDERLESS.has(name) || KEEPS.has(name) ? callbackDoubt(p.parent, name) : undefined
        if (doubt) return { why: `.${name}() ${doubt}` }
        if (ORDERLESS.has(name)) return { free: true }
        if (KEEPS.has(name)) {
          n = p.parent
          continue
        }
        if (name === 'at' && literalIndex(p.parent.arguments[0]) === 0) return { free: true }
        return { why: `.${name}()` }
      }
      if (ts.isElementAccessExpression(p) && p.expression === n)
        return literalIndex(p.argumentExpression) === 0 ? { free: true } : { why: '[…]' }
      if (ts.isVariableDeclaration(p) && p.initializer === n) {
        if (ts.isIdentifier(p.name)) return { name: p.name }
        const [only, ...rest] = ts.isArrayBindingPattern(p.name) ? p.name.elements : []
        const first = only && ts.isBindingElement(only) && !only.dotDotDotToken
        return first && rest.length === 0 ? { free: true } : { why: 'taken apart' }
      }
      if (
        ts.isBinaryExpression(p) &&
        p.right === n &&
        p.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isIdentifier(p.left)
      )
        return { name: p.left }
      if (ts.isArrayLiteralExpression(p)) return taken(p, p.elements.indexOf(n))
      if (ts.isReturnStatement(p) || (ts.isArrowFunction(p) && p.body === n)) {
        let f = p
        while (f && !ts.isFunctionLike(f)) f = f.parent
        const named =
          f && ts.isFunctionDeclaration(f)
            ? f.name
            : f && ts.isVariableDeclaration(f.parent) && ts.isIdentifier(f.parent.name)
              ? f.parent.name
              : undefined
        return named ? { helper: named } : { why: 'returned' }
      }
      if (ts.isExpressionStatement(p) || ts.isTypeQueryNode(p)) return { free: true }
      if (ts.isForOfStatement(p) && p.expression === n) return { free: true }
      if ((ts.isCallExpression(p) || ts.isNewExpression(p)) && p.arguments?.includes(n)) {
        const callee = p.expression
        if (/^expect(\.soft)?$/.test(callee.getText(sf))) return matched(p, order, text)
        // the value a matcher compares with: the rows on the other side of `toEqual(rows)`
        const subject = ts.isPropertyAccessExpression(callee) ? subjectOf(callee) : undefined
        if (subject && ts.isPropertyAccessExpression(callee)) {
          const name = callee.name.text
          // `not` turns a comparison over, never into one the order cannot tell (review round 5, Д2)
          if (negated(callee) && ORDERLESS_MATCHERS.has(name)) return { free: true }
          if (COMPARES.has(name))
            return { why: `${name}(…)`, againstRead: sameChance(subject, order) }
          return { why: `${name}(…)` }
        }
        if (callee.getText(sf) === 'JSON.stringify') {
          n = p
          text = true
          continue
        }
        return ORDERLESS_CALLS.has(callee.getText(sf))
          ? { free: true }
          : { why: `handed to ${callee.getText(sf)}` }
      }
      return { why: ts.SyntaxKind[p.kind] }
    }
  }

  /** An element of an array taken apart, awaited through `Promise.all` or written as is. */
  const taken = (array, index) => {
    let q = array
    const all =
      ts.isCallExpression(q.parent) &&
      q.parent.arguments[0] === q &&
      q.parent.expression.getText(sf) === 'Promise.all'
    if (all) q = q.parent
    while (ts.isAwaitExpression(q.parent) || ts.isParenthesizedExpression(q.parent)) q = q.parent
    const d = q.parent
    const element =
      ts.isVariableDeclaration(d) && d.initializer === q && ts.isArrayBindingPattern(d.name)
        ? d.name.elements[index]
        : undefined
    return element &&
      ts.isBindingElement(element) &&
      !element.dotDotDotToken &&
      ts.isIdentifier(element.name)
      ? { name: element.name }
      : { why: 'in an array' }
  }

  /** What `expect(rows)` goes on to: a matcher no order can change, or one that compares in order. */
  const matched = (expectCall, order, text = false) => {
    let m = expectCall.parent
    while (ts.isPropertyAccessExpression(m) && /^(resolves|rejects)$/.test(m.name.text))
      m = m.parent
    if (!ts.isPropertyAccessExpression(m)) return { why: 'expect' }
    let name = m.name.text
    // `not` turns a comparison over, never into one the order cannot tell (review round 5, Д2)
    // and frees only a matcher that is free without it (review round 6, Е2)
    if (name === 'not') {
      if (!ts.isPropertyAccessExpression(m.parent)) return { why: 'not' }
      m = m.parent
      name = m.name.text
    }
    if (ORDERLESS_MATCHERS.has(name) && !(text && /^toContain/.test(name))) return { free: true }
    const [expected] = ts.isCallExpression(m.parent) ? m.parent.arguments : []
    if (COMPARES.has(name) && expected) {
      const one =
        ts.isArrayLiteralExpression(expected) &&
        expected.elements.length <= 1 &&
        !expected.elements.some(ts.isSpreadElement)
      if (one) return { free: true }
      if (ts.isCallExpression(expected) && /arrayContaining$/.test(expected.expression.getText(sf)))
        return { free: true }
      const what = ts.isArrayLiteralExpression(expected)
        ? `[${String(expected.elements.length)}]`
        : '…'
      return { why: `${name}(${what})`, againstRead: sameChance(expected, order) }
    }
    return { why: name }
  }

  /** Every identifier of the file but the names declared or assigned, by its symbol. */
  const mentions = new Map()
  const mention = (node) => {
    if (ts.isIdentifier(node)) {
      const p = node.parent
      const declared =
        ((ts.isVariableDeclaration(p) || ts.isBindingElement(p)) && p.name === node) ||
        (ts.isBinaryExpression(p) &&
          p.left === node &&
          p.operatorToken.kind === ts.SyntaxKind.EqualsToken)
      const symbol = symbolOf(node)
      if (!declared && symbol) mentions.set(symbol, [...(mentions.get(symbol) ?? []), node])
    }
    ts.forEachChild(node, mention)
  }
  mention(sf)

  const line = (node) => sf.getLineAndCharacterOfPosition(node.getStart()).line + 1
  const lines = source.split('\n')
  let found = []
  // a helper may return a call of another helper, and learn its order late: read until nothing changes
  const state = () => [...helpers.values(), '|', ...names.values()].join()
  for (let before; before !== state();) {
    before = state()
    found = []
    const reads = []
    const collect = (node) => {
      const order = readOf(node)
      if (order) reads.push({ read: node, order })
      ts.forEachChild(node, collect)
    }
    collect(sf)
    for (const { read, order } of reads) {
      const seen = new Set()
      const follow = (node) => {
        const end = fate(node, order)
        if (end.helper) {
          const symbol = symbolOf(end.helper)
          helpers.set(symbol, merged(helpers.get(symbol), order))
        } else if (end.why && !(isChance(order) && end.againstRead)) {
          const at = node === read ? '' : ` at ${String(line(node))}`
          const by = isChance(order) ? ` (ordered by chance: ${order.slice(7)})` : ''
          found.push(
            `${String(line(read))}: ${(lines[line(read) - 1] ?? '').trim()} — ${end.why}${at}${by}`,
          )
        } else if (end.name) {
          const symbol = symbolOf(end.name)
          names.set(symbol, merged(names.get(symbol), order))
          if (seen.has(symbol)) return
          seen.add(symbol)
          for (const use of mentions.get(symbol) ?? []) follow(use)
        }
      }
      follow(read)
    }
  }
  return [...new Set(found)].sort((a, b) => Number.parseInt(a) - Number.parseInt(b))
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop() ?? '')) {
  const schema = readFileSync(SCHEMA, 'utf8')
  const chance = chanceColumns(schema)
  const identity = identityColumns(schema)
  const keys = uniqueKeys(schema)
  const files = execFileSync('git', ['ls-files', ...FILES], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter(Boolean)
  const problems = files.flatMap((file) => {
    const source = readFileSync(file, 'utf8')
    if (!MAY_READ.test(source)) return []
    return unorderedReads(file, source, chance, identity, keys).map((found) => `  ${file}:${found}`)
  })
  if (problems.length > 0) {
    console.error(
      `ordered reads: ${String(problems.length)} rows with no ORDER BY used in an order — order by an identity id or a position, never by a uuid or a moment (.claude/rules/testing.md, MOL-323)`,
    )
    for (const problem of problems) console.error(problem)
    process.exitCode = 1
  }
}
