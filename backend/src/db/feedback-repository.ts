import { and, eq, sql } from 'drizzle-orm'
import { DomainError, ERROR } from '@molvia/model'
import type { FeedbackBody } from '@molvia/model'
import { translateFailures } from './failure'
import type { Conn } from './index'
import { theRow } from './rows'
import { feedback } from './schema'

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
   * — it writes nothing. `apiBuild` is this server's, never the phone's word.
   */
  record(
    actorId: string,
    message: FeedbackBody,
    apiBuild: string,
    limit: number,
  ): Promise<FeedbackWrite>
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
    record(actorId, message, apiBuild, limit) {
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
            .returning({ id: feedback.id })
          return { kind: 'written', number: theRow(written, 'feedback').id }
        }),
      )
    },
  }
}
