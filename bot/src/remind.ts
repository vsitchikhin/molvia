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
 * One reminder: a message an item, the freshest first (В-1). Only the first one rings; the others
 * arrive silently, so an evening of three questions is one notification.
 *
 * A failure is logged by its code and nothing else — no chat, no name (the privacy page). The
 * reminder is already marked as sent by the API (Р-2): what failed here is not tried again.
 * Blocked (403) ends this person's messages: the next ones would fail the same way. Turning the
 * reminders off for them is MOL-103.
 */
async function send(telegram: Api, reminder: Reminder, appUrl: string): Promise<void> {
  const { telegramUserId, items, total } = reminder
  for (const [index, item] of items.entries()) {
    const more = index === items.length - 1 ? total - items.length : 0
    try {
      await telegram.sendMessage(telegramUserId, reminderText(item, more, appUrl), {
        reply_markup: scale(item.itemId),
        disable_notification: index > 0,
      })
    } catch (error) {
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
  for (const reminder of due) await send(telegram, reminder, appUrl)
}

/** How often the bot asks: the API decides whose evening it is, to the minute. */
export const REMIND_EVERY_MS = 60_000

/**
 * The bot's only timer, and it keeps nothing (MOL-101): every minute it asks the API, which has
 * already decided and marked who is due. A run still going when the next is due is not doubled.
 * Unreferenced, so it never keeps a process alive that is otherwise done; the returned function
 * stops it and waits for a run in progress.
 */
export function startReminders(
  api: MolviaBotClient,
  telegram: Api,
  appUrl: string,
  everyMs = REMIND_EVERY_MS,
): () => Promise<void> {
  let running: Promise<void> | undefined
  const tick = (): void => {
    if (running) return
    running = remindDue(api, telegram, appUrl).finally(() => {
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
