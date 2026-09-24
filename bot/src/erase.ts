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
    if (action === 'no') {
      try {
        await settle(ctx, 'erase.cancelled')
      } finally {
        await stopSpinner(ctx)
      }
      return
    }

    const age = now() - Number(issued)
    if (issued === '' || age < 0 || age > ERASE_BUTTON_SECONDS) {
      try {
        await refuse(ctx, 'erase.expired')
      } finally {
        await dropKeyboard(ctx)
      }
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
