import { useI18n } from 'vue-i18n'
import { formatRate, formatRateBeside, yerevanDate } from '@molvia/model'
import type { ExchangeRate, ExchangeView } from '@molvia/model'
import { asTyped } from '@/components/spending'
import { calendarDay } from '@/days'

/** What the card of an exchange says of the central bank of its day, each part on its own line. */
export interface OfficialWords {
  /** «ЦБ РА на 19 сент.» — or the open source named instead, never beside it (MOL-42, С-6). */
  readonly label: string
  readonly rate: string
  /** «На 1 603,33 ₽ больше, чем по ЦБ РА» — a difference, never a commission (MOL-40, В-3). */
  readonly difference: string
}

export interface ExchangeWords {
  readonly rateOf: (rate: ExchangeRate) => string
  readonly day: (date: string) => string
  readonly dayOf: (exchange: ExchangeView) => string
  readonly moneyOf: (value: ExchangeView['given']) => string
  readonly amountsOf: (exchange: ExchangeView) => string
  readonly rateLineOf: (exchange: ExchangeView) => string
  readonly officialOf: (exchange: ExchangeView) => OfficialWords | null
  readonly noOfficialOf: (exchange: ExchangeView) => string
}

/**
 * The words «Обмен денег» says an exchange in — on its card, in the strip after a removal and in
 * «Удалить обмен?» alike (MOL-81). Every figure is the server's; this only chooses the words.
 */
export function useExchangeWords(): ExchangeWords {
  const { t, locale } = useI18n()

  const rateOf = (rate: ExchangeRate): string => formatRate(rate, locale.value)
  /**
   * A day of Yerevan printed as that calendar day, never as the moment of its midnight — west of
   * UTC+4 every exchange came out a day early, as the spendings of «Деньги» once did (review Т-1 of
   * MOL-82, adversarial Ж).
   */
  const day = (date: string): string =>
    calendarDay(date, locale.value, { day: 'numeric', month: 'short' })
  const dayOf = (exchange: ExchangeView): string => day(exchange.exchangedOn)
  /** Amounts as they were typed, as everywhere in «Деньги» (owner's decision В-1). */
  const moneyOf = (value: ExchangeView['given']): string => asTyped(value, locale.value)

  function amountsOf(exchange: ExchangeView): string {
    return t('exchange.row_amounts', {
      given: moneyOf(exchange.given),
      received: moneyOf(exchange.received),
    })
  }

  /** The day and the rate it was made at — the day alone for amounts no rate in the band says. */
  function rateLineOf(exchange: ExchangeView): string {
    const date = dayOf(exchange)
    return exchange.rate ? t('exchange.row_rate', { date, rate: rateOf(exchange.rate) }) : date
  }

  function officialOf(exchange: ExchangeView): OfficialWords | null {
    const official = exchange.official
    if (!official) return null
    const minor = official.difference.minor
    // A name to stand at the head of a line and after «the» alike (adversarial Е).
    const source = t(`exchange.card_source_${official.provider}`)
    const words = {
      amount: moneyOf({ ...official.difference, minor: minor < 0n ? -minor : minor }),
      source,
    }
    const bank = official.provider === 'cba'
    const key = minor > 0n ? 'more' : minor < 0n ? 'less' : 'equal'
    return {
      label: t('exchange.card_official', { source, date: day(yerevanDate(official.rate.asOf)) }),
      // On the side of the exchange's own rate above it, even under one (adversarial Г).
      rate: exchange.rate
        ? formatRateBeside(official.rate, exchange.rate, locale.value)
        : rateOf(official.rate),
      difference: t(`exchange.card_${key}${bank ? '' : '_other'}`, words),
    }
  }

  /** Why there is nothing to compare with — no rate of that day, or one in doubt (MOL-40, С-5). */
  function noOfficialOf(exchange: ExchangeView): string {
    return t(exchange.officialDoubtful ? 'exchange.card_doubtful' : 'exchange.card_no_official')
  }

  return { rateOf, day, dayOf, moneyOf, amountsOf, rateLineOf, officialOf, noOfficialOf }
}
