import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { DomainError, ERROR } from '#model/support/errors'
import { money, parseMoney } from '#model/values/money'
import {
  UNIT_PRICE_SCALE,
  compareUnitPrice,
  decimalFromMilli,
  formatUnitPrice,
  parseQuantity,
  quantityCodec,
  unitPrice,
} from '#model/values/units'

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
      expect(() => parseQuantity(bad, 'kg')).toThrow(
        expect.objectContaining({ code: ERROR.INVALID_QUANTITY }),
      )
    }
  })

  it('refuses precision below the resolution of the unit instead of dropping it', () => {
    // 1.9 g used to become 1 g without a word, while 0.5 g was an error: the same loss
    // gave two different answers depending on whether it crossed a whole unit.
    for (const bad of ['1.9', '0.5', '1.001']) {
      expect(() => parseQuantity(bad, 'g')).toThrow(
        expect.objectContaining({ code: ERROR.INVALID_QUANTITY }),
      )
    }
    expect(() => parseQuantity('1.5', 'ml')).toThrow(DomainError)
  })

  it('refuses «1,500» rather than reading it as 1 g', () => {
    // A Russian keyboard and an Armenian price tag both write 1500 that way, and it used
    // to parse as a thousandth of it — a thousandfold error straight into a unit price.
    expect(parseQuantity('1 500', 'g').milli).toBe(1500n)
    expect(parseQuantity('1500', 'g').milli).toBe(1500n)
    expect(() => parseQuantity('1,500', 'g')).toThrow(DomainError)
  })

  it('refuses half a piece, because a piece does not divide', () => {
    expect(parseQuantity('2', 'piece').milli).toBe(2000n)
    for (const bad of ['1.5', '0.001']) {
      expect(() => parseQuantity(bad, 'piece')).toThrow(DomainError)
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
    expect(() => compareUnitPrice(amd, rub)).toThrow(
      expect.objectContaining({ code: ERROR.CURRENCY_MISMATCH }),
    )
    expect(() => compareUnitPrice(amd, litres)).toThrow(
      expect.objectContaining({ code: ERROR.UNIT_MISMATCH }),
    )
  })

  it('rejects a zero quantity instead of dividing by it', () => {
    expect(() => unitPrice(money(1n, 'AMD'), { milli: 0n, unit: 'kg' })).toThrow(
      expect.objectContaining({ code: ERROR.INVALID_QUANTITY }),
    )
  })
})

describe('formatUnitPrice', () => {
  const digits = (text: string): string => text.replace(/[\s\u00a0\u202f]/g, '')

  it('reads back the shelf price per unit', () => {
    const price = unitPrice(parseMoney('5403.12', 'AMD'), parseQuantity('1.128', 'kg'))
    const text = formatUnitPrice(price)
    expect(digits(text)).toContain('4790,00')
    expect(text.endsWith('/kg')).toBe(true)
  })

  it('rounds only here, and only to the minor unit', () => {
    // 520 for 0.9 l is 577.77… per litre; the repeating tail must not reach the user.
    const price = unitPrice(parseMoney('520', 'AMD'), parseQuantity('0.9', 'l'))
    expect(digits(formatUnitPrice(price))).toContain('577,78')
  })
})

describe('quantityCodec', () => {
  it('carries the quantity over a wire that a bigint cannot cross on its own', () => {
    const value = parseQuantity('1.128', 'kg')
    expect(() => JSON.stringify(value)).toThrow(TypeError)

    const wire = z.encode(quantityCodec, value)
    expect(wire).toEqual({ value: '1.128', unit: 'kg' })
    expect(quantityCodec.parse(JSON.parse(JSON.stringify(wire)))).toEqual(value)
  })

  it('travels in the base unit, so grams come back as kilograms', () => {
    expect(z.encode(quantityCodec, parseQuantity('900', 'g'))).toEqual({
      value: '0.900',
      unit: 'kg',
    })
  })

  it('refuses a non-positive quantity rather than letting unitPrice divide by it', () => {
    expect(() => quantityCodec.parse({ value: '0', unit: 'kg' })).toThrow()
  })

  it('reports it through safeParse rather than escaping it', () => {
    const parsed = quantityCodec.safeParse({ value: '0', unit: 'kg' })
    expect(parsed.success).toBe(false)
    if (parsed.success) return
    expect(parsed.error.issues[0]).toMatchObject({
      path: ['value'],
      message: ERROR.INVALID_QUANTITY,
    })
  })
})

describe('decimalFromMilli', () => {
  it('is the inverse of parseQuantity for a base unit', () => {
    expect(decimalFromMilli(parseQuantity('1.128', 'kg'))).toBe('1.128')
    expect(decimalFromMilli(parseQuantity('0.9', 'l'))).toBe('0.900')
    expect(decimalFromMilli(parseQuantity('2', 'piece'))).toBe('2.000')
  })
})
