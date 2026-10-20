import { describe, expect, it } from 'vitest'
import { ARMENIAN_RECEIPTS } from '#model/entities/receipt-card'
import { receiptCityOf } from '#model/entities/receipt'
import {
  MODEL_RECEIPT_LINES_MAX,
  modelHeadRows,
  modelReceiptSchema,
  receiptTextOfModel,
} from '#model/entities/receipt-model'
import { verifiedReading } from '#model/entities/receipt-verify'
import type { ModelReceipt } from '#model/entities/receipt-model'

// a made-up head: the repository is public, and a receipt's own carries a customer's name
const answer = (over: Partial<ModelReceipt> = {}): ModelReceipt => ({
  shop: 'Խանութ «Օրինակ»',
  address: 'Գորկու 1, Գյումրի',
  tin: '01234567',
  receipt_no: '000123',
  date: '2026-10-08',
  time: '19:57',
  lines: [],
  totals: [],
  ...over,
})

type Line = ModelReceipt['lines'][number]
const line = (over: Partial<Line> = {}): Line => ({
  printed: 'Կաթ «Մարիաննա» 3.2% 1լ',
  code: '0401',
  article: '1163909',
  quantity: '2',
  unit: 'pcs',
  unit_price: '370',
  discount: null,
  sum: '740',
  ...over,
})

const read = (a: ModelReceipt) => receiptTextOfModel(ARMENIAN_RECEIPTS, a)
const figures = (a: ModelReceipt) =>
  read(a).lines.map((l) => [
    l.quantityMilli,
    l.priceHundredths,
    l.sumHundredths,
    l.discountHundredths,
  ])

describe('a model’s answer as the parse’s reading (MOL-272)', () => {
  it('reads the figures as printed: hundredths and thousandths, never a float', () => {
    const got = figures(
      answer({
        lines: [line({ quantity: '1.524', unit: 'kg', unit_price: '1330', sum: '2026.92' })],
      }),
    )
    expect(got).toEqual([[1_524, 133_000, 202_692, null]])
    expect(figures(answer({ lines: [line({ sum: '176.4' })] }))[0]?.[2]).toBe(17_640)
  })

  it('takes no figure that is not a number of its kind', () => {
    const odd = ['5 403,12', '5403,12', '-5', '1.234', 'abc', '', ' ']
    for (const sum of odd) expect(figures(answer({ lines: [line({ sum })] }))[0]?.[2]).toBeNull()
    expect(figures(answer({ lines: [line({ quantity: '0.4525' })] }))[0]?.[0]).toBeNull()
    expect(figures(answer({ lines: [line({ quantity: '0.452' })] }))[0]?.[0]).toBe(452)
  })

  it('settles a line by its own arithmetic only, and calls it as printed then', () => {
    const [held, off] = read(answer({ lines: [line(), line({ sum: '741' })] })).lines
    expect([held?.settled, held?.asPrinted]).toEqual([true, true])
    expect([off?.settled, off?.asPrinted]).toEqual([false, false])
  })

  it('is the card’s layout where a line prints a discount, a zero one too, with its rounding', () => {
    // «Ереван Сити» rounds what was paid off its shelf price: 250 and 249,99
    const rounded = line({ quantity: '1', unit_price: '250', discount: '0', sum: '249.99' })
    const text = read(answer({ lines: [rounded] }))
    expect(text.layout).toBe('card')
    expect(text.lines[0]?.settled).toBe(true)
    const noDiscount = read(answer({ lines: [{ ...rounded, discount: null }] }))
    expect(noDiscount.layout).toBe('class')
    expect(noDiscount.lines[0]?.settled).toBe(false)
  })

  it('settles a discounted line as sum + discount = quantity × price, to the card’s three luma', () => {
    const paid = line({ quantity: '1', unit_price: '850', discount: '89.25', sum: '760.75' })
    expect(read(answer({ lines: [paid] })).lines[0]?.settled).toBe(true)
    expect(read(answer({ lines: [{ ...paid, sum: '760.78' }] })).lines[0]?.settled).toBe(true)
    expect(read(answer({ lines: [{ ...paid, sum: '760.79' }] })).lines[0]?.settled).toBe(false)
    // the price in the sum's place, as v2 of the prompt answered: nothing adds up
    const swapped = { ...paid, unit_price: null, sum: '850' }
    expect(read(answer({ lines: [swapped] })).lines[0]?.settled).toBe(false)
  })

  it('keeps the class code and the article as the parse does', () => {
    const coded = (code: string | null, article: string | null) =>
      read(answer({ lines: [line({ code, article })] })).lines[0]
    expect(coded('Դաս. 56.10', 'Ն/Կ 745030')).toMatchObject({ hs: '56.10', sku: null })
    expect(coded('0402', '395081_1')).toMatchObject({ hs: '0402', sku: '395081_1' })
    expect(coded('12345', null)).toMatchObject({ hs: null, sku: null })
    expect(coded(null, '119112')).toMatchObject({ hs: null, sku: '119112' })
  })

  it('reads the head only where it is one: a tax number of eight digits, a day, a clock', () => {
    expect(read(answer())).toMatchObject({
      tin: '01234567',
      date: '2026-10-08',
      time: '19:57',
      receiptNo: '000123',
    })
    const odd = read(answer({ tin: '0123456', date: '08.10.2026', time: '25:10', receipt_no: ' ' }))
    expect([odd.tin, odd.date, odd.time, odd.receiptNo]).toEqual([null, null, null, null])
  })

  it('names the city where the head’s address does', () => {
    expect(receiptCityOf(modelHeadRows(answer()))).toBe('Гюмри')
    expect(modelHeadRows(answer({ shop: null, address: ' ' }))).toEqual([])
  })
})

describe('the total of a model’s reading (MOL-244 by the card’s words)', () => {
  const lines = [line(), line({ quantity: '1', unit_price: '960', sum: '960' })]

  it('is the lines where they met a printed total every one as read', () => {
    const text = read(answer({ lines, totals: [{ label: 'Ընդամենը', amount: '1700.00' }] }))
    expect([text.totalHundredths, text.readTotalHundredths, text.balanced]).toEqual([
      170_000,
      170_000,
      true,
    ])
  })

  it('is none where one line is not as read and only one place prints it', () => {
    const off = [lines[0]!, { ...lines[1]!, sum: '961' }]
    const text = read(answer({ lines: off, totals: [{ label: 'Ընդամենը', amount: '1701.00' }] }))
    expect([text.totalHundredths, text.readTotalHundredths, text.balanced]).toEqual([
      null,
      170_100,
      false,
    ])
  })

  it('is what two places print — the total and the payment — where the lines do not meet it', () => {
    const totals = [
      { label: 'Ընդամենը:', amount: '2050.01' },
      { label: 'Վճարված է Առձեռն:', amount: '2050.01' },
    ]
    expect(read(answer({ lines: [], totals })).totalHundredths).toBe(205_001)
    expect(read(answer({ lines: [], totals: totals.slice(0, 1) })).totalHundredths).toBeNull()
  })

  it('takes no prepayment for a payment, nor a discount for a total', () => {
    const totals = [
      { label: 'Ընդամենը', amount: '696.90' },
      { label: 'Կանխավճար', amount: '696.90' },
      { label: 'Կանխավճարի մնացորդ', amount: '696.90' },
      { label: 'Զեղչ գործարքից', amount: '696.90' },
    ]
    expect(read(answer({ totals })).totalHundredths).toBeNull()
  })

  it('reads the largest the total’s word stands by: a prepayment slip’s is smaller, the card’s shelf total larger', () => {
    const totals = [
      { label: 'Ընդամենը', amount: '266.14' },
      { label: 'Ընդամենը', amount: '23234.06' },
      { label: 'Ընդամենը:', amount: '23459.20' },
    ]
    expect(read(answer({ lines, totals })).readTotalHundredths).toBe(2_345_920)
  })

  it('is the section’s on a receipt with no items, by the vote of MOL-227', () => {
    const totals = [
      { label: 'Բաժին 1', amount: '1700.00' },
      { label: 'Ընդամենը', amount: '1700.00' },
    ]
    const text = read(answer({ totals }))
    expect([text.layout, text.totalHundredths]).toEqual(['department', 170_000])
    // with items the section is no place: their lines vouch
    expect(
      read(answer({ lines: [{ ...lines[0]!, sum: '741' }], totals })).totalHundredths,
    ).toBeNull()
  })
})

describe('a model’s reading through the one check (MOL-255)', () => {
  it('empties a line of one piece whose price and sum are apart within the rounding', () => {
    const swapped = line({ quantity: '1', unit_price: '389.99', discount: '0', sum: '390' })
    const shown = verifiedReading(read(answer({ lines: [swapped] })), { byModel: true })
    expect(shown.lines[0]?.sumHundredths).toBeNull()
  })

  it('keeps the same line on a receipt its lines prove whole', () => {
    const rounded = line({ quantity: '1', unit_price: '250', discount: '0', sum: '249.99' })
    const totals = [{ label: 'Ընդամենը', amount: '249.99' }]
    const shown = verifiedReading(read(answer({ lines: [rounded], totals })), { byModel: true })
    expect([shown.balanced, shown.lines[0]?.priceHundredths]).toEqual([true, 25_000])
  })
})

describe('the answer’s schema', () => {
  it('refuses a field it does not name, and more lines than a till prints', () => {
    expect(modelReceiptSchema.safeParse({ ...answer(), buyer: 'x' }).success).toBe(false)
    const many = Array.from({ length: MODEL_RECEIPT_LINES_MAX + 1 }, () => line())
    expect(modelReceiptSchema.safeParse(answer({ lines: many })).success).toBe(false)
    expect(modelReceiptSchema.safeParse(answer({ lines: [line()] })).success).toBe(true)
  })

  it('takes no unit but a piece, a kilogram and a litre', () => {
    const odd = { ...answer(), lines: [{ ...line(), unit: 'g' }] }
    expect(modelReceiptSchema.safeParse(odd).success).toBe(false)
  })
})
