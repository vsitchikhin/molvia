import { Composer, InlineKeyboard } from 'grammy'
import type { Context } from 'grammy'
import { ApiError } from '@molvia/client'
import type { MolviaBotClient } from '@molvia/client'
import { ERROR, ISSUE } from '@molvia/model'
import { t } from './i18n'
import type { MessageKey } from './i18n'
import { timeAgo } from './when'

/** Telegram's limit on `callback_data`, in bytes. */
const CALLBACK_DATA_MAX = 64

const CONFIRM = 'login:ok:'
const DECLINE = 'login:no:'

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
      .text(t(language, 'login.confirm'), `${CONFIRM}${code}`)
      .text(t(language, 'login.decline'), `${DECLINE}${code}`)
  }

  /** The answer replaces the question, so the buttons go with it (Q6). */
  async function settle(ctx: Context, key: MessageKey): Promise<void> {
    const text = t(ctx.from?.language_code, key)
    try {
      // No `reply_markup`: Telegram drops the keyboard when an edit does not carry one.
      await ctx.editMessageText(text)
    } catch {
      // Too old to edit, or the message is gone — the answer still has to arrive.
      await ctx.reply(text)
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
    if (Buffer.byteLength(`${CONFIRM}${code}`) > CALLBACK_DATA_MAX) {
      await ctx.reply(t(language, 'login.unavailable'))
      return
    }

    try {
      const request = await api.previewLogin(code)
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

  privately.callbackQuery(new RegExp(`^(?:${CONFIRM}|${DECLINE})`), async (ctx) => {
    const data = ctx.callbackQuery.data
    const confirming = data.startsWith(CONFIRM)
    const code = data.slice(CONFIRM.length)
    try {
      if (confirming) {
        // `ctx.from.id` and nothing else: the account is Telegram's word, which is the only
        // thing in this flow the API cannot check for itself.
        await api.confirmLogin(code, ctx.from.id)
        await settle(ctx, 'login.confirmed')
      } else {
        await api.declineLogin(code)
        await settle(ctx, 'login.declined')
      }
    } catch (error) {
      // A second press lands here: the request is no longer waiting, so it reads as a dead
      // link — and no second session is handed out, because the API never gave one.
      await settle(ctx, refusal(error, confirming ? 'confirm login' : 'decline login'))
    } finally {
      // Always, or the button keeps spinning under the person's finger.
      await ctx.answerCallbackQuery()
    }
  })

  // Anything else said to the bot: the greeting, so it never looks dead. By MOL-58 this is
  // where a request to delete an account arrives, and silence would be the wrong answer to it.
  privately.on('message', async (ctx) => {
    await ctx.reply(t(ctx.from.language_code, 'start.greeting', { url: appUrl }))
  })

  return composer
}
