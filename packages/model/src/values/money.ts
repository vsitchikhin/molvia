import { z } from 'zod'
import { INT8_MAX, decimalFromScaled, scaledFromDecimal } from '#model/support/decimal'
import { DomainError, ERROR } from '#model/support/errors'

export const currencySchema = z.enum(['AMD', 'RUB', 'USD', 'EUR', 'GEL', 'RSD'])
export type Currency = z.infer<typeof currencySchema>

export type MinorExponent = 0 | 2 | 3

/**
 * Every currency keeps two digits today — drams included, an Armenian receipt prints hundredths,
 * the lari its tetri (MOL-110) and the dinar its paras by ISO 4217 (MOL-230) — and that coincidence is what makes a hardcoded 100n look right until a
 * currency with three digits or none arrives. Frozen because a write here would leave
 * every stored minor unit as it is and change the price it reads as.
 */
export const MINOR_EXPONENT: Readonly<Record<Currency, MinorExponent>> = Object.freeze({
  AMD: 2,
  RUB: 2,
  USD: 2,
  EUR: 2,
  GEL: 2,
  RSD: 2,
})

const POW10 = [1n, 10n, 100n, 1000n] as const

/**
 * The step a till rounds a sum to, in minor units — a property of the currency, as its exponent is
 * (MOL-92, adversarial Г″, review №8). An Armenian receipt prints hundredths and the shop rounds them
 * away, so a sum is paid and typed in whole drams; roubles are typed whole too, whatever kopecks the
 * receipt printed (owner's decision, 02.10.2026); a till in dollars, euros or lari counts to the cent
 * or the tetri — a Georgian price is 3,45 ₾ (MOL-110); a Serbian till counts whole dinars, as the
 * Armenian one counts drams (MOL-230). What
 * «Тут дешевле» allows a price per unit to wobble by: half a step on a sum.
 */
export const TILL_STEP_MINOR: Readonly<Record<Currency, bigint>> = Object.freeze({
  AMD: 100n,
  RUB: 100n,
  USD: 1n,
  EUR: 1n,
  GEL: 1n,
  RSD: 100n,
})

export function minorPerMajor(currency: Currency): bigint {
  return POW10[MINOR_EXPONENT[currency]]
}

export interface Money {
  readonly minor: bigint
  readonly currency: Currency
}

/**
 * The ceiling is part of the type, not of the wire: until MOL-6 it lived only in
 * `moneyCodec`, so the domain accepted `INT8_MAX + 1n` and `amount_minor bigint` answered
 * `22003` — the one place where the database was stricter than the domain, and the only way
 * to hit it was a path that does not cross the wire. `quantitySchema` was bounded from the
 * start; this is the same rule, applied to the other half of a price.
 */
export const moneySchema = z.object({
  minor: z.bigint().min(-INT8_MAX).max(INT8_MAX),
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

/**
 * Money that may be below zero, for the one answer that is a difference rather than a price:
 * how much more or less an exchange gave than the central bank would have (MOL-40). A price is
 * never negative, so `moneyCodec` keeps refusing the sign — this is a second codec, not a looser
 * first one.
 */
export const signedMoneyCodec = z.codec(moneyWireSchema, moneySchema, {
  decode: ({ amount, currency }, payload) => {
    const minor = scaledFromDecimal(amount, MINOR_EXPONENT[currency])
    if (minor === null || minor > INT8_MAX || minor < -INT8_MAX) {
      payload.issues.push({
        code: 'custom',
        input: amount,
        path: ['amount'],
        message: ERROR.INVALID_AMOUNT,
      })
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
  const minor = a.minor + b.minor
  if (minor > INT8_MAX || minor < -INT8_MAX) {
    throw new DomainError(ERROR.INVALID_AMOUNT, String(minor))
  }
  return { minor, currency: a.currency }
}

export function subtractMoney(a: Money, b: Money): Money {
  sameCurrency(a, b)
  const minor = a.minor - b.minor
  // The same bound `addMoney` has kept from the start. Once `moneySchema` grew a ceiling,
  // this was the only way left to build a Money the schema itself refuses — a difference
  // of two extremes is twice the range.
  if (minor > INT8_MAX || minor < -INT8_MAX) {
    throw new DomainError(ERROR.INVALID_AMOUNT, String(minor))
  }
  return { minor, currency: a.currency }
}

export function compareMoney(a: Money, b: Money): number {
  sameCurrency(a, b)
  if (a.minor === b.minor) return 0
  return a.minor < b.minor ? -1 : 1
}

/**
 * The sign CLDR gets wrong, in every language at once: Russian prints the lari as «ლ», an old letter
 * of the alphabet, where a Georgian price tag and every other locale print «₾» (MOL-110).
 */
const SIGN: Readonly<Partial<Record<Currency, string>>> = Object.freeze({ GEL: '₾' })

/**
 * An amount with its currency's sign, as every formatter of money prints it: the narrow symbol, the
 * digits asked for, and the sign of `SIGN` in place of CLDR's where it has one.
 */
export function formatInCurrency(
  decimal: `${number}`,
  currency: Currency,
  locale: string,
  digits: Pick<Intl.NumberFormatOptions, 'minimumFractionDigits' | 'maximumFractionDigits'>,
): string {
  const parts = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol',
    ...digits,
  }).formatToParts(decimal)
  const sign = SIGN[currency]
  return parts.map((part) => (part.type === 'currency' && sign ? sign : part.value)).join('')
}

/** Formats the decimal string, not a Number: that bridge rewrote digits past 2^53. */
export function formatMoney(value: Money, locale = 'ru-RU'): string {
  const exponent = MINOR_EXPONENT[value.currency]
  return formatInCurrency(decimalFromMinor(value), value.currency, locale, {
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent,
  })
}

/**
 * An estimate — money converted by a rate — rounded to whole units. Kopecks in a figure that is
 * only approximate are exactly the false precision the rule of «≈» exists against (handoff,
 * «Валюты»): «≈ 108 ₽», never «≈ 107,88 ₽». Rounding here, on output, as everywhere.
 */
export function formatEstimate(value: Money, locale = 'ru-RU'): string {
  return formatInCurrency(decimalFromMinor(value), value.currency, locale, {
    maximumFractionDigits: 0,
  })
}

/**
 * The sign of a currency as the formatter prints it next to an amount — the tail of a price field
 * (`֏`), never written into the markup: the sign belongs to the currency, and a receipt in a
 * foreign one must show its own.
 */
export function currencySign(currency: Currency, locale = 'ru-RU'): string {
  const parts = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol',
  }).formatToParts(0)
  return SIGN[currency] ?? parts.find((part) => part.type === 'currency')?.value ?? currency
}
