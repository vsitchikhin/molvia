import { Composer } from 'grammy'
import type { Context } from 'grammy'
import { ApiError } from '@molvia/client'
import type { MolviaBotClient } from '@molvia/client'
import type { ReminderSwitch } from '@molvia/model'
import { refuse, settleKeeping, stopSpinner } from './answer'
import { t } from './i18n'
import { SWITCH_DATA, keyboardOf, readText, scale, writeText } from './remind'

export interface MuteDeps {
  readonly api: MolviaBotClient
}

function logged(operation: string, error: unknown): void {
  console.error(
    `[molvia] ${operation}: ${error instanceof ApiError ? error.code : 'unexpected failure'}`,
  )
}

/**
 * The switch of the rating reminders in the bot (MOL-103).
 *
 * **«Не напоминать» and «Вернуть напоминания»** under the last reminder of the evening (В-2, В-3)
 * turn the reminders of **whoever pressed** off and on (`ctx.from.id`), only in a private chat, as
 * the scale and erasure do. The outcome is written under the question and the buttons stay with the
 * other one offered: a slip of the finger beside the scale is one more press, not a trip to the app
 * (В-3). The scale stays too, the pressed digit with it — one may still rate after saying «enough».
 * A refusal is shown over the message (`answer.ts`); the API answers `204` for an account it does
 * not know, since «off» is true of it either way, so there is no «gone» here.
 *
 * **Blocked and unblocked are Telegram's word** (`my_chat_member` of a private chat): `kicked`
 * turns the reminders off at once rather than at the next evening's 403, and `member` turns back
 * on only what blocking turned off (В-1) — the API decides that, the bot only passes it on.
 */
export function muteComposer({ api }: MuteDeps): Composer<Context> {
  const composer = new Composer<Context>()

  composer.chatType('private').callbackQuery(SWITCH_DATA, async (ctx) => {
    const offer = ctx.match[1] === 'on' ? 'on' : 'off'
    try {
      await api.switchReminders(ctx.from.id, offer)
    } catch (error) {
      logged('remind switch', error)
      // The buttons stay: «press again» must leave something to press.
      await refuse(ctx, 'remind.switchFailed')
      return
    }

    const outcome = t(ctx.from.language_code, offer === 'off' ? 'remind.stopped' : 'remind.resumed')
    const message = ctx.callbackQuery.message
    const { itemId, pressed } = keyboardOf(message?.reply_markup)
    try {
      const text = writeText({ ...readText(message?.text ?? ''), switched: outcome })
      await settleKeeping(
        ctx,
        text,
        scale(itemId, pressed, offer === 'off' ? 'on' : 'off'),
        outcome,
      )
    } finally {
      await stopSpinner(ctx)
    }
  })

  composer.on('my_chat_member', async (ctx) => {
    if (ctx.chat.type !== 'private') return
    const status = ctx.myChatMember.new_chat_member.status
    const change: ReminderSwitch | null =
      status === 'kicked' ? 'blocked' : status === 'member' ? 'unblocked' : null
    if (!change) return
    try {
      await api.switchReminders(ctx.myChatMember.from.id, change)
    } catch (error) {
      // Nobody to tell: a blocked bot cannot write, and the next evening's 403 asks again.
      logged('remind block', error)
    }
  })

  return composer
}
