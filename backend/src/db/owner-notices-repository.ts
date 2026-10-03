import { and, inArray, isNull, lt, or, sql } from 'drizzle-orm'
import { FAILURE_KEEP_DAYS, FEEDBACK_NOTICE_KINDS } from '@molvia/model'
import type { OwnerNotice, OwnerNoticeKind } from '@molvia/model'
import type { Conn } from './index'
import { rowLimit } from './rows'
import { feedbackPictures, ownerNotices } from './schema'

/** A notice about a failure not handed within a day goes: `make failures` still has its count (Р-7). */
const FAILURE_NOTICE_KINDS = [
  'failure',
  'failure_count',
  'failure_muted',
] as const satisfies readonly OwnerNoticeKind[]
const UNHANDED_FAILURE_NOTICE_MS = 24 * 60 * 60 * 1000

/**
 * How long a notice about a message waits for the bot's word that it went before it is handed the
 * second time (MOL-148, adversarial В1): a minute's run sends twenty at Telegram's pace in under half
 * a minute, and a rollout's stop gives up the rest — the next bot takes them ten minutes on. **Each
 * time after waits twice as long** (round 2, Г2): a hand counts whether the bot tried the notice or
 * not — a 429 or a stop gives up the rest of a run — so the tries are spread over a day rather than
 * spent in an hour.
 */
export const OWNER_NOTICE_RESEND_MS = 10 * 60 * 1000

/**
 * How many times a notice about a message is handed at most: with the pause doubling from ten
 * minutes, the last some 21 hours after the first — a day of Telegram away. Past it, what is left is
 * a notice Telegram refuses for good, and the bot has reported each refusal as a failure of its own
 * (`owner:send`), so the owner hears that something did not go. **The named price:** Telegram away for
 * longer than that, and the message is the table's alone again.
 */
export const OWNER_NOTICE_TRIES = 8

export interface OwnerNoticeRepository {
  /**
   * Hands out the oldest waiting notices and marks them handed in the same statement: a second claim
   * at the same moment skips the rows the first one holds rather than waiting to hand them out again.
   * A notice about a failure is handed at most once, as the rating reminders are (MOL-101) — the
   * table keeps its count. **A notice about a message is handed again** until the bot says it went
   * (`markSent`), `OWNER_NOTICE_RESEND_MS` after the first time and twice the pause each time after,
   * at most `OWNER_NOTICE_TRIES` times
   * (MOL-148, adversarial В1): the table holds nothing else of it. Their payloads, the API's and the
   * bot's before the phone's (MOL-144) and oldest first within each, as stored: the caller reads them
   * through `ownerNoticeSchema`.
   */
  claim(limit: number, at: Date): Promise<readonly unknown[]>

  /**
   * The bot sent the notices about these messages: they are not handed again, and their pictures'
   * bytes and Telegram ids go in the same transaction — the owner's Telegram has them now (MOL-167,
   * В-1). What is left of each picture is its line.
   */
  markSent(messages: readonly number[], at: Date): Promise<void>

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
        .set({ handedAt: at, tries: sql`${ownerNotices.tries} + 1` })
        .where(
          sql`${ownerNotices.id} in (
            select ${ownerNotices.id} from ${ownerNotices}
            where ${ownerNotices.handedAt} is null
               or (${inArray(ownerNotices.kind, [...FEEDBACK_NOTICE_KINDS])}
                   and ${ownerNotices.sentAt} is null
                   and ${ownerNotices.tries} < ${OWNER_NOTICE_TRIES}
                   and ${ownerNotices.handedAt} < ${at.toISOString()}::timestamptz
                     - make_interval(secs => ${OWNER_NOTICE_RESEND_MS / 1000}
                         * power(2, greatest(${ownerNotices.tries}, 1) - 1)))
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

    async markSent(messages, at) {
      if (messages.length === 0) return
      await db.transaction(async (tx) => {
        await tx
          .update(ownerNotices)
          .set({ sentAt: at })
          .where(and(inArray(ownerNotices.feedbackId, [...messages]), isNull(ownerNotices.sentAt)))
        await tx
          .update(feedbackPictures)
          .set({ image: null, telegramFileId: null, sentAt: at })
          .where(
            and(
              inArray(feedbackPictures.feedbackId, [...messages]),
              isNull(feedbackPictures.sentAt),
            ),
          )
      })
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
