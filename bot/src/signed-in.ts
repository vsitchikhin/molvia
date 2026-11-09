import { Composer, InlineKeyboard } from 'grammy'
import type { Api, Context } from 'grammy'
import { ApiError } from '@molvia/client'
import type { MolviaBotClient } from '@molvia/client'
import { ERROR, ISSUE } from '@molvia/model'
import type { LoginNotice } from '@molvia/model'
import { dropKeyboard, refuse, settleUnder, stopSpinner } from './answer'
import { t } from './i18n'
import type { MessageKey } from './i18n'
import { handlerOf, reportDefect } from './failure'
import { Flooded, deliver, sleep } from './deliver'
import type { Wait } from './deliver'

/**
 * «В ваш аккаунт вошло новое устройство» (MOL-361, audit MOL-287 Ф-3, owner's В-9 «а»): a stranger's
 * link forwarded under a pretext lets their browser into the account of whoever presses «Войти», and
 * the question's words alone do not stop it — the device is named by the stranger's own User-Agent.
 * So every session collected is told of, with one button that ends it. The API picked the sessions and
 * took them off its queue — the bot only sends (MOL-101 Р-1); the button carries the session alone,
 * and whose it is, is `ctx.from.id`.
 */

/** Telegram's limit on `callback_data`, in bytes: `session:end:` and a uuid are 48. */
const CALLBACK_DATA_MAX = 64
const PREFIX = 'session:end:'
const BUTTON_DATA = new RegExp(`^${PREFIX}(.*)$`, 's')

export function endButtonData(sessionId: string): string {
  return `${PREFIX}${sessionId}`
}

/** «9 ноября», «9 November»: the day of the sign-in, without the year — Telegram dates the message. */
function dateOf(language: 'ru' | 'en', day: string): string {
  return new Intl.DateTimeFormat(language === 'en' ? 'en-GB' : language, {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${day}T12:00:00Z`))
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
        date: dateOf(language, notice.day),
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

/**
 * Asks the API which sign-ins to tell of and sends them, one message each, with sound whatever the hour
 * (Р-2) — a 429 waited out once, a 403 marking the bot blocked, as `deliver` does for every message. A
 * notice lost here is not handed out again: at most once (MOL-101 Р-2).
 */
export async function tellSignIns(
  api: MolviaBotClient,
  telegram: Api,
  wait: Wait = async (ms) => sleep(ms),
): Promise<void> {
  let due: LoginNotice[]
  try {
    // Never cut short by a stop: the API took them off its queue, so a claim given up midway loses
    // those messages — its own thirty seconds are the bound.
    due = (await api.claimLoginNotices()).notices
  } catch (error) {
    console.error(
      `[molvia] login notice claim: ${error instanceof ApiError ? error.code : 'unexpected failure'}`,
    )
    reportDefect(api, error, 'signed_in:claim')
    return
  }
  for (const [index, notice] of due.entries()) {
    // A session id is a uuid, so this holds by construction; a notice it would not hold for is one
    // whose button could not be pressed, and the message without it is what this task exists against.
    if (Buffer.byteLength(endButtonData(notice.sessionId)) > CALLBACK_DATA_MAX) continue
    const { text, keyboard } = signedInMessage(notice)
    const message = async () =>
      telegram.sendMessage(notice.telegramUserId, text, { reply_markup: keyboard })
    try {
      await deliver(api, notice.telegramUserId, message, wait, 'signed_in')
    } catch (error) {
      if (!(error instanceof Flooded)) throw error
      console.error(`[molvia] signed in: 429 flood, ${String(due.length - index)} notices given up`)
      return
    }
  }
}

/** How often the bot asks: a sign-in is told of within the minute after it. */
export const SIGNED_IN_EVERY_MS = 60_000

/**
 * The notices' timer, a twin of the receipts': a run still going is not doubled, the timer keeps no
 * process alive, and a stop cuts the waits short and waits for the rest of the run.
 */
export function startLoginNotices(
  api: MolviaBotClient,
  telegram: Api,
  everyMs = SIGNED_IN_EVERY_MS,
): () => Promise<void> {
  let running: Promise<void> | undefined
  const stopping = new AbortController()
  const tick = (): void => {
    if (running) return
    running = tellSignIns(api, telegram, async (ms) => sleep(ms, stopping.signal)).finally(() => {
      running = undefined
    })
  }
  tick()
  const timer = setInterval(tick, everyMs)
  timer.unref()
  return async () => {
    clearInterval(timer)
    stopping.abort()
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
        await settleUnder(ctx, t(ctx.from.language_code, 'signed_in.ended'))
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
