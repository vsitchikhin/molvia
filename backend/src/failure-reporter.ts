import { describeFailure } from '@molvia/model'
import type { FailureSummary, TelegramUserId } from '@molvia/model'
import type { FastifyBaseLogger } from 'fastify'
import { createFailureRepository } from '@/db/failures-repository'
import type { Conn } from '@/db'
import { VERSION } from '@/env'
import { recordFailure } from '@/usecases/record-failure'
import type { FailurePlace } from '@/usecases/record-failure'

export interface FailureReporter {
  /**
   * A failure logged by its kind, as every failure of the API was before (MOL-58), and recorded
   * beside it into the table of failures (MOL-143) — one path for both, so nothing the log hears
   * of is missing from the table.
   */
  report(error: unknown, place: FailurePlace, message: string): void
}

/**
 * The recording is not waited for (Р-4): a request that failed answers at once, and a table that
 * cannot be written — the database down, the very failure being reported — costs one more line in
 * the log, never a second failure or a retry. `recorded` hands every recording to whoever wants to
 * wait for it: the tests, which would otherwise read the table before the row is in it.
 */
export function failureReporter(
  record: (summary: FailureSummary, place: FailurePlace) => Promise<void>,
  log: FastifyBaseLogger,
  recorded?: (recording: Promise<void>) => void,
): FailureReporter {
  return {
    report(error, place, message) {
      const summary = describeFailure(error)
      log.error(summary, message)
      const recording = record(summary, place).catch((failure: unknown) => {
        log.error(describeFailure(failure), 'failure not recorded')
      })
      recorded?.(recording)
    },
  }
}

/**
 * The API's reporter: into this build's table, queued for `owner`. The connection is asked for at
 * the moment of a failure, so building a server opens nothing.
 */
export function apiFailureReporter(
  db: () => Conn,
  owner: TelegramUserId | null,
  log: FastifyBaseLogger,
  recorded?: (recording: Promise<void>) => void,
): FailureReporter {
  return failureReporter(
    (summary, place) =>
      recordFailure(
        { failures: createFailureRepository(db()), owner, build: VERSION },
        summary,
        place,
        new Date(),
      ),
    log,
    recorded,
  )
}
