import postgres from 'postgres'

/**
 * Rows read with no order come back in an order Postgres never promised (MOL-323): the rows of every `SELECT` of the
 * integration tests whose statement has no `order by` of its own — not in parentheses, a comment or a string — and of
 * every `UPDATE`, `DELETE` and `MERGE` that returns them, which never have one, come back reversed. Reversed, not
 * turned by one (review round 13, Н1): it is the one order that puts each two rows the other way round, so a test
 * that leans on which of two comes first fails on its first run where the values it reads differ reversed; rows
 * alike, where the order tells nothing, come back the same. `INSERT`'s rows keep the order of its `VALUES`, as a
 * test may lean on. Every client of the process goes through it — the test's, the app's, a transaction's — since
 * it hooks the query of postgres.js, never a client.
 *
 * What it cannot hold, and `bin/check-ordered-reads.mjs` does, by parsing: values the same reversed — kinds
 * `failure, silence, failure` give the same first row, `find` and `[...new Set()]` either way (review round 14,
 * О1), and no fixed order tells every use, two columns asking for two orders at once; two reads reversed alike,
 * a snapshot met by a snapshot; an order the statement has (chance, ties), which this never touches.
 */

const REVERSED = Symbol.for('molvia.unorderedRowsReversed')

/** The commands whose rows Postgres gives in no order but the statement's own `order by`. */
const UNORDERED_COMMANDS = new Set(['SELECT', 'UPDATE', 'DELETE', 'MERGE'])

/** A statement's SQL outside parentheses, strings and comments: where an `order by` of its own stands. */
function outside(text: string): string {
  let out = ''
  let depth = 0
  for (let i = 0; i < text.length; i++) {
    const rest = text.slice(i)
    const char = text.charAt(i)
    let skip = 0
    if (char === "'") skip = /^'(?:[^']|'')*'?/.exec(rest)?.[0].length ?? 1
    else if (char === '"') skip = /^"(?:[^"]|"")*"?/.exec(rest)?.[0].length ?? 1
    else if (rest.startsWith('--')) skip = /^--[^\n]*/.exec(rest)?.[0].length ?? 2
    else if (rest.startsWith('/*'))
      skip = rest.includes('*/') ? rest.indexOf('*/') + 2 : rest.length
    if (skip > 0) {
      if (depth === 0) out += ' '
      i += skip - 1
      continue
    }
    if (char === '(') depth++
    if (depth === 0) out += char
    if (char === ')') depth--
  }
  return out
}

export function unordered(text: string): boolean {
  return !/\border\s+by\b/i.test(outside(text))
}

/** The rows reversed, in place: a result keeps its fields (`count`, `command`, `columns`). */
export function reversed<T>(rows: T[]): T[] {
  return rows.reverse()
}

/** Whether a result is rows in no promised order: of a command that gives them so, with no order of its own. */
export function inNoOrder(result: unknown, text: string): result is unknown[] {
  const command = Array.isArray(result) ? (result as { command?: string }).command : undefined
  return command !== undefined && UNORDERED_COMMANDS.has(command) && unordered(text)
}

interface Pending {
  strings: string | readonly string[]
  resolve: (result: unknown) => void
}

// The class of a query of postgres.js, taken from one never run — queries are run when awaited. Since 4.0 the
// package is an ES module alone, so one build serves every client of the process.
async function reverseIn(factory: typeof postgres): Promise<void> {
  const probe = factory('postgres://localhost/unused', { max: 1 })
  const prototype = Object.getPrototypeOf(probe.unsafe('select 1')) as Record<symbol, unknown>
  await probe.end()
  if (prototype[REVERSED]) return
  prototype[REVERSED] = true
  // A query sets its own `resolve` as it is made; the setter puts the reversal in front of it.
  Object.defineProperty(prototype, 'resolve', {
    configurable: true,
    set(this: Pending, resolve: (result: unknown) => void) {
      const text = typeof this.strings === 'string' ? this.strings : this.strings.join(' ? ')
      Object.defineProperty(this, 'resolve', {
        configurable: true,
        writable: true,
        value: (result: unknown) => {
          resolve(inNoOrder(result, text) ? reversed(result) : result)
        },
      })
    },
  })
}

await reverseIn(postgres)
