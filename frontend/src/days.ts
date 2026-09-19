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

const DAY_MS = 86_400_000

// Local midnight, so the difference counts calendar days; `round` absorbs the hour a change to
// or from summer time adds or takes away.
function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}
