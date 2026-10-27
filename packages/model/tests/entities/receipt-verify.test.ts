import { describe, expect, it } from 'vitest'
import { explainedReading, verifiedReading } from '#model/entities/receipt-verify'
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
    expect(figures(one({ quantityMilli: 1_000, sumHundredths: 0, priceHundredths: 0 }))).toEqual(
      BLANK,
    )
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

describe('a line paid nothing, its whole price the discount (review round 2, А7 «а»)', () => {
  const gift = { quantityMilli: 1_000, priceHundredths: 50_000, sumHundredths: 0 }

  it('keeps its figures where the discount is the price to the hundredth: «0,00/500,00 500»', () => {
    // of one piece on a receipt proven whole: the count and the nothing paid, no price (round 4, А11 «а»)
    const got = one({ ...gift, discountHundredths: 50_000 }, 0)
    expect(figures(got)).toEqual([1_000, null, 0, null, true])
    const two = one({ ...gift, quantityMilli: 2_000, discountHundredths: 100_000 })
    expect(figures(two)).toEqual([2_000, 50_000, 0, 100_000, true])
  })

  it('of one piece shows no price misread alike in both places on a receipt proven whole (А11)', () => {
    // «0,00/660,00 660» for 560 beside «300,00/0,00 300», the total 300: proven either way
    const got = verifiedReading(
      reading(
        [
          line({ ...gift, priceHundredths: 66_000, discountHundredths: 66_000 }),
          line({ quantityMilli: 1_000, priceHundredths: 30_000, sumHundredths: 30_000 }),
        ],
        30_000,
      ),
    )
    expect(got.balanced).toBe(true)
    expect(figures(got.lines[0]!)).toEqual([1_000, null, 0, null, true])
  })

  it('of one piece or one kilogram is kept only on a receipt proven whole (round 3, А9 «а»)', () => {
    // «0,00/660,00 660»: the price and the discount are one number twice, as «660 660» is
    expect(figures(one({ ...gift, discountHundredths: 50_000 }))).toEqual(BLANK)
    expect(figures(one({ ...gift, discountHundredths: 50_000 }, 1))).toEqual(BLANK)
    const weighed = one({ ...gift, unit: 'kg', discountHundredths: 50_000 })
    expect(figures(weighed)).toEqual(BLANK)
    // two pieces print two numbers, 500 and 1 000: no proof asked
    const two = one({ ...gift, quantityMilli: 2_000, discountHundredths: 100_000 })
    expect(figures(two)).toEqual([2_000, 50_000, 0, 100_000, true])
  })

  it('is emptied a hundredth off, with no discount, or with no price — the card’s rounding none', () => {
    // on a receipt proven whole, its total nothing: the gift's own arithmetic is all that empties it
    const proven = (over: Partial<ReceiptTextLine>) => figures(one({ ...gift, ...over }, 0))
    expect(proven({ discountHundredths: 49_999 })).toEqual(BLANK)
    expect(proven({ discountHundredths: 0 })).toEqual(BLANK)
    expect(proven({ discountHundredths: null })).toEqual(BLANK)
    expect(proven({ priceHundredths: null, discountHundredths: 50_000 })).toEqual(BLANK)
    const two = { quantityMilli: 2_000, discountHundredths: 99_999 }
    expect(figures(one({ ...gift, ...two }))).toEqual(BLANK)
  })

  it('proves a receipt with it: nothing and 300 are the total of 300', () => {
    const got = verifiedReading(
      reading(
        [
          line({ ...gift, discountHundredths: 50_000 }),
          line({ quantityMilli: 1_000, priceHundredths: 30_000, sumHundredths: 30_000 }),
        ],
        30_000,
      ),
    )
    expect(got.balanced).toBe(true)
    expect(got.lines.map(figures)).toEqual([
      [1_000, null, 0, null, true],
      [1_000, 30_000, 30_000, 0, true],
    ])
  })
})

describe('a line of one piece or one kilogram whose price is its sum (MOL-255, В-2 «а»)', () => {
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

  it('is the rule of one kilogram too: the till prints one number twice for it (adversarial А2)', () => {
    expect(figures(one({ ...alike, unit: 'kg' }))).toEqual(BLANK)
    const weighed = one({ ...alike, unit: 'kg', quantityMilli: 2_000, sumHundredths: 132_000 })
    expect(figures(weighed)).toEqual([2_000, 66_000, 132_000, 0, true])
  })

  it('is no rule of a line with a discount: three figures add up', () => {
    const got = one({ ...alike, sumHundredths: 59_400, discountHundredths: 6_600 })
    expect(figures(got)).toEqual([1_000, 66_000, 59_400, 6_600, true])
  })
})

describe('a model’s line of one piece whose price is within the rounding of its sum (MOL-272)', () => {
  // «389,99 390» answered as price 389,99 and sum 390: the model names the columns, and either way holds
  const swapped = { quantityMilli: 1_000, priceHundredths: 38_999, sumHundredths: 39_000 }
  const byModel = { byModel: true }

  it('is emptied on its own, as one number printed twice', () => {
    expect(figures(verifiedReading(reading([line(swapped)]), byModel).lines[0]!)).toEqual(BLANK)
    const apart = { ...swapped, priceHundredths: 39_003 }
    expect(figures(verifiedReading(reading([line(apart)]), byModel).lines[0]!)).toEqual(BLANK)
  })

  it('is no such line a luma past the rounding: its price goes, its sum stays', () => {
    const past = { ...swapped, priceHundredths: 39_004 }
    const got = verifiedReading(reading([line(past)]), byModel).lines[0]!
    expect(figures(got)).toEqual([1_000, null, 39_000, null, true])
  })

  it('is kept on a receipt proven whole', () => {
    const got = verifiedReading(reading([line(swapped), line()], 113_000), byModel)
    expect(got.lines.map(figures)).toEqual([
      [1_000, 38_999, 39_000, 0, true],
      [2_000, 37_000, 74_000, 0, true],
    ])
  })

  it('is OCR’s rounding, kept, where the columns are the paper’s: «419,98/0 490/420»', () => {
    const rounded = { quantityMilli: 1_000, priceHundredths: 42_000, sumHundredths: 41_998 }
    expect(figures(verifiedReading(reading([line(rounded)])).lines[0]!)).toEqual([
      1_000,
      42_000,
      41_998,
      0,
      true,
    ])
    expect(figures(verifiedReading(reading([line(rounded)]), byModel).lines[0]!)).toEqual(BLANK)
  })

  it('is no rule of a line with a discount, nor of a layout with no rounding', () => {
    const discounted = { ...swapped, priceHundredths: 39_400, discountHundredths: 400 }
    expect(figures(verifiedReading(reading([line(discounted)]), byModel).lines[0]!)).toEqual([
      1_000,
      39_400,
      39_000,
      400,
      true,
    ])
    const classLine = verifiedReading({ ...reading([line(swapped)]), layout: 'class' }, byModel)
    expect(figures(classLine.lines[0]!)).toEqual([1_000, null, 39_000, null, true])
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

describe('what the shop’s memory said of a line (MOL-291)', () => {
  const twice = {
    quantityMilli: 1_000,
    priceHundredths: 5_000,
    sumHundredths: 5_000,
    discountHundredths: 0,
  }

  it('keeps one number printed twice the memory confirms, on a receipt not proven whole', () => {
    expect(figures(one(twice))).toEqual(BLANK)
    expect(figures(one({ ...twice, remembered: 'confirmed' }))).toEqual([
      1_000,
      5_000,
      5_000,
      0,
      true,
    ])
  })

  it('keeps a line the memory put right on its own word, and one the total did only on a proven receipt', () => {
    const put = { ...twice, asPrinted: false, repaired: true }
    expect(figures(one(put))).toEqual(BLANK)
    expect(figures(one({ ...put, remembered: 'repaired' }))).toEqual([1_000, 5_000, 5_000, 0, true])
    expect(figures(one(put, 5_000))).toEqual([1_000, 5_000, 5_000, 0, true])
  })

  it('empties a line the memory doubts, even on a receipt proven whole', () => {
    const got = verifiedReading(reading([line({ remembered: 'doubted' })], 74_000))
    expect([figures(got.lines[0]!), got.balanced]).toEqual([BLANK, false])
  })
})

describe('why a line was not shown as read, and the receipt not whole (MOL-309)', () => {
  const why = (over: Partial<ReceiptTextLine>, total: number | null = null) =>
    explainedReading(reading([line(over)], total)).lines[0]

  it('names nothing of a line shown as read, nor of a receipt proven whole', () => {
    const got = explainedReading(reading([line()], 74_000))
    expect([got.lines, got.receipt]).toEqual([[null], null])
  })

  it('names each branch of the check by its kind', () => {
    expect(why({ remembered: 'doubted' }, 74_000)).toBe('doubted')
    expect(why({ sumHundredths: null })).toBe('missing_figure')
    expect(why({ quantityMilli: null })).toBe('missing_figure')
    expect(why({ asPrinted: false, repaired: true })).toBe('repaired_unproven')
    expect(why({ asPrinted: false, settled: false })).toBe('unsettled')
    expect(why({ asPrinted: false, settled: true })).toBe('bent')
    expect(why({ sumHundredths: 0, priceHundredths: 50_000, discountHundredths: 0 })).toBe(
      'zero_not_gift',
    )
    expect(why({ quantityMilli: 1_000, priceHundredths: 66_000, sumHundredths: 66_000 })).toBe(
      'one_alike_unproven',
    )
    expect(why({ priceHundredths: 36_000 })).toBe('price_dropped')
  })

  it('says nothing of a gift of one piece on a receipt proven whole: kept with no price by design', () => {
    const gift = line({
      quantityMilli: 1_000,
      priceHundredths: 50_000,
      sumHundredths: 0,
      discountHundredths: 50_000,
    })
    expect(explainedReading(reading([line(), gift], 74_000)).lines).toEqual([null, null])
  })

  it('names one reason a receipt, the first that holds', () => {
    const receipt = (lines: ReceiptTextLine[], total: number | null) =>
      explainedReading(reading(lines, total)).receipt
    expect(receipt([], 74_000)).toBe('no_lines')
    expect(receipt([line()], null)).toBe('no_total')
    expect(receipt([line()], 90_000)).toBe('lines_lost')
    expect(receipt([line({ remembered: 'doubted' })], 74_000)).toBe('line_doubted')
    expect(receipt([line({ asPrinted: false })], 74_000)).toBe('line_not_as_printed')
    expect(receipt([line()], 70_000)).toBe('lines_over')
  })

  it('shows exactly what verifiedReading shows', () => {
    const lines = [
      line(),
      line({ asPrinted: false, settled: false }),
      line({ quantityMilli: 1_000, priceHundredths: 66_000, sumHundredths: 66_000 }),
    ]
    for (const total of [null, 74_000, 206_000]) {
      const text = reading(lines, total)
      expect(explainedReading(text).shown).toEqual(verifiedReading(text))
    }
  })
})
