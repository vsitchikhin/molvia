import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { INT8_MAX } from './decimal'
import { DomainError, ERROR } from './errors'
import {
  MINOR_EXPONENT,
  addMoney,
  compareMoney,
  currencySchema,
  decimalFromMinor,
  formatMoney,
  minorPerMajor,
  money,
  moneyCodec,
  parseMoney,
  subtractMoney,
} from './money'

// Digits are asserted with spaces stripped: the grouping separator Intl picks differs
// between ICU builds and is not what is under test.
const digits = (text: string): string => text.replace(/[\s\u00a0\u202f]/g, '')

describe('parseMoney', () => {
  it('keeps the fractional part of a dram receipt', () => {
    expect(parseMoney('5403.12', 'AMD').minor).toBe(540312n)
  })

  it('accepts a comma and every kind of space a keyboard or a receipt produces', () => {
    expect(parseMoney('5 403,12', 'AMD').minor).toBe(540312n)
    expect(parseMoney('5\u00a0403,12', 'AMD').minor).toBe(540312n)
    expect(parseMoney('5\u202f403.12', 'AMD').minor).toBe(540312n)
  })

  it('pads a single decimal digit instead of dropping it', () => {
    expect(parseMoney('12.5', 'RUB').minor).toBe(1250n)
  })

  it('handles a whole amount', () => {
    expect(parseMoney('570', 'AMD').minor).toBe(57000n)
  })

  it('refuses a negative amount: a price is not a difference', () => {
    expect(() => parseMoney('-40.50', 'RUB')).toThrow(
      expect.objectContaining({ code: ERROR.INVALID_AMOUNT }),
    )
  })

  it('refuses an amount the bigint column could not hold', () => {
    expect(() => parseMoney('9'.repeat(20), 'AMD')).toThrow(DomainError)
  })

  it('takes a space as a group separator and nothing else', () => {
    expect(parseMoney('5 403,12', 'AMD').minor).toBe(540312n)
    for (const typo of ['5 4 0 3.1 2', '- 5', '5 40,12', '5 4033']) {
      expect(() => parseMoney(typo, 'AMD')).toThrow(DomainError)
    }
  })

  it('rejects what is not an amount', () => {
    for (const bad of ['', ' ', 'abc', '1.234', '1..2', '1,2,3', '--1']) {
      expect(() => parseMoney(bad, 'AMD')).toThrow(DomainError)
    }
  })

  it('reports the registry code, not a message written in place', () => {
    expect(() => parseMoney('abc', 'AMD')).toThrow(
      expect.objectContaining({ code: ERROR.INVALID_AMOUNT }),
    )
  })
})

describe('arithmetic', () => {
  it('adds and subtracts within one currency', () => {
    const a = money(540312n, 'AMD')
    const b = money(57000n, 'AMD')
    expect(addMoney(a, b).minor).toBe(597312n)
    expect(subtractMoney(a, b).minor).toBe(483312n)
  })

  it('refuses to mix currencies rather than guessing a rate', () => {
    const amd = money(1n, 'AMD')
    const rub = money(1n, 'RUB')
    expect(() => addMoney(amd, rub)).toThrow(
      expect.objectContaining({ code: ERROR.CURRENCY_MISMATCH }),
    )
    expect(() => compareMoney(amd, rub)).toThrow(DomainError)
  })

  it('orders amounts', () => {
    expect(compareMoney(money(1n, 'AMD'), money(2n, 'AMD'))).toBe(-1)
    expect(compareMoney(money(2n, 'AMD'), money(2n, 'AMD'))).toBe(0)
  })
})

describe('formatMoney', () => {
  // Rounding happens here and nowhere else, so this is the only place a fraction is
  // allowed to disappear.

  it('keeps both minor digits of a dram amount', () => {
    expect(digits(formatMoney(money(540312n, 'AMD')))).toContain('5403,12')
  })

  it('shows a whole amount with its zeroes rather than bare', () => {
    expect(digits(formatMoney(money(57000n, 'AMD')))).toContain('570,00')
  })

  it('keeps the sign of a negative amount', () => {
    // Not a price — a difference, which is the one shape allowed to be negative.
    expect(digits(formatMoney(money(-4050n, 'RUB')))).toContain('40,50')
    expect(formatMoney(money(-4050n, 'RUB'))).toMatch(/-|−/)
  })

  it('prints the dram sign, which is what the separate font face exists for', () => {
    expect(formatMoney(money(540312n, 'AMD'))).toContain('֏')
    expect(formatMoney(money(540312n, 'AMD'))).not.toContain('AMD')
  })

  it('stays exact past 2^53 instead of drifting or printing infinity', () => {
    // The only bridge from bigint to float used to be here, and it failed quietly.
    const huge = money(9_007_199_254_740_993n, 'USD')
    // en-US groups with commas, so strip those too before reading the digits back.
    const bare = formatMoney(huge, 'en-US').replace(/[\s\u00a0\u202f,]/g, '')
    expect(bare).toContain('90071992547409.93')
    expect(bare).not.toContain('90071992547409.92')

    // Exact all the way to the ceiling the model accepts, which is the bigint column.
    const ceiling = formatMoney(money(INT8_MAX, 'USD'), 'en-US').replace(/[\s,]/g, '')
    expect(ceiling).toContain('92233720368547758.07')
  })
})

describe('the minor-unit exponent', () => {
  it('is what minorPerMajor is derived from, for every currency', () => {
    for (const currency of currencySchema.options) {
      expect(minorPerMajor(currency)).toBe(10n ** BigInt(MINOR_EXPONENT[currency]))
    }
  })

  it('is frozen, so nothing can rewrite what an already stored amount means', () => {
    // `const` holds the binding, not the contents. A write here would leave every stored
    // minor unit exactly as it is and change the price it reads as — and a value outside
    // the union made minorPerMajor undefined, which printed NaN where a price belongs.
    expect(Object.isFrozen(MINOR_EXPONENT)).toBe(true)
    expect(() => {
      // @ts-expect-error readonly in the type as well as at runtime — this is the point
      MINOR_EXPONENT.AMD = 0
    }).toThrow(TypeError)
  })

  it('rejects one digit more than the currency keeps', () => {
    for (const currency of currencySchema.options) {
      expect(() => parseMoney('1.234', currency)).toThrow(DomainError)
    }
  })
})

describe('decimalFromMinor', () => {
  it('is the inverse of parseMoney, padding and all', () => {
    expect(decimalFromMinor(money(540312n, 'AMD'))).toBe('5403.12')
    expect(decimalFromMinor(money(5n, 'RUB'))).toBe('0.05')
    expect(decimalFromMinor(money(0n, 'RUB'))).toBe('0.00')
    expect(decimalFromMinor(money(-4050n, 'RUB'))).toBe('-40.50')
  })
})

describe('moneyCodec', () => {
  it('carries the amount over a wire that a bigint cannot cross on its own', () => {
    const value = money(540312n, 'AMD')
    expect(() => JSON.stringify(value)).toThrow(TypeError)

    const wire = z.encode(moneyCodec, value)
    expect(wire).toEqual({ amount: '5403.12', currency: 'AMD' })
    expect(moneyCodec.parse(JSON.parse(JSON.stringify(wire)))).toEqual(value)
  })

  it('sends a decimal string rather than a JSON number, which would be a double', () => {
    expect(typeof z.encode(moneyCodec, money(540312n, 'AMD')).amount).toBe('string')
  })

  it('keeps an amount past Number.MAX_SAFE_INTEGER exact — the whole reason for bigint', () => {
    const huge = money(BigInt(Number.MAX_SAFE_INTEGER) * 1000n + 7n, 'AMD')
    const wire = JSON.parse(JSON.stringify(z.encode(moneyCodec, huge))) as unknown
    expect(moneyCodec.parse(wire).minor).toBe(huge.minor)
  })

  it('refuses a malformed amount instead of coercing it', () => {
    expect(() => moneyCodec.parse({ amount: '1.234', currency: 'AMD' })).toThrow()
    expect(() => moneyCodec.parse({ amount: 'abc', currency: 'AMD' })).toThrow()
  })

  it('reports a bad amount through safeParse rather than escaping it', () => {
    // safeParse exists so it does not throw. A transform that throws would fly past the
    // `if (!parsed.success) return 400` branch of every route written the canonical way.
    const parsed = moneyCodec.safeParse({ amount: 'abc', currency: 'AMD' })
    expect(parsed.success).toBe(false)
    if (parsed.success) return
    expect(parsed.error.issues[0]).toMatchObject({
      path: ['amount'],
      message: ERROR.INVALID_AMOUNT,
    })
  })
})
