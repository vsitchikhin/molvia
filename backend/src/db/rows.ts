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
