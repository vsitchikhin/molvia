import type { BaseUnit, Currency, ExchangeRate, Money, Quantity, RateSource } from '@molvia/model'

/**
 * Columns into values and back, in one place.
 *
 * Money, quantity and the rate each live in the database as several columns that only mean
 * something together — the minor-unit exponent belongs to the currency, a number without its
 * unit is not a quantity, and half a rate snapshot converts by nothing. Assembling them at
 * every call site is how one of those pairs eventually gets written on its own.
 *
 * The pairs are returned under neutral names rather than column names: a quantity is
 * `qty_milli` on an expense and `typical_qty_milli` on an item, so the caller names the
 * columns and this file owns the pairing.
 */

export interface MoneyColumns {
  readonly minor: bigint | null
  readonly currency: Currency | null
}

export interface QuantityColumns {
  readonly milli: bigint | null
  readonly unit: BaseUnit | null
}

/** The five columns of a rate snapshot, named as `trips` names them. */
export interface RateColumns {
  readonly rateBase: Currency | null
  readonly rateQuote: Currency | null
  readonly rateScaled: bigint | null
  readonly rateSource: RateSource | null
  readonly rateAsOf: Date | null
}

export function moneyFrom(minor: bigint | null, currency: Currency | null): Money | null {
  if (minor === null || currency === null) return null
  return { minor, currency }
}

export function moneyTo(amount: Money | null | undefined): MoneyColumns {
  if (!amount) return { minor: null, currency: null }
  return { minor: amount.minor, currency: amount.currency }
}

export function quantityFrom(milli: bigint | null, unit: BaseUnit | null): Quantity | null {
  if (milli === null || unit === null) return null
  return { milli, unit }
}

export function quantityTo(quantity: Quantity | null | undefined): QuantityColumns {
  if (!quantity) return { milli: null, unit: null }
  return { milli: quantity.milli, unit: quantity.unit }
}

/**
 * All five or none. The database already holds that — `trips_rate_all_or_none` is a CHECK —
 * so the test here narrows the types rather than repeating the rule; a row that broke it
 * could not have been written.
 */
export function rateFrom(columns: RateColumns): ExchangeRate | null {
  const { rateBase, rateQuote, rateScaled, rateSource, rateAsOf } = columns
  if (
    rateBase === null ||
    rateQuote === null ||
    rateScaled === null ||
    rateSource === null ||
    rateAsOf === null
  ) {
    return null
  }
  return {
    base: rateBase,
    quote: rateQuote,
    scaled: rateScaled,
    source: rateSource,
    asOf: rateAsOf,
  }
}

export function rateTo(rate: ExchangeRate | null): RateColumns {
  if (rate === null) {
    return {
      rateBase: null,
      rateQuote: null,
      rateScaled: null,
      rateSource: null,
      rateAsOf: null,
    }
  }
  return {
    rateBase: rate.base,
    rateQuote: rate.quote,
    rateScaled: rate.scaled,
    rateSource: rate.source,
    rateAsOf: rate.asOf,
  }
}
