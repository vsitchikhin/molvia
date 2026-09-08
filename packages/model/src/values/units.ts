import { z } from 'zod'
import {
  INT8_MAX,
  decimalFromScaled,
  divideRounded,
  scaledFromDecimal,
} from '#model/support/decimal'
import { ISSUE } from '#model/support/errors'
import { DomainError, ERROR } from '#model/support/errors'
import { MINOR_EXPONENT } from './money'
import type { Currency, Money } from './money'

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

const quantityFields = z.object({
  milli: z.bigint().positive().max(INT8_MAX),
  unit: baseUnitSchema,
})

export const quantitySchema = quantityFields.refine(
  (quantity) => quantity.unit !== 'piece' || quantity.milli % 1000n === 0n,
  {
    error: ISSUE.QUANTITY_FRACTIONAL_PIECE,
  },
)
/**
 * Precision below the resolution of the unit is refused, not dropped: truncating made
 * «1,500» г — how a Russian keyboard writes 1500 — into 1 g, a thousandfold error.
 */
function quantityFromDecimal(input: string, unit: Unit): Quantity | null {
  const thousandths = scaledFromDecimal(input, 3)
  if (thousandths === null) return null

  const scaled = thousandths * MILLI_PER_UNIT[unit]
  if (scaled % 1000n !== 0n) return null

  const milli = scaled / 1000n
  if (milli <= 0n || milli > INT8_MAX) return null

  if (BASE_OF[unit] === 'piece' && milli % 1000n !== 0n) return null

  return { milli, unit: BASE_OF[unit] }
}

export function parseQuantity(input: string, unit: Unit): Quantity {
  const quantity = quantityFromDecimal(input, unit)
  if (quantity === null) throw new DomainError(ERROR.INVALID_QUANTITY, input)
  return quantity
}

export function decimalFromMilli({ milli }: Quantity): `${number}` {
  return decimalFromScaled(milli, 3)
}

export const quantityWireSchema = z.object({
  value: z.string().max(40),
  unit: baseUnitSchema,
})
export type QuantityWire = z.infer<typeof quantityWireSchema>

export const quantityCodec = z.codec(quantityWireSchema, quantitySchema, {
  decode: ({ value, unit }, payload) => {
    const quantity = quantityFromDecimal(value, unit)
    if (quantity === null) {
      payload.issues.push({
        code: 'custom',
        input: value,
        path: ['value'],
        message: ERROR.INVALID_QUANTITY,
      })
      return { milli: 0n, unit }
    }
    return quantity
  },
  encode: (quantity) => ({ value: decimalFromMilli(quantity), unit: quantity.unit }),
})

export const UNIT_PRICE_DIGITS = 6
export const UNIT_PRICE_SCALE = 10n ** BigInt(UNIT_PRICE_DIGITS)

export interface UnitPrice {
  readonly scaledMinor: bigint
  readonly currency: Currency
  readonly unit: BaseUnit
}

export function unitPrice(amount: Money, quantity: Quantity): UnitPrice {
  if (quantity.milli <= 0n) {
    throw new DomainError(ERROR.INVALID_QUANTITY, String(quantity.milli))
  }
  if (amount.minor < 0n) {
    throw new DomainError(ERROR.INVALID_AMOUNT, String(amount.minor))
  }
  return {
    scaledMinor: divideRounded(amount.minor * 1000n * UNIT_PRICE_SCALE, quantity.milli),
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

/** At least two digits whatever the currency keeps: the point is telling 570,00 from 577,78. */
export function formatUnitPrice(price: UnitPrice, locale = 'ru-RU'): string {
  const exponent = Math.max(MINOR_EXPONENT[price.currency], 2)
  const major = decimalFromScaled(
    price.scaledMinor,
    UNIT_PRICE_DIGITS + MINOR_EXPONENT[price.currency],
  )
  const amount = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: price.currency,
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent,
  }).format(major)
  return `${amount}/${price.unit}`
}
