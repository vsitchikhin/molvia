import { and, inArray, isNull, lt, or, sql } from 'drizzle-orm'
import { FAILURE_KEEP_DAYS } from '@molvia/model'
import type { OwnerNotice, OwnerNoticeKind } from '@molvia/model'
import type { Conn } from './index'
import { rowLimit } from './rows'
import { ownerNotices } from './schema'

/** A notice about a failure not handed within a day goes: `make failures` still has its count (Р-7). */
const FAILURE_NOTICE_KINDS = [
  'failure',
  'failure_count',
  'failure_muted',
] as const satisfies readonly OwnerNoticeKind[]
const UNHANDED_FAILURE_NOTICE_MS = 24 * 60 * 60 * 1000

export interface OwnerNoticeRepository {
  /**
   * Hands out the oldest waiting notices and marks them handed in the same statement — at most
   * once, as the rating reminders are (MOL-101): a second claim at the same moment skips the rows
   * the first one holds rather than waiting to hand them out again. Their payloads, the API's and the
   * bot's before the phone's and oldest first within each, as stored: the caller reads them through
   * `ownerNoticeSchema`.
   */
  claim(limit: number, at: Date): Promise<readonly unknown[]>

  /**
   * Notices handed more than `FAILURE_KEEP_DAYS` ago go, and so do notices about a failure the bot
   * did not take within a day: after a day without the bot the owner would get them in a heap.
   */
  purgeStale(now: Date): Promise<void>

  /** One notice queued by itself, not with a failure: the phone's held back, told (MOL-144). */
  queue(notice: OwnerNotice, at: Date): Promise<void>
}

/**
 * The phone's notices after the API's and the bot's (MOL-144, adversarial А5): its endpoint is open,
 * and a stream of invented failures queued ahead of the API's own put that one a day back in a queue
 * of twenty a minute — and the day's purge took it unheard.
 */
const phoneLast = sql`coalesce(${ownerNotices.payload} ->> 'source' = 'phone', false)`

export function createOwnerNoticeRepository(db: Conn): OwnerNoticeRepository {
  return {
    async claim(limit, at) {
      const rows = await db
        .update(ownerNotices)
        .set({ handedAt: at })
        .where(
          sql`${ownerNotices.id} in (
            select ${ownerNotices.id} from ${ownerNotices}
            where ${ownerNotices.handedAt} is null
            order by ${phoneLast}, ${ownerNotices.id}
            limit ${rowLimit(limit)}
            for update skip locked)`,
        )
        .returning({
          id: ownerNotices.id,
          payload: ownerNotices.payload,
          phone: sql<boolean>`${phoneLast}`,
        })
      return rows
        .sort((a, b) => Number(a.phone) - Number(b.phone) || a.id - b.id)
        .map((row) => row.payload)
    },

    async queue(notice, at) {
      await db.insert(ownerNotices).values({ kind: notice.kind, payload: notice, createdAt: at })
    },

    async purgeStale(now) {
      const handedBefore = new Date(now.getTime() - FAILURE_KEEP_DAYS * 24 * 60 * 60 * 1000)
      const waitingBefore = new Date(now.getTime() - UNHANDED_FAILURE_NOTICE_MS)
      await db
        .delete(ownerNotices)
        .where(
          or(
            lt(ownerNotices.handedAt, handedBefore),
            and(
              isNull(ownerNotices.handedAt),
              inArray(ownerNotices.kind, [...FAILURE_NOTICE_KINDS]),
              lt(ownerNotices.createdAt, waitingBefore),
            ),
          ),
        )
    },
  }
}
