import { Composer, InlineKeyboard } from 'grammy'
import type { Context } from 'grammy'
import { ApiError } from '@molvia/client'
import type { MolviaBotClient } from '@molvia/client'
import { dropKeyboard, refuse, settle, stopSpinner } from './answer'
import { t } from './i18n'

/**
 * How long a «Удалить навсегда» button means yes. A prompt found in the chat a week later, and
 * pressed by a thumb looking for something else, is not the decision it once asked for.
 */
export const ERASE_BUTTON_SECONDS = 10 * 60

/**
 * What a button carries: the action and the second it was issued — and never an id. Whose data
 * goes is `ctx.from.id`, Telegram's word for who pressed, so a button forwarded, shared or
 * forged erases the presser and nobody else.
 */
const PREFIX = 'erase:'
const buttonData = (action: 'ok' | 'no', issued: number): string =>
  `${PREFIX}${action}:${String(issued)}`
const BUTTON_DATA = new RegExp(`^${PREFIX}(ok|no):([0-9]*)$`)

/**
 * Words that take the buttons away with them: «Отмена», and a button too old to mean yes.
 * Said over the message — and **under** it when Telegram will not take the alert (adversarial
 * П-4, Р-2). A refusal may stay silent because its buttons stay for the next press; these take
 * them away, and silence with no buttons left the question «Удалить все ваши данные?» standing
 * unanswered — after «Удалить навсегда» was pressed. Both are true whatever happened before, so
 * unlike a refusal they may be written into the chat. The buttons go only once something was
 * said.
 */
async function sayAndClose(ctx: Context, key: 'erase.cancelled' | 'erase.expired'): Promise<void> {
  const text = t(ctx.from?.language_code, key)
  try {
    await ctx.answerCallbackQuery({ text, show_alert: true })
  } catch {
    try {
      await ctx.reply(text)
    } catch {
      // Nothing reached the person: the buttons stay, and the next press can try again.
      return
    }
  }
  await dropKeyboard(ctx)
}

export interface EraseDeps {
  readonly api: MolviaBotClient
  /** Seconds since the epoch — injectable so the age of a button is testable. */
  readonly now?: () => number
}

/**
 * A person erasing themselves (MOL-58): `/delete`, one question, one press. The bot is where the
 * person is already proved — Telegram says who pressed — so nothing here asks them to prove it
 * again, and nothing waits for the owner of the project to act.
 *
 * Nothing is kept between updates, exactly as for the login: the second of issue rides in the
 * button, and the API does the rest in one transaction.
 */
export function eraseComposer({
  api,
  now = () => Math.floor(Date.now() / 1000),
}: EraseDeps): Composer<Context> {
  const composer = new Composer<Context>()
  // Only in a private chat: a button pressed in a group would erase whoever pressed it.
  const privately = composer.chatType('private')

  privately.command('delete', async (ctx) => {
    const language = ctx.from.language_code
    const issued = now()
    await ctx.reply(t(language, 'erase.prompt'), {
      reply_markup: new InlineKeyboard()
        .text(t(language, 'erase.confirm'), buttonData('ok', issued))
        .text(t(language, 'erase.cancel'), buttonData('no', issued)),
    })
  })

  privately.callbackQuery(BUTTON_DATA, async (ctx) => {
    const [, action, issued = ''] = ctx.match
    // «Отмена» is not an outcome, so it is not written into the message (adversarial О-2).
    // Both presses of a hesitant double tap leave before the first edit lands, and written in,
    // «Ничего не удалено» overwrote «Готово» over an account already gone — the one lie this
    // screen cannot afford. The bot keeps no state and cannot know whether the other button
    // was pressed, so the words are shown over the message, say what is true either way, and
    // the buttons go.
    if (action === 'no') {
      await sayAndClose(ctx, 'erase.cancelled')
      return
    }

    const age = now() - Number(issued)
    if (issued === '' || age < 0 || age > ERASE_BUTTON_SECONDS) {
      await sayAndClose(ctx, 'erase.expired')
      return
    }

    // The API call alone is inside the `try`, for the reason `login.ts` gives: a Telegram
    // failure after the erasure must not be reported as a failure of the erasure.
    let failed = false
    try {
      await api.eraseMe(ctx.from.id)
    } catch (error) {
      failed = true
      // The code and the operation, nothing else — the same rule as the login's log.
      console.error(
        `[molvia] erase: ${error instanceof ApiError ? error.code : 'unexpected failure'}`,
      )
    }

    if (failed) {
      // The buttons stay: a repeat is safe, and «try again» must leave something to press.
      await refuse(ctx, 'erase.failed')
      return
    }
    try {
      await settle(ctx, 'erase.done')
    } finally {
      await stopSpinner(ctx)
    }
  })

  return composer
}
