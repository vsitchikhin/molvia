import { and, eq, sql } from 'drizzle-orm'
import { DomainError, ERROR, FEEDBACK_KEPT_YEARS } from '@molvia/model'
import type { FeedbackBody, FeedbackNotice } from '@molvia/model'
import { translateFailures } from './failure'
import type { Conn } from './index'
import { theRow } from './rows'
import { feedback, ownerNotices } from './schema'

/** What a write came to: a message, the same message again, or the day's limit reached. */
export type FeedbackWrite =
  | { readonly kind: 'written'; readonly number: number }
  | { readonly kind: 'repeated'; readonly number: number }
  | { readonly kind: 'limited' }

export interface FeedbackRepository {
  /**
   * A message from the sheet (MOL-147), under a lock of its author: the same key with the same
   * content is the message written before, the same key with another content a conflict, and past
   * `limit` messages in a rolling day nothing is written. A repeat is not counted against the limit
   * — it writes nothing. `apiBuild` is this server's, never the phone's word. With `notify`, a new
   * message is queued for the owner in the same transaction (MOL-148, Р-6); a repeat queues nothing.
   */
  record(
    actorId: string,
    message: FeedbackBody,
    apiBuild: string,
    limit: number,
    notify: boolean,
  ): Promise<FeedbackWrite>

  /**
   * Threads whose last message — the person's or the owner's reply — is older than they are kept
   * (MOL-150, В-4): removed whole, the first message taking its continuations and replies along.
   */
  purgeStale(): Promise<void>
}

type Row = typeof feedback.$inferSelect

/** One person's messages are written one at a time: the count and the write are one step. */
function lockAuthor(actorId: string) {
  return sql`select pg_advisory_xact_lock(hashtext('feedback'), hashtext(${actorId}))`
}

function saysTheSame(row: Row, message: FeedbackBody): boolean {
  return (
    row.kind === message.kind &&
    row.text === message.text &&
    row.locale === message.locale &&
    row.pageBuild === message.pageBuild &&
    row.route === message.route &&
    row.platform === message.platform &&
    row.fromError === message.fromError &&
    row.errorCode === message.errorCode
  )
}

export function createFeedbackRepository(db: Conn): FeedbackRepository {
  return {
    record(actorId, message, apiBuild, limit, notify) {
      return translateFailures(() =>
        db.transaction(async (tx): Promise<FeedbackWrite> => {
          await tx.execute(lockAuthor(actorId))
          const [same] = await tx
            .select()
            .from(feedback)
            .where(and(eq(feedback.actorId, actorId), eq(feedback.clientKey, message.clientKey)))
          if (same !== undefined) {
            // The phone takes a new key when the content changes (Р-2): another content under the
            // same key is a defect of the caller, never a message to lose silently.
            if (!saysTheSame(same, message)) throw new DomainError(ERROR.CONFLICT)
            return { kind: 'repeated', number: same.id }
          }
          const [today] = await tx.execute<{ n: number }>(sql`
            select count(*)::int as n from feedback
            where actor_id = ${actorId} and created_at > clock_timestamp() - interval '24 hours'`)
          if ((today?.n ?? 0) >= limit) return { kind: 'limited' }
          const [written] = await tx
            .insert(feedback)
            .values({
              actorId,
              kind: message.kind,
              text: message.text,
              locale: message.locale,
              pageBuild: message.pageBuild,
              apiBuild,
              route: message.route,
              platform: message.platform,
              errorCode: message.errorCode,
              fromError: message.fromError,
              clientKey: message.clientKey,
            })
            .returning({ id: feedback.id, createdAt: feedback.createdAt })
          const row = theRow(written, 'feedback')
          if (notify) {
            const notice: FeedbackNotice = {
              kind: 'feedback',
              thread: row.id,
              feedbackKind: message.kind,
              text: message.text,
              locale: message.locale,
              pageBuild: message.pageBuild,
              apiBuild,
              route: message.route,
              platform: message.platform,
              fromError: message.fromError,
              errorCode: message.errorCode,
              at: row.createdAt.toISOString(),
            }
            await tx.insert(ownerNotices).values({
              kind: notice.kind,
              payload: notice,
              feedbackId: row.id,
              createdAt: row.createdAt,
            })
          }
          return { kind: 'written', number: row.id }
        }),
      )
    },

    async purgeStale() {
      await db.execute(sql`
        delete from feedback
        where thread_id is null
          and id in (
            select coalesce(f.thread_id, f.id)
            from feedback f
            left join feedback_replies r on r.feedback_id = f.id
            group by coalesce(f.thread_id, f.id)
            having greatest(max(f.created_at), max(r.created_at))
              < clock_timestamp() - make_interval(years => ${FEEDBACK_KEPT_YEARS})
          )`)
    },
  }
}
