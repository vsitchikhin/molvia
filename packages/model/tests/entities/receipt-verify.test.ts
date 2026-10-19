import { describe, expect, it } from 'vitest'
import { verifiedReading } from '#model/entities/receipt-verify'
import type { ReceiptText, ReceiptTextLine } from '#model/entities/receipt-text'

const line = (over: Partial<ReceiptTextLine> = {}): ReceiptTextLine => ({
  printed: 'Կաթ',
  hs: '0401',
  sku: '1163909',
  quantityMilli: 2_000,
  unit: 'piece',
  priceHundredths: 37_000,
  sumHundredths: 74_000,
  discountHundredths: 0,
  settled: true,
  asPrinted: true,
  rows: [],
  ...over,
})

const reading = (lines: ReceiptTextLine[], total: number | null = null): ReceiptText => ({
  layout: 'card',
  tin: null,
  date: null,
  time: null,
  receiptNo: null,
  totalHundredths: total,
  readTotalHundredths: total,
  balanced: true,
  lines,
})

const figures = (l: ReceiptTextLine) => [
  l.quantityMilli,
  l.priceHundredths,
  l.sumHundredths,
  l.discountHundredths,
  l.settled,
]
const BLANK = [null, null, null, null, false]
const one = (over: Partial<ReceiptTextLine>, total: number | null = null) =>
  verifiedReading(reading([line(over)], total)).lines[0]!

describe('what of a reading goes to the review as read (MOL-255)', () => {
  it('keeps a line as printed whose arithmetic is its own: 2 × 370 = 740', () => {
    expect(figures(one({}))).toEqual([2_000, 37_000, 74_000, 0, true])
  })

  it('keeps a shelf price, a discount and what was paid that add up as printed', () => {
    const got = one({
      quantityMilli: 1_000,
      priceHundredths: 219_000,
      sumHundredths: 128_991,
      discountHundredths: 90_009,
    })
    expect(figures(got)).toEqual([1_000, 219_000, 128_991, 90_009, true])
  })

  it('keeps a weight read with its price: 0,902 kg × 675 = 608,85', () => {
    const got = one({
      quantityMilli: 902,
      unit: 'kg',
      priceHundredths: 67_500,
      sumHundredths: 60_885,
    })
    expect(figures(got)).toEqual([902, 67_500, 60_885, 0, true])
  })

  it('empties a line not as printed — a swap, a figure worked out, the total’s rest', () => {
    expect(figures(one({ asPrinted: false }))).toEqual(BLANK)
    expect(figures(one({ asPrinted: false, settled: false }))).toEqual(BLANK)
  })

  it('keeps the name, the codes and the rows of an emptied line', () => {
    const got = one({ asPrinted: false })
    expect([got.printed, got.hs, got.sku, got.unit]).toEqual(['Կաթ', '0401', '1163909', 'piece'])
  })

  it('empties a sum of nothing or below it, and a line with no quantity or no sum', () => {
    expect(figures(one({ sumHundredths: 0, priceHundredths: 0 }))).toEqual(BLANK)
    expect(figures(one({ sumHundredths: -18_214_000 }))).toEqual(BLANK)
    expect(figures(one({ quantityMilli: null }))).toEqual(BLANK)
    expect(figures(one({ sumHundredths: null }))).toEqual(BLANK)
  })

  it('keeps the shelf price of a till that rounds what was paid: «419,98/0 490/420»', () => {
    const got = one({ quantityMilli: 1_000, priceHundredths: 42_000, sumHundredths: 41_998 })
    expect(figures(got)).toEqual([1_000, 42_000, 41_998, 0, true])
  })

  it('keeps it within three luma of the card’s rounding, and not a luma past them', () => {
    const off = (sum: number) =>
      one({
        quantityMilli: 1_000,
        priceHundredths: 79_000,
        sumHundredths: sum,
        discountHundredths: 8_690,
      }).priceHundredths
    expect([off(70_306), off(70_307), off(70_313), off(70_314)]).toEqual([
      null,
      79_000,
      79_000,
      null,
    ])
  })

  it('keeps no price off the sum elsewhere: the terminal’s 624,44 for a sum of 624,41', () => {
    const terminal = (over: Partial<ReceiptTextLine>) =>
      verifiedReading({ ...reading([line(over)]), layout: 'class' }).lines[0]!
    const got = terminal({ quantityMilli: 1_000, priceHundredths: 62_444, sumHundredths: 62_441 })
    expect(figures(got)).toEqual([1_000, null, 62_441, null, true])
    const off = (price: number) =>
      terminal({ quantityMilli: 3_000, priceHundredths: price, sumHundredths: 30_000 })
        .priceHundredths
    expect([off(9_999), off(10_000), off(10_001)]).toEqual([null, 10_000, null])
  })
})

describe('a line of one piece whose price is its sum (MOL-255, В-2 «а»)', () => {
  const alike = { quantityMilli: 1_000, priceHundredths: 66_000, sumHundredths: 66_000 }

  it('is emptied on its own: «660 660» holds for 560 misread alike in both columns', () => {
    expect(figures(one(alike))).toEqual(BLANK)
    expect(figures(one(alike, 100_000))).toEqual(BLANK)
  })

  it('is kept on a receipt proven whole: every line as printed, their sums the total shown', () => {
    const got = verifiedReading(reading([line(alike), line()], 140_000))
    expect(got.lines.map(figures)).toEqual([
      [1_000, 66_000, 66_000, 0, true],
      [2_000, 37_000, 74_000, 0, true],
    ])
    expect(got.balanced).toBe(true)
  })

  it('is emptied where the lines are a hundredth off the total, or the total is none', () => {
    expect(figures(verifiedReading(reading([line(alike), line()], 140_001)).lines[0]!)).toEqual(
      BLANK,
    )
    expect(figures(verifiedReading(reading([line(alike), line()])).lines[0]!)).toEqual(BLANK)
  })

  it('is emptied where another line of the receipt is not as printed, though the sums meet', () => {
    const got = verifiedReading(reading([line(alike), line({ asPrinted: false })], 140_000))
    expect(got.lines.map(figures)).toEqual([BLANK, BLANK])
    expect(got.balanced).toBe(false)
  })

  it('is no rule of a weight: one kilogram at its price is a weight read', () => {
    expect(figures(one({ ...alike, unit: 'kg' }))).toEqual([1_000, 66_000, 66_000, 0, true])
  })

  it('is no rule of a line with a discount: three figures add up', () => {
    const got = one({ ...alike, sumHundredths: 59_400, discountHundredths: 6_600 })
    expect(figures(got)).toEqual([1_000, 66_000, 59_400, 6_600, true])
  })
})

describe('the receipt as a whole', () => {
  it('is balanced only when proven, whatever the parse said', () => {
    expect(verifiedReading(reading([line()], 74_000)).balanced).toBe(true)
    expect(verifiedReading({ ...reading([line()], 50_000), balanced: true }).balanced).toBe(false)
  })

  it('keeps every line, in order, and the head and totals as they were', () => {
    const lines = [line({ sku: 'a', asPrinted: false }), line({ sku: 'b' })]
    const got = verifiedReading(reading(lines, 99_900))
    expect(got.lines.map((l) => l.sku)).toEqual(['a', 'b'])
    expect([got.totalHundredths, got.readTotalHundredths, got.layout]).toEqual([
      99_900,
      99_900,
      'card',
    ])
  })

  it('reads no line at all as nothing proven', () => {
    expect(verifiedReading(reading([], 0)).balanced).toBe(false)
  })
})
