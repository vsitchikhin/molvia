import { z } from 'zod'
import { decimalFromScaled, scaledFromDecimal } from './decimal'
import { DomainError, ERROR } from './errors'

export const currencySchema = z.enum(['AMD', 'RUB', 'USD', 'EUR'])
export type Currency = z.infer<typeof currencySchema>

/** Digits after the point. Every exponent ISO 4217 actually uses, minus the unused 1. */
export type MinorExponent = 0 | 2 | 3

/**
 * How many digits the currency keeps. This belongs to the currency, not to the project:
 * all four supported ones happen to use two today — drams included, an Armenian receipt
 * prints hundredths even though a till usually rounds them away — and that coincidence is
 * exactly what makes a hardcoded 100n look correct until the first currency with three
 * digits or none arrives.
 *
 * Declared as the union rather than inferred `as const`: with all four on 2 the compiler
 * would narrow every read to the literal 2 and call the zero-digit branch dead code,
 * which is the same blind spot the constant had, moved into the type.
 */
export const MINOR_EXPONENT: Record<Currency, MinorExponent> = {
  AMD: 2,
  RUB: 2,
  USD: 2,
  EUR: 2,
}

const POW10 = [1n, 10n, 100n, 1000n] as const

export function minorPerMajor(currency: Currency): bigint {
  return POW10[MINOR_EXPONENT[currency]]
}

/** An amount is an integer in minor units. Never a float, at any point. */
export interface Money {
  readonly minor: bigint
  readonly currency: Currency
}

/**
 * Strict on purpose: coercion here would quietly accept a JSON number, and 5403.12 as a
 * double is the precision loss this type exists to prevent. Anything arriving from
 * outside goes through moneyCodec instead.
 */
export const moneySchema = z.object({
  minor: z.bigint(),
  currency: currencySchema,
})

export function money(minor: bigint, currency: Currency): Money {
  return { minor, currency }
}

/**
 * The non-throwing core. Everything that decides whether a string is an amount lives
 * here, so the codec and parseMoney can never disagree about it.
 */
function minorFromDecimal(input: string, currency: Currency): bigint | null {
  return scaledFromDecimal(input, MINOR_EXPONENT[currency])
}

/** Parses "5403.12", "5 403,12" and "5403" — anything a receipt or a keyboard produces. */
export function parseMoney(input: string, currency: Currency): Money {
  const minor = minorFromDecimal(input, currency)
  if (minor === null) throw new DomainError(ERROR.INVALID_AMOUNT, input)
  return { minor, currency }
}

/** The inverse of parseMoney: minor units back to the canonical decimal string. */
export function decimalFromMinor({ minor, currency }: Money): string {
  return decimalFromScaled(minor, MINOR_EXPONENT[currency])
}

/**
 * Money crosses the wire as a decimal string, because JSON.stringify throws on a bigint
 * and a JSON number is a double. Without this pair no schema holding an amount can travel
 * between the PWA, the API and the bot — which is the only reason the language is
 * TypeScript in the first place.
 */
export const moneyWireSchema = z.object({
  amount: z.string(),
  currency: currencySchema,
})
export type MoneyWire = z.infer<typeof moneyWireSchema>

/**
 * A transform must not throw: zod checks `payload.issues` after running it and aborts,
 * so an issue pushed here comes back as a normal `success: false`. Throwing instead would
 * escape `safeParse` — the one method whose whole purpose is not to — and a route written
 * as `if (!parsed.success) return 400` would fail past its own branch.
 */
export const moneyCodec = z.codec(moneyWireSchema, moneySchema, {
  decode: ({ amount, currency }, payload) => {
    const minor = minorFromDecimal(amount, currency)
    if (minor === null) {
      payload.issues.push({
        code: 'custom',
        input: amount,
        path: ['amount'],
        message: ERROR.INVALID_AMOUNT,
      })
      // Discarded: zod sees the issue and stops before the output schema runs.
      return { minor: 0n, currency }
    }
    return { minor, currency }
  },
  encode: (value) => ({ amount: decimalFromMinor(value), currency: value.currency }),
})

function sameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new DomainError(ERROR.CURRENCY_MISMATCH, `${a.currency} vs ${b.currency}`)
  }
}

export function addMoney(a: Money, b: Money): Money {
  sameCurrency(a, b)
  return { minor: a.minor + b.minor, currency: a.currency }
}

export function subtractMoney(a: Money, b: Money): Money {
  sameCurrency(a, b)
  return { minor: a.minor - b.minor, currency: a.currency }
}

export function compareMoney(a: Money, b: Money): number {
  sameCurrency(a, b)
  if (a.minor === b.minor) return 0
  return a.minor < b.minor ? -1 : 1
}

/** Rounding happens here and nowhere else: this is output. */
export function formatMoney({ minor, currency }: Money, locale = 'ru-RU'): string {
  const exponent = MINOR_EXPONENT[currency]
  const major = Number(minor) / Number(minorPerMajor(currency))
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    // Intl takes the digit count from its own ISO table, which agrees with ours for all
    // four currencies today. Relying on that agreement is the same mistake as the constant.
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent,
  }).format(major)
}
