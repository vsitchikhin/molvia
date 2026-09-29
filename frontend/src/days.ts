/**
 * The day a purchase is named by on the verdict card: «сегодня», «вчера», otherwise the date —
 * «12 сент.» (MOL-28, Р-6). By the calendar of the phone, not by 24-hour spans: bought at 23:50
 * and asked at 00:10 is «yesterday» to a person, however few minutes passed.
 *
 * Presentation, not a rule: the words come from `Intl` in the app's language, and the caps of
 * the card are a style, never the text.
 */
export function purchaseDay(when: Date, locale: string, now = new Date()): string {
  // Never in the future: a phone whose clock lags the server's would call today's purchase by
  // its date (self-review С-7).
  const days = Math.max(0, Math.round((startOfDay(now) - startOfDay(when)) / DAY_MS))
  if (days === 0 || days === 1) {
    return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(-days, 'day')
  }
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(when)
}

/**
 * The same day, with the year when it is not this one (MOL-57, self-review С-5): a session lives
 * for as long as it is used, so «вошли 12 сент.» may be a September of another year. Only where a
 * date can be that old — a purchase card is never older than its trip.
 */
export function dayOfAnyYear(when: Date, locale: string, now = new Date()): string {
  // «Вчера» beats the year: 31 December seen on 1 January is yesterday, whatever the calendar.
  const days = Math.round((startOfDay(now) - startOfDay(when)) / DAY_MS)
  if (when.getFullYear() === now.getFullYear() || days <= 1) return purchaseDay(when, locale, now)
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
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
 * A month of «Доходы» (MOL-66): «сентябрь 2026» from `2026-09`. The month and the year only —
 * `Intl` adds «г.» to the Russian year, which the caption does not need.
 */
export function monthOf(month: string, locale: string): string {
  const [year = '', number = ''] = month.split('-')
  const parts = new Intl.DateTimeFormat(locale, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).formatToParts(new Date(Date.UTC(Number(year), Number(number) - 1, 1)))
  const part = (type: string) => parts.find((one) => one.type === type)?.value ?? ''
  return `${part('month')} ${part('year')}`
}

const DAY_MS = 86_400_000

// Local midnight, so the difference counts calendar days; `round` absorbs the hour a change to
// or from summer time adds or takes away.
function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
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
export function dayWords(day: string, locale: string, today = localDay()): string {
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
