import { z } from 'zod'
import { DomainError, ERROR } from './errors'
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

export function parseQuantity(input: string, unit: Unit): Quantity {
  const text = input.trim().replace(/\s/g, '').replace(',', '.')
  if (!/^\d+(\.\d{1,3})?$/.test(text)) {
    throw new DomainError(ERROR.INVALID_QUANTITY, input)
  }

  const dot = text.indexOf('.')
  const whole = dot === -1 ? text : text.slice(0, dot)
  const fraction = dot === -1 ? '' : text.slice(dot + 1)
  const thousandths = BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, '0'))

  const milli = (thousandths * MILLI_PER_UNIT[unit]) / 1000n
  if (milli <= 0n) throw new DomainError(ERROR.INVALID_QUANTITY, input)

  return { milli, unit: BASE_OF[unit] }
}

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
  const major = Number(price.scaledMinor) / Number(UNIT_PRICE_SCALE * 100n)
  const amount = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: price.currency,
  }).format(major)
  return `${amount}/${price.unit}`
}
