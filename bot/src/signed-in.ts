import { Composer, InlineKeyboard } from 'grammy'
import type { Api, Context } from 'grammy'
import { ApiError } from '@molvia/client'
import type { MolviaBotClient } from '@molvia/client'
import { ERROR, ISSUE, LOGIN_NOTICE_BACK_MAX_SECONDS } from '@molvia/model'
import type { LoginNotice, LoginNoticesTold } from '@molvia/model'
import { dropKeyboard, refuse, settleKeeping, shownText, stopSpinner } from './answer'
import { t } from './i18n'
import { dayInWords } from './when'
import type { MessageKey } from './i18n'
import { handlerOf, reportDefect } from './failure'
import { Flooded, deliver } from './deliver'
import type { Wait } from './deliver'

/**
 * «В ваш аккаунт вошло новое устройство» (MOL-361, audit MOL-287 Ф-3, owner's В-9 «а»): a stranger's
 * link forwarded under a pretext lets their browser into the account of whoever presses «Войти», and
 * the question's words alone do not stop it — the device is named by the stranger's own User-Agent.
 * So every session collected is told of, with one button that ends it. The API picked the sessions and
 * took them off its queue — the bot only sends (MOL-101 Р-1); the button carries the session alone,
 * and whose it is, is `ctx.from.id`.
 */

/** `session:end:` and a uuid are 48 bytes of Telegram's 64 for `callback_data`. */
const PREFIX = 'session:end:'
const BUTTON_DATA = new RegExp(`^${PREFIX}(.*)$`, 's')

export function endButtonData(sessionId: string): string {
  return `${PREFIX}${sessionId}`
}

/**
 * The words: Russian, then English, in one message (owner's В-2 «а») — nobody's language is kept, and
 * a notice not understood is a hijack not ended. Each says the device named itself.
 */
export function signedInText(notice: LoginNotice): string {
  return (['ru', 'en'] as const)
    .map((language) =>
      t(language, 'signed_in.notice', {
        device: notice.deviceName ?? t(language, 'signed_in.device_unknown'),
        date: dayInWords(language, notice.day),
        time: notice.time,
      }),
    )
    .join('\n\n')
}

/** The message: the words and «Это не я — завершить», named in both languages as the words are. */
export function signedInMessage(notice: LoginNotice): {
  readonly text: string
  readonly keyboard: InlineKeyboard
} {
  const label = `${t('ru', 'signed_in.end')} · ${t('en', 'signed_in.end')}`
  return {
    text: signedInText(notice),
    keyboard: new InlineKeyboard().text(label, endButtonData(notice.sessionId)),
  }
}

/** Two refusals for now in a row are Telegram's, not a chat's: the rest of the claim waits for the next. */
const REFUSED_IN_A_ROW = 2

/**
 * Asks the API which sign-ins to tell of, sends them one message each with sound whatever the hour
 * (Р-2), and says what went (adversarial А1). **Nothing waits**: a 429 — of one chat, the attacker's
 * own under flood control (`/start` spammed), or the bot's — gives that notice back, behind everyone
 * else's, and the next one is tried; two in a row say it is Telegram's, and the rest of the claim is
 * given back untried. A 403 marks the bot blocked, as `deliver` does for every message, and is told.
 * Lost only if the bot dies before its word, or the word itself is lost — at most once (MOL-101 Р-2).
 */
export async function tellSignIns(api: MolviaBotClient, telegram: Api): Promise<void> {
  let due: LoginNotice[]
  try {
    due = (await api.claimLoginNotices()).notices
  } catch (error) {
    console.error(
      `[molvia] login notice claim: ${error instanceof ApiError ? error.code : 'unexpected failure'}`,
    )
    reportDefect(api, error, 'signed_in:claim')
    return
  }
  if (due.length === 0) return
  const word: LoginNoticesTold = { told: [], back: [] }
  let refused = 0
  for (const notice of due) {
    if (refused >= REFUSED_IN_A_ROW) {
      word.back.push({ sessionId: notice.sessionId, afterSeconds: null })
      continue
    }
    const { text, keyboard } = signedInMessage(notice)
    const message = async () =>
      telegram.sendMessage(notice.telegramUserId, text, { reply_markup: keyboard })
    let afterSeconds = 0
    try {
      // A wait refused: a 429 within the cap is given back at once rather than waited out here.
      const delivered = await deliver(api, notice.telegramUserId, message, noWait, 'signed_in')
      if (delivered !== 'again') {
        word.told.push(notice.sessionId)
        refused = 0
        continue
      }
    } catch (error) {
      if (!(error instanceof Flooded)) throw error
      // Telegram's hours are the contract's hour at most, or the whole word would be refused (Б2).
      afterSeconds = Math.min(error.seconds, LOGIN_NOTICE_BACK_MAX_SECONDS)
    }
    word.back.push({ sessionId: notice.sessionId, afterSeconds })
    refused += 1
  }
  if (refused >= REFUSED_IN_A_ROW) {
    console.error(
      `[molvia] signed in: refused ${String(REFUSED_IN_A_ROW)} in a row, the rest given back`,
    )
  }
  try {
    await api.loginNoticesTold(word)
  } catch (error) {
    console.error(
      `[molvia] login notices told: ${error instanceof ApiError ? error.code : 'unexpected failure'}`,
    )
    reportDefect(api, error, 'signed_in:told')
  }
}

const noWait: Wait = () => Promise.resolve(false)

/** How often the bot asks: a sign-in is told of within the minute after it. */
export const SIGNED_IN_EVERY_MS = 60_000

/** The notices' timer: a run still going is not doubled, the timer keeps no process alive. */
export function startLoginNotices(
  api: MolviaBotClient,
  telegram: Api,
  everyMs = SIGNED_IN_EVERY_MS,
): () => Promise<void> {
  let running: Promise<void> | undefined
  const tick = (): void => {
    if (running) return
    running = tellSignIns(api, telegram).finally(() => {
      running = undefined
    })
  }
  tick()
  const timer = setInterval(tick, everyMs)
  timer.unref()
  return async () => {
    clearInterval(timer)
    await running
  }
}

/**
 * A refusal of the press, by its code: no such session of this account — ended already, someone
 * else's, never one — is «уже завершён»; anything else is ours to fix, logged by its code alone.
 */
function refusal(error: unknown): MessageKey {
  if (
    error instanceof ApiError &&
    (error.code === ERROR.NOT_FOUND || error.code === ISSUE.PATH_INVALID)
  ) {
    return 'signed_in.gone'
  }
  console.error(
    `[molvia] end session: ${error instanceof ApiError ? error.code : 'unexpected failure'}`,
  )
  return 'login.failed'
}

/**
 * «Это не я — завершить». **One press, no second question** (Р-4): a slip costs one login again, the
 * hijack it ends costs the account. The outcome is written under the notice and the button goes; a
 * refusal is shown over it and written nowhere (О-1) — «уже завершён» takes the button, since nothing
 * is left to end, and «the API did not answer» keeps it for the next press.
 */
export function signedInComposer({ api }: { readonly api: MolviaBotClient }): Composer<Context> {
  const composer = new Composer<Context>()
  composer.chatType('private').callbackQuery(BUTTON_DATA, async (ctx) => {
    const [, sessionId = ''] = ctx.match
    let refused: MessageKey | null = null
    try {
      await api.endSession(sessionId, ctx.from.id)
    } catch (error) {
      reportDefect(api, error, handlerOf(ctx))
      refused = refusal(error)
    }
    if (refused === null) {
      try {
        // Under the notice, which keeps saying which device and when; the button goes.
        const outcome = t(ctx.from.language_code, 'signed_in.ended')
        const shown = shownText(ctx.callbackQuery.message)
        await settleKeeping(
          ctx,
          shown === null ? null : `${shown}\n\n${outcome}`,
          undefined,
          outcome,
        )
      } finally {
        await stopSpinner(ctx)
      }
      return
    }
    try {
      await refuse(ctx, refused)
    } finally {
      if (refused === 'signed_in.gone') await dropKeyboard(ctx)
    }
  })
  return composer
}
