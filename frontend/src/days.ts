/**
 * The day a purchase is named by on the verdict card: «сегодня», «вчера», otherwise the date —
 * «12 сент.» (MOL-28, Р-6). By the calendar of the phone, not by 24-hour spans: bought at 23:50
 * and asked at 00:10 is «yesterday» to a person, however few minutes passed.
 *
 * Counted from `today`, the screen's day (`useLocalDay`), and never from the clock (MOL-329): read where
 * the words were drawn, the clock made each word of a screen as old as its last redraw — after midnight a
 * strip redrawn by «Повторить» said «вчера» over a row still «сегодня» (adversarial А4).
 *
 * Presentation, not a rule: the words come from `Intl` in the app's language, and the caps of
 * the card are a style, never the text.
 */
export function purchaseDay(when: Date, locale: string, today: string): string {
  // Never in the future: a phone whose clock lags the server's would call today's purchase by
  // its date (self-review С-7).
  const days = Math.max(0, daysBetween(when, today))
  if (days === 0 || days === 1) {
    return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(-days, 'day')
  }
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(when)
}

/**
 * The same day, with the year when it is not this one (MOL-57, self-review С-5): a session lives
 * for as long as it is used, so «вошли 12 сент.» may be a September of another year. Only where a
 * date can be that old — a purchase card is never older than its trip, but one waiting for its rating may be
 * (MOL-329, adversarial Е1).
 */
export function dayOfAnyYear(when: Date, locale: string, today: string): string {
  // «Вчера» beats the year: 31 December seen on 1 January is yesterday, whatever the calendar.
  if (sameYear(when, today) || daysBetween(when, today) <= 1)
    return purchaseDay(when, locale, today)
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(when)
}

/**
 * A day as a date always, the year only when not this one: «19 сент.», never «вчера» — for a sentence
 * that puts its own word before the day, «Раньше 19 сент. — со связью» (MOL-204, Р-9), where «Раньше
 * вчера» is no Russian. The month is short unless a sentence wants it whole — «убран из выбора 21 сентября
 * 2025 г.» (MOL-329, adversarial А5: a moment kept for good printed by `Intl` in place had no year).
 */
export function dateOfAnyYear(
  when: Date,
  locale: string,
  today: string,
  month: 'short' | 'long' = 'short',
): string {
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month,
    ...(sameYear(when, today) ? {} : { year: 'numeric' }),
  }).format(when)
}

/**
 * The clock beside that day: «21:40» (MOL-32). The age of a remembered answer is named
 * exactly — «вчера в 21:40» is what a person judges by, while «данные могут быть неактуальны»
 * says nothing — and the two halves travel as separate placeholders because the word between
 * them is a word of the language, not of the code.
 */
export function timeOfDay(when: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(when)
}

/**
 * When the answer on screen came — «сегодня, 14:05», «14 окт., 14:05», «30 окт. 2025 г., 10:05» — for the strip of the
 * connection (MOL-181). Counted from the screen's day (`useLocalDay`), which moves when the app comes back
 * into view (adversarial А2 of MOL-187) and at midnight with the screen in view (MOL-329) — so a redraw past
 * midnight says what every other word of the screen says (MOL-187's Б2 read the clock here, and a strip
 * redrawn alone said «вчера» over rows still «сегодня»). An answer of a day the screen has not reached yet is
 * today's.
 */
export function answeredAt(at: Date, locale: string, today: string): string {
  // With its year when another: a memory may be that old — the settings' moment moves only with an
  // answer (MOL-215, adversarial Б2), and a kept month may be read last a year ago.
  return `${dayOfAnyYear(at, locale, today)}, ${timeOfDay(at, locale)}`
}

/**
 * A month: «сентябрь 2026» from `2026-09`. The month and the year only — `Intl` adds «г.» to the
 * Russian year, which the caption does not need. Given the day it is shown on (`today`), the year of
 * that day is left out — «сентябрь», «декабрь 2025» — as the months of «Доходы» are captioned (MOL-188,
 * В-2 «а»): a journal goes back across years, and only another year needs saying.
 */
export function monthOf(month: string, locale: string, today?: string): string {
  const [year = '', number = ''] = month.split('-')
  const parts = new Intl.DateTimeFormat(locale, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).formatToParts(new Date(Date.UTC(Number(year), Number(number) - 1, 1)))
  const part = (type: string) => parts.find((one) => one.type === type)?.value ?? ''
  if (today?.slice(0, 4) === year) return part('month')
  return `${part('month')} ${part('year')}`
}

const DAY_MS = 86_400_000

// Local midnight, so the difference counts calendar days; `round` absorbs the hour a change to
// or from summer time adds or takes away.
function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

/** Calendar days from the moment's day to `today`, a day of the phone's calendar. */
function daysBetween(when: Date, today: string): number {
  const [year = 0, month = 1, date = 1] = today.split('-').map(Number)
  const midnight = new Date(2000, month - 1, date)
  // `setFullYear`, since the constructor reads a year under 100 as 19xx (a clock at year 1, MOL-121).
  midnight.setFullYear(year)
  return Math.round((midnight.getTime() - startOfDay(when)) / DAY_MS)
}

function sameYear(when: Date, today: string): boolean {
  return when.getFullYear() === Number(today.slice(0, 4))
}

/**
 * A day of Yerevan's calendar — `2026-09-26`, the way spendings, trips and rates are dated — in
 * words: «26 сентября», «Сб, 26 сентября» with a weekday. Printed as that calendar day in UTC, never
 * as a moment in the phone's zone: Yerevan's midnight is the evening before in Moscow, and every
 * date west of UTC+4 came out a day early (review Т-1).
 */
export function calendarDay(
  day: string,
  locale: string,
  options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long' },
): string {
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }).format(utcDay(day))
}

/**
 * A calendar day short, the year only when not this one's: «23 окт.», «26 окт. 2023 г.» — a date read off a receipt
 * may be of any year, and a year left out hid one three years back (MOL-305). In the form a place prints its day by
 * (`options`) — a sheet's own day has no caption of a month over it to say the year (MOL-329, adversarial Ж1).
 */
export function calendarDayOfAnyYear(
  day: string,
  locale: string,
  today: string,
  options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' },
): string {
  return calendarDay(day, locale, {
    ...options,
    ...(day.slice(0, 4) === today.slice(0, 4) ? {} : { year: 'numeric' }),
  })
}

/** The day `by` days from `day` in the same calendar — «yesterday» of a Yerevan day. */
export function shiftDay(day: string, by: number): string {
  const moved = utcDay(day)
  moved.setUTCDate(moved.getUTCDate() + by)
  return moved.toISOString().slice(0, 10)
}

/**
 * Today on this phone's calendar, `2026-09-28` — the day a new spending, exchange or income is
 * written on and the one «сегодня» is said of (MOL-121, owner's decision В-3). The phone's, not
 * Yerevan's: at 23:30 in Moscow it is still the 28th for the person holding it, whatever the hour in
 * Yerevan. The server takes any day that has come somewhere (`latestDay`); its sums still count by
 * Yerevan's.
 */
export function localDay(now = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const date = String(now.getDate()).padStart(2, '0')
  // Four digits of year, as the wire writes a day: year 1 is `0001`, not `1` (adversarial round 3 С).
  return `${String(now.getFullYear()).padStart(4, '0')}-${month}-${date}`
}

/**
 * A day as a card heads it (MOL-121, В-1): «Сегодня», «Вчера», otherwise «27 сент.» — counted from
 * the phone's today, day against day, never from a moment. It stands alone, so it starts a line.
 */
export function dayWords(day: string, locale: string, today: string): string {
  if (day !== today && day !== shiftDay(today, -1)) {
    return calendarDay(day, locale, { day: 'numeric', month: 'short' })
  }
  const words = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  const text = words.format(day === today ? 0 : -1, 'day')
  return text.charAt(0).toLocaleUpperCase(locale) + text.slice(1)
}

function utcDay(day: string): Date {
  const [year = 0, month = 1, date = 1] = day.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, date))
}
