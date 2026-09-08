import { describe, expect, it } from 'vitest'
import { z } from 'zod'
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

  it('handles a whole amount and a negative one', () => {
    expect(parseMoney('570', 'AMD').minor).toBe(57000n)
    expect(parseMoney('-40.50', 'RUB').minor).toBe(-4050n)
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
    expect(digits(formatMoney(money(-4050n, 'RUB')))).toContain('40,50')
    expect(formatMoney(money(-4050n, 'RUB'))).toMatch(/-|−/)
  })
})

describe('the minor-unit exponent', () => {
  it('is what minorPerMajor is derived from, for every currency', () => {
    for (const currency of currencySchema.options) {
      expect(minorPerMajor(currency)).toBe(10n ** BigInt(MINOR_EXPONENT[currency]))
    }
  })

  it('is read from the currency at call time, not baked into the code', () => {
    // Every supported currency uses two digits today, so nothing here would notice a
    // hardcoded 100n coming back. Borrowing one currency for the length of this test is
    // the only way to pin what the table is for: a currency with no fractional part.
    const original = MINOR_EXPONENT.AMD
    MINOR_EXPONENT.AMD = 0
    try {
      expect(parseMoney('5403', 'AMD').minor).toBe(5403n)
      expect(() => parseMoney('5403.12', 'AMD')).toThrow(DomainError)
      expect(decimalFromMinor(money(5403n, 'AMD'))).toBe('5403')
      expect(digits(formatMoney(money(5403n, 'AMD')))).toContain('5403')
      expect(digits(formatMoney(money(5403n, 'AMD')))).not.toContain('5403,00')
    } finally {
      MINOR_EXPONENT.AMD = original
    }
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
