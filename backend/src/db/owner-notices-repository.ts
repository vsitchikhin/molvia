import { and, inArray, isNull, lt, or, sql } from 'drizzle-orm'
import { FAILURE_KEEP_DAYS, FEEDBACK_NOTICE_KINDS } from '@molvia/model'
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

/**
 * How long a notice about a message waits for the bot's word that it went before it is handed again
 * (MOL-148, adversarial В1): a minute's run sends twenty at Telegram's pace in under half a minute,
 * and a rollout's stop gives up the rest — the next bot takes them ten minutes on.
 */
export const OWNER_NOTICE_RESEND_MS = 10 * 60 * 1000

/**
 * How many times a notice about a message is handed at most: an hour of Telegram away or of failed
 * rollouts. Past it, something refuses that very notice for good, and the bot's report of the
 * refusal is what says so.
 */
export const OWNER_NOTICE_TRIES = 6

export interface OwnerNoticeRepository {
  /**
   * Hands out the oldest waiting notices and marks them handed in the same statement: a second claim
   * at the same moment skips the rows the first one holds rather than waiting to hand them out again.
   * A notice about a failure is handed at most once, as the rating reminders are (MOL-101) — the
   * table keeps its count. **A notice about a message is handed again** until the bot says it went
   * (`markSent`), `OWNER_NOTICE_RESEND_MS` after the last time, at most `OWNER_NOTICE_TRIES` times
   * (MOL-148, adversarial В1): the table holds nothing else of it. Their payloads, oldest first, as
   * stored: the caller reads them through `ownerNoticeSchema`.
   */
  claim(limit: number, at: Date): Promise<readonly unknown[]>

  /** The bot sent the notices about these messages: they are not handed again. */
  markSent(messages: readonly number[], at: Date): Promise<void>

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
        .set({ handedAt: at, tries: sql`${ownerNotices.tries} + 1` })
        .where(
          sql`${ownerNotices.id} in (
            select ${ownerNotices.id} from ${ownerNotices}
            where ${ownerNotices.handedAt} is null
               or (${inArray(ownerNotices.kind, [...FEEDBACK_NOTICE_KINDS])}
                   and ${ownerNotices.sentAt} is null
                   and ${ownerNotices.tries} < ${OWNER_NOTICE_TRIES}
                   and ${lt(ownerNotices.handedAt, new Date(at.getTime() - OWNER_NOTICE_RESEND_MS))})
            order by ${ownerNotices.id}
            limit ${rowLimit(limit)}
            for update skip locked)`,
        )
        .returning({ id: ownerNotices.id, payload: ownerNotices.payload })
      return rows.sort((a, b) => a.id - b.id).map((row) => row.payload)
    },

    async markSent(messages, at) {
      if (messages.length === 0) return
      await db
        .update(ownerNotices)
        .set({ sentAt: at })
        .where(and(inArray(ownerNotices.feedbackId, [...messages]), isNull(ownerNotices.sentAt)))
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
