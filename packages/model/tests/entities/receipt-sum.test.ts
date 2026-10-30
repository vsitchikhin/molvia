import { describe, expect, it } from 'vitest'
import {
  lineAddsUp,
  lineProduct,
  linesTotalOf,
  receiptPaidOf,
  priceInDoubt,
  readCovered,
  readPartly,
  receiptBalance,
  receiptDigits,
  recordedSums,
} from '#model/entities/receipt-sum'
import type { ReceiptEntry, ReceiptFigures } from '#model/entities/receipt-sum'
import type { Money } from '#model/values/money'
import type { Quantity } from '#model/values/units'

const amd = (drams: number): Money => ({ minor: BigInt(Math.round(drams * 100)), currency: 'AMD' })
const rub = (roubles: number): Money => ({
  minor: BigInt(Math.round(roubles * 100)),
  currency: 'RUB',
})
const pcs = (n: number): Quantity => ({ milli: BigInt(n * 1000), unit: 'piece' })
const kg = (milli: number): Quantity => ({ milli: BigInt(milli), unit: 'kg' })

const figures = (
  quantity: Quantity | null,
  price: Money | null,
  sum: Money | null,
  discount: Money | null = null,
): ReceiptFigures => ({ quantity, price, sum, discount })

describe('the digits a receipt prints (П-2)', () => {
  it('is none when every amount is whole', () => {
    expect(receiptDigits('AMD', [amd(957), amd(1_290), null])).toBe(0)
  })

  it("is the currency's own once any amount has a fraction", () => {
    expect(receiptDigits('AMD', [amd(957), amd(760.75)])).toBe(2)
  })

  it('reads an empty receipt as whole', () => {
    expect(receiptDigits('AMD', [])).toBe(0)
  })
})

describe('quantity × price, rounded to the receipt (П-2)', () => {
  it('rounds a weighed line to whole drams on a whole receipt', () => {
    expect(lineProduct(kg(742), amd(1_290), 0)).toEqual(amd(957))
    expect(lineProduct(kg(742), amd(1_290), 2)).toEqual(amd(957.18))
  })

  it('rounds an exact half up, and just below it down', () => {
    expect(lineProduct(kg(500), amd(1), 0)).toEqual(amd(1))
    expect(lineProduct(kg(499), amd(1), 0)).toEqual(amd(0))
  })

  it('rounds once, never twice', () => {
    // 0,999 × 0,50 = 0,4995: to hundredths 0,50, and 0,50 to units would be 1 — but 0,4995 is 0
    expect(lineProduct(kg(999), amd(0.5), 2)).toEqual(amd(0.5))
    expect(lineProduct(kg(999), amd(0.5), 0)).toEqual(amd(0))
  })
})

describe('a line adds up', () => {
  it('holds paid + discount against quantity × price', () => {
    expect(lineAddsUp(figures(pcs(1), amd(850), amd(760.75), amd(89.25)), 2)).toBe(true)
    expect(lineAddsUp(figures(pcs(2), amd(370), amd(740)), 0)).toBe(true)
  })

  it('takes a weighed line printed whole, on a whole receipt only', () => {
    expect(lineAddsUp(figures(kg(742), amd(1_290), amd(957)), 0)).toBe(true)
    expect(lineAddsUp(figures(kg(742), amd(1_290), amd(957)), 2)).toBe(false)
  })

  it('refuses a figure off by one minor unit either way', () => {
    expect(lineAddsUp(figures(pcs(1), amd(850), amd(760.76), amd(89.25)), 2)).toBe(false)
    expect(lineAddsUp(figures(pcs(1), amd(850), amd(760.74), amd(89.25)), 2)).toBe(false)
  })

  it('does not hold with a figure missing or in another currency', () => {
    expect(lineAddsUp(figures(null, amd(890), amd(890)), 0)).toBe(false)
    expect(lineAddsUp(figures(pcs(1), null, amd(890)), 0)).toBe(false)
    expect(lineAddsUp(figures(pcs(1), amd(890), null), 0)).toBe(false)
    expect(lineAddsUp(figures(pcs(1), amd(890), rub(890)), 0)).toBe(false)
  })
})

// The handoff's receipt A: seven lines of 5 543 ֏ as quantity × price, a total of 5 633, and the
// chocolate «1 × 890» printed as 980.
const receiptA = [
  figures(pcs(1), amd(531), amd(531)),
  figures(pcs(1), amd(1_032), amd(1_032)),
  figures(pcs(2), amd(250), amd(500)),
  figures(kg(800), amd(1_400), amd(1_120)),
  figures(pcs(1), amd(890), amd(980)),
  figures(pcs(1), amd(1_450), amd(1_450)),
  figures(pcs(1), amd(20), amd(20)),
]

describe('what the lines come to by the total (MOL-289)', () => {
  it('is the total less what the card sent to the card', () => {
    expect(linesTotalOf(amd(19_097.86), amd(191.02))).toEqual(amd(18_906.84))
  })

  it('is the total where nothing went to the card, or what did is not of its currency', () => {
    expect(linesTotalOf(amd(1_700), null)).toEqual(amd(1_700))
    expect(linesTotalOf(amd(1_700), rub(17))).toEqual(amd(1_700))
    expect(linesTotalOf(null, amd(17))).toBeNull()
  })

  it('never makes nothing or less of the total: a bonus the size of it is no reading', () => {
    expect(linesTotalOf(amd(17), amd(17))).toEqual(amd(17))
    expect(linesTotalOf(amd(17), amd(18))).toEqual(amd(17))
  })

  it('lets the sums the total confirms stand, and «Прочитали не всё» say nothing of the bonus', () => {
    const lines = [figures(pcs(1), amd(890), amd(980)), figures(pcs(1), amd(500), amd(495))]
    const total = linesTotalOf(amd(1_489), amd(14))
    expect(recordedSums(lines, total, 2)).toEqual([amd(980), amd(495)])
    const read = lines.map((line) => ({ settled: true, sum: line.sum }))
    expect([readPartly(read, total), readPartly(read, amd(1_489))]).toEqual([false, true])
  })
})

describe('what left the card (MOL-289, В-5 «а»)', () => {
  it('is the total less the bonus it was partly paid with', () => {
    expect(receiptPaidOf(amd(19_097.86), amd(191.02))).toEqual(amd(18_906.84))
    expect(receiptPaidOf(amd(1_700), null)).toEqual(amd(1_700))
    expect(receiptPaidOf(null, amd(17))).toBeNull()
  })

  it('is the total where the bonus is the whole of it or more, or of another currency', () => {
    expect(receiptPaidOf(amd(17), amd(17))).toEqual(amd(17))
    expect(receiptPaidOf(amd(1_700), rub(17))).toEqual(amd(1_700))
  })
})

describe('what a line is recorded at (MOL-124 В-5)', () => {
  it('takes the printed sum when the total confirms it', () => {
    const sums = recordedSums(receiptA, amd(5_633), 0)
    expect(sums[4]).toEqual(amd(980))
    expect(sums[0]).toEqual(amd(531))
  })

  it('takes quantity × price when the total was not read', () => {
    expect(recordedSums(receiptA, null, 0)[4]).toEqual(amd(890))
  })

  it('takes quantity × price when the total does not meet the printed sums', () => {
    expect(recordedSums(receiptA, amd(5_634), 0)[4]).toEqual(amd(890))
    expect(recordedSums(receiptA, amd(5_632), 0)[4]).toEqual(amd(890))
  })

  it('keeps what was paid on a line that adds up with its discount', () => {
    const line = figures(pcs(1), amd(850), amd(760.75), amd(89.25))
    expect(recordedSums([line], null, 2)).toEqual([amd(760.75)])
  })

  it('falls back to the printed sum when the line has no price, and to nothing with neither', () => {
    expect(recordedSums([figures(pcs(1), null, amd(300))], null, 0)).toEqual([amd(300)])
    expect(recordedSums([figures(null, null, null)], null, 0)).toEqual([null])
  })

  it('takes quantity × price less the discount, never below zero', () => {
    expect(recordedSums([figures(pcs(1), amd(590), amd(900), amd(59))], null, 0)).toEqual([
      amd(531),
    ])
    expect(recordedSums([figures(pcs(1), amd(10), amd(900), amd(59))], null, 0)).toEqual([amd(900)])
  })
})

const entry = (
  amount: Money | null,
  printed: Money | null = amount,
  skip = false,
): ReceiptEntry => ({
  amount,
  printed,
  skip,
})

describe('the balance of a receipt', () => {
  const asComputed = receiptA.map((line, position) =>
    entry(position === 4 ? amd(890) : line.sum, line.sum),
  )

  it('counts every line, the ones left out too', () => {
    const balance = receiptBalance(
      asComputed.map((e, i) => (i === 6 ? { ...e, skip: true } : e)),
      amd(5_633),
      'AMD',
    )
    expect(balance.lines).toEqual(amd(5_543))
    expect(balance.recorded).toBe(6)
  })

  it('names the line the difference sits in', () => {
    const balance = receiptBalance(asComputed, amd(5_633), 'AMD')
    expect(balance.difference).toEqual(amd(90))
    expect(balance.suspect).toBe(4)
  })

  it('names none when two lines could hold it', () => {
    const twice = [...asComputed, entry(amd(10), amd(100))]
    const balance = receiptBalance(twice, amd(5_643), 'AMD')
    expect(balance.difference).toEqual(amd(90))
    expect(balance.suspect).toBeNull()
  })

  it('has no difference without a total', () => {
    expect(receiptBalance(asComputed, null, 'AMD')).toMatchObject({
      lines: amd(5_543),
      difference: null,
      suspect: null,
      blank: 0,
    })
  })

  it('sums the lines with an amount and counts the blank apart, suspecting none (MOL-255)', () => {
    // a blank line's printed sum — the reading's — names no line: it is the blank that lacks
    const blank = [...asComputed, entry(null, amd(90))]
    expect(receiptBalance(blank, amd(5_633), 'AMD')).toEqual({
      lines: amd(5_543),
      difference: amd(90),
      suspect: null,
      recorded: 8,
      blank: 1,
    })
    // left out, a blank line still lacks: it was paid for
    const left = receiptBalance([entry(amd(100)), entry(null, null, true)], amd(300), 'AMD')
    expect([left.lines, left.difference, left.blank]).toEqual([amd(100), amd(200), 1])
    // every line blank: nothing read, the whole total lacks
    expect(receiptBalance([entry(null), entry(null)], amd(100), 'AMD')).toMatchObject({
      lines: amd(0),
      difference: amd(100),
      blank: 2,
    })
  })

  it('balances at zero, and does not sum a line in another currency', () => {
    expect(receiptBalance([entry(amd(100))], amd(100), 'AMD').difference).toEqual(amd(0))
    expect(receiptBalance([entry(rub(100))], amd(100), 'AMD').lines).toBeNull()
  })
})

describe('a price in doubt by the memory (В-1)', () => {
  it('doubts a price one confused digit off', () => {
    expect(priceInDoubt('AM', amd(60), amd(50))).toBe(true)
    expect(priceInDoubt('AM', amd(1_160), amd(1_190))).toBe(false)
    expect(priceInDoubt('AM', amd(1_160), amd(1_190.5))).toBe(false)
  })

  it('does not doubt the same price, another one, or one missing', () => {
    expect(priceInDoubt('AM', amd(50), amd(50))).toBe(false)
    expect(priceInDoubt('AM', amd(70), amd(50))).toBe(false)
    expect(priceInDoubt('AM', null, amd(50))).toBe(false)
    expect(priceInDoubt('AM', amd(50), null)).toBe(false)
    expect(priceInDoubt('AM', amd(50), rub(60))).toBe(false)
  })

  it('doubts a price the model read by the model’s confusions alone, 5↔6 (MOL-315)', () => {
    const model = { byModel: true }
    expect(priceInDoubt('AM', amd(650), amd(550), model)).toBe(true)
    expect(priceInDoubt('AM', amd(1_400), amd(1_100), model)).toBe(false)
    expect(priceInDoubt('AM', amd(999), amd(990), model)).toBe(false)
    expect(priceInDoubt('AM', amd(380), amd(330), model)).toBe(false)
    // no reader named — the phone's — and Tesseract's: all four pairs, as before
    for (const reading of [{}, { byModel: false }]) {
      expect(priceInDoubt('AM', amd(650), amd(550), reading)).toBe(true)
      expect(priceInDoubt('AM', amd(1_400), amd(1_100), reading)).toBe(true)
      expect(priceInDoubt('AM', amd(999), amd(990), reading)).toBe(true)
      expect(priceInDoubt('AM', amd(380), amd(330), reading)).toBe(true)
    }
    expect(
      priceInDoubt(
        'RS',
        { minor: 65_000n, currency: 'RSD' },
        { minor: 55_000n, currency: 'RSD' },
        model,
      ),
    ).toBe(false)
  })

  it('doubts no digit of a receipt the tax office gave: nobody read it (MOL-270, owner’s В-1 «а»)', () => {
    const rsd = (major: number): Money => ({
      minor: BigInt(Math.round(major * 100)),
      currency: 'RSD',
    })
    expect(priceInDoubt('RS', rsd(60), rsd(50))).toBe(false)
    expect(priceInDoubt('RS', rsd(91.99), rsd(94.99))).toBe(false)
    expect(priceInDoubt('RS', rsd(70), rsd(50))).toBe(false)
  })
})

describe('read only in part — the «переснимите» of before, a hint now (MOL-222, В-1)', () => {
  const read = (sum: Money | null, settled = true) => ({ sum, settled })

  it('is no lines at all', () => {
    expect(readPartly([], amd(1_000))).toBe(true)
    expect(readPartly([], null)).toBe(true)
  })

  it('with the total read, is any shortfall of it: the total, a luma under (MOL-255, В-7 «а»)', () => {
    expect(readPartly([read(amd(1_000))], amd(1_000))).toBe(false)
    expect(readPartly([read(amd(999.99))], amd(1_000))).toBe(true)
  })

  it('with the total read, is one lost line of many too (122b8e5f: 74 %, five lines at the seams)', () => {
    expect(readPartly([read(amd(740))], amd(1_000))).toBe(true)
    expect(readPartly([read(amd(970))], amd(1_000))).toBe(true)
  })

  it('with the total read, counts a line whose sum was lost as nothing', () => {
    expect(readPartly([read(null), read(amd(500))], amd(1_000))).toBe(true)
  })

  it('counts no sum past the total, nor one in another currency (review Р11)', () => {
    expect(readPartly([read(amd(2_000))], amd(1_000))).toBe(true)
    expect(readPartly([read(rub(1_000))], amd(1_000))).toBe(true)
  })

  it('with no total, is fewer than half the lines adding up: half is enough', () => {
    expect(readPartly([read(amd(1)), read(amd(1), false)], null)).toBe(false)
    expect(readPartly([read(amd(1)), read(amd(1), false), read(amd(1), false)], null)).toBe(true)
  })

  it('must not fire on a short receipt whose total was missed but whose lines add up (am-01)', () => {
    expect(readPartly([read(amd(1)), read(amd(1)), read(amd(1))], null)).toBe(false)
  })

  it('takes a total of zero for no total', () => {
    expect(readPartly([read(amd(1))], amd(0))).toBe(false)
  })

  it('covers by the lines in the total’s currency and not past it — the hint’s figure', () => {
    expect(
      readCovered([read(amd(300)), read(amd(5_000)), read(rub(100)), read(null)], amd(1_000)),
    ).toEqual(amd(300))
    expect(readCovered([read(amd(300))], null)).toBeNull()
    expect(readCovered([read(amd(300))], amd(0))).toBeNull()
  })
})
