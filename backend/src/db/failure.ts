import { DomainError, ERROR } from '@molvia/model'

/** A row pointed at something that is not there. */
const FOREIGN_KEY_VIOLATION = '23503'

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
 * Translates exactly one Postgres failure, and deliberately no others.
 *
 * `23503` is an ordinary answer rather than a defect: starting a trip in a place that has
 * been removed, or writing an expense against a trip that no longer exists, is a screen that
 * went stale — the client deserves `NOT_FOUND`, not a 500.
 *
 * Everything else — `23505`, `23514`, `22003`, `54000` — is left to fall through. Each one
 * means the domain let past what it is supposed to catch: amounts and quantities are checked
 * by their schemas, a duplicate verdict is absorbed by `ON CONFLICT`, a duplicate place by
 * `ensure`. Translating them would turn a defect in this server into a tidy 4xx and hide it,
 * so they stay 500s with a log line.
 */
export async function translateFailures<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    if (codeOf(error) === FOREIGN_KEY_VIOLATION) {
      throw new DomainError(ERROR.NOT_FOUND)
    }
    throw error
  }
}
