import { desc, eq, lt, sql } from 'drizzle-orm'
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
  /** The phone's platform, `ios 18 app` (MOL-144, В-2); none for the API and the bot. */
  readonly platform?: string
}

/** Where a fingerprint stands after one more occurrence. */
export interface FailureCount {
  readonly count: number
  /** How many times in `build`: equal to the times just written means they are the first there. */
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
  readonly platform: string | null
  readonly firstSeenAt: Date
  readonly lastSeenAt: Date
}

/** The largest count a column keeps: past it a failure is simply «very many». */
const COUNT_CEILING = 2 ** 31 - 1

export interface FailureRepository {
  /**
   * Adds `times` occurrences to their fingerprint — a burst the reporter gathered is one write — and
   * queues what the owner should hear of them, in one transaction. The row is written by one
   * `insert … on conflict do update`, which takes the row's lock: two writes at once are counted one
   * after the other, so each threshold in a build is crossed by exactly one of them (Р-8).
   *
   * `fresh: false` writes to a fingerprint already there and adds none (MOL-144, review №6): `null`
   * when there was none, and nothing queued.
   */
  record(
    occurrence: FailureOccurrence,
    times: number,
    at: Date,
    notices: (count: FailureCount) => readonly OwnerNotice[],
    options?: { readonly fresh?: boolean },
  ): Promise<FailureCount | null>

  /** Fingerprints not seen for `FAILURE_KEEP_DAYS` go. */
  purgeStale(now: Date): Promise<void>

  /** The latest fingerprints, by the last time they happened. */
  latest(limit: number): Promise<readonly FailureRow[]>
}

export function createFailureRepository(db: Conn): FailureRepository {
  return {
    async record(occurrence, times, at, notices, options = {}) {
      return db.transaction(async (tx) => {
        // A phone's report past the hour's new rows: only a fingerprint already there is counted.
        const known = options.fresh === false
        const [row] = await (known
          ? tx
              .update(failures)
              .set({
                frames: [...occurrence.frames],
                lastSeenAt: sql`greatest(${failures.lastSeenAt}, ${at.toISOString()}::timestamptz)`,
                count: sql`least(${failures.count}::bigint + ${times}, ${COUNT_CEILING})::integer`,
                buildCount: sql`case when ${failures.build} = ${occurrence.build}
                  then least(${failures.buildCount}::bigint + ${times}, ${COUNT_CEILING})::integer
                  else ${times} end`,
                build: occurrence.build,
                platform: occurrence.platform ?? null,
              })
              .where(eq(failures.fingerprint, occurrence.fingerprint))
              .returning({ count: failures.count, buildCount: failures.buildCount })
          : tx
              .insert(failures)
              .values({
                fingerprint: occurrence.fingerprint,
                source: occurrence.source,
                errorName: occurrence.errorName,
                code: occurrence.code ?? null,
                route: occurrence.route ?? null,
                frames: [...occurrence.frames],
                build: occurrence.build,
                platform: occurrence.platform ?? null,
                firstSeenAt: at,
                lastSeenAt: at,
                count: times,
                buildCount: times,
              })
              .onConflictDoUpdate({
                target: failures.fingerprint,
                set: {
                  // The latest frames and build: the line numbers are the ones of the build it is in now.
                  frames: sql`excluded.frames`,
                  lastSeenAt: sql`greatest(${failures.lastSeenAt}, excluded.last_seen_at)`,
                  // Summed in bigint: in integer the sum overflows before `least` can cap it (adversarial Б1).
                  count: sql`least(${failures.count}::bigint + excluded.count, ${COUNT_CEILING})::integer`,
                  buildCount: sql`case when ${failures.build} = excluded.build
                then least(${failures.buildCount}::bigint + excluded.build_count, ${COUNT_CEILING})::integer
                else excluded.build_count end`,
                  build: sql`excluded.build`,
                  platform: sql`excluded.platform`,
                },
              })
              .returning({ count: failures.count, buildCount: failures.buildCount }))
        if (known && row === undefined) return null
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
