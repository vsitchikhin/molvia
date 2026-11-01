/**
 * Rows read with no order taken in the two ways no order can change (MOL-323, review round 14, О1). The net reverses
 * such rows, but values that read the same reversed — kinds `failure, silence, failure` — give the same first row
 * either way, so `bin/check-ordered-reads.mjs` refuses the first row, `find` and `sort` of them; these say at run
 * time what makes them free.
 */

/** The one row, or none: two or more is an error, since which of them comes first is no row's to say. */
export function onlyRow<T>(rows: Iterable<T>): T | undefined {
  const all = [...rows]
  if (all.length > 1)
    throw new Error(`onlyRow: ${String(all.length)} rows, and no order to pick one by`)
  return all[0]
}

type Plain = string | number | bigint | boolean | null | undefined
type Value = Plain | readonly Plain[]

const KINDS = ['undefined', 'object', 'boolean', 'number', 'bigint', 'string']

function compare(a: Plain, b: Plain): number {
  const kinds = KINDS.indexOf(typeof a) - KINDS.indexOf(typeof b)
  if (kinds !== 0 || Object.is(a, b)) return kinds
  if (typeof a === 'number' && typeof b === 'number') {
    // NaN first and -0 before 0: a comparison of `<` ties them with another number, and a tie keeps the order
    if (Number.isNaN(a) || Number.isNaN(b)) return Number.isNaN(a) ? -1 : 1
    if (a === b) return Object.is(a, -0) ? -1 : 1
  }
  // null and undefined are one value each; bigints by value, strings by their code units, false before true
  return (a as string) < (b as string) ? -1 : 1
}

function compareValues(a: Value, b: Value): number {
  if (Array.isArray(a) !== Array.isArray(b)) return Array.isArray(a) ? 1 : -1
  if (!Array.isArray(a) || !Array.isArray(b)) return compare(a as Plain, b as Plain)
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const by = compare(a[i] as Plain, b[i] as Plain)
    if (by !== 0) return by
  }
  return a.length - b.length
}

/** A value no `toEqual` tells from another that sorts alike: not an object, a function or a symbol. */
const plain = (value: unknown): boolean =>
  value === null || (typeof value !== 'object' && KINDS.includes(typeof value))
/** An array of values that are not objects, with no hole: `toEqual` takes a hole for `undefined`. */
const tuple = (value: readonly unknown[]): boolean =>
  Object.keys(value).length === value.length && value.every(plain)

/**
 * Values sorted, where two that sort alike are the same value, so the answer is the same whatever order they came
 * in: only values that are not objects, or arrays of such, are taken — an object or a row ties with its like and
 * would keep the order it came in. Numbers by value, strings by their code units.
 */
export function sorted<T extends Value>(values: Iterable<T>): T[] {
  const all = [...values]
  for (const value of all)
    if (!(Array.isArray(value) ? tuple(value) : plain(value)))
      throw new Error('sorted: only values that are not objects sort the same in any order')
  return all.sort(compareValues)
}

/** A sum of whole numbers, the same in any order: of fractions it is not — the last digit is the order's — so they throw. */
export function sum(values: Iterable<number>): number {
  let total = 0
  for (const value of values) {
    if (!Number.isSafeInteger(value)) throw new Error(`sum: ${String(value)} is not a whole number`)
    total += value
    if (!Number.isSafeInteger(total)) throw new Error('sum: past the whole numbers a double holds')
  }
  return total
}
