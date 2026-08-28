import { z } from 'zod'
import { DomainError, ERROR } from './errors'

export const currencySchema = z.enum(['AMD', 'RUB', 'USD', 'EUR'])
export type Currency = z.infer<typeof currencySchema>

/** Every supported currency has a minor unit of 1/100 — drams included: receipts are fractional. */
export const MINOR_PER_MAJOR = 100n

/** An amount is an integer in minor units. Never a float, at any point. */
export interface Money {
  readonly minor: bigint
  readonly currency: Currency
}

export const moneySchema = z.object({
  minor: z.coerce.bigint(),
  currency: currencySchema,
})

export function money(minor: bigint, currency: Currency): Money {
  return { minor, currency }
}

/** Parses "5403.12", "5 403,12" and "5403" — anything a receipt or a keyboard produces. */
export function parseMoney(input: string, currency: Currency): Money {
  const text = input.trim().replace(/\s/g, '').replace(',', '.')
  if (!/^-?\d+(\.\d{1,2})?$/.test(text)) {
    throw new DomainError(ERROR.INVALID_AMOUNT, input)
  }

  const negative = text.startsWith('-')
  const digits = negative ? text.slice(1) : text
  const dot = digits.indexOf('.')
  const whole = dot === -1 ? digits : digits.slice(0, dot)
  const fraction = dot === -1 ? '' : digits.slice(dot + 1)

  const minor = BigInt(whole) * MINOR_PER_MAJOR + BigInt(fraction.padEnd(2, '0'))
  return { minor: negative ? -minor : minor, currency }
}

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
  const major = Number(minor) / Number(MINOR_PER_MAJOR)
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(major)
}
