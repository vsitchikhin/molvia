import { Composer } from 'grammy'
import type { Context } from 'grammy'
import { ApiError } from '@molvia/client'
import type { MolviaBotClient } from '@molvia/client'
import { ERROR, ISSUE } from '@molvia/model'
import { dropKeyboard, refuse, settleKeeping, stopSpinner } from './answer'
import { t } from './i18n'
import { SCALE_DATA, keyboardOf, readText, scale, writeText } from './remind'

export interface RateDeps {
  readonly api: MolviaBotClient
}

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
    const message = ctx.callbackQuery.message
    // The switch's row and its outcome stay as the message holds them (MOL-103, Р-7).
    const { offer } = keyboardOf(message?.reply_markup)
    try {
      const text = writeText({ ...readText(message?.text ?? ''), rated: outcome })
      await settleKeeping(ctx, text, scale(itemId, score, offer), outcome)
    } finally {
      await stopSpinner(ctx)
    }
  })

  return composer
}
