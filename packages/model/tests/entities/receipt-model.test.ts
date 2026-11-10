import { describe, expect, it } from 'vitest'
import { ARMENIAN_RECEIPTS } from '#model/entities/receipt-card'
import { needsReshoot, receiptCityOf } from '#model/entities/receipt'
import {
  MODEL_RECEIPT_LINES_MAX,
  REPAIR_ASSIGNMENTS_MAX,
  REPAIR_SHIFTS_MAX,
  repairTries,
  modelHeadRows,
  modelPaidBy,
  modelReceiptSchema,
  receiptTextOfModel,
  unparsedFigures,
} from '#model/entities/receipt-model'
import { explainedReading, verifiedReading } from '#model/entities/receipt-verify'
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
    const odd = ['-5', '1.234', '1,234.56', '0,5,0', '12 34', '5 4031', 'abc', '', ' ']
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
      answer({ id_rows: ['ՀՎՀՀ: 0123456', 'Ֆիսկալ համար'], date: '10.2026', time: '25:10' }),
    )
    expect([odd.tin, odd.date, odd.time, odd.receiptNo]).toEqual([null, null, null, null])
  })

  it('reads a date as asked, or as printed in the card’s order (MOL-305)', () => {
    const day = (date: string | null) => read(answer({ date })).date
    // the terminal of a sole trader, MOL-227: «23-10-26 14:06» is 23 October 2026, which the model made 2023-10-26
    expect(day('23-10-26')).toBe('2026-10-23')
    expect(day('04-10-26')).toBe('2026-10-04')
    // the tills: a year of four digits last
    expect(day('04.10.2026')).toBe('2026-10-04')
    expect(day('8.10.2026')).toBe('2026-10-08')
    // a year of four digits first is one order alone: what prompt v5 asks for
    expect(day('2026-10-23')).toBe('2026-10-23')
    // must not: a day no calendar has, a date cut short, words
    expect(day('31-02-26')).toBeNull()
    expect(day('23-13-26')).toBeNull()
    expect(day('23-10')).toBeNull()
    expect(day('23 окт 2026')).toBeNull()
    expect(day(null)).toBeNull()
  })

  it('reads the time as printed, its seconds dropped (MOL-305)', () => {
    const time = (printed: string | null) => read(answer({ time: printed })).time
    expect(time('14:06')).toBe('14:06')
    expect(time('23:49:53')).toBe('23:49')
    expect(time(' 00:00 ')).toBe('00:00')
    expect(time('24:00')).toBeNull()
    expect(time('14:06:61:1')).toBeNull()
    expect(time('1406')).toBeNull()
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
    // a number printed under another label too is the shop's or the till's, on every receipt of the till: never
    // the receipt's number (adversarial А6, round 4) — the tax number under «Ֆիսկալ», the till's registration
    expect(key('ՀՎՀՀ:01234567', 'Ֆիսկալ համար 01234567')).toEqual(['01234567', null])
    expect(key('ԳՀ:55512345', 'ՀՎՀՀ:01234567', 'Ֆիսկալ համար 55512345')).toEqual(['01234567', null])
    expect(key('ԳՀ:55512345 Ֆիսկալ համար 55512345', 'ՀՎՀՀ:01234567')).toEqual(['01234567', null])
    // the tax number keeps no such guard: am-07b of the bench printed it under «ՀՎՀՀ» and «ՀԴՄ», both right
    expect(key('ՀՎՀՀ:01282006', 'ՀԴՄ:01282006', 'Ֆիսկալ համար:99784818')).toEqual([
      '01282006',
      '99784818',
    ])
    // two fiscal numbers — a prepayment slip over «Ереван Сити»'s receipt — are the pair, in whichever order the
    // model copied them (MOL-293, В-3 «а»); three are none, and two tax numbers no tax number
    expect(key('ՀՎՀՀ:01234567', 'Ֆիսկալ համար 58899619', 'Ֆիսկալ համար 34408642')).toEqual([
      '01234567',
      '34408642+58899619',
    ])
    expect(key('Ֆիսկալ համար 34408642', 'ԿՀ: 70548', 'Ֆիսկալ համար 58899619')).toEqual([
      null,
      '34408642+58899619',
    ])
    expect(key('Ֆիսկալ համար 27410811', 'Ֆիսկալ համար 27410812', 'Ֆիսկալ համար 27410813')).toEqual([
      null,
      null,
    ])
    // either of the pair printed under another label too is a constant of the till: no key (А6, round 4)
    expect(key('ԳՀ:55512345', 'Ֆիսկալ համար 55512345', 'Ֆիսկալ համար 27410812')).toEqual([
      null,
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

describe('a figure in any spelling the model writes it (MOL-294)', () => {
  const sumOf = (sum: string) => figures(answer({ lines: [line({ sum })] }))[0]?.[2]

  it('reads thousands grouped by a space, a no-break one and a narrow one', () => {
    for (const sum of ['1 234.56', '1\u00a0234.56', '1\u202f234.56'])
      expect(sumOf(sum)).toBe(123_456)
    expect(sumOf('5 403,12')).toBe(540_312)
    expect(sumOf('1 000 000')).toBe(100_000_000)
  })

  it('reads a comma for the point where it is the only one and no point stands', () => {
    expect(sumOf('5403,12')).toBe(540_312)
    expect(sumOf('0,5')).toBe(50)
    const [weighed] = figures(answer({ lines: [line({ quantity: '0,452', unit: 'kg' })] }))
    expect(weighed?.[0]).toBe(452)
  })

  it('reads a minus before a line’s discount as its size, and before nothing else', () => {
    for (const discount of ['-0.50', '−0.50', '- 0,50']) {
      expect(figures(answer({ lines: [line({ discount })] }))[0]?.[3]).toBe(50)
    }
    expect(sumOf('-740')).toBeNull()
    const [negative] = figures(answer({ lines: [line({ quantity: '-2', unit_price: '-370' })] }))
    expect([negative?.[0], negative?.[1]]).toEqual([null, null])
  })

  it('reads a summary’s discount with its minus, never a total: a negative total is a refund', () => {
    const lines = [line(), line({ quantity: '1', unit_price: '960', sum: '960' })]
    const refund = read(answer({ lines, totals: [{ label: 'Ընդամենը', amount: '-1700.00' }] }))
    expect([refund.totalHundredths, refund.readTotalHundredths]).toEqual([null, null])
    const grouped = read(answer({ lines, totals: [{ label: 'Ընդամենը', amount: '1 700,00' }] }))
    expect([grouped.totalHundredths, grouped.balanced]).toEqual([170_000, true])
  })

  it('reads a receipt whose every discount carries a minus as the one without it', () => {
    // «Ереван Сити»'s card: 1 % off each line, 17,00 sent to the card (MOL-289)
    const carded = [
      line({ quantity: '2', unit_price: '370', discount: '7.4', sum: '732.6' }),
      line({ quantity: '1', unit_price: '960', discount: '9.6', sum: '950.4' }),
    ]
    const totals = [
      { label: 'Ընդամենը', amount: '1683.02' },
      { label: '/ԱԱՀ-ով հարկվող/ =', amount: '1683.00' },
      { label: 'Ընդամենը:', amount: '1700.00' },
      { label: 'Վճարված է PosTerminal:', amount: '1700.00' },
      { label: 'Զեղչ գործարքից:', amount: '17.00' },
    ]
    const signed = carded.map((one) => ({ ...one, discount: `-${one.discount ?? ''}` }))
    const minusTotals = totals.map((one) =>
      one.label.startsWith('Զեղչ') ? { ...one, amount: '-17.00' } : one,
    )
    const plain = verifiedReading(read(answer({ lines: carded, totals })))
    const minus = verifiedReading(read(answer({ lines: signed, totals: minusTotals })))
    expect(minus).toEqual(plain)
    // every line kept as read: the trace of 36f99484 was every one emptied, the total still shown
    expect(minus.lines.every((one) => one.asPrinted && one.sumHundredths !== null)).toBe(true)
    expect([minus.layout, minus.totalHundredths, minus.cashbackHundredths]).toEqual([
      'card',
      170_000,
      1_700,
    ])
  })

  it('counts the figures no rule reads, and never an empty one', () => {
    const read0 = answer({ lines: [line(), line({ discount: '-1.5', sum: '1 480,00' })] })
    expect(unparsedFigures(ARMENIAN_RECEIPTS, read0)).toBe(0)
    const odd = answer({
      lines: [line({ sum: '740,0,0', quantity: '-2', discount: null })],
      totals: [{ label: 'Ընդամենը', amount: '7 40' }],
    })
    expect(unparsedFigures(ARMENIAN_RECEIPTS, odd)).toBe(3)
    expect(
      unparsedFigures(ARMENIAN_RECEIPTS, answer({ lines: [line({ quantity: '0.4525' })] })),
    ).toBe(1)
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

  it('takes no sum since the start of the year for the total, read or voted (MOL-288)', () => {
    const totals = [
      { label: 'Ընդամենը', amount: '19097.86' },
      { label: 'Ընդամենը ամվա սկզբից:', amount: '139432.00' },
      { label: 'Առևտուր ամսվա սկզբից:', amount: '139432.00' },
    ]
    const text = read(answer({ lines, totals }))
    expect([text.totalHundredths, text.readTotalHundredths]).toEqual([null, 1_909_786])
    // nor is it one of two places: alone the total's word gives nothing to vote with
    const alone = read(answer({ lines, totals: totals.slice(1) }))
    expect([alone.totalHundredths, alone.readTotalHundredths]).toEqual([null, null])
  })

  describe('a card that sends its discount to the card (MOL-289)', () => {
    // two lines with the card's 1 %: 732,60 + 950,40 = 1 683,00 paid, 17,00 sent to the card
    const carded = [
      line({ quantity: '2', unit_price: '370', discount: '7.4', sum: '732.6' }),
      line({ quantity: '1', unit_price: '960', discount: '9.6', sum: '950.4' }),
    ]
    const summary = (over: Record<string, string> = {}) =>
      Object.entries({
        Ընդամենը: '1683.02',
        '/ԱԱՀ-ով հարկվող/ =': '1683.00',
        'Որից ԱԱՀ =': '280.50',
        'Ընդամենը:': '1700.00',
        'Վճարված է PosTerminal:': '1700.00',
        'Կանխավճարի մարում:': '0',
        'Զեղչ գործարքից:': '17.00',
        'Կանխավճարի մնացորդ:': '1520.35',
        ...over,
      }).map(([label, amount]) => ({ label, amount }))
    const shown = (a: ModelReceipt) => {
      const text = read(a)
      return [text.totalHundredths, text.cashbackHundredths, text.redeemedHundredths, text.balanced]
    }

    it('shows what left the card, the lines meeting it less the discount sent to the card', () => {
      expect(shown(answer({ lines: carded, totals: summary() }))).toEqual([
        170_000,
        1_700,
        null,
        true,
      ])
      // the check proves it whole by the total less the discount
      expect(verifiedReading(read(answer({ lines: carded, totals: summary() }))).balanced).toBe(
        true,
      )
    })

    it('takes the sum taxed with VAT for the second place where a line is not as read', () => {
      // a 3 copied for the 5: no pair the model confuses, so nothing puts it right (MOL-290)
      const off = [carded[0]!, { ...carded[1]!, sum: '930.4' }]
      expect(shown(answer({ lines: off, totals: summary() }))).toEqual([
        170_000,
        1_700,
        null,
        false,
      ])
      // the total under the list, 0,02 off where the till rounds a price with its discount, is no place;
      // with the sum taxed misread too, the total and a card's payment equal to it vouch, as on master (round 1, А2)
      const taxedOff = summary({ '/ԱԱՀ-ով հարկվող/ =': '1683.02' })
      expect(shown(answer({ lines: off, totals: taxedOff }))).toEqual([170_000, 1_700, null, false])
      // a payment rounded to the dram is no place of it: nothing vouches
      const rounded = summary({
        '/ԱԱՀ-ով հարկվող/ =': '0',
        'Ընդամենը:': '1700.40',
        'Վճարված է PosTerminal:': '1700.00',
      })
      expect(shown(answer({ lines: off, totals: rounded }))).toEqual([null, 1_700, null, false])
    })

    it('reads as before where the discount is printed twice apart: two are a doubt, not a choice', () => {
      const twice = [...summary(), { label: 'Զեղչ գործարքից', amount: '18.00' }]
      // the total and the payment vote for 1 700,00, and the lines fall short of it by the discount
      expect(shown(answer({ lines: carded, totals: twice }))).toEqual([170_000, null, null, false])
    })

    it('keeps the bonus a receipt is paid with only where the card paid the total less it', () => {
      const spent = summary({ 'Կանխավճարի մարում:': '150.00', 'Վճարված է PosTerminal:': '1550.00' })
      expect(shown(answer({ lines: carded, totals: spent }))).toEqual([
        170_000,
        1_700,
        15_000,
        true,
      ])
      // the card's payment rounded to the dram
      const rounded = summary({
        'Ընդամենը:': '1700.40',
        '/ԱԱՀ-ով հարկվող/ =': '1683.40',
        'Կանխավճարի մարում:': '150.00',
        'Վճարված է PosTerminal:': '1550.00',
      })
      expect(shown(answer({ lines: carded, totals: rounded }))[2]).toBe(15_000)
      // a payment that is not the total less it: the bonus is not read
      const apart = summary({ 'Կանխավճարի մարում:': '150.00', 'Վճարված է PosTerminal:': '1700.00' })
      expect(shown(answer({ lines: carded, totals: apart }))).toEqual([170_000, 1_700, null, true])
      // no total vouched for — a line off, the sum taxed misread — and the printed total less the bonus is what the
      // card paid: the bonus kept, the trip of the lines and the cashback the less (review round 6, Г5)
      const off = [carded[0]!, { ...carded[1]!, sum: '930.4' }]
      const totals = summary({
        '/ԱԱՀ-ով հարկվող/ =': '1683.02',
        'Կանխավճարի մարում:': '150.00',
        'Վճարված է PosTerminal:': '1550.00',
      })
      expect(shown(answer({ lines: off, totals }))).toEqual([null, 1_700, 15_000, false])
    })

    it('is as before on a receipt that sends nothing to the card', () => {
      const plain = summary({ 'Զեղչ գործարքից:': '0', 'Ընդամենը:': '1683.00' })
      expect(shown(answer({ lines: carded, totals: plain }))).toEqual([168_300, null, null, true])
    })
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

// MOL-290: «Ереван Сити»'s «5» has a flat top, and the model copies it as «6» — am-44's six lines, as printed
// under a made-up head (the repository is public)
describe('a line put right by the font’s 5↔6, the receipt whole (MOL-290)', () => {
  const carded = (over: Partial<Line>) => line({ code: '0401', unit: 'pcs', ...over })
  // as read: 1 × 290 − 2,9 = 287,1 — the card's 1 %
  const bread = carded({ quantity: '1', unit_price: '290', discount: '2.9', sum: '287.1' })
  // printed 1 × 530 − 5,3 = 524,7, copied with a discount of 6,3
  const curd = carded({ quantity: '1', unit_price: '530', discount: '6.3', sum: '524.7' })
  // printed 0,252 × 205 − 0,52 = 51,14, copied 0,262 / 0,62 / 61,14: a swap in three figures
  const apples = carded({
    quantity: '0.252'.replace('5', '6'),
    unit: 'kg',
    unit_price: '205',
    discount: '0.62',
    sum: '61.14',
  })
  // printed 3 × 185 − 5,56 = 549,44, copied 6,56 and 649,44
  const eggs = carded({ quantity: '3', unit_price: '185', discount: '6.56', sum: '649.44' })
  // as read: 1 × 210 − 2,1 = 207,9 — no digit any swap takes, the bread's 287,1 reading by 3↔8 (MOL-310)
  const plain = carded({ quantity: '1', unit_price: '210', discount: '2.1', sum: '207.9' })
  const owed = (amount: string) => [
    { label: 'Ընդամենը', amount },
    { label: 'Վճարված է Առձեռն', amount },
  ]
  const read2 = (lines: Line[], totals: { label: string; amount: string }[]) => {
    const text = read(answer({ lines, totals }))
    return { text, shown: verifiedReading(text, { byModel: true }) }
  }
  const figuresOf = (text: ReturnType<typeof read>) =>
    text.lines.map((l) => [
      l.quantityMilli,
      l.priceHundredths,
      l.discountHundredths,
      l.sumHundredths,
    ])

  it('puts every line right by its one reading, the lines then meeting a total two places print', () => {
    const { text, shown } = read2([bread, curd, apples, eggs], owed('1412.38'))
    expect(figuresOf(shown)).toEqual([
      [1_000, 29_000, 290, 28_710],
      [1_000, 53_000, 530, 52_470],
      [252, 20_500, 52, 5_114],
      [3_000, 18_500, 556, 54_944],
    ])
    expect(shown.lines.map((l) => l.repaired === true)).toEqual([false, true, true, true])
    expect(shown.lines.map((l) => l.asPrinted)).toEqual([true, false, false, false])
    expect([text.totalHundredths, text.balanced, shown.balanced]).toEqual([141_238, true, true])
  })

  it('puts nothing right where only one place prints the total', () => {
    const { text, shown } = read2([bread, curd], owed('811.80').slice(0, 1))
    expect(text.lines.some((l) => l.repaired === true)).toBe(false)
    expect(shown.lines[1]?.sumHundredths).toBeNull()
  })

  it('puts nothing right where the lines put right miss the total by a luma', () => {
    const { text, shown } = read2([bread, curd], owed('811.81'))
    expect(text.lines.some((l) => l.repaired === true)).toBe(false)
    expect([shown.lines[1]?.sumHundredths, shown.balanced]).toEqual([null, false])
  })

  it('lets the total confirm a line’s one sum, never choose among two (review round 3, Г1)', () => {
    // 65 and 56 copied for one number printed twice: 55, 56, 65 or 66, each of two swaps and a sum of its own
    const twice = carded({ quantity: '1', unit_price: '65', discount: null, sum: '56' })
    for (const total of ['342.10', '343.10', '352.10', '353.10']) {
      expect(read2([bread, twice], owed(total)).text.lines[1]?.repaired).toBeUndefined()
    }
    // printed 5 × 105 − 5,25 = 519,75, the quantity copied «6»: one swap reads it, and the till's rounding lets
    // 519,76 stand a luma off — the total tells them, as am-39's 567,15 and 567,16
    const eggs = carded({ quantity: '6', unit_price: '105', discount: '5.25', sum: '519.75' })
    for (const [total, sum] of [
      ['806.85', 51_975],
      ['806.86', 51_976],
    ] as const) {
      const line = read2([bread, eggs], owed(total)).shown.lines[1]
      expect([total, line?.quantityMilli, line?.sumHundredths, line?.repaired]).toEqual([
        total,
        5_000,
        sum,
        true,
      ])
    }
  })

  it('puts nothing right where two readings of a line make one sum — 660 copied for 550 (review round 1, А1)', () => {
    // printed 0,6 kg × 550 − 3,3 = 326,7, the price copied 660: 0,5 × 660 − 3,3 is the same sum at the same 1 %
    const cheese = carded({
      quantity: '0.6',
      unit: 'kg',
      unit_price: '660',
      discount: '3.3',
      sum: '326.7',
    })
    const { text, shown } = read2([bread, cheese], owed('613.80'))
    expect([text.lines[1]?.repaired, shown.lines[1]?.quantityMilli, shown.balanced]).toEqual([
      undefined,
      null,
      false,
    ])
    // five pieces at 660 copied as 550 alike
    const eggs6 = carded({ quantity: '5', unit_price: '550', discount: '33', sum: '3267' })
    expect(read2([bread, eggs6], owed('3554.10')).text.lines[1]?.repaired).toBeUndefined()
    // «0.6 × 650» reads as printed 0,6 × 550 and as 0,5 × 660 — one sum again: a doubt too
    const near = carded({
      quantity: '0.6',
      unit: 'kg',
      unit_price: '650',
      discount: '3.3',
      sum: '326.7',
    })
    expect(read2([bread, near], owed('613.80')).text.lines[1]?.repaired).toBeUndefined()
    // one piece at «650» for 550: one reading meets the total, as printed
    const once = carded({ quantity: '1', unit_price: '650', discount: '5.5', sum: '544.5' })
    const put = read2([bread, once], owed('831.60')).shown.lines[1]
    expect([put?.quantityMilli, put?.priceHundredths, put?.repaired]).toEqual([1_000, 55_000, true])
  })

  it('takes no reading whose discount is not the card’s rate', () => {
    // 1 × 400 − 56 copied, 334 paid: only a discount of 66 holds, 16,5 % where the card gives 1 %
    const off = carded({ quantity: '1', unit_price: '400', discount: '56', sum: '334' })
    expect(read2([bread, off], owed('621.10')).text.lines[1]?.repaired).toBeUndefined()
    // with no line printing the rate, nothing holds the discount: not put right (review round 1, №3)
    expect(read2([off], owed('334.00')).text.lines[0]?.repaired).toBeUndefined()
    // a line that prints no discount needs no rate, and nor does one that prints 0 (review round 2, №6)
    const plain = carded({ quantity: '2', unit_price: '155', discount: null, sum: '330' })
    expect(read2([plain], owed('330.00')).text.lines[0]).toMatchObject({
      priceHundredths: 16_500,
      repaired: true,
    })
    expect(read2([{ ...plain, discount: '0' }], owed('330.00')).text.lines[0]).toMatchObject({
      priceHundredths: 16_500,
      repaired: true,
    })
  })

  it('confirms no line misread alike in its price and sum: the total does not meet it (am-34)', () => {
    // printed 1 × 640 − 6,4 = 633,6, copied 540 / 5,4 / 534,6 — it holds as copied
    const alike = carded({ quantity: '1', unit_price: '540', discount: '5.4', sum: '534.6' })
    const { text, shown } = read2([alike, curd], owed('1158.30'))
    expect(text.lines.some((l) => l.repaired === true)).toBe(false)
    expect([shown.balanced, shown.lines[0]?.sumHundredths, shown.lines[1]?.sumHundredths]).toEqual([
      false,
      53_460,
      null,
    ])
  })

  it('lets the total choose only among the fewest swaps’ sums: a line bent to fit pays for none (review round 2, Б2)', () => {
    // printed 1 × 640 − 6,4 = 633,6, copied 540 / 5,4 / 534,6 — bent to fit, 99,00 short (am-34)
    const alike = carded({ quantity: '1', unit_price: '540', discount: '5.4', sum: '534.6' })
    // printed 1 × 522 − 5,22 = 516,78, the price copied «622»: one swap reads it as printed, three as
    // 622 − 6,22 = 615,78 — 99,00 over, the one choice that met the total
    const cottage = carded({ quantity: '1', unit_price: '622', discount: '5.22', sum: '516.78' })
    const { text, shown } = read2([bread, alike, cottage], owed('1437.48'))
    expect(text.lines.some((l) => l.repaired === true)).toBe(false)
    expect([shown.balanced, shown.lines[2]?.sumHundredths]).toEqual([false, null])
    // the butter copied right: the cottage cheese is put right as printed
    const butter = carded({ quantity: '1', unit_price: '640', discount: '6.4', sum: '633.6' })
    expect(figuresOf(read2([bread, butter, cottage], owed('1437.48')).shown)[2]).toEqual([
      1_000, 52_200, 522, 51_678,
    ])
  })

  it('puts nothing right where a line read whole, swapped, meets the total too (review round 2, Б2)', () => {
    // printed 5 × 105 − 5,25 = 519,75, copied «6»: 519,75 or, a luma off, 519,76. Beside it 1 × 1 234 − 12,34 =
    // 1 221,66 reads whole as copied and, its last 6 a 5, as 1 221,65 within the till's rounding: 519,76 meets the
    // total with it moved — two choices, a doubt
    const eggs = carded({ quantity: '6', unit_price: '105', discount: '5.25', sum: '519.75' })
    const flour = carded({ quantity: '1', unit_price: '1234', discount: '12.34', sum: '1221.66' })
    const { text, shown } = read2([flour, eggs], owed('1741.41'))
    expect(text.lines.some((l) => l.repaired === true)).toBe(false)
    expect([shown.balanced, shown.lines[1]?.sumHundredths]).toEqual([false, null])
    // a line no swap moves takes nothing away
    expect(read2([bread, eggs], owed('806.85')).shown.lines[1]?.repaired).toBe(true)
  })

  it('lets the total pay for no line bent to fit with a reading as cheap (review round 3, Г1)', () => {
    // the butter bent to fit, 99,00 short (am-34: a 3 for a 4, no swap of the pair); the cottage cheese printed
    // 1 × 522 − 5,22 = 516,78 with its price and discount copied «622» and «6.22»: two swaps read it as printed,
    // two as 622 − 6,22 = 615,78 — 99,00 over, which the total would have taken
    const alike = carded({ quantity: '1', unit_price: '540', discount: '5.4', sum: '534.6' })
    const cottage = carded({ quantity: '1', unit_price: '622', discount: '6.22', sum: '516.78' })
    const { text, shown } = read2([bread, alike, cottage], owed('1437.48'))
    expect(text.lines.some((l) => l.repaired === true)).toBe(false)
    expect([shown.balanced, shown.lines[2]?.sumHundredths]).toEqual([false, null])
    // the class code's till: the bun 380 bent to 480 / 480, the juice 1 × 660 with its price copied «560»
    const plain = (price: string, sum: string) =>
      carded({ quantity: '1', unit_price: price, discount: null, sum })
    const classed = read2(
      [plain('420', '420'), plain('480', '480'), plain('560', '660')],
      owed('1460.00'),
    )
    expect([classed.shown.balanced, classed.shown.lines[1]?.sumHundredths]).toEqual([false, null])
    // the price, named: copied right beside them, the same lines are a doubt too
    const butter = carded({ quantity: '1', unit_price: '640', discount: '6.4', sum: '633.6' })
    expect(read2([bread, butter, cottage], owed('1437.48')).text.lines[2]?.repaired).toBeUndefined()
  })

  it('moves the total by every sum a line read whole gives at its fewest swaps (review round 4, №9)', () => {
    // «505.56 / 505.56» read whole as copied reads whole as 505,55, 505,66 or 506,56 too, two swaps each: the luma
    // it may be off makes the eggs, 519,75 or a luma off within the till's rounding, meet the total either way
    const plain = carded({ quantity: '1', unit_price: '505.56', discount: null, sum: '505.56' })
    const eggs = carded({ quantity: '6', unit_price: '105', discount: '5.25', sum: '519.75' })
    expect(read2([bread, plain, eggs], owed('1312.41')).text.lines[2]?.repaired).toBeUndefined()
    // the total it meets with the line as copied alone: 519,76
    const put = read2([bread, plain, eggs], owed('1312.42')).shown.lines[2]
    expect([put?.sumHundredths, put?.repaired]).toEqual([51_976, true])
  })

  it('lets the total choose a luma of the sum alone, never another quantity (review round 4, Г3)', () => {
    // printed 0,51 kg × 665 = 339,15, the price copied «565»: one swap reads it, four 0,61 × 556 = 339,16
    const ham = carded({
      quantity: '0.51',
      unit: 'kg',
      unit_price: '565',
      discount: null,
      sum: '339.15',
    })
    // beside a line bent a luma short (290 − 2,91 = 287,09 for 287,10), the total meets 0,61 × 556 alone
    const bent = carded({ quantity: '1', unit_price: '290', discount: '2.91', sum: '287.09' })
    expect(read2([bent, ham], owed('626.25')).text.lines[1]?.repaired).toBeUndefined()
    expect(figuresOf(read2([bread, ham], owed('626.25')).shown)[1]).toEqual([
      510,
      66_500,
      null,
      33_915,
    ])
    // printed 0,61 kg × 515 = 314,15, the price copied «616»: two swaps read it back, two 0,51 × 616 = 314,16 — the
    // cheapest readings apart by their quantity are a doubt, the bent neighbour or not (review round 5, Г4)
    const veal = carded({
      quantity: '0.61',
      unit: 'kg',
      unit_price: '616',
      discount: null,
      sum: '314.15',
    })
    expect(read2([bent, veal], owed('601.24')).text.lines[1]?.repaired).toBeUndefined()
    expect(read2([bread, veal], owed('601.25')).text.lines[1]?.repaired).toBeUndefined()
  })

  it('puts nothing right past the ways the lines read whole may move', () => {
    // a line of one at 0,05, 0,5, 5 or 50 reads whole a figure up by its swap — 7 of each move the lines 8⁴ ways
    const plain = carded({ quantity: '2', unit_price: '155', discount: null, sum: '330' })
    const of = (more: string[]) => {
      const prices = [
        ...['0.05', '0.5', '5', '50'].flatMap((price) => Array.from({ length: 7 }, () => price)),
        ...more,
      ]
      const whole = prices.map((price) =>
        carded({ quantity: '1', unit_price: price, discount: null, sum: price }),
      )
      const total = prices.reduce((all, price) => all + Math.round(Number(price) * 100), 33_000)
      const text = read2([...whole, plain], owed((total / 100).toFixed(2))).text
      return text.lines[whole.length]?.repaired
    }
    expect(8 ** 4).toBe(REPAIR_SHIFTS_MAX)
    expect(of([])).toBe(true)
    expect(of(['5'])).toBeUndefined()
  })

  it('puts nothing right by a cashback nothing vouches for (review round 2, Б1)', () => {
    // printed 1 × 291 − 2,91 = 288,09 and 5 × 105 − 5,25 = 519,75, the quantity copied «6»: 807,84 paid, 15,16
    // sent to the card, 823,00 left it
    const lines = [
      carded({ quantity: '1', unit_price: '291', discount: '2.91', sum: '288.09' }),
      carded({ quantity: '6', unit_price: '105', discount: '5.25', sum: '519.75' }),
    ]
    const summary = (cashback: string, taxed: string) =>
      Object.entries({
        '/ԱԱՀ-ով հարկվող/ =': taxed,
        'Ընդամենը:': '823.00',
        'Վճարված է PosTerminal:': '823.00',
        'Զեղչ գործարքից:': cashback,
      }).map(([label, amount]) => ({ label, amount }))
    // read right, the sum taxed vouches for the lines' 807,84: the eggs put right as printed
    expect(figuresOf(read2(lines, summary('15.16', '807.84')).shown)[1]).toEqual([
      5_000, 10_500, 525, 51_975,
    ])
    // «Զեղչ գործարքից» copied 15,15: the total stands by itself and the card's payment, but 823 less 15,15 is no
    // place's — the eggs at 519,76 met it, and «ԱԱՀ-ով հարկվող», 807,84, said otherwise
    const misread = read2(lines, summary('15.15', '807.84'))
    expect([misread.text.totalHundredths, misread.text.lines[1]?.repaired]).toEqual([
      82_300,
      undefined,
    ])
    expect([misread.shown.balanced, misread.shown.lines[1]?.sumHundredths]).toEqual([false, null])
    // read right with the sum taxed misread too: the total shown, nothing put right
    expect(read2(lines, summary('15.16', '807.94')).text.lines[1]?.repaired).toBeUndefined()
  })

  it('swaps only the card’s pair: a 1 for a 4 is not put right', () => {
    // printed 1 × 140 − 1,4 = 138,6, copied 110: Tesseract confuses 1 and 4, the model is not measured on it
    const four = carded({ quantity: '1', unit_price: '110', discount: '1.4', sum: '138.6' })
    expect(read2([bread, four], owed('425.70')).text.lines[1]?.repaired).toBeUndefined()
  })

  it('tries two swaps in one figure — 550 copied as 660 — and no more', () => {
    const twice = carded({ quantity: '1', unit_price: '660', discount: '5.5', sum: '544.5' })
    expect(read2([bread, twice], owed('831.60')).text.lines[1]?.priceHundredths).toBe(55_000)
    // printed 2 × 555 = 1 110, copied 666: one reading, of three swaps in the price
    const thrice = carded({ quantity: '2', unit_price: '666', discount: null, sum: '1110' })
    expect(read2([bread, thrice], owed('1397.10')).text.lines[1]?.repaired).toBeUndefined()
  })

  it('leaves a line past its ceiling as copied, trying none of its readings', () => {
    // 67 readings of the price, 46 of the discount, 11 of the quantity: 33 902, past 20 000
    const wide = carded({
      quantity: '5.565',
      unit_price: '565656565.56',
      discount: '5656565.56',
      sum: '1',
    })
    const before = repairTries.count
    const { text } = read2([plain, wide], owed('208.90'))
    expect([repairTries.count - before, text.lines[1]?.repaired]).toEqual([0, undefined])
  })

  it('puts no receipt right past the budget of its readings: 39 dear lines, and not 40', () => {
    // printed 5,565 × 65 666,66 − 3 654,35, copied 6,565: 5 104 readings a line with 3↔8 (MOL-310), 200 000 a
    // receipt
    const dear = carded({
      quantity: '6.565',
      unit: 'kg',
      unit_price: '65666.66',
      discount: '3654.35',
      sum: '361780.61',
    })
    const of = (n: number) => {
      const total = ((28_710 + n * 36_178_061) / 100).toFixed(2)
      const before = repairTries.count
      const { text } = read2([bread, ...Array.from({ length: n }, () => dear)], owed(total))
      return [text.lines.filter((l) => l.repaired === true).length, repairTries.count - before]
    }
    expect(of(39)).toEqual([39, 199_057])
    expect(of(40)).toEqual([0, 199_057])
  })

  it('walks no figure that is no number: three hundred fives of junk (review round 1, №1)', () => {
    const junk = '5'.repeat(300)
    const wild = carded({ quantity: junk, unit_price: junk, discount: junk, sum: junk })
    const before = repairTries.walked
    const { text } = read2([plain, wild], owed('207.90'))
    expect([repairTries.walked - before, text.lines[1]?.repaired]).toEqual([0, undefined])
  })

  it('gives up choosing past its steps: twelve lines each read four ways', () => {
    // 1 × 65 = 56 copied: 55, 56, 65 or 66 — 16 777 216 ways for twelve such lines
    const twice = carded({ quantity: '1', unit_price: '65', discount: null, sum: '56' })
    const before = repairTries.chose
    const { text } = read2(
      Array.from({ length: 12 }, () => twice),
      owed('660.00'),
    )
    expect(text.lines.some((l) => l.repaired === true)).toBe(false)
    expect(repairTries.chose - before).toBeLessThanOrEqual(REPAIR_ASSIGNMENTS_MAX + 1)
  })

  it('takes away the mark of a line the check emptied', () => {
    const repaired = read(answer({ lines: [bread, curd], totals: owed('811.80') }))
    const unproven = verifiedReading({ ...repaired, totalHundredths: null }, { byModel: true })
    expect(unproven.lines[1]).toMatchObject({ repaired: false, sumHundredths: null })
  })
})

describe('a café’s bill (MOL-310)', () => {
  // a made-up bill: dishes of one price column, the service under them, the total in capitals
  const dish = (printed: string, quantity: string, price: string | null, sum: string): Line =>
    line({ printed, code: null, article: null, unit: null, quantity, unit_price: price, sum })
  const dishes = [
    dish('Չիզբուրգեր', '1.00', '2200', '2200'),
    dish('Tequila Sunrise', '2.00', '3000', '6000'),
    dish('Տոլմա', '1.00', '2400', '2400'),
  ]
  const bill = (totals: [string, string][], lines = dishes) =>
    read(answer({ lines, totals: totals.map(([label, amount]) => ({ label, amount })) }))
  const shown = (text: ReturnType<typeof read>) => {
    const one = explainedReading(text, { byModel: true })
    return [text.totalHundredths, text.serviceHundredths, one.receipt, one.lines]
  }

  it('meets its total with the service, and the dishes of one price are kept: the bill is whole', () => {
    const text = bill([
      ['Հավելավճար 10%', '1060'],
      ['ՎՃԱՐՄԱՆ', '11660'],
    ])
    expect(shown(text)).toEqual([1_166_000, 106_000, null, [null, null, null]])
    expect(verifiedReading(text, { byModel: true }).lines[0]?.priceHundredths).toBe(220_000)
  })

  it('reads the service by any of its words, in any case', () => {
    for (const word of ['Սպասարկում', 'ՍՊԱՍԱՐԿՈՒՄ', 'Service 10%', 'Обслуживание']) {
      const text = bill([
        [word, '1060'],
        ['Ընդամենը', '11660'],
      ])
      expect(text.serviceHundredths, word).toBe(106_000)
    }
  })

  it('reads a bill’s total in Russian, «Всего» and «Итого к оплате»', () => {
    expect(bill([['Всего:', '10600.00']]).totalHundredths).toBe(1_060_000)
    expect(bill([['Итого к оплате:', '10600.00']]).totalHundredths).toBe(1_060_000)
  })

  it('takes no service the total did not: a bill that prints it apart meets its total without it', () => {
    const text = bill([
      ['Սպասարկում', '1060'],
      ['Ընդամենը', '10600'],
    ])
    expect(shown(text).slice(0, 3)).toEqual([1_060_000, null, null])
  })

  it('takes two services apart for a doubt: nothing meets the total, and nothing is shown of it', () => {
    const text = bill([
      ['Սպասարկում', '1060'],
      ['Հավելավճար', '1000'],
      ['Ընդամենը', '11660'],
    ])
    expect(shown(text).slice(0, 3)).toEqual([null, null, 'no_total'])
  })

  it('keeps a total that names the service a total: «Итого с обслуживанием» (review №3, adversarial А4)', () => {
    const text = bill([
      ['Итого:', '10600.00'],
      ['Обслуживание 10%:', '1060.00'],
      ['Итого с обслуживанием:', '11660.00'],
    ])
    expect(shown(text).slice(0, 3)).toEqual([1_166_000, 106_000, null])
  })

  it('reads «Վճարման» as a bill’s total alone on its row, never the payment the model copied so (adversarial А1)', () => {
    // «Վճարված է Առձեռն» copied «Վճարման է Առնեմն»: the payment's place, the second of the total, as on master
    // «Տոլմա» lost on a fold
    const text = bill(
      [
        ['Ընդամենը', '10600'],
        ['Վճարման է Առնեմն:', '10600'],
      ],
      dishes.slice(0, 2),
    )
    expect(shown(text).slice(0, 3)).toEqual([1_060_000, null, 'lines_lost'])
  })

  it('takes the service a total its places voted took: every bill seen prints it so (owner’s В-7 «а», adversarial Б1)', () => {
    // Bakery's figures: dishes 17 800 + «Սպասարկում» 1 780 = «Ընդամենը» 19 580, paid by the terminal
    const bakery = [
      dish('Հավի մսով եվ ավոկադոյով', '2', '3900', '7800'),
      dish('Հավ Բորդոլե Բեկոնով', '1', '4600', '4600'),
      dish('Ռաֆ Սուրճ', '2', '1800', '3600'),
      dish('Ցիտրուսային', '1', '1800', '1800'),
    ]
    const paid: [string, string][] = [
      ['Սպասարկում', '1780'],
      ['Ընդամենը', '19580'],
      ['Վճարված է PosTerminal:', '19580'],
    ]
    // a dish lost: the shortfall is the dish alone
    const lost = bill(paid, bakery.slice(0, 3))
    expect(shown(lost).slice(0, 3)).toEqual([1_958_000, 178_000, 'lines_lost'])
    // a price copied 1300 for 1800 (3↔8): put right to the total less the service, the bill whole
    const swapped = bill(paid, [
      bakery[0]!,
      bakery[1]!,
      dish('Ռաֆ Սուրճ', '2', '1300', '3600'),
      bakery[3]!,
    ])
    expect([
      swapped.serviceHundredths,
      swapped.balanced,
      swapped.lines[2]?.priceHundredths,
    ]).toEqual([178_000, true, 180_000])
  })

  it('takes the service the model copied as a line out of the lines, never a dish that names the word', () => {
    const served = [dish('Service 10%', '1.00', null, '1060'), ...dishes]
    const text = bill([['Всего:', '11660.00']], served)
    expect([text.lines.length, text.serviceHundredths, text.balanced]).toEqual([3, 106_000, true])
    // must not: a dish is a dish, whatever word its name holds
    const salad = [dish('Салат Service', '1.00', '1060', '1060'), ...dishes]
    expect(bill([['Всего:', '11660.00']], salad).lines).toHaveLength(4)
  })

  it('counts the service once where it is a doubt: the line stays a line, and no label’s amount is taken (review №9)', () => {
    // dishes 9 000, the model's line «Service 10% · 900» and a label «Սպասարկում 1 000»: two amounts, a doubt either way
    const served = [
      dish('Service 10%', '1.00', null, '900'),
      dish('Չիզբուրգեր', '1.00', '3000', '3000'),
      dish('Tequila Sunrise', '2.00', '3000', '6000'),
    ]
    const text = bill(
      [
        ['Սպասարկում', '1000'],
        ['Всего:', '10900.00'],
      ],
      served,
    )
    expect([text.lines.length, text.serviceHundredths, text.totalHundredths]).toEqual([
      3,
      null,
      null,
    ])
  })

  it('takes no service by the vote once the service line stayed a line: never counted twice (adversarial В2)', () => {
    // «Service 10%» a line not in the total: the dishes alone are 19 500, paid by the terminal
    const served = [
      dish('Service 10%', '1.00', null, '1950.00'),
      dish('Телятина по-мексикански', '1.00', null, '3800.00'),
      dish('Тирамису', '2.00', null, '3000.00'),
      dish('Салат с телятиной и хрустящими баклажанами', '1.00', null, '12700.00'),
    ]
    const text = bill(
      [
        ['Ընդամենը', '19500'],
        ['Վճարված է PosTerminal:', '19500'],
      ],
      served,
    )
    // the service line stays a line, never as read: «проверьте», the bill not proven (adversarial Е2)
    expect(shown(text).slice(0, 3)).toEqual([1_950_000, null, 'line_not_as_printed'])
    expect(text.lines).toHaveLength(4)
  })

  it('proves no bill whole by a service line left a line: two service amounts are a doubt (adversarial Е2)', () => {
    const served = [
      dish('Service 10%', '1.00', null, '1950.00'),
      dish('Телятина по-мексикански', '1.00', null, '3800.00'),
      dish('Тирамису', '2.00', null, '3000.00'),
      dish('Салат с телятиной и хрустящими баклажанами', '1.00', null, '12700.00'),
    ]
    const text = bill(
      [
        ['Service 10%', '1960.00'],
        ['Всего:', '21450.00'],
        ['Итого к оплате:', '21450.00'],
      ],
      served,
    )
    const one = explainedReading(text, { byModel: true })
    // «Всего» and «Итого к оплате» are one place: no total, and the service line «проверьте» — never a dish read
    expect([text.serviceHundredths, one.receipt, one.lines[0]]).toEqual([
      null,
      'no_total',
      'unsettled',
    ])
  })

  it('holds the service to its percent where the lines met the total with it too (adversarial Ж1)', () => {
    // a bill «not included», the bread lost: 500 is 11,1 % of the 4 500 read, not the 10 % printed — no service
    const read = [
      dish('Չիզբուրգեր', '1', '2200', '2200'),
      dish('Mojito', '1', '1800', '1800'),
      dish('Թեյ', '1', '500', '500'),
    ]
    const label = bill(
      [
        ['Սպասարկում 10%', '500'],
        ['Ընդամենը', '5000'],
      ],
      read,
    )
    expect(shown(label).slice(0, 3)).toEqual([null, null, 'no_total'])
    const line = bill([['Ընդամենը', '5000']], [dish('Service 10%', '1', null, '500'), ...read])
    expect([line.serviceHundredths, line.balanced]).toEqual([null, false])
  })

  it('holds the service to the percent printed beside it where only the vote vouches for the total (adversarial Е1)', () => {
    const served = (sum: string) => [
      dish('Service 10%', '1.00', null, sum),
      dish('Телятина по-мексикански', '1.00', null, '3800.00'),
      dish('Тирамису', '2.00', null, '3000.00'),
      dish('Салат с телятиной и хрустящими баклажанами', '1.00', null, '12700.00'),
    ]
    const paid: [string, string][] = [
      ['Всего:', '21450.00'],
      ['Итого к оплате:', '21450.00'],
      ['Վճարված է PosTerminal:', '21450.00'],
    ]
    // copied 1960 for 1950: not 10 % of the dishes, so no service — the line stays, «проверьте»
    expect(bill(paid, served('1960.00')).serviceHundredths).toBeNull()
    // as printed: 10 % of 19 500
    expect(bill(paid, served('1950.00')).serviceHundredths).toBe(195_000)
  })

  it('shows no total a subtotal meets without the service line: the total with it may be lost (Р-2, adversarial Д1)', () => {
    // «Всего» 19 500 is the dishes; «Итого к оплате» 21 450 with the service the model did not copy
    const served = [
      dish('Service 10%', '1.00', null, '1950.00'),
      dish('Телятина по-мексикански', '1.00', null, '3800.00'),
      dish('Тирамису', '2.00', null, '3000.00'),
      dish('Салат с телятиной и хрустящими баклажанами', '1.00', null, '12700.00'),
    ]
    expect(shown(bill([['Всего:', '19500.00']], served)).slice(0, 3)).toEqual([
      null,
      null,
      'no_total',
    ])
  })

  it('reads a service whose percent is in brackets: «Հավելավճար (10%)» (adversarial Б2)', () => {
    const text = bill([
      ['Հավելավճար (10%)', '1060'],
      ['ՎՃԱՐՄԱՆ', '11660'],
    ])
    expect(shown(text).slice(0, 3)).toEqual([1_166_000, 106_000, null])
  })

  it('leaves the service line among the lines where no surcharge is taken (review №5)', () => {
    // two services are a doubt: the line stays the model's, for the foot's shortfall to show
    const served = [dish('Service 10%', '1.00', null, '1060'), ...dishes]
    const text = bill(
      [
        ['Սպասարկում', '1000'],
        ['Всего:', '11660.00'],
      ],
      served,
    )
    expect([text.lines.length, text.serviceHundredths]).toEqual([4, null])
  })

  describe('a bill that prints no price — «Блюдо, Кол-во, Сумма» (owner’s В-4 «а»)', () => {
    const priceless = [
      dish('Тирамису', '2.00', null, '3000.00'),
      dish('Смузи', '1.00', null, '1700.00'),
      dish('Чай', '3.00', null, '1000.00'),
    ]

    it('prices a line of a whole bill by its sum and quantity, where that is a figure to the hundredth', () => {
      const shownLines = verifiedReading(bill([['Всего:', '5700.00']], priceless), {
        byModel: true,
      }).lines
      expect(shownLines.map((l) => [l.quantityMilli, l.priceHundredths, l.sumHundredths])).toEqual([
        [2_000, 150_000, 300_000],
        [1_000, 170_000, 170_000],
        // 1 000 by 3 is no figure to the hundredth: the sum stays, the price is none
        [3_000, null, 100_000],
      ])
      // the total vouches for the sums, nothing for the count: «проверьте», never as read (owner's В-6 «а», А2)
      expect(shownLines.map((l) => [l.repaired, l.asPrinted])).toEqual([
        [true, false],
        [true, false],
        [true, false],
      ])
    })

    it('takes no sum of nothing for a line the total vouches for (review №4)', () => {
      const zero = [...priceless, dish('Хлеб', '1.00', null, '0')]
      const one = explainedReading(bill([['Всего:', '5700.00']], zero), { byModel: true })
      expect(one.lines[3]).toBe('zero_not_gift')
    })

    it('empties every such line of a bill not proven whole, by a reason of its own', () => {
      const one = explainedReading(bill([['Всего:', '5800.00']], priceless), { byModel: true })
      expect(one.lines).toEqual(['no_price_unproven', 'no_price_unproven', 'no_price_unproven'])
      expect(one.shown.lines.every((l) => l.sumHundredths === null)).toBe(true)
    })
  })
})

describe('a bank terminal’s slip with no bill (MOL-310, owner’s В-3 «а»)', () => {
  const slip = (over: Partial<ModelReceipt> = {}) =>
    answer({
      shop: 'Սրճարան',
      id_rows: ['TID: 10000001', 'MID: 20000002', 'Անդորրագիր 12345'],
      totals: [{ label: 'Գումար', amount: '11660.00' }],
      ...over,
    })

  it('is a sum to record, the one amount after its word, with nothing to reshoot', () => {
    const text = read(slip())
    expect([text.layout, text.totalHundredths, text.balanced, needsReshoot(text)]).toEqual([
      'slip',
      1_166_000,
      false,
      false,
    ])
  })

  it('is no slip without the terminal’s rows, nor with two amounts: a reading of nothing, as before', () => {
    const bare = read(slip({ id_rows: ['Անդորրագիր 12345'] }))
    expect([bare.layout, bare.totalHundredths, needsReshoot(bare)]).toEqual(['class', null, true])
    const two = read(
      slip({
        totals: [
          { label: 'Գումար', amount: '11660.00' },
          { label: 'Գումար', amount: '11600.00' },
        ],
      }),
    )
    expect([two.layout, two.totalHundredths]).toEqual(['class', null])
  })

  it('is a slip with an amount of nothing beside its sum: tips of 0 say nothing (adversarial Б3)', () => {
    const tipped = read(
      slip({
        totals: [
          { label: 'Գումար', amount: '11660.00' },
          { label: 'Թեյավճար', amount: '0.00' },
        ],
      }),
    )
    expect([tipped.layout, tipped.totalHundredths]).toEqual(['slip', 1_166_000])
  })

  it('is no slip where another label’s amount was not read: it may be the receipt’s total (review №12)', () => {
    const misread = read(
      slip({
        totals: [
          { label: 'Գումար', amount: '4850.00' },
          { label: 'Ընդամենը', amount: '4 85O' },
        ],
      }),
    )
    expect([misread.layout, needsReshoot(misread)]).toEqual(['class', true])
  })

  it('is no slip where the paper prints a total beside it: a receipt shot with its slip, lines lost (adversarial А5)', () => {
    const both = read(
      slip({
        totals: [
          { label: 'Ընդամենը', amount: '4850.00' },
          { label: 'Գումար', amount: '4850.00' },
        ],
      }),
    )
    expect([both.layout, needsReshoot(both)]).toEqual(['class', true])
  })

  it('is no slip where a line was read: the receipt with a slip under it reads as before', () => {
    const lined = read(slip({ lines: [line()] }))
    expect(lined.layout).not.toBe('slip')
  })
})

describe('a cashback the model copied under another word (MOL-310, Р-1)', () => {
  const carded = [
    line({ quantity: '2', unit_price: '370', discount: '7.4', sum: '732.6' }),
    line({ quantity: '1', unit_price: '960', discount: '9.6', sum: '950.4' }),
  ]
  const of = (totals: [string, string][]) =>
    read(answer({ lines: carded, totals: totals.map(([label, amount]) => ({ label, amount })) }))
  // the prepayment slip over the receipt, and the total that left the card
  const head: [string, string][] = [
    ['Կանխավճար', '17.00'],
    ['Ընդամենը', '17.00'],
    ['Ընդամենը:', '1700.00'],
    ['Վճարված է PosTerminal:', '1700.00'],
  ]

  it('takes the slip’s sum where the same sum stands under another word below the total', () => {
    const text = of([...head, ['կանխավճարին ավել. մանր:', '17.00']])
    expect([text.cashbackHundredths, text.totalHundredths, text.balanced]).toEqual([
      1_700,
      170_000,
      true,
    ])
  })

  it('takes the slip’s sum where a total less the sum taxed with VAT is it', () => {
    const text = of([...head, ['/ԱԱՀ-ով հարկվող/ =', '1683.00']])
    expect([text.cashbackHundredths, text.balanced]).toEqual([1_700, true])
  })

  it('takes no slip’s sum on its own, nor two so vouched', () => {
    expect(of(head).cashbackHundredths).toBeNull()
    const two = of([
      ...head,
      ['Կանխավճար', '18.00'],
      ['կանխավճարին ավել. մանր:', '17.00'],
      ['Մանր:', '18.00'],
    ])
    expect(two.cashbackHundredths).toBeNull()
  })
})

describe('a model’s slips of copying the total puts right (MOL-310, owner’s В-5 «а»)', () => {
  const carded = (over: Partial<Line>) => line({ code: '0401', ...over })
  // as read: 1 × 210 − 2,1 = 207,9 — no digit any swap takes
  const plain = carded({
    quantity: '1',
    unit: 'pcs',
    unit_price: '210',
    discount: '2.1',
    sum: '207.9',
  })
  const owed = (amount: string) => [
    { label: 'Ընդամենը', amount },
    { label: 'Վճարված է Առձեռն', amount },
  ]
  const put = (copied: Line, total: string) => {
    const text = read(answer({ lines: [plain, copied], totals: owed(total) }))
    const one = text.lines[1]
    return [one?.repaired, one?.quantityMilli, one?.priceHundredths, one?.sumHundredths]
  }

  it('drops the 4 the model made of «կ» in «0,65կգ», where the total confirms the weight', () => {
    // printed 0,65 × 2 090 − 13,58 = 1 344,92
    const fish = carded({
      quantity: '0.654',
      unit: 'kg',
      unit_price: '2090',
      discount: '13.58',
      sum: '1344.92',
    })
    expect(put(fish, '1552.82')).toEqual([true, 650, 209_000, 134_492])
    // must not: a weight whose 4 is its own, the arithmetic holding as copied, is left as read
    const own = carded({
      quantity: '0.324',
      unit: 'kg',
      unit_price: '265',
      discount: '0.86',
      sum: '85',
    })
    expect(put(own, '292.90')[0]).toBeUndefined()
  })

  it('reads a count the model took from the name — «10հտ» bought once — as one', () => {
    // printed 1 × 830 − 8,3 = 821,7, the pack of ten in the name
    const eggs = carded({
      printed: 'Հավկիթ «Ոսկեհատ» 10հտ',
      quantity: '10',
      unit: 'pcs',
      unit_price: '830',
      discount: '8.3',
      sum: '821.7',
    })
    expect(put(eggs, '1029.60')).toEqual([true, 1_000, 83_000, 82_170])
    // must not: a count no name prints stays as copied
    expect(put({ ...eggs, printed: 'Հավկիթ «Ոսկեհատ»' }, '1029.60')[0]).toBeUndefined()
  })

  it('puts a 3 copied for an 8 right on the model’s line, by the total alone', () => {
    // printed 1 × 650 − 68,25 = 581,75 (a card of 10,5 %), copied 531,75
    const wipes = carded({
      quantity: '1',
      unit: 'pcs',
      unit_price: '650',
      discount: '68.25',
      sum: '531.75',
    })
    const tissue = carded({
      quantity: '1',
      unit: 'pcs',
      unit_price: '200',
      discount: '21',
      sum: '179',
    })
    const text = read(answer({ lines: [tissue, wipes], totals: owed('760.75') }))
    expect([text.lines[1]?.repaired, text.lines[1]?.sumHundredths]).toEqual([true, 58_175])
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

describe('how the model’s summary says the receipt was paid (MOL-312)', () => {
  const paid = (...totals: [string, string][]) =>
    modelPaidBy(
      ARMENIAN_RECEIPTS,
      answer({ totals: totals.map(([label, amount]) => ({ label, amount })) }),
    )

  it('reads the summary’s words beside their amounts, as Tesseract’s rows', () => {
    expect(paid(['Ընդամենը', '1680.00'], ['Վճարված է Առծեռն', '5000.00'])).toBe('cash')
    expect(paid(['Ընդամենը', '19098.00'], ['Վճարված է PosTerminal:', '19 098,00'])).toBe('card')
    // the forms the bench's answers made of «Առձեռն»
    for (const word of ['Առեն', 'Առնեռն', 'Առեղեն', 'Առճեռն', 'Առոեոն', 'Առժեն']) {
      expect(paid([`Վճարված է ${word}`, '1000.00']), word).toBe('cash')
    }
  })

  it('reads the year’s trade the model copied «Առաջին» as no payment (adversarial А1, А2)', () => {
    const trade: [string, string] = ['Առաջին ամսվա սկզբից', '152889.00']
    expect(paid(['Վճարված է PosTerminal', '22521.00'], trade)).toBe('card')
    expect(paid(['Վճարված է:', '22521.00'], trade)).toBeNull()
    expect(paid(['Առնեն ամբողջ ակզբից:', '152889.00'])).toBeNull()
  })

  it('reads no bonus spent as cash, nor a payment of an unknown way', () => {
    // must not: the model copied «Կանխավճարի մարում» as «Կանխիկ վճարի մարում», and a delivery app
    expect(paid(['Կանխիկ վճարի մարում', '700.00'])).toBeNull()
    expect(paid(['Վճարված է Yandex', '8676.00'])).toBeNull()
    expect(paid(['Վճարված է Առևտուր', '16539.00'])).toBeNull()
    expect(paid(['Վճարված է Առձեռն', '0'], ['Վճարված է PosTerminal', '3741.00'])).toBe('card')
  })
})
