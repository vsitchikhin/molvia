import { describe, expect, it } from 'vitest'
import { ERROR } from './errors'
import { money, parseMoney } from './money'
import { UNIT_PRICE_SCALE, compareUnitPrice, parseQuantity, unitPrice } from './units'

describe('parseQuantity', () => {
  it('reduces every unit to thousandths of its base unit', () => {
    expect(parseQuantity('1.128', 'kg')).toEqual({ milli: 1128n, unit: 'kg' })
    expect(parseQuantity('900', 'g')).toEqual({ milli: 900n, unit: 'kg' })
    expect(parseQuantity('0.9', 'l')).toEqual({ milli: 900n, unit: 'l' })
    expect(parseQuantity('900', 'ml')).toEqual({ milli: 900n, unit: 'l' })
    expect(parseQuantity('2', 'piece')).toEqual({ milli: 2000n, unit: 'piece' })
  })

  it('rejects zero, negatives and junk', () => {
    for (const bad of ['0', '-1', '', 'kg', '1.2345']) {
      expect(() => parseQuantity(bad, 'kg')).toThrowError(
        expect.objectContaining({ code: ERROR.INVALID_QUANTITY }),
      )
    }
  })
})

describe('unitPrice', () => {
  it('recovers the shelf price from a weighed receipt', () => {
    // 1.128 kg of beef for 5403.12 AMD is exactly 4790.00 AMD per kg
    const price = unitPrice(parseMoney('5403.12', 'AMD'), parseQuantity('1.128', 'kg'))
    expect(price.scaledMinor).toBe(479000n * UNIT_PRICE_SCALE)
  })

  it('sees through a smaller package: 520 for 0.9 l is dearer than 570 for a litre', () => {
    const small = unitPrice(parseMoney('520', 'AMD'), parseQuantity('0.9', 'l'))
    const full = unitPrice(parseMoney('570', 'AMD'), parseQuantity('1', 'l'))
    expect(compareUnitPrice(small, full)).toBe(1)
  })

  it('refuses to compare across currencies or across units', () => {
    const amd = unitPrice(money(100n, 'AMD'), parseQuantity('1', 'kg'))
    const rub = unitPrice(money(100n, 'RUB'), parseQuantity('1', 'kg'))
    const litres = unitPrice(money(100n, 'AMD'), parseQuantity('1', 'l'))
    expect(() => compareUnitPrice(amd, rub)).toThrowError(
      expect.objectContaining({ code: ERROR.CURRENCY_MISMATCH }),
    )
    expect(() => compareUnitPrice(amd, litres)).toThrowError(
      expect.objectContaining({ code: ERROR.UNIT_MISMATCH }),
    )
  })

  it('rejects a zero quantity instead of dividing by it', () => {
    expect(() => unitPrice(money(1n, 'AMD'), { milli: 0n, unit: 'kg' })).toThrowError(
      expect.objectContaining({ code: ERROR.INVALID_QUANTITY }),
    )
  })
})
