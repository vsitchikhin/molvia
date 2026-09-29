import { GrammyError, InlineKeyboard } from 'grammy'
import type { Api } from 'grammy'
import { ApiError } from '@molvia/client'
import type { MolviaBotClient } from '@molvia/client'
import type { Reminder, ReminderItem } from '@molvia/model'
import { t } from './i18n'

/**
 * What a button of the scale carries: the item and the digit — and never whose verdict it is.
 * That is `ctx.from.id`, Telegram's word for who pressed, so a message forwarded to someone else
 * rates for them, never for the person it was sent to. 43 bytes of Telegram's 64.
 */
const PREFIX = 'rate:'
export const SCALE_DATA = new RegExp(`^${PREFIX}([0-9a-f-]{36}):([1-5])$`)

/** The scale 1–5 under an item, with the digit already pressed marked. */
export function scale(itemId: string, pressed?: number): InlineKeyboard {
  const keyboard = new InlineKeyboard()
  for (const score of [1, 2, 3, 4, 5]) {
    keyboard.text(
      score === pressed ? `${String(score)} ✓` : String(score),
      `${PREFIX}${itemId}:${String(score)}`,
    )
  }
  return keyboard
}

/**
 * The words of one message (MOL-101): when and where, the item, the scale's meaning — and under
 * the last one of the day, how many more wait in «Оценки». Always Russian (Р-7): the reminder is
 * sent without an update, and the person's language is not something we keep.
 */
export function reminderText(item: ReminderItem, more: number, appUrl: string): string {
  const when =
    item.daysAgo === 1
      ? t(undefined, 'remind.yesterday')
      : item.daysAgo === 2
        ? t(undefined, 'remind.dayBefore')
        : t(undefined, 'remind.daysAgo', { n: item.daysAgo })
  const question = t(undefined, 'remind.question', {
    when,
    place: item.placeName,
    name: item.name,
  })
  return more > 0
    ? `${question}\n\n${t(undefined, 'remind.more', { n: more, url: `${appUrl.replace(/\/+$/, '')}/verdicts` })}`
    : question
}

/**
 * The longest a 429 is waited out (review Т-4). Telegram names the wait in `retry_after`; a wait
 * longer than this is flood control over the whole bot, and a retry before it ends is refused for
 * certain — so the run stops there instead (adversarial З). A stop on deploy has thirty seconds
 * (`stop_grace_period`), and the rest of the evening's messages are still to go.
 */
export const RETRY_AFTER_CAP_SECONDS = 10

/** Waits `ms`; `false` when a stop cut the wait short. */
export type Wait = (ms: number) => Promise<boolean>

/** Telegram asked for longer than we wait: every message after this one would be refused too. */
class Flooded extends Error {}

/**
 * One reminder: a message an item, the freshest first (В-1). Only the first one rings; the others
 * arrive silently, so an evening of three questions is one notification.
 *
 * A failure is logged by its code and nothing else — no chat, no name (the privacy page). The
 * reminder is already marked as sent by the API (Р-2), so what fails here is not claimed again:
 * **Too Many Requests (429) is waited out once**, as Telegram asks, since at 19:00 everybody in
 * Armenia is one batch — unless it asks for longer than `RETRY_AFTER_CAP_SECONDS`, which ends the
 * run (`Flooded`), or a stop cuts the wait short, which gives that message up. Anything else is
 * given up. Blocked (403) ends this person's messages: the next ones would fail the same way.
 * Turning the reminders off for them is MOL-103.
 */
async function send(telegram: Api, reminder: Reminder, appUrl: string, wait: Wait): Promise<void> {
  const { telegramUserId, items, total } = reminder
  for (const [index, item] of items.entries()) {
    const more = index === items.length - 1 ? total - items.length : 0
    const message = async () =>
      telegram.sendMessage(telegramUserId, reminderText(item, more, appUrl), {
        reply_markup: scale(item.itemId),
        disable_notification: index > 0,
      })
    try {
      try {
        await message()
      } catch (error) {
        if (!(error instanceof GrammyError) || error.error_code !== 429) throw error
        const seconds = error.parameters.retry_after ?? 1
        if (seconds > RETRY_AFTER_CAP_SECONDS) throw new Flooded()
        if (!(await wait(seconds * 1000))) throw error
        await message()
      }
    } catch (error) {
      if (error instanceof Flooded) throw error
      const code = error instanceof GrammyError ? String(error.error_code) : 'unexpected failure'
      console.error(`[molvia] remind: ${code}`)
      if (error instanceof GrammyError && error.error_code === 403) return
    }
  }
}

/** Asks the API what is due and sends it — one claim, everybody in it. */
export async function remindDue(
  api: MolviaBotClient,
  telegram: Api,
  appUrl: string,
  wait: Wait = async (ms) => sleep(ms),
): Promise<void> {
  let due: Reminder[]
  try {
    due = (await api.claimReminders()).reminders
  } catch (error) {
    console.error(
      `[molvia] remind claim: ${error instanceof ApiError ? error.code : 'unexpected failure'}`,
    )
    return
  }
  for (const [index, reminder] of due.entries()) {
    try {
      await send(telegram, reminder, appUrl, wait)
    } catch (error) {
      if (!(error instanceof Flooded)) throw error
      // The rest of the run would be refused the same way: given up at once, and said how many.
      console.error(`[molvia] remind: 429 flood, ${String(due.length - index)} people given up`)
      return
    }
  }
}

/** Waits `ms`, or less if `signal` aborts first: `true` for the whole wait, `false` for a cut. */
async function sleep(ms: number, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) return false
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', cut)
      resolve(true)
    }, ms)
    const cut = (): void => {
      clearTimeout(timer)
      resolve(false)
    }
    signal?.addEventListener('abort', cut, { once: true })
  })
}

/** How often the bot asks: the API decides whose evening it is, to the minute. */
export const REMIND_EVERY_MS = 60_000

/**
 * The bot's only timer, and it keeps nothing (MOL-101): every minute it asks the API, which has
 * already decided and marked who is due. A run still going when the next is due is not doubled.
 * Unreferenced, so it never keeps a process alive that is otherwise done; the returned function
 * stops it, cuts the run's waits short and waits for the rest of it.
 */
export function startReminders(
  api: MolviaBotClient,
  telegram: Api,
  appUrl: string,
  everyMs = REMIND_EVERY_MS,
): () => Promise<void> {
  let running: Promise<void> | undefined
  // A stop cuts every wait short (adversarial З): the messages left are sent at once, without the
  // pauses, and the process stops inside its `stop_grace_period` instead of being killed in one.
  const stopping = new AbortController()
  const tick = (): void => {
    if (running) return
    running = remindDue(api, telegram, appUrl, async (ms) => sleep(ms, stopping.signal)).finally(
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
