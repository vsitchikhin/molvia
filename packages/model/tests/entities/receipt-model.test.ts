import { describe, expect, it } from 'vitest'
import { ARMENIAN_RECEIPTS } from '#model/entities/receipt-card'
import { needsReshoot, receiptCityOf } from '#model/entities/receipt'
import {
  MODEL_RECEIPT_LINES_MAX,
  REPAIR_ASSIGNMENTS_MAX,
  REPAIR_SHIFTS_MAX,
  repairTries,
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
    // «505.56 / 505.56» read whole as copied reads whole as 505,55, 505,66 or 506,56 too, one swap each: the luma
    // it may be off makes «205.05 / 205.06» meet the total at 205,05 as well — a doubt
    const plain = (price: string, sum: string) =>
      carded({ quantity: '1', unit_price: price, discount: null, sum })
    const juice = plain('205.05', '205.06')
    expect(
      read2([plain('505.56', '505.56'), juice], owed('710.61')).text.lines[1]?.repaired,
    ).toBeUndefined()
    // the total it meets as copied: 205,06
    const put = read2([plain('505.56', '505.56'), juice], owed('710.62')).shown.lines[1]
    expect([put?.sumHundredths, put?.repaired]).toEqual([20_506, true])
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
    const { text } = read2([bread, wide], owed('288.10'))
    expect([repairTries.count - before, text.lines[1]?.repaired]).toEqual([0, undefined])
  })

  it('puts no receipt right past the budget of its readings: 89 dear lines, and not 90', () => {
    // printed 5,565 × 65 666,66 − 3 654,35, copied 6,565: 2 233 readings a line, 200 000 a receipt
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
    expect(of(89)).toEqual([89, 198_737])
    expect(of(90)).toEqual([0, 198_737])
  })

  it('walks no figure that is no number: three hundred fives of junk (review round 1, №1)', () => {
    const junk = '5'.repeat(300)
    const wild = carded({ quantity: junk, unit_price: junk, discount: junk, sum: junk })
    const before = repairTries.walked
    const { text } = read2([bread, wild], owed('287.10'))
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
