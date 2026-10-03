import { and, desc, eq, isNull, or, sql } from 'drizzle-orm'
import { DomainError, ERROR, FEEDBACK_KEPT_YEARS, feedbackQuote } from '@molvia/model'
import type {
  AppLocale,
  FeedbackBody,
  FeedbackContinuedNotice,
  FeedbackNotice,
  ReplyDelivered,
  TelegramUserId,
} from '@molvia/model'
import { translateFailures } from './failure'
import type { Conn } from './index'
import { theRow } from './rows'
import { actors, feedback, feedbackReplies, ownerNotices } from './schema'

/** What a write came to: a message, the same message again, or the day's limit reached. */
export type FeedbackWrite =
  | { readonly kind: 'written'; readonly number: number }
  | { readonly kind: 'repeated'; readonly number: number }
  | { readonly kind: 'limited' }

/** The owner's reply written (MOL-148): to whom it goes, in which language, and what it answers. */
export interface ReplyWritten {
  readonly reply: number
  readonly to: TelegramUserId
  readonly locale: AppLocale
  /** When the message it answers was written — «Ответ на ваше сообщение от …». */
  readonly answeredAt: Date
  /** The person's country, whose zone that day is in. */
  readonly country: string
}

/** The owner's reply a person answered in Telegram, found by the message it went out as. */
export interface AnsweredReply {
  readonly reply: number
  readonly actorId: string
}

/** What a person's word in a thread came to: written, the same again, the day spent, or gone. */
export type ContinueWrite = 'written' | 'repeated' | 'limited' | 'gone'

export interface ContinueThread {
  readonly reply: AnsweredReply
  readonly text: string
  /** The key a repeat of the same Telegram message is found by. */
  readonly key: string
  readonly apiBuild: string
  readonly limit: number
  readonly notify: boolean
}

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
   * (MOL-150, В-4): removed whole, the first message taking its continuations and replies along. A
   * reply Telegram refused never reached anyone and keeps no thread alive (adversarial В4).
   */
  purgeStale(): Promise<void>

  /**
   * The owner's reply to thread `thread` (MOL-148, Р-3), under the person's lock: written under
   * the person's latest message in the thread — that is what the owner answers. `null` where the
   * thread is gone: the person erased, or a year past.
   */
  reply(thread: number, text: string): Promise<ReplyWritten | null>

  /**
   * The reply the Telegram account answered by its message `messageId` (MOL-148, В-2): message ids
   * are per chat, so it is looked for only among this account's own replies. `null` otherwise.
   */
  answeredBy(telegramUserId: TelegramUserId, messageId: number): Promise<AnsweredReply | null>

  /**
   * A person's word in the thread of `reply` (В-1 of MOL-150), under their lock, as a message from
   * the sheet is: the same Telegram message again is written once, the day's limit is the form's,
   * and the owner's notice is queued in the same transaction. `gone` if the reply went meanwhile.
   */
  continueThread(continuation: ContinueThread): Promise<ContinueWrite>

  /** What became of a reply once the bot tried (Р-4); a reply already marked keeps its mark. */
  markDelivered(delivery: ReplyDelivered): Promise<void>
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
              number: row.id,
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

    async reply(thread, text) {
      const write = async () =>
        db.transaction(async (tx): Promise<ReplyWritten | null> => {
          const [head] = await tx
            .select({ actorId: feedback.actorId, locale: feedback.locale })
            .from(feedback)
            .where(and(eq(feedback.id, thread), isNull(feedback.threadId)))
          if (head === undefined) return null
          await tx.execute(lockAuthor(head.actorId))
          const [last] = await tx
            .select({ id: feedback.id, createdAt: feedback.createdAt })
            .from(feedback)
            .where(
              and(
                eq(feedback.actorId, head.actorId),
                or(eq(feedback.id, thread), eq(feedback.threadId, thread)),
              ),
            )
            .orderBy(desc(feedback.id))
            .limit(1)
          const [author] = await tx
            .select({ telegram: actors.telegramUserId, country: actors.country })
            .from(actors)
            .where(eq(actors.id, head.actorId))
          // Erased between the two reads: the cascade took the thread, and there is nobody to answer.
          if (last === undefined || author === undefined) return null
          const [written] = await tx
            .insert(feedbackReplies)
            .values({ feedbackId: last.id, actorId: head.actorId, threadId: thread, text })
            .returning({ id: feedbackReplies.id })
          return {
            reply: theRow(written, 'feedback_replies').id,
            to: author.telegram,
            locale: head.locale as AppLocale,
            answeredAt: last.createdAt,
            country: author.country,
          }
        })
      // Erased between the reads and the write: the key finds no message, and the thread is gone.
      return translateFailures(write).catch((error: unknown) => {
        if (error instanceof DomainError && error.code === ERROR.NOT_FOUND) return null
        throw error
      })
    },

    async answeredBy(telegramUserId, messageId) {
      const [row] = await db
        .select({ reply: feedbackReplies.id, actorId: feedbackReplies.actorId })
        .from(feedbackReplies)
        .innerJoin(actors, eq(actors.id, feedbackReplies.actorId))
        .where(
          and(
            eq(actors.telegramUserId, telegramUserId),
            eq(feedbackReplies.telegramMessageId, messageId),
          ),
        )
      return row ?? null
    },

    continueThread({ reply, text, key, apiBuild, limit, notify }) {
      return translateFailures(() =>
        db.transaction(async (tx): Promise<ContinueWrite> => {
          await tx.execute(lockAuthor(reply.actorId))
          const [answered] = await tx
            .select({
              text: feedbackReplies.text,
              thread: sql<number>`coalesce(${feedback.threadId}, ${feedback.id})`.mapWith(Number),
            })
            .from(feedbackReplies)
            .innerJoin(feedback, eq(feedback.id, feedbackReplies.feedbackId))
            .where(
              and(eq(feedbackReplies.id, reply.reply), eq(feedbackReplies.actorId, reply.actorId)),
            )
          if (answered === undefined) return 'gone'
          const [same] = await tx
            .select({ id: feedback.id })
            .from(feedback)
            .where(and(eq(feedback.actorId, reply.actorId), eq(feedback.clientKey, key)))
          if (same !== undefined) return 'repeated'
          const [today] = await tx.execute<{ n: number }>(sql`
            select count(*)::int as n from feedback
            where actor_id = ${reply.actorId} and created_at > clock_timestamp() - interval '24 hours'`)
          if ((today?.n ?? 0) >= limit) return 'limited'
          const [head] = await tx
            .select({ kind: feedback.kind, locale: feedback.locale })
            .from(feedback)
            .where(eq(feedback.id, answered.thread))
          if (head === undefined) return 'gone'
          // A word from Telegram has no screen, platform or page build; its kind and language are
          // the thread's (MOL-148, Р-7).
          const [written] = await tx
            .insert(feedback)
            .values({
              actorId: reply.actorId,
              kind: head.kind,
              text,
              locale: head.locale,
              apiBuild,
              threadId: answered.thread,
              inReplyTo: reply.reply,
              clientKey: key,
            })
            .returning({ id: feedback.id, createdAt: feedback.createdAt })
          const row = theRow(written, 'feedback')
          if (notify) {
            const notice: FeedbackContinuedNotice = {
              kind: 'feedback_continued',
              number: row.id,
              thread: answered.thread,
              quote: feedbackQuote(answered.text),
              text,
              at: row.createdAt.toISOString(),
            }
            await tx.insert(ownerNotices).values({
              kind: notice.kind,
              payload: notice,
              feedbackId: row.id,
              createdAt: row.createdAt,
            })
          }
          return 'written'
        }),
      )
    },

    async markDelivered(delivery) {
      await translateFailures(() =>
        db
          .update(feedbackReplies)
          .set({
            delivered: delivery.outcome,
            telegramMessageId: delivery.outcome === 'sent' ? delivery.messageId : null,
          })
          .where(and(eq(feedbackReplies.id, delivery.reply), isNull(feedbackReplies.delivered))),
      )
    },

    async purgeStale() {
      await db.execute(sql`
        delete from feedback
        where thread_id is null
          and id in (
            select coalesce(f.thread_id, f.id)
            from feedback f
            left join feedback_replies r on r.feedback_id = f.id and r.delivered is distinct from 'failed'
            group by coalesce(f.thread_id, f.id)
            having greatest(max(f.created_at), max(r.created_at))
              < clock_timestamp() - make_interval(years => ${FEEDBACK_KEPT_YEARS})
          )`)
    },
  }
}
