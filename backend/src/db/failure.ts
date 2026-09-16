import { DomainError, ERROR } from '@molvia/model'

/** A row pointed at something that is not there. */
const FOREIGN_KEY_VIOLATION = '23503'

/** `postgres` throws its own error class; only the code is ever looked at here. */
function codeOf(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined
  return typeof error.code === 'string' ? error.code : undefined
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
