import { describe, expect, it } from 'vitest'
import { DomainError, ERROR } from './errors'
import { addMoney, compareMoney, formatMoney, money, parseMoney, subtractMoney } from './money'

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
  // allowed to disappear. Digits are asserted with spaces stripped: the grouping
  // separator Intl picks differs between ICU builds and is not what is under test.
  const digits = (text: string): string => text.replace(/[\s\u00a0\u202f]/g, '')

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
