import { z } from 'zod'
import { decimalFromScaled, scaledFromDecimal } from './decimal'
import { DomainError, ERROR } from './errors'
import { MINOR_EXPONENT, minorPerMajor } from './money'
import type { Currency, Money } from './money'

/** What everything is compared in. Prices only ever meet after being reduced to these. */
export const baseUnitSchema = z.enum(['kg', 'l', 'piece'])
export type BaseUnit = z.infer<typeof baseUnitSchema>

export const unitSchema = z.enum(['g', 'kg', 'ml', 'l', 'piece'])
export type Unit = z.infer<typeof unitSchema>

const BASE_OF: Record<Unit, BaseUnit> = {
  g: 'kg',
  kg: 'kg',
  ml: 'l',
  l: 'l',
  piece: 'piece',
}

/** Thousandths of the base unit, as an integer: 1.128 kg -> 1128n, 900 ml -> 900n. */
const MILLI_PER_UNIT: Record<Unit, bigint> = {
  g: 1n,
  kg: 1000n,
  ml: 1n,
  l: 1000n,
  piece: 1000n,
}

export interface Quantity {
  readonly milli: bigint
  readonly unit: BaseUnit
}

/** Positive on purpose: zero is what unitPrice would divide by, and negative weight is not a thing. */
export const quantitySchema = z.object({
  milli: z.bigint().positive(),
  unit: baseUnitSchema,
})

/** The non-throwing core, shared by parseQuantity and the codec so they cannot disagree. */
function quantityFromDecimal(input: string, unit: Unit): Quantity | null {
  const thousandths = scaledFromDecimal(input, 3)
  if (thousandths === null) return null

  const milli = (thousandths * MILLI_PER_UNIT[unit]) / 1000n
  if (milli <= 0n) return null

  return { milli, unit: BASE_OF[unit] }
}

export function parseQuantity(input: string, unit: Unit): Quantity {
  const quantity = quantityFromDecimal(input, unit)
  if (quantity === null) throw new DomainError(ERROR.INVALID_QUANTITY, input)
  return quantity
}

/** The inverse of parseQuantity for a base unit: 1128n -> "1.128". */
export function decimalFromMilli({ milli }: Quantity): string {
  return decimalFromScaled(milli, 3)
}

/** Same reason as money: milli is a bigint, and JSON.stringify throws on those. */
export const quantityWireSchema = z.object({
  amount: z.string(),
  unit: baseUnitSchema,
})
export type QuantityWire = z.infer<typeof quantityWireSchema>

/** Reports through the payload rather than throwing — see the note on moneyCodec. */
export const quantityCodec = z.codec(quantityWireSchema, quantitySchema, {
  decode: ({ amount, unit }, payload) => {
    const quantity = quantityFromDecimal(amount, unit)
    if (quantity === null) {
      payload.issues.push({
        code: 'custom',
        input: amount,
        path: ['amount'],
        message: ERROR.INVALID_QUANTITY,
      })
      return { milli: 1n, unit }
    }
    return quantity
  },
  encode: (value) => ({ amount: decimalFromMilli(value), unit: value.unit }),
})

/**
 * Price per base unit, scaled so that comparison stays exact where a float would drift.
 * The user must never have to work out that 520 ֏ for 0.9 l beats 570 ֏ for a litre.
 */
export const UNIT_PRICE_SCALE = 1_000_000n

export interface UnitPrice {
  readonly scaledMinor: bigint
  readonly currency: Currency
  readonly unit: BaseUnit
}

export function unitPrice(amount: Money, quantity: Quantity): UnitPrice {
  if (quantity.milli <= 0n) {
    throw new DomainError(ERROR.INVALID_QUANTITY, String(quantity.milli))
  }
  // A negative amount here would win every comparison and sit at the top of "where is it
  // cheaper" for good, with nothing on the card to show what it was built from.
  if (amount.minor < 0n) {
    throw new DomainError(ERROR.INVALID_AMOUNT, String(amount.minor))
  }
  return {
    scaledMinor: (amount.minor * 1000n * UNIT_PRICE_SCALE) / quantity.milli,
    currency: amount.currency,
    unit: quantity.unit,
  }
}

export function compareUnitPrice(a: UnitPrice, b: UnitPrice): number {
  if (a.currency !== b.currency) {
    throw new DomainError(ERROR.CURRENCY_MISMATCH, `${a.currency} vs ${b.currency}`)
  }
  if (a.unit !== b.unit) {
    throw new DomainError(ERROR.UNIT_MISMATCH, `${a.unit} vs ${b.unit}`)
  }
  if (a.scaledMinor === b.scaledMinor) return 0
  return a.scaledMinor < b.scaledMinor ? -1 : 1
}

/** Rounding happens here and nowhere else: this is output. */
export function formatUnitPrice(price: UnitPrice, locale = 'ru-RU'): string {
  const exponent = MINOR_EXPONENT[price.currency]
  const major = Number(price.scaledMinor) / Number(UNIT_PRICE_SCALE * minorPerMajor(price.currency))
  const amount = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: price.currency,
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent,
  }).format(major)
  return `${amount}/${price.unit}`
}
