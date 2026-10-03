import { describe, expect, it } from 'vitest'
import {
  RESHOOT_TOTAL_SHARE,
  moneyOfHundredths,
  needsReshoot,
  receiptDateOf,
  receiptLineOf,
} from '#model/entities/receipt'
import type { ReceiptText, ReceiptTextLine } from '#model/entities/receipt-text'

const line = (over: Partial<ReceiptTextLine> = {}): ReceiptTextLine => ({
  printed: 'Կաթ',
  hs: '0401',
  sku: '1163909',
  quantityMilli: 1_000,
  unit: 'piece',
  priceHundredths: 37_000,
  sumHundredths: 37_000,
  discountHundredths: 0,
  settled: true,
  rows: [],
  ...over,
})

const receipt = (lines: ReceiptTextLine[], totalHundredths: number | null = null): ReceiptText => ({
  layout: 'card',
  tin: null,
  date: null,
  time: null,
  receiptNo: null,
  totalHundredths,
  balanced: false,
  lines,
})

describe('«разгладьте и переснимите» (В-4)', () => {
  it('asks for a new shot when no item line was read', () => {
    expect(needsReshoot(receipt([], 100_000))).toBe(true)
    expect(needsReshoot(receipt([]))).toBe(true)
  })

  it(`with the total read, asks below ${String(RESHOOT_TOTAL_SHARE * 100)} % of it: exactly the share, a luma under`, () => {
    expect(needsReshoot(receipt([line({ sumHundredths: 70_000 })], 100_000))).toBe(false)
    expect(needsReshoot(receipt([line({ sumHundredths: 69_999 })], 100_000))).toBe(true)
  })

  it('with the total read, one lost line of many is the review screen’s, not a new shot (am-03: 0,97)', () => {
    expect(needsReshoot(receipt([line({ sumHundredths: 97_000 })], 100_000))).toBe(false)
  })

  it('with the total read, counts a line whose sum was lost as nothing', () => {
    expect(
      needsReshoot(
        receipt([line({ sumHundredths: null }), line({ sumHundredths: 50_000 })], 100_000),
      ),
    ).toBe(true)
  })

  it('with no total, asks when fewer than half the lines add up: half is enough', () => {
    expect(needsReshoot(receipt([line(), line({ settled: false })]))).toBe(false)
    expect(
      needsReshoot(receipt([line(), line({ settled: false }), line({ settled: false })])),
    ).toBe(true)
  })

  it('must not fire on a short receipt whose total was missed but whose lines add up (am-01)', () => {
    expect(needsReshoot(receipt([line(), line(), line()]))).toBe(false)
  })

  it('takes a total of zero for no total', () => {
    expect(needsReshoot(receipt([line()], 0))).toBe(false)
  })
})

describe('the figures as the domain’s values', () => {
  it('reads a till’s hundredths as drams’ minor units', () => {
    expect(moneyOfHundredths(76_075, 'AMD')).toEqual({ minor: 76_075n, currency: 'AMD' })
  })

  it('takes no amount for a negative, a missing or a broken figure', () => {
    expect([
      moneyOfHundredths(-1, 'AMD'),
      moneyOfHundredths(null, 'AMD'),
      moneyOfHundredths(Number.NaN, 'AMD'),
    ]).toEqual([null, null, null])
  })

  it('keeps a weight in thousandths of a kilogram', () => {
    expect(receiptLineOf(line({ quantityMilli: 1_312, unit: 'kg' }), 'AMD').quantity).toEqual({
      milli: 1_312n,
      unit: 'kg',
    })
  })

  it('takes no count for a fraction read for pieces', () => {
    expect(receiptLineOf(line({ quantityMilli: 1_500 }), 'AMD').quantity).toBeNull()
  })

  it('takes no quantity for zero', () => {
    expect(receiptLineOf(line({ quantityMilli: 0 }), 'AMD').quantity).toBeNull()
  })

  it('carries the line as printed, its heading and article', () => {
    const got = receiptLineOf(line(), 'AMD')
    expect([got.printed, got.hs, got.sku, got.settled, got.sum]).toEqual([
      'Կաթ',
      '0401',
      '1163909',
      true,
      { minor: 37_000n, currency: 'AMD' },
    ])
  })
})

describe('the date a receipt prints', () => {
  it('takes a real day', () => {
    expect(receiptDateOf({ ...receipt([]), date: '2026-09-30' })).toBe('2026-09-30')
  })

  it('drops a day OCR made up: 30 February, month 13', () => {
    expect(receiptDateOf({ ...receipt([]), date: '2026-02-30' })).toBeNull()
    expect(receiptDateOf({ ...receipt([]), date: '2026-13-01' })).toBeNull()
  })

  it('has none when none was read', () => {
    expect(receiptDateOf(receipt([]))).toBeNull()
  })
})
