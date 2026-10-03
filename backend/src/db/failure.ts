import { DrizzleQueryError } from 'drizzle-orm/errors'
import { DomainError, ERROR, describeFailure, failureCodeOf } from '@molvia/model'
import type { FailureSummary } from '@molvia/model'

/** A row pointed at something that is not there. */
const FOREIGN_KEY_VIOLATION = '23503'

/** A row claims what another row already holds. */
const UNIQUE_VIOLATION = '23505'

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
    const code = failureCodeOf(error)
    if (code === FOREIGN_KEY_VIOLATION) throw new DomainError(ERROR.NOT_FOUND)
    if (code === UNIQUE_VIOLATION) throw new DomainError(ERROR.CONFLICT)
    throw error
  }
}

/** What a failed migration may say about itself: its kind, and the statement or file that failed. */
export interface MigrationFailure extends FailureSummary {
  readonly statement?: string
  readonly reason?: string
}

/**
 * A failed migration described for the log of a deploy (MOL-153, adversarial А). Its message is no
 * safer than a request's: Postgres writes the value a cast refused into it — a person's note, under
 * `SET DATA TYPE numeric USING "note"::numeric` — and pino appends the cause's message to the
 * wrapper's. So it goes by its kind too, and beside the kind the statement that failed: drizzle's
 * migrator wraps each in a `DrizzleQueryError` with no parameters, and the statement is DDL from our
 * own files — what a broken deploy is fixed by. A query that carries parameters is not one of those,
 * and is left out.
 *
 * A failure with neither a query nor a code is the migrator itself, reading our folder — a file the
 * journal names and the folder lacks, a journal left with merge markers — and its words name only
 * our files: they are kept, or the log says «Error» where it could say which file (round 2, Е).
 * Everything the database answers carries a code, and stays without words.
 */
export function describeMigrationFailure(error: unknown): MigrationFailure {
  const summary = describeFailure(error)
  if (error instanceof DrizzleQueryError) {
    return error.params.length === 0 ? { ...summary, statement: error.query } : summary
  }
  if (summary.code === undefined && error instanceof Error && error.message) {
    return { ...summary, reason: error.message }
  }
  return summary
}
