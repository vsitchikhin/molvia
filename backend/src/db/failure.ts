import { DomainError, ERROR } from '@molvia/model'

/** A row pointed at something that is not there. */
const FOREIGN_KEY_VIOLATION = '23503'

/** A row claims what another row already holds. */
const UNIQUE_VIOLATION = '23505'

/**
 * `postgres` throws its own error class and drizzle wraps it: `DrizzleQueryError` carries the
 * query and its parameters, with the driver error underneath in `cause`. So the chain is
 * walked rather than the top level read — measured, not assumed. Looking only at the wrapper
 * made every foreign-key violation a 500, which is precisely what this file exists to stop.
 */
function codeOf(error: unknown): string | undefined {
  let current: unknown = error
  for (let depth = 0; depth < 4; depth += 1) {
    if (typeof current !== 'object' || current === null) return undefined
    if ('code' in current && typeof current.code === 'string') return current.code
    if (!('cause' in current)) return undefined
    current = current.cause
  }
  return undefined
}

/**
 * Translates two Postgres failures, and deliberately no others.
 *
 * `23503` is an ordinary answer rather than a defect: starting a trip in a place that has
 * been removed, or writing an expense against a trip that no longer exists, is a screen that
 * went stale — the client deserves `NOT_FOUND`, not a 500.
 *
 * `23505` was left untranslated at first, on the argument that everything except a missing
 * reference «means the domain let past what it was supposed to catch». The argument holds
 * only while the domain has something to catch it *with*, and for a unique constraint it does
 * not: uniqueness is a statement about **other rows of the table**, and the domain sees one
 * input at a time. One path reaches it on an ordinary day — a scanned barcode that already
 * belongs to another item — and it is not a defect in this server. Hence `CONFLICT`.
 *
 * An actor identifier is no longer such a path: it is a fresh `randomUUID()` issued by the
 * use case (MOL-8, Р-1) rather than something a device brings back after a timeout.
 *
 * Everything else — `23514`, `22003`, `54000`, `22P02` — still falls through. Those the
 * domain genuinely can check on the input in front of it, so meeting one here means a caller
 * skipped it, and a 500 with a log line is the honest answer.
 */
export async function translateFailures<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    const code = codeOf(error)
    if (code === FOREIGN_KEY_VIOLATION) throw new DomainError(ERROR.NOT_FOUND)
    if (code === UNIQUE_VIOLATION) throw new DomainError(ERROR.CONFLICT)
    throw error
  }
}
