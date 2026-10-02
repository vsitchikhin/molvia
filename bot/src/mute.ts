import { Composer } from 'grammy'
import type { Context, MiddlewareFn } from 'grammy'
import { ApiError } from '@molvia/client'
import type { MolviaBotClient } from '@molvia/client'
import { ERROR } from '@molvia/model'
import type { ReminderSwitch } from '@molvia/model'
import { dropKeyboard, refuse, settleKeeping, stopSpinner } from './answer'
import { t } from './i18n'
import { SWITCH_DATA, keyboardOf, readText, scale, shownText, writeText } from './remind'

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
 * A refusal is shown over the message (`answer.ts`). The API answers `204` to «off» for an account
 * it does not know, since «off» is true of it either way, and `404` to «on» — there is nobody to
 * turn on (adversarial В), and no press of this message can do anything for them.
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
      if (error instanceof ApiError && error.code === ERROR.NOT_FOUND) {
        await refuse(ctx, 'remind.gone')
        await dropKeyboard(ctx)
        return
      }
      logged('remind switch', error)
      // The buttons stay: «press again» must leave something to press.
      await refuse(ctx, 'remind.switchFailed')
      return
    }

    const outcome = t(ctx.from.language_code, offer === 'off' ? 'remind.stopped' : 'remind.resumed')
    const message = ctx.callbackQuery.message
    const { itemId, pressed } = keyboardOf(message?.reply_markup)
    const shown = shownText(message)
    try {
      const text = shown === null ? null : writeText({ ...readText(shown), switched: outcome })
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

/**
 * **Whoever writes to the bot has not blocked it** (MOL-103, adversarial round 2 Н): any message or
 * press in a private chat passes «unblocked» to the API. Telegram keeps an unblock's `my_chat_member`
 * for a day at most, and a bot down longer left `blocked` for good — with the settings unable to lift
 * it (В-5) and the screen saying «разблокируйте — и вернутся» to someone who had. `/start` alone was
 * not enough: unblocking from Telegram's list sends none, and a chat with its history shows no
 * «START» — a word typed or a digit pressed under an old reminder is what such a person does.
 *
 * Installed first, before every composer, since each of them may end the update. Not waited for:
 * the login or the rating behind it must not stand in the API's queue, and «unblocked» changes
 * only `blocked` — on anyone else it writes nothing. **Not for a press of the switch**: «Не
 * напоминать» and «Вернуть» tell the API themselves, and the two words of one press would arrive
 * in no order (round 3, О). What stays unordered is the «unblocked» of a press of the scale — with
 * its verdict, which the switch does not touch, and with a press of the switch right after it
 * (round 4, О4): over a stuck `blocked`, the count of «Не напоминать» and the ladder then hang on
 * which arrives first. Accepted: it needs the slower request to lose to a verdict, an edit and a
 * whole next update, and waiting for it would put the rating back in the API's queue. The named
 * price: a press followed at once by a block may let its «unblocked» arrive after the block's word
 * and turn the reminders on for one evening, until that evening's 403 turns them off again.
 */
export function heardFrom({ api }: MuteDeps): MiddlewareFn {
  return async (ctx, next) => {
    // A press of the switch itself says its own word, waited for: a second one beside it, unordered,
    // made the count of «Не напоминать» and the ladder depend on which arrived first (round 3, О).
    const switchPress = SWITCH_DATA.test(ctx.callbackQuery?.data ?? '')
    if (
      ctx.chat?.type === 'private' &&
      ctx.from &&
      (ctx.message || ctx.callbackQuery) &&
      !switchPress
    ) {
      const telegramUserId = ctx.from.id
      // A promise first: a client that throws at once must not take the update with it.
      void Promise.resolve()
        .then(async () => api.switchReminders(telegramUserId, 'unblocked'))
        .catch((error: unknown) => {
          logged('remind unblock', error)
        })
    }
    await next()
  }
}
