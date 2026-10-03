import { Composer, GrammyError } from 'grammy'
import type { Context } from 'grammy'
import { ApiError } from '@molvia/client'
import type { MolviaBotClient } from '@molvia/client'
import { ERROR, LOCALES } from '@molvia/model'
import type { AppLocale, FeedbackFromBotAnswer } from '@molvia/model'
import { telegramFailure } from './assemble'
import { t } from './i18n'
import type { MessageKey } from './i18n'
import { threadTagOf } from './owner'
import { handlerOf, reportDefect } from './failure'

export interface FeedbackDeps {
  readonly api: MolviaBotClient
}

/** The mark of a reply delivered (MOL-148, В-1): ✅ is not among the reactions Telegram takes. */
export const DELIVERED_REACTION = '👌'

/** The day a reply answers, as the person reads it: «3 октября», «October 3». */
function dayInWords(day: string, locale: AppLocale): string {
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(
    new Date(`${day}T00:00:00Z`),
  )
}

/**
 * The owner's reply as the person gets it (MOL-148, Р-12 of MOL-150): which message it answers, the
 * text, and how to answer it — in the language their message was written in, never the owner's.
 */
export function replyFrame(text: string, day: string, locale: AppLocale): string {
  return [
    t(locale, 'feedback.frame', { date: dayInWords(day, locale) }),
    '',
    text,
    '',
    t(locale, 'feedback.howToAnswer'),
  ].join('\n')
}

/**
 * The last lines frames were sent with before the wording of `feedback.howToAnswer` changed (round 2,
 * Г3): a frame stays in a person's chat for good, and their answer to it must still be known as one.
 * A new wording moves the old one here, in every language.
 */
export const FRAME_LAST_LINES: readonly string[] = []

/**
 * Whether a message of the bot's is the frame of a reply (MOL-148): its last line is the frame's own,
 * in any language the bot speaks, now or in a wording it was sent with before. The bot reads its
 * message back, as it reads a notice's tag.
 */
export function isReplyFrame(text: string): boolean {
  const last = text.slice(text.lastIndexOf('\n') + 1)
  return (
    LOCALES.some((locale) => last === t(locale, 'feedback.howToAnswer')) ||
    FRAME_LAST_LINES.includes(last)
  )
}

/**
 * «Написать разработчику» in the bot (MOL-148): a text written **as a reply to one of the bot's own
 * messages** — a notice tagged `#fb42` or the frame of a reply, and no other (adversarial В2: a
 * reply to the greeting must not wait on the API, and get «сервер не ответил» for an answer) —
 * in a private chat, is handed to the API with who wrote it (`ctx.from.id`), the message
 * answered and the tag `#fb42` that message's first line carries. **The API says what it was** — the
 * owner's reply on a notice, a person's word on a reply they got, or nothing of ours — and the bot
 * only acts on the answer: nothing of ours goes on to the greeting, as before.
 *
 * The owner's reply goes to the person at once, not through a queue: the owner waits to see it
 * went (Р-10). Then a reaction on the owner's message says «delivered» — no message more in the chat
 * (Р-11) — and a refusal of the reaction a line «Доставлено» instead; a blocked bot says so, marks the
 * reply and turns the person's reminders off by the path of MOL-103. Every other outcome is a line
 * under the message it answers: there are no buttons to keep here, and no error is shown.
 */
export function feedbackComposer({ api }: FeedbackDeps): Composer<Context> {
  const composer = new Composer<Context>()

  composer.chatType('private').on('message', async (ctx, next) => {
    const replied = ctx.message.reply_to_message
    if (replied?.from?.id !== ctx.me.id) {
      await next()
      return
    }
    const thread = threadTagOf(replied.text ?? '')
    const command = ctx.message.entities?.some(
      (entity) => entity.type === 'bot_command' && entity.offset === 0,
    )
    // A command is the bot's to answer, never a word to the developer (adversarial В6).
    if ((thread === null && !isReplyFrame(replied.text ?? '')) || command === true) {
      await next()
      return
    }
    const language = ctx.from.language_code
    const say = async (key: MessageKey, params?: Record<string, string | number>) => {
      await ctx.reply(t(language, key, params), {
        reply_parameters: { message_id: ctx.message.message_id },
      })
    }
    const text = ctx.message.text
    if (text === undefined) {
      // A photo on a tagged notice must not look sent; on a frame the bot stays quiet, as before.
      if (thread === null) await next()
      else await say('feedback.textOnly')
      return
    }

    let answer: FeedbackFromBotAnswer
    try {
      answer = await api.feedbackFromBot({
        telegramUserId: ctx.from.id,
        repliedMessageId: replied.message_id,
        thread,
        text,
      })
    } catch (error) {
      if (error instanceof ApiError && error.code === ERROR.NOT_FOUND) {
        await next()
        return
      }
      console.error(
        `[molvia] feedback: ${error instanceof ApiError ? error.code : 'unexpected failure'}`,
      )
      reportDefect(api, error, handlerOf(ctx))
      await say('feedback.failed')
      return
    }

    switch (answer.outcome) {
      case 'answered':
        await deliver(ctx, api, answer, text, say)
        return
      case 'continued':
        await say('feedback.passed')
        return
      case 'gone':
        await say('feedback.gone', { thread: answer.thread })
        return
      case 'too_long':
        await say('feedback.tooLong', { max: answer.max })
        return
      case 'invisible':
        await say('feedback.invisible')
        return
      case 'limited':
        await say('feedback.limited')
        return
    }
  })

  return composer
}

/**
 * The owner's reply, sent to the person and its outcome said to the owner (Р-11). The mark goes to
 * the API after the send: a lost mark leaves the reply «unknown», and the person's answer to it
 * cannot find the thread — a named price (Р-4, Р-14), said to the owner instead of the 👌.
 */
async function deliver(
  ctx: Context,
  api: MolviaBotClient,
  answer: Extract<FeedbackFromBotAnswer, { outcome: 'answered' }>,
  text: string,
  say: (key: MessageKey) => Promise<void>,
): Promise<void> {
  let messageId: number
  try {
    const sent = await ctx.api.sendMessage(answer.to, replyFrame(text, answer.day, answer.locale))
    messageId = sent.message_id
  } catch (error) {
    if (error instanceof GrammyError && error.error_code === 403) {
      await mark(api, ctx, () => api.replyDelivered({ reply: answer.reply, outcome: 'blocked' }))
      await mark(api, ctx, () => api.switchReminders(answer.to, 'blocked'))
      await say('feedback.blocked')
      return
    }
    console.error(`[molvia] feedback reply: ${telegramFailure(error)}`)
    reportDefect(api, error, handlerOf(ctx))
    if (error instanceof GrammyError) {
      // Telegram said no: the reply never reached the person, the copy says so, and «ответьте ещё
      // раз» writes another (adversarial В4).
      await mark(api, ctx, () => api.replyDelivered({ reply: answer.reply, outcome: 'failed' }))
      await say('feedback.notSent')
      return
    }
    // The connection broke: Telegram may have taken the message before it did, so nothing is marked
    // — empty is «unknown» (Р-4) — and the owner is told it may go twice (review №8).
    await say('feedback.unknown')
    return
  }
  const marked = await mark(api, ctx, () =>
    api.replyDelivered({ reply: answer.reply, outcome: 'sent', messageId }),
  )
  // Delivered, but the API does not know the message it went as: the person's answer to it cannot
  // find the thread, and the owner must not wait for one under a 👌 (review №2).
  if (!marked) {
    await say('feedback.deliveredUnmarked')
    return
  }
  try {
    await ctx.react(DELIVERED_REACTION)
  } catch (error) {
    console.error(`[molvia] feedback reaction: ${telegramFailure(error)}`)
    await say('feedback.delivered')
  }
}

/** A word to the API after the send: its failure is the log's, and the owner still hears the outcome. */
async function mark(
  api: MolviaBotClient,
  ctx: Context,
  call: () => Promise<void>,
): Promise<boolean> {
  try {
    await call()
    return true
  } catch (error) {
    console.error(
      `[molvia] feedback mark: ${error instanceof ApiError ? error.code : 'unexpected failure'}`,
    )
    reportDefect(api, error, handlerOf(ctx))
    return false
  }
}
