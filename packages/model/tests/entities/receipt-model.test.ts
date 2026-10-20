import { describe, expect, it } from 'vitest'
import { ARMENIAN_RECEIPTS } from '#model/entities/receipt-card'
import { needsReshoot, receiptCityOf } from '#model/entities/receipt'
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
  id_rows: ['ՀՎՀՀ: 01234567', 'ԳՀ: 55512345', 'ԿՀ: 000123', 'Ֆիսկալ համար 27410811'],
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

  it('gives the rounding only to a line that prints a discount itself, never by another’s (adversarial А4)', () => {
    // 3 × 130 is 390,00, not 389,97: the «0» under the bread is no word about the milk
    const milk = line({ quantity: '3', unit_price: '130', discount: null, sum: '389.97' })
    const bread = line({
      printed: 'Հաց',
      quantity: '1',
      unit_price: '290',
      discount: '0',
      sum: '290',
    })
    const text = read(answer({ lines: [milk, bread] }))
    expect(text.layout).toBe('card')
    expect(text.lines.map((l) => l.settled)).toEqual([false, true])
    const shown = verifiedReading(text, { byModel: true })
    expect(shown.lines[0]?.priceHundredths).toBeNull()
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
      receiptNo: '27410811',
    })
    const odd = read(
      answer({ id_rows: ['ՀՎՀՀ: 0123456', 'Ֆիսկալ համար'], date: '08.10.2026', time: '25:10' }),
    )
    expect([odd.tin, odd.date, odd.time, odd.receiptNo]).toEqual([null, null, null, null])
  })

  it('keys a second record by the words of the card, as Tesseract reads it (adversarial А5, А6, review №10)', () => {
    const key = (...id_rows: string[]) => {
      const text = read(answer({ id_rows }))
      return [text.tin, text.receiptNo]
    }
    expect(key('ՀՎՀՀ:01234567', 'Ֆիսկալ համար 00410811')).toEqual(['01234567', '00410811'])
    expect(key('ՀՎՀՀ 01234567 Գ/Հ 55512345', 'ՖԻՍԿԱԼ ՀԱՄԱՐ: 27410811')).toEqual([
      '01234567',
      '27410811',
    ])
    // the till's registration and the shop's tax number under labels the model mixed up: neither is a key, so
    // two receipts of the till are never one (review №10: am-07b and am-10 of the bench, `51691957/01282006`)
    expect(key('ԳՀ:51691957', 'ԳՀ:01282006', 'ԿՀ: 90264')).toEqual([null, null])
    expect(key('ՀԴՄ:01282006', 'ԳՀ:61691957', 'Ֆիսկալ համար 43542455')).toEqual([null, '43542455'])
    // the tax number is every receipt of the shop: never the receipt's number
    expect(key('ՀՎՀՀ:01234567', 'Ֆիսկալ համար 01234567')).toEqual(['01234567', null])
    // two fiscal numbers — a prepayment slip, two receipts on a photo — or two tax numbers: none is the key
    expect(key('ՀՎՀՀ:01234567', 'Ֆիսկալ համար 27410811', 'Ֆիսկալ համար 27410812')).toEqual([
      '01234567',
      null,
    ])
    expect(key('ՀՎՀՀ:01234567', 'ՀՎՀՀ:01234568', 'Ֆիսկալ համար 27410811')).toEqual([
      null,
      '27410811',
    ])
    // the same number read twice is one
    expect(key('Ֆիսկալ համար 27410811', 'Ֆիսկալ համար: 27410811')).toEqual([null, '27410811'])
    // «ԿՀ», a barcode's number, «ՖՀ», a digit lost or one too many: no key
    expect(key('ԿՀ: 00000049', 'GY0000927265', 'ՖՀ 27410811')).toEqual([null, null])
    expect(key('Ֆիսկալ համար 2741081', 'Ֆիսկալ համար 274108111')).toEqual([null, null])
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
    expect(needsReshoot(text)).toBe(false)
    // no section named, the total and the payment agreeing: still a sum to record
    const paid = read(answer({ totals: [totals[1]!, { label: 'Առձեռն', amount: '1700.00' }] }))
    expect([paid.layout, paid.totalHundredths, needsReshoot(paid)]).toEqual([
      'department',
      170_000,
      false,
    ])
    // no line, no section and one place: a reading of nothing, «переснимите», never a sum to record
    const nothing = read(answer({ totals: totals.slice(1) }))
    expect([nothing.layout, needsReshoot(nothing)]).toEqual(['class', true])
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
