/**
 * The rating reminder (MOL-101): the bot asks about a purchase the day after it, and a person who
 * keeps silent is asked less and less, then left alone — the owner's ladder of 29.09.2026. Every
 * day here is the person's own, `YYYY-MM-DD` in their country's zone (`timeZoneOf`).
 */

/** Seven in the evening of the person's day (В-2): whatever was bought yesterday has been tried. */
export const REMINDER_HOUR = 19

/**
 * No reminder from this hour on (Р-4). An API or a bot that was down all evening loses the day
 * rather than send «yesterday» at night; the items wait in «Оценки».
 */
export const REMINDER_LAST_HOUR = 22

/** At most this many items a day, one message each, the freshest first (В-1). */
export const REMINDER_ITEMS = 3

/**
 * Days between the steps of the ladder when nothing was rated in between: step 2 comes three days
 * after step 1, step 3 a week after step 2.
 */
export const REMINDER_STEP_DAYS = [3, 7] as const

/** After an unanswered step 3 the bot keeps silent this many calendar months. */
export const REMINDER_PAUSE_MONTHS = 6

export type ReminderStep = 1 | 2 | 3

/** Where a person stands on the ladder: the last step sent, on which day, and since when it asks. */
export interface ReminderLadder {
  readonly step: ReminderStep
  readonly remindedOn: string
  /** The first day whose purchases this ladder asks about — the day before its step 1. */
  readonly windowFrom: string
}

/** A reminder due today: which step, and the days whose unrated purchases it asks about. */
export interface ReminderPlan {
  readonly step: ReminderStep
  readonly from: string
  readonly to: string
}

/**
 * Which reminder, if any, is due on `today`.
 *
 * - **A rating since the last reminder resets the ladder** (Л-1): any of the person's own, from
 *   the screen or from the bot, and during the pause too (Л-3) — they are back.
 * - **Step 1 asks about yesterday alone**, and only a purchase makes it: no reminder without one.
 * - **Steps 2 and 3 ask about everything since the ladder began** (Л-2), so a purchase made between
 *   two steps waits for the next one instead of starting a reminder of its own — that is the point.
 * - **After step 3 the bot is silent for `REMINDER_PAUSE_MONTHS`**, and then asks only about what
 *   was bought after the pause, never about the purchase of half a year ago.
 *
 * Whether there is anything to ask about is the caller's: a plan over days with no unrated purchase
 * sends nothing.
 */
export function planReminder({
  ladder,
  ratedSince,
  today,
}: {
  readonly ladder: ReminderLadder | null
  readonly ratedSince: boolean
  readonly today: string
}): ReminderPlan | null {
  if (ladder !== null && ladder.remindedOn >= today) return null
  const yesterday = shiftDays(today, -1)
  const firstStep: ReminderPlan = { step: 1, from: yesterday, to: yesterday }
  if (ladder === null || ratedSince) return firstStep

  if (ladder.step === 3) {
    const resume = shiftMonths(ladder.remindedOn, REMINDER_PAUSE_MONTHS)
    return yesterday >= resume ? firstStep : null
  }
  const due = shiftDays(ladder.remindedOn, REMINDER_STEP_DAYS[ladder.step - 1] ?? 0)
  if (today < due) return null
  return { step: ladder.step === 1 ? 2 : 3, from: ladder.windowFrom, to: yesterday }
}

/**
 * The person's day and hour at `now`, in `timeZone`. Through `Intl`, which knows the zones'
 * history — Serbia moves its clock twice a year, and a fixed offset would move the reminder.
 */
export function localClock(now: Date, timeZone: string): { day: string; hour: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((one) => one.type === type)?.value ?? ''
  return {
    day: `${part('year')}-${part('month')}-${part('day')}`,
    hour: Number(part('hour')),
  }
}

/** Whether a reminder may be sent at this hour of the person's day. */
export function isReminderHour(hour: number): boolean {
  return hour >= REMINDER_HOUR && hour < REMINDER_LAST_HOUR
}

/** How many of the person's days lie between a purchase's day and `today`: yesterday is 1. */
export function daysBetween(day: string, today: string): number {
  return Math.round((toUtc(today) - toUtc(day)) / DAY_MS)
}

const DAY_MS = 24 * 60 * 60 * 1000

function toUtc(day: string): number {
  return Date.parse(`${day}T00:00:00.000Z`)
}

function shiftDays(day: string, days: number): string {
  return new Date(toUtc(day) + days * DAY_MS).toISOString().slice(0, 10)
}

/**
 * Calendar months, the last day of a shorter month standing in for a day it lacks — as Postgres
 * adds `interval '6 months'`: the 31st of August and six months is the 28th of February.
 */
function shiftMonths(day: string, months: number): string {
  const [year = 0, month = 1, date = 1] = day.split('-').map(Number)
  const target = new Date(Date.UTC(year, month - 1 + months, 1))
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  target.setUTCDate(Math.min(date, last))
  return target.toISOString().slice(0, 10)
}

/**
 * Why a person's reminders are off (MOL-103); none — they are on, as every account starts.
 * `chosen` — they turned them off themselves, in the settings or under a reminder; `blocked` — they
 * blocked the bot, and Telegram said so. The reason is kept because the two end differently: an
 * unblocked bot turns back on only what blocking turned off (В-1), and the screen says which it is.
 */
export const REMINDERS_OFF = ['chosen', 'blocked'] as const
export type RemindersOff = (typeof REMINDERS_OFF)[number]

/**
 * What can happen to the switch: turned off or on by the person, the bot blocked or unblocked.
 * `off` and `on` come from the settings or from the buttons under a reminder; the other two only
 * from Telegram.
 */
export const REMINDER_SWITCHES = ['off', 'on', 'blocked', 'unblocked'] as const
export type ReminderSwitch = (typeof REMINDER_SWITCHES)[number]

/**
 * Where a switch leaves the person's reminders (MOL-103). The person's own word wins both ways:
 * blocking does not make «chosen» into «blocked», and unblocking turns on only what blocking
 * turned off — someone who said «не напоминать» and later unblocked the bot to sign in is still
 * not reminded (В-1).
 */
export function switchReminders(
  current: RemindersOff | null,
  change: ReminderSwitch,
): RemindersOff | null {
  switch (change) {
    case 'off':
      return 'chosen'
    case 'on':
      return null
    case 'blocked':
      return current ?? 'blocked'
    case 'unblocked':
      return current === 'blocked' ? null : current
  }
}
