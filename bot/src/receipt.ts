import { InlineKeyboard } from 'grammy'
import type { Api } from 'grammy'
import { ApiError } from '@molvia/client'
import type { MolviaBotClient } from '@molvia/client'
import type { ReceiptNotice } from '@molvia/model'
import { t } from './i18n'
import { reportDefect } from './failure'
import { Flooded, deliver, sleep } from './deliver'
import type { Wait } from './deliver'

/**
 * «Чек разобран» (MOL-129): the receipts the API handed out — already marked as told — each one
 * message in the receipt's language, with one button straight to the review. The bot keeps nothing:
 * which receipt is told of, and whether at all, is the API's (П-5).
 */

/** «7 позиций», «1 item»: the form by the language's own plural rule. */
function lines(language: string, n: number): string {
  const form = new Intl.PluralRules(language).select(n)
  const key =
    form === 'one'
      ? 'receipt.items.one'
      : form === 'few'
        ? 'receipt.items.few'
        : 'receipt.items.many'
  return t(language, key, { n })
}

/** «4 октября», «4 October»: the receipt's calendar day, without the year. */
function dateOf(language: string, day: string): string {
  return new Intl.DateTimeFormat(language === 'en' ? 'en-GB' : language, {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${day}T12:00:00Z`))
}

/** The words of the message: the place where the review knows it, else the day; never a sum. */
export function receiptText(notice: ReceiptNotice): string {
  const { language, place, day, lineCount, outcome, duplicate } = notice
  if (outcome === 'failed') return t(language, 'receipt.failed', { date: dateOf(language, day) })
  // a second shot of a receipt recorded before: the review says «уже записан» (adversarial А4)
  if (duplicate) {
    return place === null
      ? t(language, 'receipt.duplicate_no_place', { date: dateOf(language, day) })
      : t(language, 'receipt.duplicate', { place })
  }
  const count = lines(language, lineCount)
  return place === null
    ? t(language, 'receipt.parsed_no_place', { date: dateOf(language, day), count })
    : t(language, 'receipt.parsed', { place, count })
}

/** The review of the receipt — the screen «Посмотреть и записать» or «не разобран». */
export function receiptUrl(appUrl: string, receiptId: string): string {
  return `${appUrl.replace(/\/+$/, '')}/purchases/receipts/${receiptId}`
}

/**
 * The message: the words and a URL button to the review. **Telegram refuses an inline button to an
 * `http://` address**, which a copy in development has, so there the link goes as a line of text, as
 * «ещё N ждут» of the reminder does.
 */
export function receiptMessage(
  notice: ReceiptNotice,
  appUrl: string,
): { readonly text: string; readonly keyboard?: InlineKeyboard } {
  const label = t(
    notice.language,
    notice.outcome === 'failed' || notice.duplicate ? 'receipt.open' : 'receipt.view',
  )
  const url = receiptUrl(appUrl, notice.receiptId)
  const text = receiptText(notice)
  return url.startsWith('https://')
    ? { text, keyboard: new InlineKeyboard().url(label, url) }
    : { text: `${text}\n\n${label}: ${url}` }
}

/**
 * Asks the API which receipts to tell of and sends them, one message each — a 429 waited out once, a
 * block turning the person's reminders off, as `deliver` does for the reminder. A message lost here
 * is not handed out again: at most once (MOL-101 Р-2).
 */
export async function tellReceipts(
  api: MolviaBotClient,
  telegram: Api,
  appUrl: string,
  wait: Wait = async (ms) => sleep(ms),
): Promise<void> {
  let due: ReceiptNotice[]
  try {
    // Never cut short by a stop: the API marks what it hands out, so a claim given up on midway
    // loses those receipts' messages — its own thirty seconds are the bound.
    due = (await api.claimReceiptNotices()).notices
  } catch (error) {
    console.error(
      `[molvia] receipt claim: ${error instanceof ApiError ? error.code : 'unexpected failure'}`,
    )
    reportDefect(api, error, 'receipt:claim')
    return
  }
  for (const [index, notice] of due.entries()) {
    const { text, keyboard } = receiptMessage(notice, appUrl)
    const message = async () =>
      telegram.sendMessage(notice.telegramUserId, text, {
        ...(keyboard ? { reply_markup: keyboard } : {}),
        disable_notification: notice.silent,
      })
    try {
      await deliver(api, notice.telegramUserId, message, wait, 'receipt')
    } catch (error) {
      if (!(error instanceof Flooded)) throw error
      console.error(`[molvia] receipt: 429 flood, ${String(due.length - index)} receipts given up`)
      return
    }
  }
}

/** How often the bot asks: a receipt read half a minute ago is told of within the next minute. */
export const RECEIPTS_EVERY_MS = 60_000

/**
 * The receipts' timer, a twin of the reminders': a run still going is not doubled, the timer keeps
 * no process alive, and a stop cuts the waits short and waits for the rest of the run.
 */
export function startReceiptNotices(
  api: MolviaBotClient,
  telegram: Api,
  appUrl: string,
  everyMs = RECEIPTS_EVERY_MS,
): () => Promise<void> {
  let running: Promise<void> | undefined
  const stopping = new AbortController()
  const tick = (): void => {
    if (running) return
    running = tellReceipts(api, telegram, appUrl, async (ms) => sleep(ms, stopping.signal)).finally(
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
