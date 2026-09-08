import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { ERROR } from './errors'
import { decimalFromRate, exchangeRateSchema, parseRate, rateCodec } from './rates'

const asOf = new Date('2026-09-08T10:00:00Z')

const rate = {
  base: 'RUB',
  quote: 'AMD',
  scaled: 4_820_000n,
  source: 'official',
  asOf,
}

describe('parseRate', () => {
  it('scales a rate the way a receipt writes it', () => {
    expect(parseRate('4.82')).toBe(4_820_000n)
    expect(parseRate('4,82')).toBe(4_820_000n)
    expect(parseRate('4.820000')).toBe(4_820_000n)
    expect(parseRate('1')).toBe(1_000_000n)
  })

  it('rejects a rate that is zero, negative or too precise to be one', () => {
    for (const bad of ['0', '-4.82', '4.8200001', 'abc', '']) {
      expect(() => parseRate(bad)).toThrow(expect.objectContaining({ code: ERROR.INVALID_AMOUNT }))
    }
  })

  it('round-trips through the decimal form', () => {
    expect(decimalFromRate(parseRate('4.82'))).toBe('4.820000')
  })
})

describe('exchangeRateSchema', () => {
  it('accepts a rate between two currencies', () => {
    expect(exchangeRateSchema.parse(rate).scaled).toBe(4_820_000n)
  })

  it('refuses a rate from a currency to itself', () => {
    // Not 1 — a mistake upstream: nothing should have built a rate at all.
    expect(() => exchangeRateSchema.parse({ ...rate, quote: 'RUB' })).toThrow()
  })

  it('refuses a non-positive rate', () => {
    expect(() => exchangeRateSchema.parse({ ...rate, scaled: 0n })).toThrow()
  })
})

describe('rateCodec', () => {
  it('carries the rate and its date over a wire that holds neither natively', () => {
    const value = exchangeRateSchema.parse(rate)
    expect(() => JSON.stringify(value)).toThrow(TypeError)

    const wire = z.encode(rateCodec, value)
    expect(wire).toEqual({
      base: 'RUB',
      quote: 'AMD',
      rate: '4.820000',
      source: 'official',
      asOf: '2026-09-08T10:00:00.000Z',
    })
    expect(rateCodec.parse(JSON.parse(JSON.stringify(wire)))).toEqual(value)
  })

  it('refuses a malformed rate rather than coercing it', () => {
    const wire = {
      base: 'RUB',
      quote: 'AMD',
      rate: 'abc',
      source: 'official',
      asOf: asOf.toISOString(),
    }
    expect(() => rateCodec.parse(wire)).toThrow()
  })

  it('refuses a date that is not ISO', () => {
    const wire = {
      base: 'RUB',
      quote: 'AMD',
      rate: '4.820000',
      source: 'official',
      asOf: '08.09.2026',
    }
    expect(() => rateCodec.parse(wire)).toThrow()
  })
})
