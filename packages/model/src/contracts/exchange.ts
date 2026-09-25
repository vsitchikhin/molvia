import { z } from 'zod'
import { deviceIdSchema, isoDate } from './trip'
import {
  exchangeDaySchema,
  exchangeNoteSchema,
  isPlausibleExchange,
  lostCostReasonSchema,
  walletBasisSchema,
} from '#model/entities/exchange'
import { ERROR, ISSUE } from '#model/support/errors'
import { currencySchema, moneyCodec, signedMoneyCodec } from '#model/values/money'
import type { Money } from '#model/values/money'
import { rateCodec, rateProviderSchema } from '#model/values/rates'

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
})
export type ExchangesResponse = z.output<typeof exchangesResponseCodec>
