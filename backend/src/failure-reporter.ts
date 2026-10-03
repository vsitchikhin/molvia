import { describeFailure } from '@molvia/model'
import type { FailureSummary, TelegramUserId } from '@molvia/model'
import type { FastifyBaseLogger } from 'fastify'
import { createFailureRepository } from '@/db/failures-repository'
import type { FailureOccurrence } from '@/db/failures-repository'
import type { Conn } from '@/db'
import { VERSION } from '@/env'
import { occurrenceOf, recordFailure } from '@/usecases/record-failure'
import type { FailurePlace } from '@/usecases/record-failure'

export interface FailureReporter {
  /**
   * A failure logged by its kind, as every failure of the API was before (MOL-58), and recorded
   * beside it into the table of failures (MOL-143) — one path for both, so nothing the log hears
   * of is missing from the table.
   */
  report(error: unknown, place: FailurePlace, message: string): void
  /** A failure somebody else has logged — the bot's report of its own — into the table alone. */
  take(summary: FailureSummary, place: FailurePlace): void
}

/** How many fingerprints may be written at once; one write a fingerprint at a time. */
export const RECORDINGS_AT_ONCE = 4

/**
 * How many fingerprints may wait for their turn. Past it a failure is the log's alone: so many
 * different failures at once is the process itself breaking, and the memory has to stop somewhere.
 */
export const FINGERPRINTS_WAITING = 200

interface Waiting {
  occurrence: FailureOccurrence
  times: number
  readonly settled: (() => void)[]
}

/**
 * The recording is not waited for (Р-4): a request that failed answers at once, and a table that
 * cannot be written — the database down, the very failure being reported — costs one more line in
 * the log, never a second failure or a retry.
 *
 * **A burst is gathered, never dropped** (adversarial А1–А3). Occurrences of one fingerprint wait in
 * memory and go as one write of their count; a fingerprint has one write in flight at most, and all
 * of them together `RECORDINGS_AT_ONCE`. So a failure that is the database itself — slow, out of
 * connections — never queues a write a request on the pool the live requests need; three hundred of
 * one failure in a minute are counted three hundred, and the owner hears «уже 100»; and a new
 * failure in the middle of the burst takes the next free turn rather than being turned away. The
 * bot's reports go through the same gate — they reached the pool past it before (А3). What is lost
 * is what waits in memory when the process stops.
 *
 * `recorded` hands over, for every failure taken, the moment it is in the table — for the tests,
 * which would otherwise read the table before the row is in it.
 */
export function failureReporter(
  build: string,
  write: (occurrence: FailureOccurrence, times: number) => Promise<void>,
  log: FastifyBaseLogger,
  recorded?: (recording: Promise<void>) => void,
): FailureReporter {
  const waiting = new Map<string, Waiting>()
  const writing = new Set<string>()

  function pump(): void {
    for (const [fingerprint, entry] of waiting) {
      if (writing.size >= RECORDINGS_AT_ONCE) return
      if (writing.has(fingerprint)) continue
      waiting.delete(fingerprint)
      writing.add(fingerprint)
      void write(entry.occurrence, entry.times)
        .catch((failure: unknown) => {
          log.error(describeFailure(failure), 'failure not recorded')
        })
        .finally(() => {
          writing.delete(fingerprint)
          for (const settle of entry.settled) settle()
          pump()
        })
    }
  }

  function take(summary: FailureSummary, place: FailurePlace): void {
    const occurrence = occurrenceOf(summary, place, build)
    const known = waiting.get(occurrence.fingerprint)
    if (known === undefined && waiting.size >= FINGERPRINTS_WAITING) {
      log.error({ reason: 'busy' }, 'failure not recorded')
      return
    }
    const entry = known ?? { occurrence, times: 0, settled: [] }
    // The latest frames, as one write of one occurrence keeps them.
    entry.occurrence = occurrence
    entry.times += 1
    recorded?.(
      new Promise<void>((resolve) => {
        entry.settled.push(resolve)
      }),
    )
    waiting.set(occurrence.fingerprint, entry)
    pump()
  }

  return {
    report(error, place, message) {
      const summary = describeFailure(error)
      log.error(summary, message)
      take(summary, place)
    },
    take,
  }
}

/**
 * The API's reporter: into this build's table, queued for `owner`. The connection is asked for at
 * the moment of a write, so building a server opens nothing.
 */
export function apiFailureReporter(
  db: () => Conn,
  owner: TelegramUserId | null,
  log: FastifyBaseLogger,
  recorded?: (recording: Promise<void>) => void,
): FailureReporter {
  return failureReporter(
    VERSION,
    (occurrence, times) =>
      recordFailure(
        { failures: createFailureRepository(db()), owner },
        occurrence,
        times,
        new Date(),
      ),
    log,
    recorded,
  )
}
