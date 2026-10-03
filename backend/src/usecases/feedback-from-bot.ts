import { createHash } from 'node:crypto'
import {
  DomainError,
  ERROR,
  FEEDBACK_DAY_LIMIT,
  FEEDBACK_REPLY_MAX,
  FEEDBACK_TEXT_MAX,
  dayIn,
  timeZoneOf,
  visibleText,
} from '@molvia/model'
import type { FeedbackFromBot, FeedbackFromBotAnswer, TelegramUserId } from '@molvia/model'
import type { FeedbackRepository } from '@/db/feedback-repository'

type Refused = Extract<FeedbackFromBotAnswer, { outcome: 'too_long' | 'invisible' }>

/**
 * The text as it is kept — `visibleText`, the one rule of what draws — or why it cannot be: longer
 * than `max`, or nothing visible in it (blank runs, only invisible characters). The writer's to fix.
 */
function readText(text: string, max: number): string | Refused {
  const read = visibleText(max).safeParse(text)
  if (read.success) return read.data
  return read.error.issues.some((issue) => issue.code === 'too_big')
    ? { outcome: 'too_long', max }
    : { outcome: 'invisible' }
}

/**
 * The key a person's word from Telegram is written under (MOL-148, Р-7): the chat and the message,
 * so Telegram handing the same update over twice writes one row and sends the owner one notice. A
 * uuid in shape, as the phone's `clientKey` is; the prefix keeps it from ever meeting a phone's.
 */
export function telegramKey(telegramUserId: TelegramUserId, messageId: number): string {
  const hex = createHash('sha256')
    .update(`telegram:${String(telegramUserId)}:${String(messageId)}`)
    .digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

/**
 * A text written to the bot as a reply to one of its messages (MOL-148, Р-2). **What it is, the API
 * decides — the bot repeats no rule**:
 *
 * - from the owner (`OWNER_TELEGRAM_ID`), on a notice tagged `#fb42` — the owner's reply, up to
 *   `FEEDBACK_REPLY_MAX`, written under the person's latest word in the thread; `gone` if the thread
 *   is no longer there;
 * - else, an answer to a reply this very account was sent (В-2) — the person's word in that thread,
 *   up to `FEEDBACK_TEXT_MAX` as the form's, under the form's day limit;
 * - else nothing of ours — `404`, and the bot lets it on to the greeting. A tag in a stranger's reply
 *   is that too: only the owner's account makes it a reply.
 */
export async function feedbackFromBot(
  repository: Pick<FeedbackRepository, 'reply' | 'answeredBy' | 'continueThread'>,
  owner: TelegramUserId | null,
  message: FeedbackFromBot,
  apiBuild: string,
): Promise<FeedbackFromBotAnswer> {
  if (owner !== null && message.telegramUserId === owner && message.thread !== null) {
    const text = readText(message.text, FEEDBACK_REPLY_MAX)
    if (typeof text !== 'string') return text
    const written = await repository.reply(message.thread, text)
    if (written === null) return { outcome: 'gone', thread: message.thread }
    return {
      outcome: 'answered',
      reply: written.reply,
      to: written.to,
      locale: written.locale,
      day: dayIn(written.answeredAt, timeZoneOf(written.country) ?? undefined),
    }
  }

  const answered = await repository.answeredBy(message.telegramUserId, message.repliedMessageId)
  if (answered === null) throw new DomainError(ERROR.NOT_FOUND)
  const text = readText(message.text, FEEDBACK_TEXT_MAX)
  if (typeof text !== 'string') return text
  const write = await repository.continueThread({
    reply: answered,
    text,
    key: telegramKey(message.telegramUserId, message.messageId),
    apiBuild,
    limit: FEEDBACK_DAY_LIMIT,
    notify: owner !== null,
  })
  if (write === 'gone') throw new DomainError(ERROR.NOT_FOUND)
  if (write === 'limited') return { outcome: 'limited' }
  return { outcome: 'continued' }
}
