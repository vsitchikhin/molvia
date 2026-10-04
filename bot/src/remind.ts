import { InlineKeyboard } from 'grammy'
import type { Api } from 'grammy'
import { ApiError } from '@molvia/client'
import type { MolviaBotClient } from '@molvia/client'
import { cityWhereNameRepeats, settingsCityOf } from '@molvia/model'
import type { Reminder, ReminderItem } from '@molvia/model'
import type { InlineKeyboardMarkup } from 'grammy/types'
import { hasMessage, t } from './i18n'
import { reportDefect } from './failure'
import { Flooded, deliver, sleep } from './deliver'
import type { Wait } from './deliver'

/**
 * What a button of the scale carries: the item and the digit — and never whose verdict it is.
 * That is `ctx.from.id`, Telegram's word for who pressed, so a message forwarded to someone else
 * rates for them, never for the person it was sent to. 43 bytes of Telegram's 64.
 */
const PREFIX = 'rate:'
export const SCALE_DATA = new RegExp(`^${PREFIX}([0-9a-f-]{36}):([1-5])$`)

/**
 * The switch under the last reminder of the evening (MOL-103, В-2): «Не напоминать», and once it is
 * pressed, «Вернуть напоминания» in its place (В-3). Only the action travels — whose reminders they
 * are is `ctx.from.id`, as with the scale.
 */
export type Offer = 'off' | 'on'
const SWITCH_PREFIX = 'remind:'
export const SWITCH_DATA = new RegExp(`^${SWITCH_PREFIX}(off|on)$`)

/**
 * The scale 1–5 under an item, with the digit already pressed marked — and under it, on the last
 * message of the evening, the switch it offers. Without an item, the switch alone: a message whose
 * scale could not be read back is still given its other button.
 */
export function scale(itemId: string | undefined, pressed?: number, offer?: Offer): InlineKeyboard {
  const keyboard = new InlineKeyboard()
  if (itemId) {
    for (const score of [1, 2, 3, 4, 5]) {
      keyboard.text(
        score === pressed ? `${String(score)} ✓` : String(score),
        `${PREFIX}${itemId}:${String(score)}`,
      )
    }
  }
  if (offer) {
    if (itemId) keyboard.row()
    keyboard.text(
      t(undefined, offer === 'off' ? 'remind.stop' : 'remind.resume'),
      `${SWITCH_PREFIX}${offer}`,
    )
  }
  return keyboard
}

/**
 * What a reminder's keyboard holds, read back off the message: the bot keeps no state, and
 * Telegram's copy of the message is the only memory there is. A press of one row rebuilds the
 * keyboard whole, so the other row has to be read here or it would be lost (Р-7).
 */
export function keyboardOf(markup: InlineKeyboardMarkup | undefined): {
  readonly itemId?: string
  readonly pressed?: number
  readonly offer?: Offer
} {
  let itemId: string | undefined
  let pressed: number | undefined
  let offer: Offer | undefined
  for (const button of (markup?.inline_keyboard ?? []).flat()) {
    const data = 'callback_data' in button ? button.callback_data : undefined
    const digit = SCALE_DATA.exec(data ?? '')
    if (digit) {
      itemId = digit[1]
      if (button.text.endsWith('✓')) pressed = Number(digit[2])
    }
    const action = SWITCH_DATA.exec(data ?? '')
    if (action) offer = action[1] as Offer
  }
  return {
    ...(itemId ? { itemId } : {}),
    ...(pressed ? { pressed } : {}),
    ...(offer ? { offer } : {}),
  }
}

/**
 * Where each outcome begins in a reminder's text. The text is Telegram's memory of the question
 * (the bot keeps none), so a press finds the earlier outcomes there and replaces its own: the
 * rating's after `✓`, the switch's — which begins with its own 🔕 or 🔔 — after it, and neither
 * erases the other (Р-7). Marks rather than line counts, because the last message of the day carries
 * one more line.
 */
const RATED = '\n\n✓ '
const SWITCHED = /\n\n(?=🔕 |🔔 )/u

export interface ReminderText {
  readonly question: string
  readonly rated?: string
  readonly switched?: string
}

/**
 * The text of the message a press came under, or `null` when Telegram handed it over without one —
 * an `InaccessibleMessage`: then there is nothing to read back, and nothing may be written over it.
 */
export function shownText(message: { readonly text?: string } | undefined): string | null {
  return message?.text ?? null
}

export function readText(text: string): ReminderText {
  const [head = '', switched] = text.split(SWITCHED)
  const [question = '', rated] = head.split(RATED)
  return {
    question,
    ...(rated === undefined ? {} : { rated }),
    ...(switched === undefined ? {} : { switched }),
  }
}

export function writeText({ question, rated, switched }: ReminderText): string {
  const parts = [question]
  if (rated !== undefined) parts.push(`${RATED}${rated}`)
  if (switched !== undefined) parts.push(`\n\n${switched}`)
  return parts.join('').replace(/^\n\n/, '')
}

/**
 * «Ереван Сити в Ереване», or the name alone where `city` is `null` (MOL-120). The case is looked
 * up by the city of the settings the stored spelling folds to — «гюмри» is Gyumri (adversarial А2).
 */
function placeText(name: string, city: string | null): string {
  if (city === null) return name
  const known = settingsCityOf(city)
  const key = `remind.in.${known ?? ''}`
  return known !== null && hasMessage(key)
    ? t(undefined, 'remind.placeIn', { place: name, where: t(undefined, key) })
    : t(undefined, 'remind.placeInBrackets', { place: name, city })
}

/**
 * The words of one message (MOL-101): when and where, the item, the scale's meaning — and under
 * the last one of the day, how many more wait in «Оценки». Always Russian (Р-7): the reminder is
 * sent without an update, and the person's language is not something we keep.
 */
export function reminderText(
  item: ReminderItem,
  more: number,
  appUrl: string,
  city: string | null = null,
): string {
  const when =
    item.daysAgo === 1
      ? t(undefined, 'remind.yesterday')
      : item.daysAgo === 2
        ? t(undefined, 'remind.dayBefore')
        : t(undefined, 'remind.daysAgo', { n: item.daysAgo })
  const question = t(undefined, 'remind.question', {
    when,
    place: placeText(item.placeName, city),
    name: item.name,
  })
  return more > 0
    ? `${question}\n\n${t(undefined, 'remind.more', { n: more, url: `${appUrl.replace(/\/+$/, '')}/verdicts` })}`
    : question
}

/**
 * One reminder: a message an item, the freshest first (В-1). Only the first one rings; the others
 * arrive silently, so an evening of three questions is one notification. «Не напоминать» goes under
 * the last one alone (MOL-103, В-2): one line in the chat, not three.
 *
 * The reminder is already marked as sent by the API (Р-2); how a message is sent — a 429 waited out
 * once, a failure logged by its code, a 403 turning the reminders off — is `deliver`'s. **Blocked
 * ends this person's messages** of the evening.
 */
async function send(
  api: MolviaBotClient,
  telegram: Api,
  reminder: Reminder,
  appUrl: string,
  wait: Wait,
): Promise<void> {
  const { telegramUserId, items, total } = reminder
  // The city of a place, where another item of this reminder names a shop of its name in another
  // city (MOL-120) — the domain's rule, the one «Оценки» reads.
  const cityOf = cityWhereNameRepeats(
    items.map((item) => ({ name: item.placeName, city: item.placeCity })),
  )
  for (const [index, item] of items.entries()) {
    const last = index === items.length - 1
    const more = last ? total - items.length : 0
    const message = async () =>
      telegram.sendMessage(
        telegramUserId,
        reminderText(item, more, appUrl, cityOf({ name: item.placeName, city: item.placeCity })),
        {
          reply_markup: scale(item.itemId, undefined, last ? 'off' : undefined),
          disable_notification: index > 0,
        },
      )
    // a block ends this person's messages: the rest would be refused the same way
    if ((await deliver(api, telegramUserId, message, wait, 'remind')) === 'blocked') return
  }
}

/**
 * Asks the API what is due and sends it — one claim, everybody in it. `claimed` is told the claim
 * went through, an empty one included, before anything is sent: it is the bot's pulse (MOL-142),
 * and it must not wait for an evening's messages.
 */
export async function remindDue(
  api: MolviaBotClient,
  telegram: Api,
  appUrl: string,
  wait: Wait = async (ms) => sleep(ms),
  claimed: () => void = () => undefined,
): Promise<void> {
  let due: Reminder[]
  try {
    due = (await api.claimReminders()).reminders
  } catch (error) {
    console.error(
      `[molvia] remind claim: ${error instanceof ApiError ? error.code : 'unexpected failure'}`,
    )
    reportDefect(api, error, 'remind:claim')
    return
  }
  claimed()
  for (const [index, reminder] of due.entries()) {
    try {
      await send(api, telegram, reminder, appUrl, wait)
    } catch (error) {
      if (!(error instanceof Flooded)) throw error
      // The rest of the run would be refused the same way: given up at once, and said how many.
      console.error(`[molvia] remind: 429 flood, ${String(due.length - index)} people given up`)
      return
    }
  }
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
  claimed: () => void = () => undefined,
): () => Promise<void> {
  let running: Promise<void> | undefined
  // A stop cuts every wait short (adversarial З): the messages left are sent at once, without the
  // pauses, and the process stops inside its `stop_grace_period` instead of being killed in one.
  const stopping = new AbortController()
  const tick = (): void => {
    if (running) return
    running = remindDue(
      api,
      telegram,
      appUrl,
      async (ms) => sleep(ms, stopping.signal),
      claimed,
    ).finally(() => {
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
