/**
 * Fixed-point decimal strings, in both directions.
 *
 * An amount, a quantity and an exchange rate are the same shape — an integer scaled by a
 * power of ten — and differ only in the power and in which error they raise. Written out
 * three times this drifts; written once it is the single place where a digit can be lost.
 *
 * Returns null rather than throwing so each caller keeps its own registry code.
 */
export function scaledFromDecimal(input: string, digits: number): bigint | null {
  const text = input.trim().replace(',', '.')

  // A space is a group separator, not a character to be ignored. "5 403,12" is what a
  // receipt prints; "5 4 0 3.1 2" and "- 5" are typos, and stripping every space first
  // turned both of them into numbers the person never typed.
  const wholePart = String.raw`(?:\d+|\d{1,3}(?:\s\d{3})+)`
  const shape =
    digits === 0
      ? new RegExp(String.raw`^-?${wholePart}$`)
      : new RegExp(String.raw`^-?${wholePart}(?:\.\d{1,${digits}})?$`)
  if (!shape.test(text)) return null

  const bare = text.replace(/\s/g, '')
  const negative = bare.startsWith('-')
  const body = negative ? bare.slice(1) : bare
  const dot = body.indexOf('.')
  const whole = dot === -1 ? body : body.slice(0, dot)
  const fraction = dot === -1 ? '' : body.slice(dot + 1)

  const scaled = BigInt(whole) * 10n ** BigInt(digits) + BigInt(fraction.padEnd(digits, '0') || '0')
  return negative ? -scaled : scaled
}

/**
 * The largest value a Postgres `bigint` column holds. The model refuses anything past it
 * rather than letting the INSERT fail: an amount that cannot be stored is a bad amount,
 * and `22003` from the driver is not an error this project is allowed to surface.
 */
export const INT8_MAX = 9_223_372_036_854_775_807n

/**
 * The inverse: 540312n at 2 digits is "5403.12".
 *
 * Typed as a numeric literal because `Intl.NumberFormat.format` accepts one and formats
 * it without going through a float. The shape is guaranteed by construction here — sign,
 * digits, one point — and this is the only place in the model where a shape is asserted
 * rather than proven, precisely so that no caller has to assert it again.
 */
export function decimalFromScaled(value: bigint, digits: number): `${number}` {
  const negative = value < 0n
  const body = (negative ? -value : value).toString().padStart(digits + 1, '0')
  const sign = negative ? '-' : ''
  const decimal =
    digits === 0 ? sign + body : `${sign}${body.slice(0, -digits)}.${body.slice(-digits)}`
  return decimal as `${number}`
}

/**
 * Integer division that rounds to nearest, half away from zero — the way a till rounds.
 * Truncation would be a one-sided bias rather than noise, and there is no exact answer to
 * pick instead: a conversion rarely lands on a whole minor unit.
 */
export function divideRounded(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n
  const magnitude = negative ? -numerator : numerator
  const result = (magnitude + denominator / 2n) / denominator
  return negative ? -result : result
}
