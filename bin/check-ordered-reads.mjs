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
// not. **A read in the order of chance** is one whose order has a column of chance in it, read from the
// schema: a uuid (`randomUUID()`) or a moment, whoever writes it — `now()` is one for every row of a
// transaction, a repository writes one for a whole batch. Their order is of values, not of insertion, and a
// column of chance decides the ties of those before it.
//
// **The rule is closed** (review of MOL-323, rounds 1–3): a list of the uses that compare by position
// missed one more each time it was attacked. So it goes the other way round. Rows are followed through
// `await`, a cast, the methods that keep an order (`map`, `filter`, `flatMap`, `flat`, `slice`),
// `JSON.stringify`, a spread of them alone, a branch of `?:`, `??` or `||`, an object they are put in, a
// name they are given — declared, assigned or taken from an array (`Promise.all`) — and a function of the
// file that returns them. Rows with no order may end only where their order cannot tell: their length,
// their first row (`[0]`, `at(0)`, `const [row] = …`), `find`, `some`, `every`, `includes` — never by an
// index their callback, written in place or named, is handed — `reduce`, `sort`, `toSorted`, a `for … of`,
// a `Set`, a `Map`, `inArray`, `notInArray`, `Object.fromEntries`, `typeof`, discarded; under `expect`:
// `toHaveLength`, `toContain`, `toContainEqual`, `toBeDefined`, `toBeUndefined`, `toBeTruthy`, `toBeFalsy`,
// any `not`, `toEqual` of one row or none written in place, or of `expect.arrayContaining`. Rows in the
// order of chance may besides be compared with another read in the order of chance — a snapshot with a
// snapshot, by the read itself or a name given it — never with anything the test builds. Anything else is
// refused, and the fix is an order, never a use the check does not know.
//
// What this is: a guard against the ordinary form, not against one built to slip past it. **The price,
// named, by class:** an order of ties is taken as an order — a column every row read shares
// (`.orderBy(t.threadId)` under `eq(t.threadId, …)`), a `sort` whose key repeats, an `order by` of SQL text
// by whatever it names; a row picked as the one — the first, `find`, a key of a `Map` or
// `Object.fromEntries` — is taken as the only one: where more qualify, the first in the heap answers, or
// for a key the last; what a `for … of` or a `reduce` collects is not followed — a sum is their ordinary
// use; a field of an object of rows is not followed; a helper of another file is not followed. Those go to
// review.
//
//   node bin/check-ordered-reads.mjs

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import process from 'node:process'
import ts from 'typescript'

/** The files that read Postgres: the integration tests of the API. */
const FILES = ['backend/*.integration.test.ts']
/** Where a column is a uuid or a moment: its order is chance. */
const SCHEMA = 'backend/src/db/schema.ts'

/** A file that names none of these reads nothing: the binder is spared it. */
export const MAY_READ = /\bselect|findMany/i

/** The methods an array of rows keeps its order through. */
const KEEPS = new Set(['map', 'filter', 'flatMap', 'flat', 'slice'])
/** The methods whose answer no order of the rows can change, or that give them one. */
const ORDERLESS = new Set(['find', 'some', 'every', 'includes', 'reduce', 'sort', 'toSorted'])
/** Where a callback is handed the index of a row: the second parameter, `reduce`'s third; a comparator never. */
const INDEX_AT = { reduce: 2, sort: Infinity, toSorted: Infinity }
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

/**
 * The columns of the schema whose order is chance, as `table.column` by the names the tests import.
 * @param {string} source
 * @returns {Set<string>}
 */
export function chanceColumns(source) {
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
        if (ts.isPropertyAssignment(column) && chanceColumn(column.initializer))
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
 * @returns {string[]}
 */
export function unorderedReads(fileName, source, chance = new Set()) {
  const { sf, checker } = bind(fileName, source)
  const symbolOf = (node) => checker.getSymbolAtLocation(node)
  /** The functions of the file that return a read, by their symbol, with its order: `none` or `chance`. */
  const helpers = new Map()

  /** Whether an argument of `orderBy` is a column whose order is chance. */
  const byChance = (argument) => {
    let a = argument
    if (ts.isCallExpression(a) && /^(asc|desc)$/.test(a.expression.getText(sf))) a = a.arguments[0]
    return Boolean(a) && ts.isPropertyAccessExpression(a) && chance.has(a.getText(sf))
  }

  /** What order a node reads in, if it reads: `none`, `chance`, or undefined — ordered, or no read. */
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
      // a column of chance decides the ties of those before it: the order is chance
      return columns.some(byChance) ? 'chance' : undefined
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

  /** Whether the callback a method of rows is handed takes the index of a row. */
  const byIndex = (call, method) => {
    const callback = functionOf(call.arguments[0])
    return Boolean(callback && callback.parameters.length > (INDEX_AT[method] ?? 1))
  }

  /** The names given a read, by their symbol, with its order. */
  const names = new Map()
  /** Whether a value is rows in the order of chance too: a read of them, or a name given one. */
  const chanceSide = (node) => {
    let n = node
    while (ts.isAwaitExpression(n) || ts.isParenthesizedExpression(n) || ts.isAsExpression(n))
      n = n.expression
    return (ts.isIdentifier(n) ? names.get(symbolOf(n)) : readOf(n)) === 'chance'
  }

  /**
   * Where rows go: `{ free }` where their order cannot tell; `{ name }` given to a name; `{ helper }`
   * returned by a function of the file; `{ why, againstRead }` used in an order — `againstRead` where they
   * are compared with rows read in the order of chance too.
   */
  const fate = (node) => {
    let n = node
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
        if (!ts.isCallExpression(p.parent) || p.parent.expression !== p)
          return name === 'length' ? { free: true } : { why: `.${name}` }
        if ((ORDERLESS.has(name) || KEEPS.has(name)) && byIndex(p.parent, name))
          return { why: `.${name}() by index` }
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
        if (/^expect(\.soft)?$/.test(callee.getText(sf))) return matched(p)
        // the value a matcher compares with: the rows on the other side of `toEqual(rows)`
        const subject = ts.isPropertyAccessExpression(callee) ? subjectOf(callee) : undefined
        if (subject && ts.isPropertyAccessExpression(callee)) {
          const name = callee.name.text
          if (negated(callee)) return { free: true }
          if (COMPARES.has(name)) return { why: `${name}(…)`, againstRead: chanceSide(subject) }
          return { why: `${name}(…)` }
        }
        if (callee.getText(sf) === 'JSON.stringify') {
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
  const matched = (expectCall) => {
    let m = expectCall.parent
    while (ts.isPropertyAccessExpression(m) && /^(resolves|rejects)$/.test(m.name.text))
      m = m.parent
    if (!ts.isPropertyAccessExpression(m)) return { why: 'expect' }
    const name = m.name.text
    if (name === 'not' || ORDERLESS_MATCHERS.has(name)) return { free: true }
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
      return { why: `${name}(${what})`, againstRead: chanceSide(expected) }
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
        const end = fate(node)
        if (end.helper) {
          const symbol = symbolOf(end.helper)
          if (helpers.get(symbol) !== 'none') helpers.set(symbol, order)
        } else if (end.why && !(order === 'chance' && end.againstRead)) {
          const at = node === read ? '' : ` at ${String(line(node))}`
          const by = order === 'chance' ? ' (ordered by chance)' : ''
          found.push(
            `${String(line(read))}: ${(lines[line(read) - 1] ?? '').trim()} — ${end.why}${at}${by}`,
          )
        } else if (end.name) {
          const symbol = symbolOf(end.name)
          if (names.get(symbol) !== 'none') names.set(symbol, order)
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
  const chance = chanceColumns(readFileSync(SCHEMA, 'utf8'))
  const files = execFileSync('git', ['ls-files', ...FILES], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter(Boolean)
  const problems = files.flatMap((file) => {
    const source = readFileSync(file, 'utf8')
    if (!MAY_READ.test(source)) return []
    return unorderedReads(file, source, chance).map((found) => `  ${file}:${found}`)
  })
  if (problems.length > 0) {
    console.error(
      `ordered reads: ${String(problems.length)} rows with no ORDER BY used in an order — order by an identity id or a position, never by a uuid or a moment (.claude/rules/testing.md, MOL-323)`,
    )
    for (const problem of problems) console.error(problem)
    process.exitCode = 1
  }
}
