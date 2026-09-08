import { z } from 'zod'
import { decimalFromScaled, scaledFromDecimal } from './decimal'
import { DomainError, ERROR } from './errors'
import { currencySchema } from './money'

/** Six digits: enough for a rate quoted to fractions of a dram, and still an integer. */
export const RATE_DIGITS = 6
export const RATE_SCALE = 1_000_000n

/**
 * Where the number came from. Both exist in 0.1: the official one answers "what is it
 * worth", the personal one answers "what did I actually change money at", and only the
 * second matches what the person counts in their head.
 */
export const rateSourceSchema = z.enum(['personal', 'official'])
export type RateSource = z.infer<typeof rateSourceSchema>

export const exchangeRateSchema = z
  .object({
    /** The currency income arrives in — what a total is converted into. */
    base: currencySchema,
    /** The currency spent on the spot. */
    quote: currencySchema,
    /** Units of quote per one base: «1 ₽ = 4,82 ֏» is 4_820_000n. */
    scaled: z.bigint().positive(),
    source: rateSourceSchema,
    asOf: z.date(),
  })
  .refine((rate) => rate.base !== rate.quote, {
    // A rate from a currency to itself is not 1, it is a mistake upstream: nothing should
    // have built a rate at all when there is nothing to convert.
    error: 'base and quote must differ',
  })
export type ExchangeRate = z.infer<typeof exchangeRateSchema>

export function parseRate(input: string): bigint {
  const scaled = scaledFromDecimal(input, RATE_DIGITS)
  if (scaled === null || scaled <= 0n) throw new DomainError(ERROR.INVALID_AMOUNT, input)
  return scaled
}

export function decimalFromRate(scaled: bigint): string {
  return decimalFromScaled(scaled, RATE_DIGITS)
}

/**
 * Dates go over the wire as ISO strings for the same reason amounts go as decimal ones:
 * JSON has no type for either, and a Date survives stringify only to come back a string.
 */
export const exchangeRateWireSchema = z.object({
  base: currencySchema,
  quote: currencySchema,
  rate: z.string(),
  source: rateSourceSchema,
  asOf: z.iso.datetime(),
})
export type ExchangeRateWire = z.infer<typeof exchangeRateWireSchema>

export const rateCodec = z.codec(exchangeRateWireSchema, exchangeRateSchema, {
  decode: ({ base, quote, rate, source, asOf }) => ({
    base,
    quote,
    scaled: parseRate(rate),
    source,
    asOf: new Date(asOf),
  }),
  encode: (value) => ({
    base: value.base,
    quote: value.quote,
    rate: decimalFromRate(value.scaled),
    source: value.source,
    asOf: value.asOf.toISOString(),
  }),
})
