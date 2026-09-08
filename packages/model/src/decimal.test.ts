import { describe, expect, it } from 'vitest'
import {
  INT8_MAX,
  convertScaled,
  decimalFromScaled,
  divideRounded,
  scaledFromDecimal,
} from './decimal'

describe('scaledFromDecimal', () => {
  it('works at every scale the model uses, not only at two digits', () => {
    // Money keeps two today, quantity three, a rate six — and a currency with none is the
    // case the whole per-currency exponent exists for, so it is exercised here rather
    // than by borrowing a real currency and putting it back.
    expect(scaledFromDecimal('5403', 0)).toBe(5403n)
    expect(scaledFromDecimal('5403.12', 2)).toBe(540312n)
    expect(scaledFromDecimal('1.128', 3)).toBe(1128n)
    expect(scaledFromDecimal('4.82', 6)).toBe(4_820_000n)
  })

  it('refuses a fractional part the scale cannot hold', () => {
    expect(scaledFromDecimal('5403.1', 0)).toBeNull()
    expect(scaledFromDecimal('1.234', 2)).toBeNull()
    expect(scaledFromDecimal('1.2345', 3)).toBeNull()
  })

  it('takes a space between groups of three and nowhere else', () => {
    expect(scaledFromDecimal('5 403,12', 2)).toBe(540312n)
    for (const typo of ['5 4 0 3.1 2', '- 5', '5 40,12', '5 4033', '']) {
      expect(scaledFromDecimal(typo, 2)).toBeNull()
    }
  })
})

describe('decimalFromScaled', () => {
  it('is the inverse at every scale, padding and sign included', () => {
    expect(decimalFromScaled(5403n, 0)).toBe('5403')
    expect(decimalFromScaled(540312n, 2)).toBe('5403.12')
    expect(decimalFromScaled(5n, 2)).toBe('0.05')
    expect(decimalFromScaled(-4050n, 2)).toBe('-40.50')
    expect(decimalFromScaled(1128n, 3)).toBe('1.128')
    expect(decimalFromScaled(4_820_000n, 6)).toBe('4.820000')
  })
})

describe('divideRounded', () => {
  it('rounds to nearest, half away from zero, symmetrically', () => {
    expect(divideRounded(5n, 2n)).toBe(3n)
    expect(divideRounded(-5n, 2n)).toBe(-3n)
    expect(divideRounded(4n, 2n)).toBe(2n)
    expect(divideRounded(1n, 3n)).toBe(0n)
    expect(divideRounded(2n, 3n)).toBe(1n)
  })
})

describe('convertScaled', () => {
  const RATE_DIGITS = 6

  it('uses both exponents, not the one they happen to share today', () => {
    // 6 493,12 in a two-digit currency at 4,82 per unit is 1 347,12 in another two-digit
    // one. The same money in a currency with no minor unit is 1 347 whole units, and a
    // formula with the two exponents swapped would give 134 712 — which no test built
    // from AMD, RUB, USD and EUR could ever see, because there the factors cancel.
    expect(convertScaled(649312n, 4_820_000n, RATE_DIGITS, 2, 2)).toBe(134712n)
    expect(convertScaled(649312n, 4_820_000n, RATE_DIGITS, 2, 0)).toBe(1347n)
    expect(convertScaled(6493n, 4_820_000n, RATE_DIGITS, 0, 2)).toBe(134710n)
    expect(convertScaled(649312n, 4_820_000n, RATE_DIGITS, 2, 3)).toBe(1347120n)
  })

  it('rounds a half away from zero, like every other division here', () => {
    expect(convertScaled(1n, 2_000_000n, RATE_DIGITS, 2, 2)).toBe(1n)
    expect(convertScaled(-1n, 2_000_000n, RATE_DIGITS, 2, 2)).toBe(-1n)
  })
})

describe('INT8_MAX', () => {
  it('is the ceiling of the column the amounts are declared to live in', () => {
    expect(INT8_MAX).toBe(2n ** 63n - 1n)
  })
})
