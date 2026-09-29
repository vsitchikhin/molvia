import { Composer } from 'grammy'
import type { Context } from 'grammy'
import { ApiError } from '@molvia/client'
import type { MolviaBotClient } from '@molvia/client'
import { ERROR, ISSUE } from '@molvia/model'
import { dropKeyboard, refuse, settleKeeping, stopSpinner } from './answer'
import { t } from './i18n'
import { SCALE_DATA, scale } from './remind'

export interface RateDeps {
  readonly api: MolviaBotClient
}

/**
 * Where the outcome begins in a reminder's text. The text is Telegram's memory of the question
 * (the bot keeps none), so a second press finds the first one's outcome there and replaces it:
 * everything from this mark on is the last press's word. A mark rather than a line count, because
 * the last message of the day carries one more line.
 */
const OUTCOME = '\n\n✓ '

/**
 * A press of 1–5 under a rating reminder (MOL-101): the verdict of **whoever pressed**
 * (`ctx.from.id`), through the API's `PUT` — the same verdict «Оценки» gives, the review left as
 * it was. The outcome is written into the message and the scale stays, the digit marked (Р-6);
 * a refusal is shown over the message (`answer.ts`).
 *
 * Only in a private chat, like erasure: pressed in a group, it would rate for whoever pressed.
 */
export function rateComposer({ api }: RateDeps): Composer<Context> {
  const composer = new Composer<Context>()

  composer.chatType('private').callbackQuery(SCALE_DATA, async (ctx) => {
    const [, itemId = '', digit = ''] = ctx.match
    const score = Number(digit)

    // The API call alone is inside the `try`, as in `login.ts`: a Telegram failure after the
    // verdict is written must not be reported as a failure to write it.
    try {
      await api.rateFromBot(ctx.from.id, itemId, score)
    } catch (error) {
      if (
        error instanceof ApiError &&
        (error.code === ERROR.NOT_FOUND || error.code === ISSUE.PATH_INVALID)
      ) {
        // An erased account or an item gone: no press of this message can succeed again.
        await refuse(ctx, 'rate.gone')
        await dropKeyboard(ctx)
        return
      }
      console.error(
        `[molvia] rate: ${error instanceof ApiError ? error.code : 'unexpected failure'}`,
      )
      // The scale stays: a repeat is harmless, and «press again» must leave something to press.
      await refuse(ctx, 'rate.failed')
      return
    }

    const outcome = t(ctx.from.language_code, 'rate.done', { score })
    const question = (ctx.callbackQuery.message?.text ?? '').split(OUTCOME)[0] ?? ''
    try {
      const text = question === '' ? outcome : `${question}${OUTCOME}${outcome}`
      await settleKeeping(ctx, text, scale(itemId, score), outcome)
    } finally {
      await stopSpinner(ctx)
    }
  })

  return composer
}
