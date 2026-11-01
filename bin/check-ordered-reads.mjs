// Refuses a read of Postgres with no ORDER BY whose rows an integration test uses in an order (MOL-323):
// without one Postgres promises no order, and `clearAll` empties the tables by `DELETE`, so a row inserted
// later may come back first. «То же фото дважды» in `feedback-bot` read its four words so and failed on a
// pull request that touched only the PWA (CI 41022785698).
//
// Found by parsing, as `check-clock-bounds.mjs` is, names resolved by TypeScript's binder.
//
// **A read with no order**: a chain of Drizzle with `select…` and `from` and no `orderBy` that names a column
// (`orderBy()` renders no ORDER BY); `findMany` with no `orderBy`; a template with `select` and `from` and no
// `order by` of the statement itself — not in parentheses, a comment or a string — handed to `execute` or
// tagged on its own (postgres.js); a function of the file that returns one, named first or not. **A read in
// the order of chance** is one ordered only by a uuid of the schema or by `createdAt`: an order of values,
// not of insertion — two writes of one transaction share `now()`, and a uuid is `randomUUID()`.
//
// **The rule is closed** (review of MOL-323, round 1): a list of the uses that compare by position missed one
// more each time it was attacked — a name of a name, `.join`, `.resolves`, a spread, `Promise.all`. So it goes
// the other way round. Rows with no order are followed through `await`, a cast, the methods that keep an
// order (`map`, `filter`, `flatMap`, `flat`, `slice`), `JSON.stringify`, a spread of them alone, a branch of
// `?:`, `??` or `||`, a name they are given — declared, assigned or taken from an array (`Promise.all`) — and a
// function of the file that returns them. They may end only where their order cannot tell: their length, their
// first row (`[0]`, `at(0)`, `const [row] = …` — the read of one row), `find`, `some`, `every`, `includes`,
// `reduce`, `sort`, `toSorted`, a `for … of`, a `Set`, a `Map`, `inArray`, `notInArray`, `Object.fromEntries`,
// `typeof`, discarded; under `expect`: `toHaveLength`, `toContain`, `toContainEqual`, `toBeDefined`,
// `toBeUndefined`, `toBeTruthy`, `toBeFalsy`, any `not`, `toEqual` of one row or none or of
// `expect.arrayContaining`. Anything else is refused, and the fix is an order, never a use the check does
// not know. Rows in the order of chance are refused only where the test writes an order of insertion: an
// array of two or more written in place, an index past 0, taken apart into two.
//
// What this is: a guard against the ordinary form, not against one built to slip past it. **The price,
// named:** a helper of another file is not followed; what a `for … of` or a `reduce` collects is not — its sum
// is the ordinary use; a column whose order is no order but is neither a uuid nor `createdAt` — one every row
// read shares (`.orderBy(t.threadId)` under `eq(t.threadId, …)`) — passes. Those go to review.
//
//   node bin/check-ordered-reads.mjs

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import process from 'node:process'
import ts from 'typescript'

/** The files that read Postgres: the integration tests of the API. */
const FILES = ['backend/*.integration.test.ts']
/** Where a column is a uuid: its order is chance (`randomUUID()`). */
const SCHEMA = 'backend/src/db/schema.ts'

/** A file that names none of these reads nothing: the binder is spared it. */
export const MAY_READ = /\bselect|findMany/i

/** The methods an array of rows keeps its order through. */
const KEEPS = new Set(['map', 'filter', 'flatMap', 'flat', 'slice'])
/** The methods whose answer no order of the rows can change, or that give them one. */
const ORDERLESS = new Set(['find', 'some', 'every', 'includes', 'reduce', 'sort', 'toSorted'])
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
/** The matchers that compare an array element by element. */
const COMPARES = new Set(['toEqual', 'toStrictEqual', 'toMatchObject'])
/** A column whose order is chance whatever the table. */
const CHANCE = new Set(['createdAt'])

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

/** The innermost call a chain starts with: `uuid` of `uuid('id').primaryKey()`. */
const rootCall = (node) => {
  let n = node
  while (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression))
    n = n.expression.expression
  return ts.isCallExpression(n) && ts.isIdentifier(n.expression) ? n.expression.text : undefined
}

/**
 * The columns of the schema that are uuids, as `table.column` by the names the tests import.
 * @param {string} source
 * @returns {Set<string>}
 */
export function uuidColumns(source) {
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
        if (ts.isPropertyAssignment(column) && rootCall(column.initializer) === 'uuid')
          found.add(`${declaration.name.text}.${column.name.getText(sf)}`)
    }
  }
  return found
}

/** A template's SQL outside parentheses: what `${…}` holds put aside, comments and strings taken out. */
const statementOf = (template) => {
  const parts = ts.isNoSubstitutionTemplateLiteral(template)
    ? [template.text]
    : [template.head.text, ...template.templateSpans.map((span) => span.literal.text)]
  const text = parts
    .join(' ? ')
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'(?:[^']|'')*'/g, "''")
  let outside = ''
  let depth = 0
  for (const char of text) {
    if (char === '(') depth++
    if (depth === 0) outside += char
    if (char === ')') depth--
  }
  return outside
}

/** Whether a template reads rows with no order: `select … from` and no `order by` of its own. */
const unorderedTemplate = (template) => {
  const statement = statementOf(template)
  return (
    /\bselect\b/i.test(statement) &&
    /\bfrom\b/i.test(statement) &&
    !/\border\s+by\b/i.test(statement)
  )
}

/** The calls of a chain, outermost first: `db.select().from(t).where(c)`. */
const callsOf = (node) => {
  const calls = []
  let n = node
  for (;;) {
    if (ts.isCallExpression(n)) {
      if (ts.isPropertyAccessExpression(n.expression)) calls.push(n)
      n = n.expression
    } else if (ts.isPropertyAccessExpression(n)) n = n.expression
    else return calls
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

/**
 * Every read with no order that one file uses in an order, as `line: text — why`.
 * @param {string} fileName
 * @param {string} source
 * @param {Set<string>} [uuids] the uuid columns of the schema, as `table.column`
 * @returns {string[]}
 */
export function unorderedReads(fileName, source, uuids = new Set()) {
  const { sf, checker } = bind(fileName, source)
  const symbolOf = (node) => checker.getSymbolAtLocation(node)
  /** The functions of the file that return a read, by their symbol, with its order: `none` or `chance`. */
  const helpers = new Map()

  /** Whether an argument of `orderBy` is a column whose order is chance. */
  const byChance = (argument) => {
    let a = argument
    if (ts.isCallExpression(a) && /^(asc|desc)$/.test(a.expression.getText(sf))) a = a.arguments[0]
    return (
      Boolean(a) &&
      ts.isPropertyAccessExpression(a) &&
      (uuids.has(a.getText(sf)) || CHANCE.has(a.name.text))
    )
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
    const calls = callsOf(node)
    const names = calls.map((call) => call.expression.name.text)
    if (names.some((name) => name.startsWith('select')) && names.includes('from')) {
      const columns = calls
        .filter((call) => call.expression.name.text === 'orderBy')
        .flatMap((call) => [...call.arguments])
      if (columns.length === 0) return 'none'
      return columns.every(byChance) ? 'chance' : undefined
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

  /**
   * Where rows go: `{ free }` where their order cannot tell; `{ name }` given to a name; `{ helper }`
   * returned by a function of the file; `{ why, stated }` used in an order — `stated` where the test writes
   * the order of insertion itself.
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
        (ts.isSpreadElement(p) &&
          ts.isArrayLiteralExpression(p.parent) &&
          p.parent.elements.length === 1)
      ) {
        n = ts.isSpreadElement(p) ? p.parent : p
        continue
      }
      if (ts.isPropertyAccessExpression(p) && p.expression === n) {
        const name = p.name.text
        if (!ts.isCallExpression(p.parent) || p.parent.expression !== p)
          return name === 'length' ? { free: true } : { why: `.${name}` }
        if (ORDERLESS.has(name)) return { free: true }
        if (KEEPS.has(name)) {
          n = p.parent
          continue
        }
        if (name === 'at') {
          const index = literalIndex(p.parent.arguments[0])
          if (index === 0) return { free: true }
          return { why: `.at(…)`, stated: index !== undefined }
        }
        return { why: `.${name}()` }
      }
      if (ts.isElementAccessExpression(p) && p.expression === n) {
        const index = literalIndex(p.argumentExpression)
        return index === 0 ? { free: true } : { why: '[…]', stated: index !== undefined }
      }
      if (ts.isVariableDeclaration(p) && p.initializer === n) {
        if (ts.isIdentifier(p.name)) return { name: p.name }
        const [only, ...rest] = ts.isArrayBindingPattern(p.name) ? p.name.elements : []
        const first = only && ts.isBindingElement(only) && !only.dotDotDotToken
        return first && rest.length === 0
          ? { free: true }
          : { why: 'taken apart', stated: ts.isArrayBindingPattern(p.name) }
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
        const callee = p.expression.getText(sf)
        if (/^expect(\.soft)?$/.test(callee)) return matched(p)
        if (callee === 'JSON.stringify') {
          n = p
          continue
        }
        return ORDERLESS_CALLS.has(callee) ? { free: true } : { why: `handed to ${callee}` }
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
      if (ts.isArrayLiteralExpression(expected))
        return expected.elements.length <= 1
          ? { free: true }
          : { why: `${name}([${String(expected.elements.length)}])`, stated: true }
      if (ts.isCallExpression(expected) && /arrayContaining$/.test(expected.expression.getText(sf)))
        return { free: true }
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
  // a helper may return a call of another helper: found until nothing new is
  for (let known = -1; known !== helpers.size;) {
    known = helpers.size
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
        } else if (end.why && (order === 'none' || end.stated)) {
          const at = node === read ? '' : ` at ${String(line(node))}`
          const chance = order === 'chance' ? ' (ordered by chance)' : ''
          found.push(
            `${String(line(read))}: ${(lines[line(read) - 1] ?? '').trim()} — ${end.why}${at}${chance}`,
          )
        } else if (end.name) {
          const symbol = symbolOf(end.name)
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
  const uuids = uuidColumns(readFileSync(SCHEMA, 'utf8'))
  const files = execFileSync('git', ['ls-files', ...FILES], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter(Boolean)
  const problems = files.flatMap((file) => {
    const source = readFileSync(file, 'utf8')
    if (!MAY_READ.test(source)) return []
    return unorderedReads(file, source, uuids).map((found) => `  ${file}:${found}`)
  })
  if (problems.length > 0) {
    console.error(
      `ordered reads: ${String(problems.length)} rows with no ORDER BY used in an order — order by an identity id or a position, never a uuid or createdAt alone (.claude/rules/testing.md, MOL-323)`,
    )
    for (const problem of problems) console.error(problem)
    process.exitCode = 1
  }
}
