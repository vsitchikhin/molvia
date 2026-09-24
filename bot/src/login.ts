import { Composer, GrammyError, InlineKeyboard } from 'grammy'
import type { Context } from 'grammy'
import { ApiError } from '@molvia/client'
import type { MolviaBotClient } from '@molvia/client'
import { ERROR, ISSUE } from '@molvia/model'
import { t } from './i18n'
import type { MessageKey } from './i18n'
import { timeAgo } from './when'

/** Telegram's limit on `callback_data`, in bytes. */
const CALLBACK_DATA_MAX = 64

/**
 * What a button carries, written once and read back by the expression built from it.
 *
 * Written and read by two hand-kept strings at first, and the reading was `slice(CONFIRM.length)`
 * — correct only while both prefixes happen to be the same length. Renaming one of them would
 * have cut the code in the wrong place and refused a perfectly good login, silently.
 *
 * The code is matched as `(.*)`, not `(.+)`: an empty one then reaches the same refusal as any
 * other dead link, whereas an update this filter does not match at all would leave the spinner
 * turning under the person's finger forever.
 */
const PREFIX = 'login:'
const buttonData = (action: 'ok' | 'no', code: string): string => `${PREFIX}${action}:${code}`
const BUTTON_DATA = new RegExp(`^${PREFIX}(ok|no):(.*)$`, 's')

export interface LoginDeps {
  readonly api: MolviaBotClient
  /** Where the app lives — the one thing the greeting says beyond hello. */
  readonly appUrl: string
}

/**
 * What the code of a refusal becomes on screen, and what is written down about it.
 *
 * Expired, spent, declined, unknown — the API answers all four with `login_unavailable`, and a
 * code no row could carry never leaves this process: the client refuses it as `path_invalid`.
 * For the person those are one and the same dead link, and telling them apart would be telling
 * them how to guess a code.
 *
 * Anything else is ours to fix rather than theirs, so it is logged — **the code of the error
 * and the operation, and nothing else**. Not the update, not the name, not the username, not
 * `language_code` and never the channel's secret (Confluence «Персональные данные», п. 4.3).
 */
function refusal(error: unknown, operation: string): MessageKey {
  if (
    error instanceof ApiError &&
    (error.code === ERROR.LOGIN_UNAVAILABLE || error.code === ISSUE.PATH_INVALID)
  ) {
    return 'login.unavailable'
  }
  console.error(
    `[molvia] ${operation}: ${error instanceof ApiError ? error.code : 'unexpected failure'}`,
  )
  return 'login.failed'
}

/**
 * The second half of the login (MOL-51): the one place a person sees **which device** they are
 * letting in, and says so on purpose.
 *
 * The bot adds exactly two things to what MOL-54 already holds — the Telegram account doing the
 * confirming, which only Telegram can vouch for, and the person's explicit «yes». Everything
 * else — the five-minute term, the one-use rule, the quota, «expired and unknown answer the
 * same» — belongs to the API and is not repeated here.
 *
 * **Nothing is remembered between updates.** The code travels in the button's `callback_data`,
 * which is Telegram's memory rather than the bot's, and every other fact is asked of the API.
 */
export function loginComposer({ api, appUrl }: LoginDeps): Composer<Context> {
  const composer = new Composer<Context>()

  // Only in a private chat. A deep link never opens a group, and a button pressed in a group by
  // whoever saw it first is somebody else's login.
  const privately = composer.chatType('private')

  function keyboard(code: string, language: string | undefined): InlineKeyboard {
    return new InlineKeyboard()
      .text(t(language, 'login.confirm'), buttonData('ok', code))
      .text(t(language, 'login.decline'), buttonData('no', code))
  }

  /** Nothing left to confirm, but putting the request out is still worth offering (Б1). */
  function declineOnly(code: string, language: string | undefined): InlineKeyboard {
    return new InlineKeyboard().text(t(language, 'login.decline'), buttonData('no', code))
  }

  /**
   * The answer replaces the question, so the buttons go with it (Q6).
   *
   * **Only an outcome may be written here** — confirmed or declined. A refusal is shown over
   * the message instead of in it, for the reason spelled out on the handler below.
   */
  async function settle(ctx: Context, key: MessageKey): Promise<void> {
    const text = t(ctx.from?.language_code, key)
    try {
      // No `reply_markup`: Telegram drops the keyboard when an edit does not carry one.
      await ctx.editMessageText(text)
    } catch (error) {
      // «message is not modified» is not a failure to answer — it means this very answer is
      // already on screen, which is what a second press of an idempotent confirmation produces.
      // Read as «the message is gone», it put a duplicate reply into the chat every double tap
      // (adversarial Б2) — exactly the clutter Q6 removed by editing in place.
      if (error instanceof GrammyError && error.description.includes('message is not modified')) {
        return
      }
      // Too old to edit, or the message is gone — the answer still has to arrive.
      await ctx.reply(text)
    }
  }

  /**
   * A refusal, shown **over** the message and never written into it (О-1).
   *
   * The alert is the whole channel here, so its failure cannot be the end of the matter: a
   * press that waited out the client's fifteen-second timeout is exactly what this branch
   * meets, and Telegram refuses to answer a query that old. That left «не дождался ответа»
   * reaching nobody at all — the chat still showed the question, as if nothing had been
   * pressed (adversarial В1). A plain message is a poorer place for it and the right fallback.
   */
  async function refuse(ctx: Context, key: MessageKey): Promise<void> {
    const text = t(ctx.from?.language_code, key)
    try {
      // Over the message rather than under the top edge of the screen: this is the one thing
      // the person has to read, and a toast at a shelf is easy to miss.
      await ctx.answerCallbackQuery({ text, show_alert: true })
    } catch {
      await ctx.reply(text)
    }
  }

  /** Buttons that can no longer do anything, taken away without touching what was written. */
  async function dropKeyboard(ctx: Context): Promise<void> {
    try {
      await ctx.editMessageReplyMarkup()
    } catch {
      // Already gone, or the message is: neither changes what the person is looking at.
    }
  }

  privately.command('start', async (ctx) => {
    const language = ctx.from.language_code
    const code = ctx.match.trim()
    if (!code) {
      await ctx.reply(t(language, 'start.greeting', { url: appUrl }))
      return
    }

    // A code we could not put on a button is one we cannot ask about: the prompt without its
    // buttons would be the very thing this task exists to prevent. Today's codes are 43
    // characters and the schema allows 64, so this is a guard on a future change, not on input.
    if (Buffer.byteLength(buttonData('ok', code)) > CALLBACK_DATA_MAX) {
      await ctx.reply(t(language, 'login.unavailable'))
      return
    }

    try {
      const request = await api.previewLogin(code)
      // Already said «yes» to, and the session not collected yet — the link opened again after
      // an answer that never arrived (О-2). Nothing left to confirm, so «Войти» goes; «Это не
      // я» stays, because the bot cannot tell this person from the one whose link was confirmed
      // by a stranger (Б1), and for that one the button is the only way out.
      if (request.confirmed) {
        await ctx.reply(t(language, 'login.already'), {
          reply_markup: declineOnly(code, language),
        })
        return
      }
      await ctx.reply(
        t(language, 'login.prompt', {
          device: request.deviceName ?? t(language, 'login.device_unknown'),
          when: timeAgo(request.createdAt, language),
        }),
        { reply_markup: keyboard(code, language) },
      )
    } catch (error) {
      await ctx.reply(t(language, refusal(error, 'preview login')))
    }
  })

  /**
   * A press. **An outcome is written into the message; a refusal is only shown over it.**
   *
   * The two were one path at first, and a double tap then ended in a lie (adversarial О-1):
   * both presses leave before the first edit reaches the phone — the buttons are still on
   * screen, which at a shelf on a slow connection is the ordinary case — so the second press
   * was answered `login_unavailable` by the API, quite correctly, and **overwrote «Вход
   * подтверждён» with «Начните вход заново»**. The login had happened; the last thing written
   * in the chat said it had not, and a person who does as told starts a second one. «Это не я»
   * had the mirror image of it: «в аккаунт никто не вошёл» replaced by an invitation to sign in.
   *
   * So a refusal goes to `answerCallbackQuery`, which is shown over whatever the message says
   * and cannot rewrite it. What happens to the buttons then depends on the kind of refusal, and
   * that distinction is the whole of О-3: a dead link has nothing left to press, while «the API
   * did not answer, try again» must keep the very buttons it is asking for.
   */
  privately.callbackQuery(BUTTON_DATA, async (ctx) => {
    const [, action, code = ''] = ctx.match
    const confirming = action === 'ok'

    // The API call alone is inside the `try`. With the answer to the person in there too, a
    // Telegram failure **after** a login had been confirmed was caught here and reported as a
    // failure of the login — «Не получилось, попробуйте ещё раз» over a session already
    // granted, and a log line naming the wrong thing as broken (selfreview З-4).
    let refused: MessageKey | null = null
    try {
      if (confirming) {
        // `ctx.from.id` and nothing else: the account is Telegram's word, which is the only
        // thing in this flow the API cannot check for itself.
        await api.confirmLogin(code, ctx.from.id)
      } else {
        await api.declineLogin(code)
      }
    } catch (error) {
      refused = refusal(error, confirming ? 'confirm login' : 'decline login')
    }

    if (refused === null) {
      // The outcome is written first and the press answered in `finally`, not the other way
      // round: `answerCallbackQuery` throws on a query Telegram has already aged out — which is
      // what a press waiting out the client's fifteen-second timeout becomes — and with the
      // answer first that threw before anything was written. The login had happened and the
      // message still showed the question with its buttons (selfreview П-2). The spinner is
      // cosmetic; what the person reads is not.
      try {
        await settle(ctx, confirming ? 'login.confirmed' : 'login.declined')
      } finally {
        await ctx.answerCallbackQuery()
      }
      return
    }

    try {
      await refuse(ctx, refused)
    } finally {
      // Outside the answer, deliberately. Standing after it, it was skipped by the very press
      // this branch is most likely to meet — one that waited out the client's fifteen-second
      // timeout, which Telegram by then refuses to answer (adversarial В1). The dead link then
      // kept its buttons, and the next tap на них would find the same nothing.
      if (refused === 'login.unavailable') await dropKeyboard(ctx)
    }
  })

  /**
   * A press this bot no longer understands — a button whose format has changed since it was
   * sent, and `0708da3` is the commit that changed one. Questions already sent stay in their
   * chats forever, so without this the spinner under that finger never stops (О-7).
   */
  privately.on('callback_query', async (ctx) => {
    try {
      await refuse(ctx, 'login.unavailable')
    } finally {
      await dropKeyboard(ctx)
    }
  })

  // Anything else **written** to the bot: the greeting, so it never looks dead. By MOL-58 this
  // is where a request to delete an account arrives, and silence would be the wrong answer.
  //
  // `message:text`, not `message`: Telegram calls a pinned message, a granted write permission
  // and — from 0.3 — a Stars payment «messages» too, and every one of them was being greeted
  // with «вход начинается в приложении» (О-6). Q5 said «произвольный текст», and this is that.
  privately.on('message:text', async (ctx) => {
    await ctx.reply(t(ctx.from.language_code, 'start.greeting', { url: appUrl }))
  })

  return composer
}
