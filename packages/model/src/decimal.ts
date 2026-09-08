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
  const text = input.trim().replace(/\s/g, '').replace(',', '.')
  const shape = digits === 0 ? /^-?\d+$/ : new RegExp(String.raw`^-?\d+(\.\d{1,${digits}})?$`)
  if (!shape.test(text)) return null

  const negative = text.startsWith('-')
  const body = negative ? text.slice(1) : text
  const dot = body.indexOf('.')
  const whole = dot === -1 ? body : body.slice(0, dot)
  const fraction = dot === -1 ? '' : body.slice(dot + 1)

  const scaled = BigInt(whole) * 10n ** BigInt(digits) + BigInt(fraction.padEnd(digits, '0') || '0')
  return negative ? -scaled : scaled
}

/** The inverse: 540312n at 2 digits is "5403.12". */
export function decimalFromScaled(value: bigint, digits: number): string {
  const negative = value < 0n
  const body = (negative ? -value : value).toString().padStart(digits + 1, '0')
  const sign = negative ? '-' : ''
  if (digits === 0) return sign + body
  return `${sign}${body.slice(0, -digits)}.${body.slice(-digits)}`
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
