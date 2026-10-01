import { previousMonth } from '@molvia/model'
import { monthOf } from '@/days'

/**
 * The words of «Графики» (MOL-74): months and percents as the handoff prints them. Presentation
 * only — every figure behind them is the server's.
 */

/** The minus of a figure — U+2212, never the hyphen `Intl` prints (handoff 06). */
const MINUS = '−'

/** «Сентябрь 2026» — the month of a reading. */
export function longMonth(month: string, locale: string): string {
  const text = monthOf(month, locale)
  return text.charAt(0).toLocaleUpperCase(locale) + text.slice(1)
}

/** «апр», «сен» — under a bar: three letters, as the handoff has them, whatever `Intl` shortens to. */
export function shortMonth(month: string, locale: string): string {
  const [year = '', number = ''] = month.split('-')
  return new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' })
    .format(new Date(Date.UTC(Number(year), Number(number) - 1, 1)))
    .replace(/\.$/, '')
    .slice(0, 3)
}

/**
 * A signed percent: «−8 %» from −8 whole, «−7,21 %» from −721 hundredths. Zero has no sign; any
 * other change always carries one, since «8 %» beside a month does not say which way.
 */
export function signedPercent(value: number, locale: string, hundredths = false): string {
  const digits = hundredths ? 2 : 0
  const text = new Intl.NumberFormat(locale, {
    style: 'percent',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Math.abs(value) / (hundredths ? 10_000 : 100))
  return value < 0 ? `${MINUS}${text}` : value > 0 ? `+${text}` : text
}

/** «−8 % к августу»: how a month compares with the one before it, or null with nothing to compare. */
export function versusPrevious(
  change: number | null,
  month: string,
  locale: string,
  t: (key: string, named?: Record<string, unknown>) => string,
): string | null {
  if (change === null) return null
  return t('spending.vs_previous', {
    percent: signedPercent(change, locale),
    month: t(`spending.month_to.${previousMonth(month).slice(5)}`),
  })
}

/** «сентябрь» — the month's name alone, as it stands in a sentence. */
export function monthName(month: string, locale: string): string {
  const [year = '', number = ''] = month.split('-')
  return new Intl.DateTimeFormat(locale, { month: 'long', timeZone: 'UTC' }).format(
    new Date(Date.UTC(Number(year), Number(number) - 1, 1)),
  )
}

/** «октября» — a month after «с» or «до» (MOL-158): Russian wants the genitive, so it is a key. */
export function monthGenitive(
  month: string,
  t: (key: string, named?: Record<string, unknown>) => string,
): string {
  return t(`spending.month_of.${month.slice(5)}`)
}

/** «январь — август», or «октябрь 2025 — август 2026» when the two are of different years. */
export function monthSpan(from: string, to: string, locale: string): { from: string; to: string } {
  if (from.slice(0, 4) === to.slice(0, 4)) {
    return { from: monthName(from, locale), to: monthName(to, locale) }
  }
  return {
    from: `${monthName(from, locale)} ${from.slice(0, 4)}`,
    to: `${monthName(to, locale)} ${to.slice(0, 4)}`,
  }
}

/**
 * «До сентября закрыт только август»: the closed months before the month shown, named, below the
 * three a usual needs — of that month, never of today, so a past month says the truth too
 * (adversarial Г of MOL-158).
 */
export function closedWords(
  month: string,
  closed: readonly string[],
  locale: string,
  t: (key: string, named?: Record<string, unknown>) => string,
): string {
  const before = monthGenitive(month, t)
  if (closed.length === 0) return t('spending.charts.few_body_none', { month: before })
  const names = new Intl.ListFormat(locale, { type: 'conjunction' }).format(
    closed.map((month) => monthName(month, locale)),
  )
  return t(closed.length === 1 ? 'spending.charts.few_body_one' : 'spending.charts.few_body_many', {
    closed: names,
    month: before,
  })
}
