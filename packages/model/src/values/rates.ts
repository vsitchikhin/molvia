import { z } from 'zod'
import { decimalFromScaled, scaledFromDecimal } from '#model/support/decimal'
import { DomainError, ERROR, ISSUE } from '#model/support/errors'
import { currencySchema } from './money'

export const RATE_DIGITS = 6
export const RATE_SCALE = 10n ** BigInt(RATE_DIGITS)

// A sanity band, not a validation: the real check on a rate is disagreement with the
// official one for the same day, and that needs the cache from MOL-39.
const RATE_MIN = RATE_SCALE / 10_000n
const RATE_MAX = RATE_SCALE * 1_000_000n

const RATE_EPOCH = new Date('2000-01-01T00:00:00.000Z')

export const rateSourceSchema = z.enum(['personal', 'official'])
export type RateSource = z.infer<typeof rateSourceSchema>

const exchangeRateFields = z.object({
  base: currencySchema,
  quote: currencySchema,
  scaled: z.bigint().min(RATE_MIN).max(RATE_MAX),
  source: rateSourceSchema,
  asOf: z.date(),
})

export const exchangeRateSchema = exchangeRateFields
  .refine((rate) => rate.base !== rate.quote, {
    error: ISSUE.RATE_SAME_CURRENCY,
  })
  // No Date.now() here: a schema that answers differently depending on the clock is not
  // a schema. «Not from the future» belongs to the use case that snapshots the rate.
  .refine((rate) => rate.asOf >= RATE_EPOCH, { error: ISSUE.RATE_IMPLAUSIBLE_DATE })
export type ExchangeRate = z.infer<typeof exchangeRateSchema>

function scaledFromRate(input: string): bigint | null {
  const scaled = scaledFromDecimal(input, RATE_DIGITS)
  if (scaled === null || scaled < RATE_MIN || scaled > RATE_MAX) return null
  return scaled
}

export function parseRate(input: string): bigint {
  const scaled = scaledFromRate(input)
  if (scaled === null) throw new DomainError(ERROR.INVALID_RATE, input)
  return scaled
}

export function decimalFromRate(scaled: bigint): string {
  return decimalFromScaled(scaled, RATE_DIGITS)
}

export const exchangeRateWireSchema = z.object({
  base: currencySchema,
  quote: currencySchema,
  rate: z.string().max(40),
  source: rateSourceSchema,
  asOf: z.iso.datetime(),
})
export type ExchangeRateWire = z.infer<typeof exchangeRateWireSchema>

export const rateCodec = z.codec(exchangeRateWireSchema, exchangeRateSchema, {
  decode: ({ base, quote, rate, source, asOf }, payload) => {
    const scaled = scaledFromRate(rate)
    if (scaled === null) {
      payload.issues.push({
        code: 'custom',
        input: rate,
        path: ['rate'],
        message: ERROR.INVALID_RATE,
      })
    }
    return { base, quote, scaled: scaled ?? 1n, source, asOf: new Date(asOf) }
  },
  encode: (value) => ({
    base: value.base,
    quote: value.quote,
    rate: decimalFromRate(value.scaled),
    source: value.source,
    asOf: value.asOf.toISOString(),
  }),
})
