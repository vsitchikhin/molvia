import { InlineKeyboard } from 'grammy'
import type { Api } from 'grammy'
import { ApiError } from '@molvia/client'
import type { MolviaBotClient } from '@molvia/client'
import type { SilenceNotice } from '@molvia/model'
import { t } from './i18n'
import { reportDefect } from './failure'
import { Flooded, deliver, sleep } from './deliver'
import type { Wait } from './deliver'

/**
 * The warning before an account is erased for two years of silence (MOL-239): the API picked whom,
 * marked the step and named the day — the bot only sends. Russian, then English, in one message
 * (owner's В-2 «а»): nobody's language is kept, and a warning not understood is data lost.
 */

/** «30 дней», «7 days»: the form by the language's own plural rule. */
function days(language: 'ru' | 'en', n: number): string {
  const form = new Intl.PluralRules(language).select(n)
  const key =
    form === 'one' ? 'silence.days.one' : form === 'few' ? 'silence.days.few' : 'silence.days.many'
  return t(language, key, { n })
}

/** «26 сентября», «26 September»: the day it goes, without the year — it is a month away at most. */
function dateOf(language: 'ru' | 'en', day: string): string {
  return new Intl.DateTimeFormat(language === 'en' ? 'en-GB' : language, {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${day}T12:00:00Z`))
}

/** The words: the Russian, then the English, each with its own date and count. */
export function silenceText(notice: SilenceNotice): string {
  return (['ru', 'en'] as const)
    .map((language) =>
      t(language, 'silence.warn', {
        date: dateOf(language, notice.day),
        days: days(language, notice.days),
      }),
    )
    .join('\n\n')
}

/**
 * The message: the words and a URL button to the app, where the door asks to sign in — named in both
 * languages, as the words are (self-review №3). **Telegram refuses an inline button to an `http://`
 * address**, which a copy in development has, so there the link goes as a line of text, as «чек
 * разобран» does.
 */
export function silenceMessage(
  notice: SilenceNotice,
  appUrl: string,
): { readonly text: string; readonly keyboard?: InlineKeyboard } {
  const label = `${t('ru', 'silence.open')} · ${t('en', 'silence.open')}`
  const url = `${appUrl.replace(/\/+$/, '')}/`
  const text = silenceText(notice)
  return url.startsWith('https://')
    ? { text, keyboard: new InlineKeyboard().url(label, url) }
    : { text: `${text}\n\n${label}: ${url}` }
}

/**
 * Asks the API whom to warn and sends it, one message each — a 429 waited out once, a 403 marking the
 * bot blocked, as `deliver` does for every message. A warning lost here is not handed out again: the
 * account then goes a week after the mark (Р-6), the price of «at most once».
 */
export async function warnSilent(
  api: MolviaBotClient,
  telegram: Api,
  appUrl: string,
  wait: Wait = async (ms) => sleep(ms),
): Promise<void> {
  let due: SilenceNotice[]
  try {
    due = (await api.claimSilenceNotices()).notices
  } catch (error) {
    console.error(
      `[molvia] silence claim: ${error instanceof ApiError ? error.code : 'unexpected failure'}`,
    )
    reportDefect(api, error, 'silence:claim')
    return
  }
  for (const [index, notice] of due.entries()) {
    const { text, keyboard } = silenceMessage(notice, appUrl)
    const message = async () =>
      telegram.sendMessage(notice.telegramUserId, text, {
        ...(keyboard ? { reply_markup: keyboard } : {}),
      })
    try {
      await deliver(api, notice.telegramUserId, message, wait, 'silence')
    } catch (error) {
      if (!(error instanceof Flooded)) throw error
      console.error(`[molvia] silence: 429 flood, ${String(due.length - index)} warnings given up`)
      return
    }
  }
}

/** How often the bot asks: a warning is due by the day, and comes within the minute of its hour. */
export const SILENCE_EVERY_MS = 60_000

/**
 * The warnings' timer, a twin of the receipts': a run still going is not doubled, the timer keeps no
 * process alive, and a stop cuts the waits short and waits for the rest of the run.
 */
export function startSilenceNotices(
  api: MolviaBotClient,
  telegram: Api,
  appUrl: string,
  everyMs = SILENCE_EVERY_MS,
): () => Promise<void> {
  let running: Promise<void> | undefined
  const stopping = new AbortController()
  const tick = (): void => {
    if (running) return
    running = warnSilent(api, telegram, appUrl, async (ms) => sleep(ms, stopping.signal)).finally(
      () => {
        running = undefined
      },
    )
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
