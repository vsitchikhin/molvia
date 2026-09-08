import { z } from 'zod'
import { INT8_MAX, decimalFromScaled, scaledFromDecimal } from './decimal'
import { DomainError, ERROR, ISSUE } from './errors'
import { currencySchema } from './money'

/** Six digits: enough for a rate quoted to fractions of a dram, and still an integer. */
export const RATE_DIGITS = 6
/** Derived, not written twice: the same split MINOR_PER_MAJOR was removed for. */
export const RATE_SCALE = 10n ** BigInt(RATE_DIGITS)

/**
 * A band, not a bound. One millionth of a dram per rouble parsed as a rate and turned a
 * 1 000 ֏ trip into ten million roubles, and nothing in the model said it could not. The
 * band is deliberately wide: it rejects a misplaced decimal point, not an unusual currency.
 */
const RATE_MIN = RATE_SCALE / 10_000n
const RATE_MAX = RATE_SCALE * 1_000_000n

/** No rate predates the currencies this app deals in, and none is dated in the future. */
const RATE_EPOCH = new Date('2000-01-01T00:00:00.000Z')
const CLOCK_SKEW_MS = 24 * 60 * 60 * 1000

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
    scaled: z.bigint().min(RATE_MIN).max(RATE_MAX),
    source: rateSourceSchema,
    asOf: z.date(),
  })
  .refine((rate) => rate.base !== rate.quote, {
    // A rate from a currency to itself is not 1, it is a mistake upstream: nothing should
    // have built a rate at all when there is nothing to convert.
    error: ISSUE.RATE_SAME_CURRENCY,
  })
  .refine((rate) => rate.asOf >= RATE_EPOCH && rate.asOf.getTime() <= Date.now() + CLOCK_SKEW_MS, {
    error: ISSUE.RATE_IMPLAUSIBLE_DATE,
  })
export type ExchangeRate = z.infer<typeof exchangeRateSchema>

/** The non-throwing core, shared by parseRate and the codec. */
function scaledFromRate(input: string): bigint | null {
  const scaled = scaledFromDecimal(input, RATE_DIGITS)
  if (scaled === null || scaled < RATE_MIN || scaled > RATE_MAX || scaled > INT8_MAX) {
    return null
  }
  return scaled
}

/** Its own code: «неверная сумма» in a field labelled «мой курс» is the wrong sentence. */
export function parseRate(input: string): bigint {
  const scaled = scaledFromRate(input)
  if (scaled === null) throw new DomainError(ERROR.INVALID_RATE, input)
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
  rate: z.string().max(40),
  source: rateSourceSchema,
  asOf: z.iso.datetime(),
})
export type ExchangeRateWire = z.infer<typeof exchangeRateWireSchema>

/** Reports through the payload rather than throwing — see the note on moneyCodec. */
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
