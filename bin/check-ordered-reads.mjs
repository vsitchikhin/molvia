// Refuses a read of Postgres with no ORDER BY whose rows an integration test uses in an order (MOL-323):
// without one Postgres promises no order, and `clearAll` empties the tables by `DELETE`, so a row inserted
// later may come back first, and a plan that changes moves the rows with it. «То же фото дважды» in
// `feedback-bot` read its four words so and failed on a pull request that touched only the PWA (CI
// 41022785698).
//
// **The net is the run's half** (review of MOL-323, rounds 12, 13): `backend/tests/unordered-rows.ts` reverses
// the rows of every `SELECT` of the integration tests with no `order by` of its own, and of every `UPDATE`,
// `DELETE` and `MERGE` returning them, so a test leaning on which of two such rows comes first fails on its
// first run — where the values it reads differ reversed. **Values the same reversed it cannot tell** (round 14,
// О1): kinds `failure, silence, failure` give the same first row, `find` and `[...new Set()]` either way, and
// no fixed order can tell every such use — two columns may ask for two orders at once; nor two reads reversed
// alike, nor an order the statement has, of chance or of ties, which it never touches. **So this check holds
// every use of rows with no order by itself**, and the net is what a form the check follows wrong runs into.
//
// Found by parsing, as `check-clock-bounds.mjs` is, names resolved by TypeScript's binder, the facts of the
// tables read from `schema.ts`. **The check is closed at each of the three places it recognises something**
// (review of MOL-323, eleven rounds before the net: a list of forms missed one more each round, so every
// place says what it knows and holds the rest in doubt — and **in doubt there is no order**).
//
// **1. What reads.** A chain of Drizzle with `select…` and `from`, its beginning followed through a `const`
// and through a function of the file that returns one — carried on from any other name, it is refused;
// `findMany`, whose order the parse does not read, so in doubt; `execute` of a template, of `sql.raw` of
// one, of a `const` of either, and of a text the parse cannot read, which is a read with no order; a
// function of the file that executes the whole text it is handed — as it is, through `sql.raw`, or a
// template of `${sql.raw(text)}` alone — read by that text's order, or none; `unsafe` and `query` of SQL as
// a string, the same. **A template is what its tag is**: Drizzle's `sql`, by its import, is a fragment of a
// query wherever it stands, read by `execute` or a helper that executes it; any other tag — postgres.js's
// client, or one the parse cannot place — is a query, a read wherever it stands, handed to `expect` or a
// function included. Every file of integration tests is read, none spared by a guess at its text. A
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
// cannot tell: their length, `some`, `every`, `includes`, a `for … of` whose body changes nothing outside it
// and leaves at no row (`break`, `return`, `yield`, a labelled `continue`), a `Set` — its size, `has`, itself
// against another, a `Map`'s `has` and size — `inArray`, `notInArray`, `typeof`, discarded, a promise refused;
// `onlyRow`, `sorted` and `sum` of `backend/tests/rows.ts`, by their import, which hold at run time what makes
// them free — the one row or none, else an error; values that are not objects, sorted; whole numbers, summed;
// under `expect`: `toHaveLength`, `toContain` and `toContainEqual` of the rows, `toBeDefined`,
// `toBeUndefined`, `toBeTruthy`, `toBeFalsy`, a `not` of these and of no other, `toEqual` of one row or none
// written in place or of `expect.arrayContaining`. **Not the first row, `find`, `reduce`, `sort`, `toSorted`,
// a part by `slice`, a value of a `Map` or an object by its key** (round 14, О1): each is the order the rows
// came in — of several, the first; of a comparator's ties, the one before; of a key repeated, the last. A
// callback of these is in doubt where it takes the index of a row (a parameter, the rest of its arguments),
// may change anything outside it — closed, in doubt it does (round 15, П1): outside is a name declared outside,
// an import but vitest's `expect`, `this`, and an alias of one; written by an assignment, its targets taken apart,
// `++`, `delete`, a loop's target; called, its method called, handed to a call or to `new`; a query by a template
// of any tag but Drizzle's `sql`; the platform's functions but its pure ones (`fetch`, `process.stdout.write`,
// `console`), and every one of them in a file that spies on or stubs the platform (round 16, Р1); of vitest's
// `expect`, only the names known to keep nothing — not a snapshot, which keeps a count (round 17, С1) — or is one the
// parse cannot read; the platform's `Boolean`, `String`, `Number` are read. Of the rows made one string
// nothing is free but its length. Rows in the order of chance may besides meet another read in the same total
// order — a snapshot with a snapshot. Anything else is refused, and the fix is an order, or the rows through
// `onlyRow`, `sorted`, `sum` — never a use the check does not know. **Every answer of «free» or «not a read»
// the check gives is one written here**; nothing else is let go.
//
// **What the check is** (owner's decision, 02.11.2026): a guard against a read written the ordinary way, not against
// a form built to slip past it, as `check-clock-bounds.mjs` is. A form found that hides an ordinary read is a new line
// here; a form built only to slip past it is review's.
//
// **4. What a statement takes by the heap's order, however its rows are used** (round 18, Т1, Т2): the net reverses
// the rows a statement gives and `onlyRow` counts them, but neither sees which rows they are or the order inside one.
// So SQL text — a template of any tag, a fragment of Drizzle's `sql`, a string run by `unsafe`, `query`, `execute` or
// `sql.raw` — is refused where, at any level of its parentheses, a `limit`, an `offset`, a `fetch first` or a
// `distinct on` stands with no `order by` of that level; where an aggregate that keeps the order it is fed in
// (`array_agg`, `string_agg`, `json_agg`, `jsonb_object_agg`, `array(select …)`) has no `order by` of its own; where a
// window of a place (`row_number`, `lag`, `first_value` …) is over no order, or over one named elsewhere. And a query
// of Drizzle taking a part of its rows — `limit`, `offset`, `selectDistinctOn`, `findFirst`, `findMany` of a `limit` —
// by no order, or by an order of chance, wherever the query began: a function of the file that returns it, carried on
// by a `limit`, takes a part by an identity written in the chain or by none (round 20, У1).
//
// **The price, named, by class, and nothing outside these classes** — of rows with no order, what a form this
// check does not follow hides: rows a helper of another file returns — the net reverses them, and values the
// same reversed it cannot tell — and a read of the API's own code, which no test file holds; of rows in
// an order the statement has: an order of ties is taken as an order — a column every row read shares, a
// parent's identity through a join, an order of SQL text by whatever it names; an order of values the test
// wrote is taken as the test's — a column that is neither a uuid nor a moment is not judged; a moment before an
// identity is refused even where the test wrote the moments; a callback calling a pure method of a name of
// this file or of an import is refused. Those go to review. The files read are the integration tests and the
// helpers beside them in `backend/tests/` (round 14), the net's own test aside.
//
//   node bin/check-ordered-reads.mjs

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import process from 'node:process'
import ts from 'typescript'

/** The files that read Postgres: the integration tests of the API and the helpers beside them (review round 14). */
const FILES = ['backend/*.integration.test.ts', 'backend/tests/*.ts']
/** The test of the net that turns rows read with no order: it reads so on purpose. */
const THE_NET = 'backend/tests/unordered-rows.integration.test.ts'
/** Where a column is a uuid, a moment or an identity. */
const SCHEMA = 'backend/src/db/schema.ts'

/** The methods an array of rows keeps its order through, every row's part kept: `slice` only whole, with nothing. */
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
/**
 * The methods whose answer no order of the rows can change. Not `find`, `reduce`, `sort`, `toSorted`: the first
 * match, a sum of strings, two rows a comparator ties — each the order the rows came in (review round 14, О1).
 */
const ORDERLESS = new Set(['some', 'every', 'includes'])
/**
 * What the platform holds that changes nothing outside a callback (review round 15): the functions, and the roots
 * whose methods only read or make — `Object`'s too, but `assign` and `defineProperty` write their first argument,
 * which is judged as any argument is. Anything else of the platform called — `fetch`, `process.stdout.write`,
 * `setTimeout`, `console`, an output — is in doubt (round 16, Р1). **Pure only where the file watches none of the
 * platform**: a spy or a stub on it — `vi.spyOn(console, 'log')`, `vi.spyOn(Map.prototype, 'set')`, `vi.stubGlobal`,
 * a function of it written over — records every call in its order, so in such a file every call of the platform and
 * every method of a value is in doubt, vitest's `expect` and its matchers alone known.
 */
const PURE_FUNCTIONS = new Set([
  'String',
  'Number',
  'Boolean',
  'BigInt',
  'parseInt',
  'parseFloat',
  'isNaN',
  'isFinite',
  'encodeURIComponent',
  'decodeURIComponent',
  'structuredClone',
  'Set',
  'Map',
  'Date',
  'Error',
  'TypeError',
  'RangeError',
  'RegExp',
  'URL',
  'URLSearchParams',
  'Array',
  'Object',
  'Uint8Array',
])
const PURE_GLOBALS = new Set([
  'JSON',
  'Math',
  'Object',
  'Array',
  'Number',
  'String',
  'BigInt',
  'Date',
  'Intl',
  'Buffer',
])
/** The platform's casts: a callback of the first argument alone. */
const CASTS = new Set(['Boolean', 'String', 'Number'])
/** The methods handed a value, not a callback. */
const NO_CALLBACK = new Set(['includes', 'slice', 'flat'])
/** What is handed the rows whole and keeps no order of them. */
const ORDERLESS_CALLS = new Set(['inArray', 'notInArray'])
/**
 * What keeps the rows in the order they were put in, and is followed as they are (review round 13, Н3): a `Set`, a
 * `Map`, an object of `Object.fromEntries`. Its size and `has` cannot tell the order, nor a `Set` compared with another
 * by `toEqual`; a value by its key can, and a `Map` or an object compared whole reads it (rounds 14, 21); spread,
 * `Array.from`, `values()`, `Object.keys` and the like give the rows back in that order.
 */
const CONTAINERS = { Set: 'set', Map: 'map', 'Object.fromEntries': 'object' }
const UNPACKS = new Set(['Array.from', 'Object.keys', 'Object.values', 'Object.entries'])
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
/**
 * The names of vitest's `expect` chain known to keep nothing between calls (review round 17, С1): its modifiers, its
 * matchers that compare and forget, its asymmetric helpers. Not a snapshot — `toMatchSnapshot`,
 * `toMatchInlineSnapshot`, `toMatchFileSnapshot`, `toThrowErrorMatchingSnapshot` keep a count, the n-th call met with
 * the n-th written — nor `extend` and what it adds, nor anything else: a name not here is in doubt.
 */
const KEEPS_NOTHING = new Set([
  'soft',
  'not',
  'resolves',
  'rejects',
  'toBe',
  'toEqual',
  'toStrictEqual',
  'toMatchObject',
  'toContain',
  'toContainEqual',
  'toHaveLength',
  'toHaveProperty',
  'toBeDefined',
  'toBeUndefined',
  'toBeNull',
  'toBeTruthy',
  'toBeFalsy',
  'toBeNaN',
  'toBeTypeOf',
  'toBeInstanceOf',
  'toBeGreaterThan',
  'toBeGreaterThanOrEqual',
  'toBeLessThan',
  'toBeLessThanOrEqual',
  'toBeCloseTo',
  'toMatch',
  'toThrow',
  'toThrowError',
  'toSatisfy',
  'toBeOneOf',
  'toHaveBeenCalled',
  'toHaveBeenCalledTimes',
  'toHaveBeenCalledWith',
  'any',
  'anything',
  'objectContaining',
  'arrayContaining',
  'stringContaining',
  'stringMatching',
  'closeTo',
])

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
  // an update, a delete or a merge returning rows returns them in no order, and can have none (round 13, Н2)
  if (/\b(update|delete|merge)\b/i.test(outside) && /\breturning\b/i.test(outside)) return true
  return /\bselect\b/i.test(all) && /\bfrom\b/i.test(all) && !/\border\s+by\b/i.test(outside)
}

/** The aggregates whose answer is the order they were fed in: an array, a text, a JSON array, an object whose key repeats. */
const ORDERED_AGGREGATES =
  /\b(array_agg|string_agg|json_agg|jsonb_agg|json_object_agg|jsonb_object_agg|json_arrayagg|xmlagg|array)\s*$/i
/** The window functions whose answer is a place in the window's order. */
const ORDERED_WINDOWS =
  /\b(row_number|rank|dense_rank|percent_rank|cume_dist|ntile|lag|lead|first_value|last_value|nth_value)\s*\([^()]*\)\s*over\s*$/i

/**
 * Why a statement picks its rows, or what it gathers into one, by the order the heap gives them (review round 18,
 * Т1, Т2), or undefined: at any level of its parentheses — a subquery as the statement — a `limit`, an `offset`, a
 * `fetch first` or a `distinct on` with no `order by` of that level; an aggregate that keeps the order it is fed in
 * (`array_agg`, `string_agg`, `json_agg`, `array(select …)`) with no `order by` of its own; a window of a place
 * (`row_number() over ()`) with none, or one named elsewhere. The net reverses the rows a statement gives, and
 * `onlyRow` counts them; neither sees which rows these are, or the order inside one of them.
 */
const pickedByChance = (template) => {
  const { all } = sqlOf(template)
  // each level by its own text, its parentheses' insides put aside: [text before it, its own text]
  const levels = []
  const stack = [{ before: '', own: '' }]
  for (const char of all) {
    if (char === '(') {
      stack.push({ before: stack.at(-1).own, own: '' })
      stack.at(-2).own += '(…'
    } else if (char === ')' && stack.length > 1) {
      levels.push(stack.pop())
      stack.at(-1).own += ')'
    } else stack.at(-1).own += char
  }
  levels.push(...stack)
  for (const { before, own } of levels) {
    const ordered = /\border\s+by\b/i.test(own)
    if (!ordered && /\b(limit|offset|fetch\s+(first|next)|distinct\s+on)\b/i.test(own))
      return 'a limit, an offset or a distinct on with no order by of its level'
    if (!ordered && ORDERED_AGGREGATES.test(before))
      return 'an aggregate with no order by of its own'
    if (!ordered && ORDERED_WINDOWS.test(before)) return 'a window of a place with no order by'
  }
  if (
    /\)\s*over\s+[a-z_]\w*/i.test(all) &&
    /\b(row_number|rank|dense_rank|percent_rank|cume_dist|ntile|lag|lead|first_value|last_value|nth_value)\s*\(/i.test(
      all,
    )
  )
    return 'a window of a place named elsewhere'
  return undefined
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
    // a parameter that is the whole text an `execute`, `unsafe` or `query` is handed: as it is, through `sql.raw`,
    // or as a template of `${sql.raw(text)}` alone (review round 11, Л2) — never a value or a name bound in one
    const raw = (n) =>
      ts.isCallExpression(n) &&
      n.expression.getText(sf) === 'sql.raw' &&
      ts.isIdentifier(n.arguments[0]) &&
      parameters.has(n.arguments[0].text)
    const mentions = (n) =>
      (ts.isIdentifier(n) && parameters.has(n.text)) ||
      raw(n) ||
      (ts.isTaggedTemplateExpression(n) &&
        ts.isTemplateExpression(n.template) &&
        n.template.head.text.trim() === '' &&
        n.template.templateSpans.length === 1 &&
        n.template.templateSpans[0].literal.text.trim() === '' &&
        raw(n.template.templateSpans[0].expression))
    let found = false
    const visit = (n) => {
      if (
        ts.isCallExpression(n) &&
        ts.isPropertyAccessExpression(n.expression) &&
        /^(execute|unsafe|query)$/.test(n.expression.name.text) &&
        n.arguments.some(mentions)
      )
        found = true
      ts.forEachChild(n, visit)
    }
    visit(f.body)
    return found
  }

  /** The module an import of a name is from: `vitest` for `import { expect } from 'vitest'`. */
  const importedFrom = (declaration) => {
    let d = declaration
    while (d && !ts.isImportDeclaration(d)) d = d.parent
    return d && ts.isStringLiteral(d.moduleSpecifier) ? d.moduleSpecifier.text : undefined
  }

  /** Whether a tag is Drizzle's `sql`, by the import that names it: a fragment, never a query of its own. */
  const drizzleSql = (tag) => {
    if (!ts.isIdentifier(tag)) return false
    const declaration = symbolOf(tag)?.declarations?.[0]
    const imported = declaration && ts.isImportSpecifier(declaration)
    if (!imported) return false
    const from = declaration.parent.parent.parent.moduleSpecifier
    return ts.isStringLiteral(from) && /^drizzle-orm/.test(from.text)
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
      // what a template is, is its tag's: Drizzle's `sql` is a fragment of a query wherever it stands — read by
      // `execute` or a helper that executes it, judged with the query it is part of (`where`, `exists`,
      // `select({ n: … })`); any other tag — postgres.js's client, or one the parse cannot place — is a query,
      // a read wherever it stands, handed to `expect` or a function included (review round 11, Л1, №19)
      if (drizzleSql(node.tag)) return undefined
      // handed to `execute`, the call is the read
      const p = node.parent
      if (
        ts.isCallExpression(p) &&
        ts.isPropertyAccessExpression(p.expression) &&
        p.expression.name.text === 'execute'
      )
        return undefined
      return unorderedTemplate(node.template) ? 'none' : undefined
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
      if (template) return unorderedTemplate(template.template) ? 'none' : undefined
      const written = texts.find(
        (text) =>
          text &&
          (ts.isStringLiteral(text) ||
            ts.isNoSubstitutionTemplateLiteral(text) ||
            ts.isTemplateExpression(text)),
      )
      return written && !unorderedTemplate(written) ? undefined : 'none'
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
    // an update or a delete of Drizzle returning rows returns them in no order, and can have none (round 13, Н2)
    if ((names.includes('update') || names.includes('delete')) && names.includes('returning'))
      return 'none'
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
  const callbackDoubt = (call, method) => callbackDoubtOf(call.arguments[0], method)
  /** The same of a callback handed in any place: `Array.from`'s mapping is its second (review round 22, Х1). */
  const callbackDoubtOf = (argument, method) => {
    if (!argument || NO_CALLBACK.has(method)) return undefined
    // the platform's casts take their first argument and nothing else (review round 5, №14)
    if (ts.isIdentifier(argument) && CASTS.has(argument.text) && !watched) return undefined
    const callback = functionOf(argument)
    if (!callback) return 'by a callback the check cannot read'
    if (callback.parameters.length > 1) return 'by index'
    // an index without a parameter for it: the rest of the arguments, or a count kept outside (Д3)
    if (callback.parameters.some((parameter) => parameter.dotDotDotToken)) return 'by index'
    return countsOutside(callback) ? 'by what it changes outside' : undefined
  }

  /** Whether a name is the platform's: none of the file, none imported (`console`, `Map`, `globalThis`). */
  const platform = (node) => {
    let n = node
    while (
      ts.isPropertyAccessExpression(n) ||
      ts.isElementAccessExpression(n) ||
      ts.isParenthesizedExpression(n)
    )
      n = n.expression
    return ts.isIdentifier(n) && !(symbolOf(n)?.declarations ?? []).length
  }
  /**
   * Whether the file watches the platform (review round 16, Р1): a spy on it, a stub of it, a function of it written
   * over, a property of it defined — then a call of the platform is no longer known to keep nothing.
   */
  const watched = (() => {
    let found = false
    const visit = (node) => {
      if (ts.isCallExpression(node)) {
        const callee = node.expression.getText(sf)
        const [first] = node.arguments
        if (/(^|\.)stubGlobal$/.test(callee)) found = true
        if (
          /(^|\.)spyOn$|^Object\.defineProperty$|^Reflect\.(set|defineProperty)$/.test(callee) &&
          first &&
          platform(first)
        )
          found = true
      }
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
        node.operatorToken.kind <= ts.SyntaxKind.LastAssignment &&
        !ts.isIdentifier(node.left) &&
        platform(node.left)
      )
        found = true
      if (!found) ts.forEachChild(node, visit)
    }
    visit(sf)
    return found
  })()
  /**
   * What a callee of vitest's `expect` chain is: `pure` where `expect` and every name of its chain is one known to
   * keep nothing (`KEEPS_NOTHING`), `doubt` where one is not — a snapshot keeps a count, the n-th call is met with the
   * n-th written (review round 17, С1), and a matcher of `expect.extend` may keep anything — or none, not of the chain.
   */
  const expectChain = (node) => {
    let n = node
    let known = true
    for (;;) {
      if (ts.isPropertyAccessExpression(n)) {
        if (!KEEPS_NOTHING.has(n.name.text)) known = false
        n = n.expression
      } else if (ts.isElementAccessExpression(n)) {
        const name = n.argumentExpression
        if (!(ts.isStringLiteralLike(name) && KEEPS_NOTHING.has(name.text))) known = false
        n = n.expression
      } else if (ts.isCallExpression(n)) n = n.expression
      else break
    }
    if (!ts.isIdentifier(n) || n.text !== 'expect') return undefined
    const [first] = symbolOf(n)?.declarations ?? []
    if (!(first && ts.isImportSpecifier(first) && importedFrom(first) === 'vitest'))
      return undefined
    return known ? 'pure' : 'doubt'
  }

  /**
   * Whether a function — or a loop, its body — may change anything outside it (review round 15, П1: closed, in doubt
   * it does). Outside is a name declared outside it, an import but vitest's `expect`, `this`, and a name of the body
   * given anything that mentions one of those (`const o = outer`, an alias). It changes what is outside by writing
   * it — an assignment, its targets taken apart, `++`, `delete`, the target of a `for … of` — by calling it or a
   * method of it, by handing it to a call or to `new`, by a template of any tag but Drizzle's `sql`, which only
   * builds a fragment: a query of postgres.js writes as a call does; and by calling or making with `new` what the
   * platform holds but its pure functions and constructors (`fetch`, `process.stdout.write`).
   */
  const countsOutside = (callback, body = callback.body) => {
    const within = (declaration) =>
      declaration.pos >= callback.pos && declaration.end <= callback.end
    const rootOf = (node) => {
      let n = node
      while (
        ts.isPropertyAccessExpression(n) ||
        ts.isElementAccessExpression(n) ||
        ts.isParenthesizedExpression(n) ||
        ts.isNonNullExpression(n) ||
        ts.isAsExpression(n) ||
        ts.isSatisfiesExpression(n) ||
        ts.isSpreadElement(n)
      )
        n = n.expression
      return n
    }
    /** The names of the body given what mentions something outside: what they hold may be the outside itself. */
    const aliases = new Set()
    /** `outside` of a name: the platform's (`undefined`), outside (`true`) or the body's (`false`). */
    const whose = (identifier) => {
      const symbol = symbolOf(identifier)
      const [first] = symbol?.declarations ?? []
      if (!first) return undefined
      if (ts.isImportSpecifier(first) || ts.isImportClause(first) || ts.isNamespaceImport(first))
        return !(identifier.text === 'expect' && importedFrom(first) === 'vitest')
      if (aliases.has(symbol)) return true
      return !within(symbol.valueDeclaration ?? first)
    }
    /** Whether a value is of what is outside: its root a name from outside, or `this`. */
    const outside = (node) => {
      const root = rootOf(node)
      if (root.kind === ts.SyntaxKind.ThisKeyword) return true
      return ts.isIdentifier(root) && whose(root) === true
    }
    /** Whether a target written is outside: a name of the platform is outside too (`globalThis.x = row`). */
    const written = (node) => {
      const root = rootOf(node)
      if (root.kind === ts.SyntaxKind.ThisKeyword) return true
      return ts.isIdentifier(root) && whose(root) !== false
    }
    /** The targets of an assignment, taken apart: `[a, b] = …`, `({ x: o.k, ...rest } = …)`. */
    const targets = (left) => {
      if (ts.isArrayLiteralExpression(left))
        return left.elements.flatMap((element) =>
          ts.isOmittedExpression(element) ? [] : targets(element),
        )
      if (ts.isObjectLiteralExpression(left))
        return left.properties.flatMap((property) =>
          ts.isPropertyAssignment(property)
            ? targets(property.initializer)
            : ts.isShorthandPropertyAssignment(property)
              ? [property.name]
              : ts.isSpreadAssignment(property)
                ? targets(property.expression)
                : [property],
        )
      if (ts.isSpreadElement(left)) return targets(left.expression)
      if (ts.isBinaryExpression(left) && left.operatorToken.kind === ts.SyntaxKind.EqualsToken)
        return targets(left.left)
      return [left]
    }
    /** Whether a node mentions anything outside, nested functions included. */
    const mentions = (node) => {
      let found = false
      const visit = (n) => {
        if ((ts.isIdentifier(n) || n.kind === ts.SyntaxKind.ThisKeyword) && outside(n)) found = true
        if (!found) ts.forEachChild(n, visit)
      }
      visit(node)
      return found
    }
    /** The names a declaration binds, taken apart. */
    const bound = (name) =>
      ts.isIdentifier(name)
        ? [name]
        : name.elements.flatMap((element) =>
            ts.isOmittedExpression(element) ? [] : bound(element.name),
          )
    // aliases learnt until nothing changes: `const a = outer; const b = a`
    for (let grew = true; grew;) {
      grew = false
      const learn = (n) => {
        const given =
          ts.isVariableDeclaration(n) && n.initializer
            ? [n.name, n.initializer]
            : ts.isBinaryExpression(n) &&
                n.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
                ts.isIdentifier(n.left)
              ? [n.left, n.right]
              : undefined
        if (given && mentions(given[1]))
          for (const name of bound(given[0])) {
            const symbol = symbolOf(name)
            if (symbol && !aliases.has(symbol) && whose(name) === false) {
              aliases.add(symbol)
              grew = true
            }
          }
        ts.forEachChild(n, learn)
      }
      learn(body)
    }
    /** Whether calling or making what a callee names may change what is outside. */
    const callsOut = (callee) => {
      // vitest's `expect` and its matchers keep nothing, the platform watched or not
      const chain = expectChain(callee)
      if (chain) return chain === 'doubt'
      if (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)) {
        const root = rootOf(callee)
        if (root.kind === ts.SyntaxKind.ThisKeyword) return true
        // a method of a value the body made — a call's answer, a literal, a name of its own — is the body's, unless
        // the file watches the platform: a spy on a prototype hears it too (`vi.spyOn(Map.prototype, 'set')`)
        if (!ts.isIdentifier(root)) return watched
        const of = whose(root)
        if (of === undefined)
          return (
            watched ||
            !PURE_GLOBALS.has(root.text) ||
            (root.text === 'Object' && !ts.isPropertyAccessExpression(callee))
          )
        return of || watched
      }
      if (ts.isIdentifier(callee)) {
        const of = whose(callee)
        return of === undefined ? watched || !PURE_FUNCTIONS.has(callee.text) : of
      }
      // a callee the parse cannot name is in doubt
      return !(ts.isFunctionExpression(callee) || ts.isArrowFunction(callee))
    }
    let changes = false
    const visit = (node) => {
      if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
        if (callsOut(node.expression)) changes = true
        if ((node.arguments ?? []).some(outside)) changes = true
      }
      if (ts.isTaggedTemplateExpression(node) && !drizzleSql(node.tag) && callsOut(node.tag))
        changes = true
      if (
        (ts.isPostfixUnaryExpression(node) || ts.isPrefixUnaryExpression(node)) &&
        [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(node.operator) &&
        written(node.operand)
      )
        changes = true
      if (ts.isDeleteExpression(node) && written(node.expression)) changes = true
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
        node.operatorToken.kind <= ts.SyntaxKind.LastAssignment &&
        targets(node.left).some(written)
      )
        changes = true
      if (
        (ts.isForOfStatement(node) || ts.isForInStatement(node)) &&
        !ts.isVariableDeclarationList(node.initializer) &&
        targets(node.initializer).some(written)
      )
        changes = true
      ts.forEachChild(node, visit)
    }
    visit(body)
    return changes
  }

  /**
   * Why a `for … of` of rows may tell their order: its body changes what is outside it, as a callback's may, or leaves
   * the loop at a row — `break`, `return`, `yield` — which is `find` (review round 14, О1).
   */
  const loopDoubt = (loop) => {
    let leaves = false
    const visit = (node) => {
      if (ts.isFunctionLike(node)) return
      if (ts.isBreakStatement(node) || ts.isReturnStatement(node) || ts.isYieldExpression(node))
        leaves = true
      if (ts.isContinueStatement(node) && node.label) leaves = true
      ts.forEachChild(node, visit)
    }
    visit(loop.statement)
    if (leaves) return 'a for … of left at a row'
    return countsOutside(loop, loop.statement)
      ? 'a for … of that changes what is outside it'
      : undefined
  }

  /**
   * Whether a call is of `onlyRow`, `sorted` or `sum` of `backend/tests/rows.ts`, by the import that names it: the
   * one row or none, else an error; values that are not objects, sorted; whole numbers, summed — what no order of the
   * rows can change, held at run time (review round 14, О1).
   */
  const byRows = (callee) => {
    if (!ts.isIdentifier(callee)) return false
    const declaration = symbolOf(callee)?.declarations?.[0]
    if (!declaration || !ts.isImportSpecifier(declaration)) return false
    const from = declaration.parent.parent.parent.moduleSpecifier
    const name = (declaration.propertyName ?? declaration.name).text
    return ts.isStringLiteral(from) && from.text === './rows' && /^(onlyRow|sorted|sum)$/.test(name)
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
  const fate = (node, order, kept = null) => {
    let n = node
    /** Whether the rows have been made one string: `toContain` of it reads them in place (Ж2). */
    let text = false
    /** What keeps the rows in their order, if they are in one: `set`, `map` or `object` (Н3). */
    let container = kept
    for (;;) {
      const p = n.parent
      if (container) {
        const end = contained(n, p, container, order)
        if (end.unpacked) {
          n = end.unpacked
          container = null
          continue
        }
        if (end.name) return { name: end.name, container }
        if (end.free || end.why) return end
      }
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
        // a part of the rows by place is the order's: `slice` keeps them only whole (review round 14, О1)
        if (name === 'slice' && p.parent.arguments.length > 0) return { why: '.slice(…)' }
        if (KEEPS.has(name)) {
          n = p.parent
          continue
        }
        // the first row of several is the order's (review round 14, О1): `onlyRow` takes the one
        if (name === 'at' && literalIndex(p.parent.arguments[0]) === 0)
          return { why: 'the first row' }
        return { why: `.${name}()` }
      }
      if (ts.isElementAccessExpression(p) && p.expression === n)
        return { why: literalIndex(p.argumentExpression) === 0 ? 'the first row' : '[…]' }
      if (ts.isVariableDeclaration(p) && p.initializer === n) {
        if (ts.isIdentifier(p.name)) return { name: p.name }
        const [only, ...rest] = ts.isArrayBindingPattern(p.name) ? p.name.elements : []
        const first = only && ts.isBindingElement(only) && !only.dotDotDotToken
        return { why: first && rest.length === 0 ? 'the first row' : 'taken apart' }
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
      if (ts.isForOfStatement(p) && p.expression === n) {
        const doubt = loopDoubt(p)
        return doubt ? { why: doubt } : { free: true }
      }
      if ((ts.isCallExpression(p) || ts.isNewExpression(p)) && p.arguments?.includes(n)) {
        const callee = p.expression
        if (/^expect(\.soft)?$/.test(callee.getText(sf))) return matched(p, order, text)
        if (ts.isCallExpression(p) && byRows(callee)) return { free: true }
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
          container = null
          continue
        }
        const keeper = CONTAINERS[callee.getText(sf)]
        if (keeper) {
          n = p
          container = keeper
          continue
        }
        if (UNPACKS.has(callee.getText(sf))) {
          // `Array.from`'s mapping is a callback of the rows, as `map`'s (review round 22, Х1)
          const doubt = callbackDoubtOf(p.arguments[1], 'map')
          if (doubt) return { why: `${callee.getText(sf)}(…, mapping) ${doubt}` }
          n = p
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
  /**
   * Where a `Set`, a `Map` or an object of rows goes: `{ free }`, `{ why }`, `{ name }`, `{ unpacked }` — given back
   * as rows in its order — or `{}` where the ordinary walk goes on.
   */
  const contained = (n, p, container, order) => {
    if (ts.isPropertyAccessExpression(p) && p.expression === n) {
      const name = p.name.text
      const called = ts.isCallExpression(p.parent) && p.parent.expression === p
      // a value by its key is the last row of that key put in: the order's where a key repeats (round 14)
      if (container === 'object') return { why: called ? `.${name}()` : 'a value by its key' }
      if (!called) return name === 'size' ? { free: true } : { why: `.${name}` }
      if (name === 'has') return { free: true }
      if (name === 'get') return { why: 'a value by its key' }
      if (/^(values|keys|entries)$/.test(name)) return { unpacked: p.parent }
      return { why: `.${name}()` }
    }
    if (ts.isElementAccessExpression(p) && p.expression === n)
      return { why: container === 'object' ? 'a value by its key' : '[…]' }
    if (ts.isVariableDeclaration(p) && p.initializer === n && ts.isIdentifier(p.name))
      return { name: p.name }
    if ((ts.isCallExpression(p) || ts.isNewExpression(p)) && p.arguments?.includes(n)) {
      const callee = p.expression.getText(sf)
      if (UNPACKS.has(callee)) {
        const doubt = callbackDoubtOf(p.arguments[1], 'map')
        return doubt ? { why: `${callee}(…, mapping) ${doubt}` } : { unpacked: p }
      }
      if (/^expect(\.soft)?$/.test(callee)) {
        const end = matched(p, order)
        // compared with another by `toEqual`, a Set tells no order; a Map and an object hold the last row of a key
        // repeated, and the comparison reads it — its value by its key, whole (review round 21, Ф1)
        return container === 'set' &&
          end.why &&
          /^(toEqual|toStrictEqual|toMatchObject)/.test(end.why)
          ? { free: true }
          : end
      }
      return {}
    }
    // spread back into an array, it is the rows in their order
    if (
      ts.isSpreadElement(p) &&
      ts.isArrayLiteralExpression(p.parent) &&
      p.parent.elements.length === 1
    )
      return { unpacked: p.parent }
    if (ts.isForOfStatement(p) && p.expression === n) {
      const doubt = loopDoubt(p)
      return doubt ? { why: doubt } : { free: true }
    }
    return {}
  }

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
      const follow = (node, kept = null) => {
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
        const end = fate(node, order, kept)
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
          for (const use of mentions.get(symbol) ?? []) follow(use, end.container ?? null)
        }
      }
      follow(read)
    }
  }
  /**
   * The order of a query carried on from what the parse cannot read whole — a function of the file that returns it:
   * an order of insertion only where its first column is an identity, every column of it one the schema names; in
   * doubt, none (round 20, У1).
   */
  const continuedOrder = (node) => {
    const given = queryOf(node)
      .filter((call) => calledAs(call) === 'orderBy')
      .flatMap((call) => [...call.arguments])
    const columns = given.map((argument) => orderColumns(argument))
    if (columns.some((column) => !column)) return 'none'
    const [first] = columns.flat()
    return first && named(first, identity) ? undefined : 'none'
  }

  // what a statement picks or gathers by the heap's order, however its rows are used (review round 18, Т1, Т2)
  const picks = []
  const pick = (node, why) =>
    picks.push(`${String(line(node))}: ${(lines[line(node) - 1] ?? '').trim()} — ${why}`)
  const visitPicks = (node) => {
    // SQL as text: a template of any tag — a query or a fragment of one — and a string run as SQL
    if (ts.isTaggedTemplateExpression(node)) {
      const why = pickedByChance(node.template)
      if (why) pick(node, why)
    }
    if (
      ts.isCallExpression(node) &&
      (/^(sql\.raw)$/.test(node.expression.getText(sf)) ||
        (ts.isPropertyAccessExpression(node.expression) &&
          /^(unsafe|query|execute)$/.test(node.expression.name.text)))
    ) {
      const text = constant(node.arguments[0])
      if (
        text &&
        (ts.isStringLiteral(text) ||
          ts.isNoSubstitutionTemplateLiteral(text) ||
          ts.isTemplateExpression(text))
      ) {
        const why = pickedByChance(text)
        if (why) pick(node, why)
      }
    }
    // a query of Drizzle that takes part of its rows — `limit`, `offset`, `selectDistinctOn` — by no order of insertion
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      !(ts.isPropertyAccessExpression(node.parent) && node.parent.expression === node)
    ) {
      const names = queryOf(node).map(calledAs)
      const part = names.some((name) => /^(limit|offset|selectDistinctOn)$/.test(name ?? ''))
      // wherever the query began — written whole, a `const`, a function of the file that returns it (round 20, У1)
      if (part) {
        const order = !names.includes('orderBy')
          ? 'none'
          : names.includes('from')
            ? readOf(node)
            : continuedOrder(node)
        if (order !== undefined && !/^(update|delete)$/.test(names.at(-2) ?? ''))
          pick(
            node,
            `a part of the rows by ${order === 'none' ? 'no order' : 'an order of chance'}`,
          )
      }
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      /^(findMany|findFirst)$/.test(node.expression.name.text)
    ) {
      const [query] = node.arguments
      const keys =
        query && ts.isObjectLiteralExpression(query)
          ? query.properties.map((p) => p.name?.getText(sf))
          : []
      if (
        (node.expression.name.text === 'findFirst' ||
          keys.includes('limit') ||
          keys.includes('offset')) &&
        !keys.includes('orderBy')
      )
        pick(node, `${node.expression.name.text} of a part of the rows by no order`)
    }
    ts.forEachChild(node, visitPicks)
  }
  visitPicks(sf)
  return [...new Set([...found, ...picks])].sort((a, b) => Number.parseInt(a) - Number.parseInt(b))
}

/**
 * The files the check reads, as git knows them: every integration test and every helper beside them, the net's own
 * test aside.
 * @returns {string[]}
 */
export function filesToRead() {
  return execFileSync('git', ['ls-files', ...FILES], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter((file, at, all) => file && file !== THE_NET && all.indexOf(file) === at)
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop() ?? '')) {
  const schema = readFileSync(SCHEMA, 'utf8')
  const chance = chanceColumns(schema)
  const identity = identityColumns(schema)
  const known = schemaTables(schema)
  const keys = uniqueKeys(schema)
  const files = filesToRead()
  const problems = files.flatMap((file) => {
    const source = readFileSync(file, 'utf8')
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
