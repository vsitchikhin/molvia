import { z } from 'zod'
import { INT8_MAX, decimalFromScaled, scaledFromDecimal } from '#model/support/decimal'
import { DomainError, ERROR } from '#model/support/errors'

export const currencySchema = z.enum(['AMD', 'RUB', 'USD', 'EUR'])
export type Currency = z.infer<typeof currencySchema>

export type MinorExponent = 0 | 2 | 3

/**
 * All four currencies keep two digits today — drams included, an Armenian receipt prints
 * hundredths — and that coincidence is what makes a hardcoded 100n look right until a
 * currency with three digits or none arrives. Frozen because a write here would leave
 * every stored minor unit as it is and change the price it reads as.
 */
export const MINOR_EXPONENT: Readonly<Record<Currency, MinorExponent>> = Object.freeze({
  AMD: 2,
  RUB: 2,
  USD: 2,
  EUR: 2,
})

const POW10 = [1n, 10n, 100n, 1000n] as const

export function minorPerMajor(currency: Currency): bigint {
  return POW10[MINOR_EXPONENT[currency]]
}

export interface Money {
  readonly minor: bigint
  readonly currency: Currency
}

export const moneySchema = z.object({
  minor: z.bigint(),
  currency: currencySchema,
})

export const priceSchema = moneySchema.refine((value) => value.minor >= 0n, {
  error: ERROR.INVALID_AMOUNT,
})

export function money(minor: bigint, currency: Currency): Money {
  return { minor, currency }
}

function minorFromDecimal(input: string, currency: Currency): bigint | null {
  const minor = scaledFromDecimal(input, MINOR_EXPONENT[currency])
  if (minor === null || minor < 0n || minor > INT8_MAX) return null
  return minor
}

export function parseMoney(input: string, currency: Currency): Money {
  const minor = minorFromDecimal(input, currency)
  if (minor === null) throw new DomainError(ERROR.INVALID_AMOUNT, input)
  return { minor, currency }
}

export function decimalFromMinor({ minor, currency }: Money): `${number}` {
  return decimalFromScaled(minor, MINOR_EXPONENT[currency])
}

export const moneyWireSchema = z.object({
  amount: z.string().max(40),
  currency: currencySchema,
})
export type MoneyWire = z.infer<typeof moneyWireSchema>

/** decode must not throw: zod checks payload.issues after it and safeParse must not either. */
export const moneyCodec = z.codec(moneyWireSchema, priceSchema, {
  decode: ({ amount, currency }, payload) => {
    const minor = minorFromDecimal(amount, currency)
    if (minor === null) {
      payload.issues.push({
        code: 'custom',
        input: amount,
        path: ['amount'],
        message: ERROR.INVALID_AMOUNT,
      })
      return { minor: -1n, currency }
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
  const minor = a.minor + b.minor
  if (minor > INT8_MAX) throw new DomainError(ERROR.INVALID_AMOUNT, String(minor))
  return { minor, currency: a.currency }
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

/** Formats the decimal string, not a Number: that bridge rewrote digits past 2^53. */
export function formatMoney(value: Money, locale = 'ru-RU'): string {
  const exponent = MINOR_EXPONENT[value.currency]
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: value.currency,
    currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent,
  }).format(decimalFromMinor(value))
}
