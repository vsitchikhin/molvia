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
