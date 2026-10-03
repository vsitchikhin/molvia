import { desc, lt, sql } from 'drizzle-orm'
import { FAILURE_KEEP_DAYS } from '@molvia/model'
import type { FailureSource, OwnerNotice } from '@molvia/model'
import type { Conn } from './index'
import { rowLimit, theRow } from './rows'
import { failures, ownerNotices } from './schema'

/** One failure as it happened, fingerprinted by the caller (MOL-143). */
export interface FailureOccurrence {
  readonly fingerprint: string
  readonly source: FailureSource
  readonly errorName: string
  readonly code?: string
  readonly route?: string
  readonly frames: readonly string[]
  readonly build: string
}

/** Where a fingerprint stands after one more occurrence. */
export interface FailureCount {
  readonly count: number
  /** How many times in `build` — 1 means it is the first time there. */
  readonly buildCount: number
}

/** A fingerprint as `make failures` prints it. */
export interface FailureRow extends FailureCount {
  readonly fingerprint: string
  readonly source: string
  readonly errorName: string
  readonly code: string | null
  readonly route: string | null
  readonly frames: readonly string[]
  readonly build: string
  readonly firstSeenAt: Date
  readonly lastSeenAt: Date
}

/** The largest count a column keeps: past it a failure is simply «very many». */
const COUNT_CEILING = 2 ** 31 - 1

export interface FailureRepository {
  /**
   * Adds one occurrence to its fingerprint and queues what the owner should hear of it, in one
   * transaction. The row is written by one `insert … on conflict do update`, which takes the row's
   * lock: two occurrences at once are counted one after the other, so the 1st, 10th, 100th and
   * 1000th in a build are each seen by exactly one of them and none twice (Р-8).
   */
  record(
    occurrence: FailureOccurrence,
    at: Date,
    notices: (count: FailureCount) => readonly OwnerNotice[],
  ): Promise<FailureCount>

  /** Fingerprints not seen for `FAILURE_KEEP_DAYS` go. */
  purgeStale(now: Date): Promise<void>

  /** The latest fingerprints, by the last time they happened. */
  latest(limit: number): Promise<readonly FailureRow[]>
}

export function createFailureRepository(db: Conn): FailureRepository {
  return {
    async record(occurrence, at, notices) {
      return db.transaction(async (tx) => {
        const [row] = await tx
          .insert(failures)
          .values({
            fingerprint: occurrence.fingerprint,
            source: occurrence.source,
            errorName: occurrence.errorName,
            code: occurrence.code ?? null,
            route: occurrence.route ?? null,
            frames: [...occurrence.frames],
            build: occurrence.build,
            firstSeenAt: at,
            lastSeenAt: at,
            count: 1,
            buildCount: 1,
          })
          .onConflictDoUpdate({
            target: failures.fingerprint,
            set: {
              // The latest frames and build: the line numbers are the ones of the build it is in now.
              frames: sql`excluded.frames`,
              lastSeenAt: sql`greatest(${failures.lastSeenAt}, excluded.last_seen_at)`,
              count: sql`least(${failures.count} + 1, ${COUNT_CEILING})`,
              buildCount: sql`case when ${failures.build} = excluded.build
                then least(${failures.buildCount} + 1, ${COUNT_CEILING}) else 1 end`,
              build: sql`excluded.build`,
            },
          })
          .returning({ count: failures.count, buildCount: failures.buildCount })
        const count = theRow(row, 'failures')
        const queued = notices(count)
        if (queued.length > 0) {
          await tx
            .insert(ownerNotices)
            .values(queued.map((notice) => ({ kind: notice.kind, payload: notice, createdAt: at })))
        }
        return count
      })
    },

    async purgeStale(now) {
      const before = new Date(now.getTime() - FAILURE_KEEP_DAYS * 24 * 60 * 60 * 1000)
      await db.delete(failures).where(lt(failures.lastSeenAt, before))
    },

    async latest(limit) {
      return db.select().from(failures).orderBy(desc(failures.lastSeenAt)).limit(rowLimit(limit))
    },
  }
}
