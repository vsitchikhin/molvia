import { and, inArray, isNull, lt, or, sql } from 'drizzle-orm'
import { FAILURE_KEEP_DAYS } from '@molvia/model'
import type { OwnerNoticeKind } from '@molvia/model'
import type { Conn } from './index'
import { rowLimit } from './rows'
import { ownerNotices } from './schema'

/** A notice about a failure not handed within a day goes: `make failures` still has its count (Р-7). */
const FAILURE_NOTICE_KINDS = [
  'failure',
  'failure_count',
] as const satisfies readonly OwnerNoticeKind[]
const UNHANDED_FAILURE_NOTICE_MS = 24 * 60 * 60 * 1000

export interface OwnerNoticeRepository {
  /**
   * Hands out the oldest waiting notices and marks them handed in the same statement — at most
   * once, as the rating reminders are (MOL-101): a second claim at the same moment skips the rows
   * the first one holds rather than waiting to hand them out again. Their payloads, oldest first,
   * as stored: the caller reads them through `ownerNoticeSchema`.
   */
  claim(limit: number, at: Date): Promise<readonly unknown[]>

  /**
   * Notices handed more than `FAILURE_KEEP_DAYS` ago go, and so do notices about a failure the bot
   * did not take within a day: after a day without the bot the owner would get them in a heap.
   */
  purgeStale(now: Date): Promise<void>
}

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
            order by ${ownerNotices.id}
            limit ${rowLimit(limit)}
            for update skip locked)`,
        )
        .returning({ id: ownerNotices.id, payload: ownerNotices.payload })
      return rows.sort((a, b) => a.id - b.id).map((row) => row.payload)
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
