// Refuses a read of Postgres with no ORDER BY whose rows an integration test uses in an order (MOL-323):
// without one Postgres promises no order, and `clearAll` empties the tables by `DELETE`, so a row inserted
// later may come back first, and a plan that changes moves the rows with it. «То же фото дважды» in
// `feedback-bot` read its four words so and failed on a pull request that touched only the PWA (CI
// 41022785698).
//
// Found by parsing, as `check-clock-bounds.mjs` is, names resolved by TypeScript's binder, the facts of the
// tables read from `schema.ts`. **The check is closed at each of the three places it recognises something**
// (review of MOL-323, ten rounds: a list of forms missed one more each round, so every place says what it
// knows and holds the rest in doubt — and **in doubt there is no order**).
//
// **1. What reads.** A chain of Drizzle with `select…` and `from`, its beginning followed through a `const`
// and through a function of the file that returns one — carried on from any other name, it is refused;
// `findMany`, whose order the parse does not read, so in doubt; `execute` of a template, of `sql.raw` of
// one, of a `const` of either, and of a text the parse cannot read, which is a read with no order; a
// function of the file that executes what it is handed, read by that text's order, or none; `unsafe` and
// `query` of SQL as a string, the same; a template awaited, named or returned (postgres.js). A template
// handed to a call, put in another or in an object is a fragment of a query, never a read of its own. A
// template has an order when `order by` stands in the statement itself — not in parentheses, a comment or a
// string — and a `select` with no `from` is one row. Rows handed to a callback of `then` are its first
// parameter's.
//
// **2. What orders.** The arguments of `orderBy`, each a column of a table the schema names — by its name,
// an import alias or a namespace; any other is in doubt — `asc` or `desc` of one, a `const` of these or an
// array of them spread; any other argument — a fragment of `sql`, a call, an expression — is in doubt, and
// the read has no order of insertion. Of the columns, the schema says which are chance — a uuid and any
// `timestamp`: an order of values, not of insertion, `now()` one for a whole transaction — and which are
// identities. An order is decided by its columns up to the first identity, in a read of one table (through
// a join a parent's identity repeats with every child); a column of chance among them makes the order
// chance; it is total only where a unique key of every table read stands among them — every part of the key
// a column, none of them NULL unless its NULLs are one.
//
// **3. What the rows are used for.** They are followed through `await`, a cast, `map`, `filter`, `flatMap`,
// `flat`, `slice`, `JSON.stringify`, a spread of them alone, a branch of `?:`, `??`, `||`, an object, a
// name — declared, assigned, taken from `Promise.all` — a function of the file that returns them, and a
// query carried on (`base.where(c)`), which is a read of its own. They may end only where their order
// cannot tell: their length, their first row, `find`, `some`, `every`, `includes`, `reduce`, `sort`,
// `toSorted`, a `for … of`, a `Set`, a `Map`, `inArray`, `notInArray`, `Object.fromEntries`, `typeof`,
// discarded, a promise refused; under `expect`: `toHaveLength`, `toContain` and `toContainEqual` of the
// rows, `toBeDefined`, `toBeUndefined`, `toBeTruthy`, `toBeFalsy`, a `not` of these and of no other,
// `toEqual` of one row or none written in place or of `expect.arrayContaining`. A callback of these is in
// doubt where it takes the index of a row (a parameter, the rest of its arguments), changes anything
// outside it (a name, a field, a method of a name from outside, a function of this file called, a name
// handed to a call), or is one the parse cannot read; the platform's `Boolean`, `String`, `Number` are
// read. Of the rows made one string nothing is free but its length. Rows in the order of chance may besides
// meet another read in the same total order — a snapshot with a snapshot. Anything else is refused, and the
// fix is an order, never a use the check does not know. **Every answer of «free» or «not a read» the check
// gives is one written here**; nothing else is let go.
//
// **The price, named, by class, and nothing outside these classes:** an order of ties is taken as an order
// — a column every row read shares, a parent's identity through a join, a `sort` whose key repeats, an
// order of SQL text by whatever it names; an order of values the test wrote is taken as the test's — a
// column that is neither a uuid nor a moment is not judged; a moment before an identity is refused even
// where the test wrote the moments; a row picked as the one — the first, `find`, a key of a `Map` or
// `Object.fromEntries` — is taken as the only one; what a `for … of` or a `reduce` collects is not
// followed, a sum being their ordinary use; a callback calling a pure method of a name of this file is
// refused; a function handed in as a parameter, a field of an object of rows, an import and a helper of
// another file are not followed. Those go to review.
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
/** The methods that carry a query of Drizzle on: what they give is a query, read where it ends. */
const BUILDS = new Set([
  'where',
  'orderBy',
  'limit',
  'offset',
  'groupBy',
  'having',
  'innerJoin',
  'leftJoin',
  'rightJoin',
  'fullJoin',
  'crossJoin',
  'innerJoinLateral',
  'leftJoinLateral',
  'crossJoinLateral',
  'for',
  '$dynamic',
  'union',
  'unionAll',
  'intersect',
  'except',
])
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
export function schemaTables(source) {
  const sf = ts.createSourceFile(SCHEMA, source, ts.ScriptTarget.Latest, true)
  const found = new Set()
  for (const statement of sf.statements)
    if (ts.isVariableStatement(statement))
      for (const declaration of statement.declarationList.declarations)
        if (
          ts.isIdentifier(declaration.name) &&
          declaration.initializer &&
          ts.isCallExpression(declaration.initializer) &&
          declaration.initializer.expression.getText(sf) === 'pgTable'
        )
          found.add(declaration.name.text)
  return found
}

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
  const text =
    ts.isNoSubstitutionTemplateLiteral(template) || ts.isStringLiteral(template)
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
  known = new Set(),
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
  /** Whether a function of the file executes what it is handed: `const read = (q) => db.execute(q)`. */
  const executes = (callee) => {
    const f = functionOf(callee)
    if (!f) return false
    const parameters = new Set(f.parameters.map((parameter) => parameter.name.getText(sf)))
    let found = false
    const visit = (n) => {
      if (
        ts.isCallExpression(n) &&
        ts.isPropertyAccessExpression(n.expression) &&
        /^(execute|unsafe|query)$/.test(n.expression.name.text) &&
        n.arguments.some((a) => ts.isIdentifier(a) && parameters.has(a.text))
      )
        found = true
      ts.forEachChild(n, visit)
    }
    visit(f.body)
    return found
  }

  /** What a `const` name stands for, followed to the end: the node itself where it is none. */
  const constant = (node, depth = 0) => {
    if (!node || !ts.isIdentifier(node) || depth > 8) return node
    const declaration = symbolOf(node)?.valueDeclaration
    const isConst =
      declaration &&
      ts.isVariableDeclaration(declaration) &&
      declaration.initializer &&
      ts.isVariableDeclarationList(declaration.parent) &&
      (declaration.parent.flags & ts.NodeFlags.Const) !== 0
    return isConst ? constant(declaration.initializer, depth + 1) : node
  }

  /**
   * The calls of a query, its `const` beginnings included: `const base = db.select().from(t)` and then
   * `base.where(c)` is one query, `select`, `from` and `where` (review round 9, after И1).
   */
  const queryOf = (node, depth = 0) => {
    const calls = callsOf(node)
    let root = node
    while (ts.isCallExpression(root) || ts.isPropertyAccessExpression(root)) root = root.expression
    const begun = depth < 8 && ts.isIdentifier(root) ? constant(root) : undefined
    return begun && begun !== root && ts.isCallExpression(begun)
      ? [...calls, ...queryOf(begun, depth + 1)]
      : calls
  }

  /** The tables of the schema by the names this file gives them: `verdicts as verdictsTable`, `* as schema`. */
  const aliases = new Map()
  const namespaces = new Set()
  for (const statement of sf.statements) {
    const bindings = ts.isImportDeclaration(statement)
      ? statement.importClause?.namedBindings
      : undefined
    if (bindings && ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text)
    if (bindings && ts.isNamedImports(bindings))
      for (const element of bindings.elements)
        aliases.set(element.name.text, (element.propertyName ?? element.name).text)
  }
  /** A table as the schema names it, or none where the parse cannot tell (review round 10, К1). */
  const tableOf = (node) => {
    let n = node
    while (ts.isParenthesizedExpression(n) || ts.isNonNullExpression(n)) n = n.expression
    let name
    if (ts.isIdentifier(n)) name = aliases.get(n.text) ?? n.text
    else if (
      ts.isPropertyAccessExpression(n) &&
      ts.isIdentifier(n.expression) &&
      namespaces.has(n.expression.text)
    )
      name = n.name.text
    return name && (known.size === 0 || known.has(name)) ? name : undefined
  }

  /**
   * The columns an argument of `orderBy` orders by, each with its direction, or none where the parse cannot tell:
   * a column, `asc` or `desc` of one, a `const` name of any of these, an array of them, spread. Anything else — a
   * fragment of `sql`, a call, an expression — is in doubt, and an order in doubt is no order (review round 9).
   */
  const orderColumns = (argument, depth = 0) => {
    let a = argument
    while (ts.isParenthesizedExpression(a) || ts.isAsExpression(a) || ts.isSatisfiesExpression(a))
      a = a.expression
    if (depth > 8 || !a) return undefined
    if (ts.isSpreadElement(a)) return orderColumns(a.expression, depth + 1)
    if (ts.isArrayLiteralExpression(a)) {
      const all = a.elements.map((element) => orderColumns(element, depth + 1))
      return all.every(Boolean) ? all.flat() : undefined
    }
    if (ts.isCallExpression(a) && /^(asc|desc)$/.test(a.expression.getText(sf))) {
      const inner = orderColumns(a.arguments[0], depth + 1)
      const direction = a.expression.getText(sf)
      return inner?.map((column) => ({ ...column, key: `${direction} ${column.name}` }))
    }
    // a column of a table the schema names; one it cannot is in doubt (review round 10, К1)
    if (ts.isPropertyAccessExpression(a)) {
      const table = tableOf(a.expression)
      const name = table && `${table}.${a.name.text}`
      return name ? [{ node: a, name, key: name }] : undefined
    }
    if (ts.isIdentifier(a)) {
      const value = constant(a)
      return value !== a ? orderColumns(value, depth + 1) : undefined
    }
    return undefined
  }
  const named = (column, columns) => columns.has(column.name)

  /**
   * What order a node reads in, if it reads: `none`, `chance:<columns>`, or undefined — ordered, or no read.
   * The order is its columns up to the first identity: what follows one decides nothing (review round 4, №11).
   */
  const readOf = (node) => {
    if (ts.isTaggedTemplateExpression(node)) {
      // a template handed to a call, placed in another or in an object is a fragment of a query, never a read of
      // its own: `execute`'s text, a helper's that executes it — that call is the read — or Drizzle's
      // (`where`, `exists`, `select({ n: … })`), judged with the query it is part of (review round 10, №18)
      const p = node.parent
      const fragment =
        ((ts.isCallExpression(p) || ts.isNewExpression(p)) && p.arguments?.includes(node)) ||
        ts.isTemplateSpan(p) ||
        ts.isPropertyAssignment(p)
      return !fragment && unorderedTemplate(node.template) ? 'none' : undefined
    }
    if (!ts.isCallExpression(node)) return undefined
    if (ts.isIdentifier(node.expression)) {
      const helper = helpers.get(symbolOf(node.expression))
      if (helper) return helper
      // a function of the file handed a template it executes: the call reads by the template's order
      if (!executes(node.expression)) return undefined
      // whatever it is handed: a template by its order, anything the parse cannot read with none (round 10)
      const texts = node.arguments.map((argument) => constant(argument))
      const template = texts.find((text) => text && ts.isTaggedTemplateExpression(text))
      if (!template) return 'none'
      return unorderedTemplate(template.template) ? 'none' : undefined
    }
    if (!ts.isPropertyAccessExpression(node.expression)) return undefined
    // the outermost call of its chain only: `.where(…)`, not the `.from(…)` inside it
    if (ts.isPropertyAccessExpression(node.parent) && node.parent.expression === node)
      return undefined
    const method = node.expression.name.text
    const query = queryOf(node)
    const calls = query.filter((call) => ts.isPropertyAccessExpression(call.expression))
    const names = calls.map(calledAs)
    // a query carried on from a function of the file that returns one: `rows().where(c)` (after round 9)
    const begun = query.at(-1)
    const fromHelper =
      begun && ts.isIdentifier(begun.expression)
        ? helpers.get(symbolOf(begun.expression))
        : undefined
    const continued = fromHelper !== undefined && names.some((name) => BUILDS.has(name ?? ''))
    if ((names.some((name) => name?.startsWith('select')) && names.includes('from')) || continued) {
      const given = calls
        .filter((call) => calledAs(call) === 'orderBy')
        .flatMap((call) => [...call.arguments])
      if (given.length === 0) return fromHelper ?? 'none'
      const read = given.map((argument) => orderColumns(argument))
      // an order the parse cannot read is no order of insertion, nor one a snapshot may meet (round 9, И1, И2)
      if (read.some((columns) => !columns))
        return `chance:?${given.map((argument) => argument.getText(sf)).join(', ')}`
      const columns = read.flat()
      // an identity is unique in its own table only: through a join a parent's repeats with every child, and the
      // columns after it decide the children's order (review round 5, Д1)
      const joined = names.some((name) => /join/i.test(name ?? ''))
      const unique = joined ? -1 : columns.findIndex((column) => named(column, identity))
      const deciding = unique === -1 ? columns : columns.slice(0, unique + 1)
      const texts = deciding.map((column) => column.name)
      // the tables a read takes its rows from: a key of one is unique only among its own rows (review round 8, З2)
      const tables = calls
        .filter((call) => calledAs(call) === 'from' || /join/i.test(calledAs(call) ?? ''))
        .map((call) => (call.arguments[0] ? tableOf(call.arguments[0]) : undefined))
      const of = (table) => (column) => column.startsWith(`${table}.`)
      // a column of chance decides the ties of those before it: the order is chance
      if (!deciding.some((column) => named(column, chance))) return undefined
      // total where a unique key of every table read is among its columns: only then is it one order (Ж3, З2)
      const total =
        tables.length > 0 &&
        tables.every(
          (table) =>
            Boolean(table) &&
            keys.some(
              (key) => key.every(of(table)) && key.every((column) => texts.includes(column)),
            ),
        )
      return `chance:${total ? '!' : ''}${deciding.map((column) => column.key).join(', ')}`
    }
    if (method === 'findMany') {
      const [query] = node.arguments
      const ordered =
        query &&
        ts.isObjectLiteralExpression(query) &&
        query.properties.some((p) => p.name && p.name.getText(sf) === 'orderBy')
      // an order of the relational API the parse does not read: in doubt (review round 10)
      return ordered ? 'chance:?findMany' : 'none'
    }
    if (method === 'execute') {
      let text = constant(node.arguments[0])
      // `sql.raw(…)`: its text is the string it is handed
      if (text && ts.isCallExpression(text) && text.expression.getText(sf) === 'sql.raw')
        text = constant(text.arguments[0])
      if (text && ts.isTaggedTemplateExpression(text)) text = text.template
      // a parameter is judged where its text is written: a template handed to a helper is a read of its own
      const declaration =
        text && ts.isIdentifier(text) ? symbolOf(text)?.valueDeclaration : undefined
      if (declaration && ts.isParameter(declaration)) return undefined
      // a text in doubt — built by a call, not one the parse can read — is a read with no order
      const readable =
        text &&
        (ts.isNoSubstitutionTemplateLiteral(text) ||
          ts.isTemplateExpression(text) ||
          ts.isStringLiteral(text))
      if (!readable) return 'none'
      return unorderedTemplate(text) ? 'none' : undefined
    }
    // SQL as a string: postgres.js's `unsafe`, a pool's `query`
    if (method === 'unsafe' || method === 'query') {
      const text = constant(node.arguments[0])
      const written =
        text &&
        (ts.isStringLiteral(text) ||
          ts.isNoSubstitutionTemplateLiteral(text) ||
          ts.isTemplateExpression(text))
      // a text the parse cannot read is a read with no order, as `execute`'s is (review round 10, К2)
      if (!written) return 'none'
      return unorderedTemplate(text) ? 'none' : undefined
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
        // a query carried on is a read of its own, judged where it ends (`base.where(c)`) — from a `const`, which
        // the parse follows to its beginning; from any other name it cannot, and in doubt it is refused (round 10)
        if (BUILDS.has(name)) {
          const declaration = ts.isIdentifier(n) ? symbolOf(n)?.valueDeclaration : undefined
          const followed =
            !ts.isIdentifier(n) ||
            (declaration &&
              ts.isVariableDeclaration(declaration) &&
              ts.isVariableDeclarationList(declaration.parent) &&
              (declaration.parent.flags & ts.NodeFlags.Const) !== 0)
          return followed
            ? { free: true }
            : { why: `.${name}() of a query the check cannot follow` }
        }
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
        // a text handed to a function of the file that executes it is that call's, judged as the call
        if (ts.isIdentifier(callee) && executes(callee)) return { free: true }
        // a template handed to `execute` is that read's text, judged as the call
        if (ts.isPropertyAccessExpression(callee) && callee.name.text === 'execute')
          return { free: true }
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
    // a promise refused holds no rows
    if (ts.isPropertyAccessExpression(m) && m.name.text === 'rejects') return { free: true }
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
        ((ts.isVariableDeclaration(p) || ts.isBindingElement(p) || ts.isParameter(p)) &&
          p.name === node) ||
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
        // rows handed to a callback of `then`: its first parameter holds them; a callback the parse cannot read
        // is in doubt (review round 10)
        if (
          node === read &&
          ts.isCallExpression(node) &&
          ts.isPropertyAccessExpression(node.expression) &&
          node.expression.name.text === 'then'
        ) {
          const [parameter] = functionOf(node.arguments[0])?.parameters ?? []
          if (parameter && ts.isIdentifier(parameter.name)) {
            for (const use of mentions.get(symbolOf(parameter.name)) ?? []) follow(use)
            return
          }
          found.push(
            `${String(line(read))}: ${(lines[line(read) - 1] ?? '').trim()} — rows handed to then`,
          )
          return
        }
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
  const known = schemaTables(schema)
  const keys = uniqueKeys(schema)
  const files = execFileSync('git', ['ls-files', ...FILES], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter(Boolean)
  const problems = files.flatMap((file) => {
    const source = readFileSync(file, 'utf8')
    if (!MAY_READ.test(source)) return []
    return unorderedReads(file, source, chance, identity, keys, known).map(
      (found) => `  ${file}:${found}`,
    )
  })
  if (problems.length > 0) {
    console.error(
      `ordered reads: ${String(problems.length)} rows with no ORDER BY used in an order — order by an identity id or a position, never by a uuid or a moment (.claude/rules/testing.md, MOL-323)`,
    )
    for (const problem of problems) console.error(problem)
    process.exitCode = 1
  }
}
