import { z } from 'zod'
import { deviceIdSchema } from './trip'
import { exchangeDaySchema, isPlausibleExchange, walletBasisSchema } from '#model/entities/exchange'
import { ERROR, ISSUE } from '#model/support/errors'
import { currencySchema, moneyCodec, signedMoneyCodec } from '#model/values/money'
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

const positiveMoneyCodec = moneyCodec.refine((value) => value.minor > 0n, {
  error: ERROR.INVALID_AMOUNT,
})

/**
 * «Записать обмен». Named by the device, as a trip is, so a tap sent twice is one exchange. The
 * day is the person's; «not after today» is the use case's, which has the clock.
 */
export const exchangeBodySchema = z
  .strictObject({
    id: deviceIdSchema,
    given: positiveMoneyCodec,
    received: positiveMoneyCodec,
    exchangedOn: exchangeDaySchema,
    heldBefore: moneyCodec.optional(),
  })
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
export type ExchangeBody = z.infer<typeof exchangeBodySchema>

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
   * The hints for the next exchange into each currency but the one of conversion: what is left
   * by the recorded spending and exchanges, and whether that is everything held (`whole`) or only
   * the money of the last exchange, whose remainder before it was never said.
   */
  heldEstimates: z.array(z.strictObject({ held: moneyCodec, whole: z.boolean() })),
  /**
   * The day the currency of conversion last changed, or null if it never did: the wallet counts
   * exchanges from that day on, and the ones before it stand in the list as they were (В-2).
   */
  baseSince: exchangeDaySchema.nullable(),
  exchanges: z.array(exchangeViewCodec),
})
export type ExchangesResponse = z.output<typeof exchangesResponseCodec>
