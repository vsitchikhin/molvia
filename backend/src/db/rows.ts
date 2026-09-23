import { resourceIdOf } from '@molvia/model'

/**
 * `RETURNING` on a write that succeeded always yields its row, so an empty result is not an
 * ordinary outcome here — it means the statement did something other than what this code
 * believes. A plain `Error`, deliberately, and not a `DomainError`: there is no answer to
 * give a client, only a 500 with a log line.
 *
 * Reaching for a row this way is not the same as a read finding nothing. A `byId` that
 * matches no row returns `null` and says so in its type; this guard exists only on the
 * write paths, where the row was just created or just updated.
 */
export function theRow<T>(row: T | undefined, table: string): T {
  if (row === undefined) throw new Error(`a write to ${table} returned no row`)
  return row
}

/**
 * An identifier that reached a query, or `null` when it could never match a row.
 *
 * `byId(id: string)` takes any string, and Postgres answers `22P02` to one that is not a
 * uuid — a 500 for what is plainly «no such row». Worse, it is a *third* answer: the rule
 * that someone else's row and a missing row look identical exists so that identifiers cannot
 * be guessed by the difference in the reply, and a malformed one broke that by replying
 * differently again. Read paths take the `null` and return nothing found.
 */
export function idOrNull(id: string): string | null {
  return resourceIdOf(id)
}

/**
 * How many rows a listing may return.
 *
 * Neither end of this was checked before, and the two nearby wrong numbers behaved in
 * opposite ways: drizzle prints no `LIMIT` clause at all for a negative one — so `-1` handed
 * back *everything*, the exact failure the limit exists to prevent — while `2.5` reached
 * Postgres and met a `bigint`, giving `22P02` and a 500. Both are now the same nothing-
 * special: floor it, and never below zero.
 */
export function rowLimit(limit: number): number {
  if (!Number.isFinite(limit)) return 0
  return Math.max(0, Math.floor(limit))
}
