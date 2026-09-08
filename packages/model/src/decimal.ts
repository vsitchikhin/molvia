/**
 * A space is a group separator, not a character to ignore: "5 403,12" is what a receipt
 * prints, "5 4 0 3.1 2" is a typo, and stripping every space made both into numbers.
 */
export function scaledFromDecimal(input: string, digits: number): bigint | null {
  const text = input.trim().replace(',', '.')

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

export const INT8_MAX = 9_223_372_036_854_775_807n

export function decimalFromScaled(value: bigint, digits: number): `${number}` {
  const negative = value < 0n
  const body = (negative ? -value : value).toString().padStart(digits + 1, '0')
  const sign = negative ? '-' : ''
  const decimal =
    digits === 0 ? sign + body : `${sign}${body.slice(0, -digits)}.${body.slice(-digits)}`
  return decimal as `${number}`
}

/**
 * Apart from convertMoney so the two exponents can be exercised against each other: with
 * every currency on two digits the factors cancel, and a swapped formula looks correct.
 */
export function convertScaled(
  amount: bigint,
  rateScaled: bigint,
  rateDigits: number,
  fromExponent: number,
  toExponent: number,
): bigint {
  const numerator = amount * 10n ** BigInt(rateDigits) * 10n ** BigInt(toExponent)
  const denominator = rateScaled * 10n ** BigInt(fromExponent)
  return divideRounded(numerator, denominator)
}

/** Half away from zero, the way a till rounds. Truncation is a bias, not noise. */
export function divideRounded(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n
  const magnitude = negative ? -numerator : numerator
  const result = (magnitude + denominator / 2n) / denominator
  return negative ? -result : result
}
