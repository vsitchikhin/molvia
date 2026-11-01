import postgres from 'postgres'

/**
 * Rows read with no order come back in an order Postgres never promised (MOL-323): every `SELECT` of the
 * integration tests whose statement has no `order by` of its own — not in parentheses, a comment or a string — has
 * its rows turned by one, the first last. A test that leans on the order of such rows fails on its first run
 * however it reads them; rows alike, where the order tells nothing, come back the same. Every client of the
 * process goes through it — the test's, the app's, a transaction's — since it hooks the query of postgres.js,
 * never a client. `bin/check-ordered-reads.mjs` says the same before the run, by parsing; this is what holds.
 */

const TURNED = Symbol.for('molvia.unorderedRowsTurned')

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

/** The rows turned by one, in place: a result keeps its fields (`count`, `command`, `columns`). */
export function turned<T>(rows: T[]): T[] {
  if (rows.length > 1) rows.push(rows.shift() as T)
  return rows
}

interface Pending {
  strings: string | readonly string[]
  resolve: (result: unknown) => void
}

// The class of a query of postgres.js, taken from one never run: queries are run when awaited.
const probe = postgres('postgres://localhost/unused', { max: 1 })
const query = probe.unsafe('select 1') as unknown as Pending
const prototype = Object.getPrototypeOf(query) as Record<symbol, unknown>
await probe.end()

if (!prototype[TURNED]) {
  prototype[TURNED] = true
  // A query sets its own `resolve` as it is made; the setter puts the turn in front of it.
  Object.defineProperty(prototype, 'resolve', {
    configurable: true,
    set(this: Pending, resolve: (result: unknown) => void) {
      const text = typeof this.strings === 'string' ? this.strings : this.strings.join(' ? ')
      Object.defineProperty(this, 'resolve', {
        configurable: true,
        writable: true,
        value: (result: unknown) => {
          const read =
            Array.isArray(result) && (result as { command?: string }).command === 'SELECT'
          resolve(read && unordered(text) ? turned(result) : result)
        },
      })
    },
  })
}
