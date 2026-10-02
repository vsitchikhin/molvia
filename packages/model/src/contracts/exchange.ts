import { z } from 'zod'
import { deviceIdSchema, isoDate } from './trip'
import {
  exchangeDaySchema,
  exchangeNoteSchema,
  isPlausibleExchange,
  lostCostReasonSchema,
  walletBasisSchema,
} from '#model/entities/exchange'
import type { RateChart, RateChartPeriod } from '#model/entities/exchange-rate-chart'
import { CHART_LEVEL } from '#model/entities/money-charts'
import type { ExchangeLosses } from '#model/entities/money-charts'
import { ERROR, ISSUE } from '#model/support/errors'
import { currencySchema, moneyCodec, signedMoneyCodec } from '#model/values/money'
import type { Money } from '#model/values/money'
import { rateCodec, rateProviderSchema } from '#model/values/rates'
import {
  exchangeChannelSchema,
  marketChannelSchema,
  marketSideSchema,
} from '#model/values/market-rates'

/**
 * Which rate a new trip takes (MOL-40, В-3): `personal` — the person's own when they have an
 * exchange of the pair, and the official one otherwise — or always `official`. Nothing is ever
 * required of the person: without exchanges the two are the same answer.
 */
export const ratePreferenceSchema = z.enum(['personal', 'official'])
export type RatePreference = z.infer<typeof ratePreferenceSchema>

export const ratePreferenceBodySchema = z.strictObject({ preference: ratePreferenceSchema })
export type RatePreferenceBody = z.infer<typeof ratePreferenceBodySchema>

export const positiveMoneyCodec = moneyCodec.refine((value) => value.minor > 0n, {
  error: ERROR.INVALID_AMOUNT,
})

/** What an exchange says, as the screen sends it — the same whether it is recorded or amended. */
const exchangeFields = {
  given: positiveMoneyCodec,
  received: positiveMoneyCodec,
  exchangedOn: exchangeDaySchema,
  heldBefore: moneyCodec.optional(),
  note: exchangeNoteSchema.optional(),
  /**
   * How the money was changed (MOL-137, В-1); null says «not said». Left out — a screen older than
   * the field — it is kept by an amendment and matches anything in a repeat, as an account is.
   */
  channel: exchangeChannelSchema.nullable().optional(),
  /** The accounts each side left and landed on (MOL-115); left out of an amendment, kept (Р-26). */
  givenAccountId: z
    .uuid()
    .overwrite((id) => id.toLowerCase())
    .nullable()
    .optional(),
  receivedAccountId: z
    .uuid()
    .overwrite((id) => id.toLowerCase())
    .nullable()
    .optional(),
}

interface ExchangeFields {
  readonly given: Money
  readonly received: Money
  readonly heldBefore?: Money | undefined
}

/** The rules of one exchange, held by both bodies and said under the field they are about. */
function withExchangeRules<Schema extends z.ZodType<ExchangeFields>>(schema: Schema) {
  return schema
    .refine(({ given, received }) => given.currency !== received.currency, {
      error: ISSUE.EXCHANGE_SAME_CURRENCY,
      path: ['received'],
    })
    .refine(({ given, received }) => isPlausibleExchange(given, received), {
      error: ERROR.INVALID_RATE,
      path: ['received'],
    })
    .refine(
      ({ heldBefore, received }) =>
        heldBefore === undefined || heldBefore.currency === received.currency,
      { error: ISSUE.EXCHANGE_HELD_NOT_RECEIVED, path: ['heldBefore'] },
    )
}

/**
 * «Записать обмен». Named by the device, as a trip is, so a tap sent twice is one exchange. The
 * day is the person's; «not after today» is the use case's, which has the clock.
 */
export const exchangeBodySchema = withExchangeRules(
  z.strictObject({ id: deviceIdSchema, ...exchangeFields }),
)
export type ExchangeBody = z.infer<typeof exchangeBodySchema>

/**
 * «Сохранить правку» (MOL-42, В-3): the exchange whole as it should now be, and the version it was
 * amended over — so an amendment made on another phone in between is a conflict rather than lost,
 * as the settings form of MOL-65 is. Whatever is left out is cleared, as in a new exchange.
 */
export const exchangeAmendBodySchema = withExchangeRules(
  z.strictObject({ revision: z.int().min(1), ...exchangeFields }),
)
export type ExchangeAmendBody = z.infer<typeof exchangeAmendBodySchema>

/**
 * One channel's market figure beside an exchange: the rate as the currency in drams on its own day,
 * the row it came from (`basis`, В-2), and how much more — below zero, less — the exchange gave in
 * the received currency than that figure would have.
 */
const marketQuoteCodec = z.strictObject({
  channel: exchangeChannelSchema,
  basis: marketChannelSchema,
  rate: rateCodec,
  difference: signedMoneyCodec,
})

/**
 * One currency of «Курсы по данным ЦБ РА» (MOL-137, В-1): the official rate against the dram, and
 * each channel's latest figures on both sides, each dated by its own rate — the exchange offices
 * come a week or two late. `best…` marks the best of the fresh ones for the person, so the phone
 * compares nothing.
 */
export const marketTodayCodec = z.strictObject({
  currency: currencySchema,
  official: rateCodec.nullable(),
  quotes: z.array(
    z.strictObject({
      channel: exchangeChannelSchema,
      basis: marketChannelSchema,
      buys: rateCodec.nullable(),
      sells: rateCodec.nullable(),
      bestBuys: z.boolean(),
      bestSells: z.boolean(),
    }),
  ),
})
export type MarketToday = z.output<typeof marketTodayCodec>

/**
 * One exchange as the screen lists it. Its own rate and the comparison with the central bank are
 * the server's: the phone divides nothing (CLAUDE.md, «No business logic on the frontend»).
 */
export const exchangeViewCodec = z.strictObject({
  id: z.uuid(),
  exchangedOn: exchangeDaySchema,
  given: moneyCodec,
  received: moneyCodec,
  heldBefore: moneyCodec.nullable(),
  note: z.string().nullable(),
  channel: exchangeChannelSchema.nullable().default(null),
  givenAccountId: z.uuid().nullable().default(null),
  receivedAccountId: z.uuid().nullable().default(null),
  /** The version an amendment names, so one made elsewhere in between is a conflict. */
  revision: z.int().min(1),
  /** When it was last amended, or null — «исправлен 25 сент.» on the row. */
  amendedAt: isoDate.nullable(),
  /** The versions before, newest first: what the sheet of an amendment shows (MOL-42, В-3). */
  history: z.array(
    z.strictObject({
      given: moneyCodec,
      received: moneyCodec,
      exchangedOn: exchangeDaySchema,
      heldBefore: moneyCodec.nullable(),
      note: z.string().nullable(),
      channel: exchangeChannelSchema.nullable().default(null),
      replacedAt: isoDate,
    }),
  ),
  /** Null only for amounts so far apart that no rate within the band says them. */
  rate: rateCodec.nullable(),
  /**
   * The official rate of the pair on the exchange's day, who published it, and how much more —
   * below zero, less — the exchange gave in the received currency. Null when the cache has no
   * rate for that pair on or before that day: the exchange stands without a comparison.
   */
  official: z
    .strictObject({
      rate: rateCodec,
      provider: rateProviderSchema,
      difference: signedMoneyCodec,
    })
    .nullable(),
  /**
   * The official rate of that day jumped and there is nothing before it to measure by: no
   * comparison, and the screen says the bank's number of that day is in doubt (review С-5).
   */
  officialDoubtful: z.boolean(),
  /**
   * The market of the exchange's day (MOL-137): the best figure of the channels a person can name,
   * on the side the exchange was (`bestQuote`), and the exchange's own channel when it was named and
   * is not the best. `exchangersPending`: the exchange offices of that day are still to come (В-3).
   * Null for a pair without the dram (В-4) and for a day with no market figure at all.
   */
  market: z
    .strictObject({
      best: marketQuoteCodec,
      own: marketQuoteCodec.nullable(),
      exchangersPending: z.boolean(),
    })
    .nullable()
    .default(null),
})
export type ExchangeView = z.output<typeof exchangeViewCodec>

/**
 * Money that came in — an exchange or an income (MOL-66) — as the sheets need it to decide whether
 * to ask «сколько было до»: into which currency, on which day, and whether it gave that currency a
 * known cost. Only the whole walk knows the last: a chain made before a change of the currency of
 * conversion counts, a link of the old reckoning does not (MOL-42, round 3, П-1, М1). The phone does
 * not re-derive it. Newest first, as the walk would meet them last.
 */
export const receiptCodec = z.strictObject({
  id: z.uuid(),
  currency: currencySchema,
  on: exchangeDaySchema,
  priced: z.boolean(),
})
export type ReceiptView = z.output<typeof receiptCodec>

/**
 * A hint for «сколько было до»: what is left of a currency by the recorded spending and exchanges,
 * whether that is everything held (`whole`) or only the money of the last receipt, whose remainder
 * before it was never said — and whether that receipt was an exchange or an income (MOL-66), so the
 * sheet names the right one.
 */
export const heldEstimateCodec = z.strictObject({
  held: moneyCodec,
  whole: z.boolean(),
  from: z.enum(['exchange', 'income']),
})

const currencyCostCodec = z.strictObject({
  rate: rateCodec,
  basis: walletBasisSchema,
  estimated: z.boolean(),
})

/**
 * The exchanges of twelve months by exchanger, worst first (MOL-74): what each place gave more — or
 * less — than the measure, in the spending currency. Against the central bank on «Графики», against
 * the market on «Обмен денег» (MOL-152, in MOL-159).
 */
export const exchangeLossesCodec = z.strictObject({
  total: signedMoneyCodec,
  uncounted: z.int().min(0),
  groups: z.array(
    z.strictObject({
      place: z.string().nullable(),
      count: z.int().min(1),
      difference: signedMoneyCodec,
      /** Hundredths of a percent: −721 is «−7,21 %». */
      percent: z.int(),
      level: z.int().min(-CHART_LEVEL).max(CHART_LEVEL),
    }),
  ),
})
export type ExchangeLossesView = z.output<typeof exchangeLossesCodec>

/** The losses as they go on the wire. */
export function exchangeLossesViewOf(losses: ExchangeLosses): ExchangeLossesView {
  return {
    total: losses.total,
    uncounted: losses.uncounted,
    groups: losses.groups.map((group) => ({ ...group })),
  }
}

const chartLevel = z.int().min(0).max(CHART_LEVEL)

/**
 * One period of a pair (MOL-168): the market of all bank clients at every step — a day of the month,
 * the end of a week of half a year and of the year — the person's exchanges on the line's side with
 * their percent and the market they were measured by, and the ticks of the axis of its own figures.
 */
const ratePeriodCodec = z.strictObject({
  step: z.enum(['day', 'week']),
  steps: z.array(
    z.strictObject({
      day: exchangeDaySchema,
      rate: rateCodec.nullable(),
      x: chartLevel,
      level: chartLevel.nullable(),
    }),
  ),
  exchanges: z.array(
    z.strictObject({
      id: z.uuid(),
      day: exchangeDaySchema,
      step: z.int().min(0),
      x: chartLevel,
      rate: rateCodec,
      level: chartLevel,
      place: z.string().nullable(),
      /** Hundredths of a percent: −40 is «−0,40 %». */
      percent: z.int().nullable(),
      market: z
        .strictObject({ rate: rateCodec, level: chartLevel, basis: marketChannelSchema })
        .nullable(),
    }),
  ),
  levels: z
    .array(z.strictObject({ rate: rateCodec, level: chartLevel }))
    .min(1)
    .max(3),
})

/**
 * «Курс рубля за месяц, 6 и 12 месяцев» (MOL-161, MOL-168): per pair against the dram, each period
 * by its months — all three in one answer, so a change of the period asks the server nothing (Р-2).
 * Null for a month or half a year with no figure of the market while the year has one (Р-6). Every
 * height and position is the server's.
 */
export const exchangeRateChartCodec = z.strictObject({
  pairs: z
    .array(
      z.strictObject({
        currency: currencySchema.exclude(['AMD']),
        side: marketSideSchema,
        periods: z.strictObject({
          1: ratePeriodCodec.nullable(),
          6: ratePeriodCodec.nullable(),
          12: ratePeriodCodec,
        }),
      }),
    )
    .min(1),
})
export type ExchangeRateChartView = z.output<typeof exchangeRateChartCodec>
export type ExchangeRatePeriodView = z.output<typeof ratePeriodCodec>

function ratePeriodViewOf(period: RateChartPeriod): ExchangeRatePeriodView {
  return {
    ...period,
    steps: period.steps.map((step) => ({ ...step })),
    exchanges: period.exchanges.map((point) => ({
      ...point,
      market: point.market && { ...point.market },
    })),
    levels: period.levels.map((level) => ({ ...level })),
  }
}

/** The chart as it goes on the wire. */
export function exchangeRateChartViewOf(chart: RateChart): ExchangeRateChartView {
  return {
    pairs: chart.pairs.map(({ currency, side, periods }) => ({
      currency,
      side,
      periods: {
        1: periods[1] && ratePeriodViewOf(periods[1]),
        6: periods[6] && ratePeriodViewOf(periods[6]),
        12: ratePeriodViewOf(periods[12]),
      },
    })),
  }
}

/**
 * «Обмен денег» whole: the preference, the pair a trip would convert by today — the currency of
 * conversion into the spending one, or null when the two are one — the wallet of that pair, what
 * the other currencies held by exchange cost, the hints for the next exchange into each, and the
 * exchanges, newest first.
 */
export const exchangesResponseCodec = z.strictObject({
  preference: ratePreferenceSchema,
  pair: z.strictObject({ base: currencySchema, quote: currencySchema }).nullable(),
  /**
   * `estimated`: part of the cost was never named by the person and was taken from the official
   * rate of an exchange's day — dollars brought from home, say (MOL-42, В-1).
   */
  wallet: currencyCostCodec.nullable(),
  /**
   * What one unit of every other currency held by exchange cost in the currency of conversion —
   * the dollars a chain of roubles to dollars to drams went through, as «89,04 ₽/$» — so the chain
   * can be checked by eye (MOL-42, Р-4). Neither the currency of conversion nor the spending one
   * is here.
   */
  costs: z.array(currencyCostCodec),
  /**
   * Why there is no wallet although the spending currency came in: the exchange or income its
   * cost was lost on — `given` is null for an income (MOL-66) — and why: money of no known price
   * with no fresh official rate of that day (`noRate`), or money of the reckoning before the last
   * change of the currency of conversion (`oldReckoning`). Null when there is a wallet, or nothing
   * of the spending currency was ever received (С-4, round 4 Н1).
   */
  walletUnknown: z
    .strictObject({
      on: exchangeDaySchema,
      given: currencySchema.nullable(),
      reason: lostCostReasonSchema,
    })
    .nullable(),
  /**
   * The hints for the next exchange into each currency but the one of conversion: what is left
   * by the recorded spending and exchanges, and whether that is everything held (`whole`) or only
   * the money of the last exchange, whose remainder before it was never said.
   */
  heldEstimates: z.array(heldEstimateCodec),
  /**
   * The day the currency of conversion last changed, or null if it never did: the wallet counts
   * exchanges from that day on, and the ones before it stand in the list as they were (В-2).
   */
  baseSince: exchangeDaySchema.nullable(),
  exchanges: z.array(exchangeViewCodec),
  /** Every exchange and income, for the sheet's «сколько было до обмена» (see `receiptCodec`). */
  receipts: z.array(receiptCodec),
  /** «Курсы по данным ЦБ РА» — the dollar, the euro and the rouble (MOL-137, В-1). */
  marketToday: z.array(marketTodayCodec).default([]),
  /**
   * «Обмены против рынка» (MOL-152, in MOL-159): the exchanges of twelve months by place, each
   * against the market of its day — its own channel when named, else the best — as its card sets it.
   * Null — nothing of the twelve months measured: no card. Defaulted so that an answer of the server
   * before it still reads.
   */
  losses: exchangeLossesCodec.nullable().default(null),
  /**
   * «Курс рубля за месяц, 6 и 12 месяцев» (MOL-161, MOL-168): null — no figure of the market in any
   * week of the year, or no pair to draw. Defaulted so that an answer of the server before it still
   * reads.
   */
  rateCharts: exchangeRateChartCodec.nullable().default(null),
  /**
   * The chart of the year alone, as the server before MOL-168 sent it (Р-4): read so that its answer
   * is not refused whole, and never used — a new page against it shows no chart. Goes with the next
   * task of money.
   */
  rateChart: z.unknown().optional(),
})
export type ExchangesResponse = z.output<typeof exchangesResponseCodec>
