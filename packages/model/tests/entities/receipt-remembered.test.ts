import { describe, expect, it } from 'vitest'
import { ARMENIAN_RECEIPTS } from '#model/entities/receipt-card'
import { receiptTextOfModel } from '#model/entities/receipt-model'
import {
  REMEMBERED_RECEIPT_COMBINATIONS_MAX,
  rememberedLines,
  rememberedReading,
  rememberedTries,
} from '#model/entities/receipt-remembered'
import { verifiedReading } from '#model/entities/receipt-verify'
import type { ModelReceipt } from '#model/entities/receipt-model'
import type { ReceiptText, ReceiptTextLine } from '#model/entities/receipt-text'

// a made-up head: the repository is public, and a receipt's own carries a customer's name
const answer = (lines: Line[], totals: { label: string; amount: string }[] = []): ModelReceipt => ({
  shop: 'Խանութ «Օրինակ»',
  address: 'Գորկու 1, Գյումրի',
  id_rows: ['ՀՎՀՀ: 01234567'],
  date: '2026-10-08',
  time: '19:57',
  lines,
  totals,
})

type Line = ModelReceipt['lines'][number]
const line = (article: string, over: Partial<Line>): Line => ({
  printed: 'Կաթ «Մարիաննա» 3.2% 1լ',
  code: '0401',
  article,
  quantity: '1',
  unit: 'pcs',
  unit_price: '290',
  discount: null,
  sum: '290',
  ...over,
})
// as printed: 1 × 290 − 2,9 = 287,1 — the card's 1 %
const bread = line('1000001', { discount: '2.9', sum: '287.1' })
const owed = (amount: string) => [
  { label: 'Ընդամենը', amount },
  { label: 'Վճարված է Առձեռն', amount },
]
const prices = (entries: Record<string, number>) => new Map(Object.entries(entries))

const read = (
  lines: Line[],
  memory: Record<string, number>,
  totals: ReturnType<typeof owed> = [],
) => {
  const text = receiptTextOfModel(ARMENIAN_RECEIPTS, answer(lines, totals), prices(memory))
  return { text, shown: verifiedReading(text, { byModel: true }) }
}
const figuresOf = (l: ReceiptTextLine | undefined) => [
  l?.quantityMilli,
  l?.priceHundredths,
  l?.discountHundredths,
  l?.sumHundredths,
]
const BLANK = [null, null, null, null]

describe('the shop’s memory as a voice in a model’s digits (MOL-291)', () => {
  it('puts right a line whose price it remembers one confused digit off, the rest by the swaps', () => {
    // printed 1 × 550 − 5,5 = 544,5, copied 650 / 5,6 / 644,6 (am-34): no total to judge it
    const copied = line('1119220', { unit_price: '650', discount: '5.6', sum: '644.6' })
    expect(figuresOf(read([bread, copied], {}).shown.lines[1])).toEqual(BLANK)
    const { text, shown } = read([bread, copied], { '1119220': 55_000 })
    expect(figuresOf(shown.lines[1])).toEqual([1_000, 55_000, 550, 54_450])
    expect(shown.lines[1]).toMatchObject({
      repaired: true,
      remembered: 'repaired',
      asPrinted: false,
    })
    // the memory proves no receipt whole: the bread stands as printed, the receipt as before
    expect([text.balanced, shown.balanced]).toEqual([false, false])
  })

  it('puts right «60 60» for «50 50» where the copy disagrees with itself, never where it agrees', () => {
    const half = line('1122223', { unit_price: '60', sum: '50' })
    expect(figuresOf(read([half], { '1122223': 5_000 }).shown.lines[0])).toEqual([
      1_000,
      5_000,
      null,
      5_000,
    ])
    // as printed «60 60» against a remembered 50: a doubt, never a correction (owner's В-2 «б»)
    const alike = line('1122223', { unit_price: '60', sum: '60' })
    const { text, shown } = read([alike], { '1122223': 5_000 })
    expect(text.lines[0]?.remembered).toBe('doubted')
    expect(figuresOf(shown.lines[0])).toEqual(BLANK)
  })

  it('confirms one number printed twice where it is the remembered price', () => {
    // 1 × 50 = 50 is emptied on a receipt not proven whole (MOL-255, В-2 «а»): the memory is its second source
    const bag = line('1122223', { unit_price: '50', sum: '50' })
    expect(figuresOf(read([bag], {}).shown.lines[0])).toEqual(BLANK)
    const { shown } = read([bag], { '1122223': 5_000 })
    expect(figuresOf(shown.lines[0])).toEqual([1_000, 5_000, null, 5_000])
    expect(shown.lines[0]).toMatchObject({ remembered: 'confirmed', asPrinted: true })
    expect(shown.lines[0]?.repaired).toBeUndefined()
  })

  it('empties a line as printed one confused digit off it, the total not vouching (am-34’s butter)', () => {
    // printed 640 / 5,4 / 634,6, copied 540 / 5,4 / 534,6 — it holds as copied
    const butter = line('1174106', { unit_price: '540', discount: '5.4', sum: '534.6' })
    expect(figuresOf(read([bread, butter], {}).shown.lines[1])).toEqual([
      1_000, 54_000, 540, 53_460,
    ])
    expect(figuresOf(read([bread, butter], { '1174106': 64_000 }).shown.lines[1])).toEqual(BLANK)
  })

  it('takes the memory’s reading of a doubted line where only it meets a total two places print', () => {
    const coffee = line('1000002', { unit_price: '1200', sum: '1200' })
    const bag = line('1122223', { unit_price: '60', sum: '60' })
    const { shown } = read([coffee, bag], { '1122223': 5_000 }, owed('1250'))
    expect(figuresOf(shown.lines[1])).toEqual([1_000, 5_000, null, 5_000])
    expect(shown.lines[1]).toMatchObject({ repaired: true, remembered: 'repaired' })
    expect(shown.balanced).toBe(true)
    // the total does not meet it: the doubt stands
    expect(
      figuresOf(read([coffee, bag], { '1122223': 5_000 }, owed('1270')).shown.lines[1]),
    ).toEqual(BLANK)
  })

  it('says nothing of a price further off: the shelf price changed (caramel 2 030 for 1 830)', () => {
    const caramel = line('066134', {
      quantity: '0.164',
      unit: 'kg',
      unit_price: '2030',
      discount: '3.34',
      sum: '329.58',
    })
    const { text } = read([bread, caramel], { '066134': 183_000 })
    expect(text.lines[1]?.remembered).toBeUndefined()
    expect(figuresOf(text.lines[1])).toEqual([164, 203_000, 334, 32_958])
  })

  it('leaves a receipt the lines prove whole as copied, whatever it remembers', () => {
    const bag = line('1122223', { unit_price: '60', sum: '60' })
    const { text, shown } = read([bread, bag], { '1122223': 5_000 }, owed('347.10'))
    expect(text.lines.map((l) => l.remembered)).toEqual([undefined, undefined])
    expect([shown.balanced, shown.lines[1]?.priceHundredths]).toEqual([true, 6_000])
  })

  it('needs the receipt’s card rate for a discount, and the arithmetic to the hundredth', () => {
    // no line shares a rate: nothing would hold the discount
    const alone = line('1119220', { unit_price: '650', discount: '5.6', sum: '644.6' })
    expect(read([alone], { '1119220': 55_000 }).text.lines[0]?.remembered).toBeUndefined()
    // at 0,5 %: 50 − 0,25 = 49,75 — «0,27 / 49,76» holds within the till's three luma, and not to the hundredth
    const half = line('1000003', { discount: '1.45', sum: '288.55' })
    const off = line('1122223', { unit_price: '60', discount: '0.27', sum: '49.76' })
    expect(read([half, off], { '1122223': 5_000 }).text.lines[1]?.remembered).toBeUndefined()
  })

  it('lets the price as copied stand for the arithmetic’s alone: the total judges such a line', () => {
    // the price is the remembered 290, the sum copied 674,2 for 574,2: the memory has no word on the sum
    const two = line('1106618', { quantity: '2', discount: '5.8', sum: '674.2' })
    expect(read([bread, two], { '1106618': 29_000 }).text.lines[1]?.remembered).toBeUndefined()
  })

  it('chooses among a line’s readings the total confirms, by its price (MOL-290’s doubt)', () => {
    // printed 0,6 kg × 550 − 3,3 = 326,7, copied 660: 0,5 × 660 is the same sum at the same 1 %
    const cheese = line('2000001', {
      quantity: '0.6',
      unit: 'kg',
      unit_price: '660',
      discount: '3.3',
      sum: '326.7',
    })
    expect(read([bread, cheese], {}, owed('613.80')).shown.lines[1]?.quantityMilli).toBeNull()
    const { shown } = read([bread, cheese], { '2000001': 55_000 }, owed('613.80'))
    expect(figuresOf(shown.lines[1])).toEqual([600, 55_000, 330, 32_670])
    expect(shown.balanced).toBe(true)
  })

  it('reads nothing without an article, and no memory at all as before', () => {
    const bare = { ...line('1122223', { unit_price: '60', sum: '50' }), article: null }
    expect(read([bare], { '1122223': 5_000 }).text.lines[0]?.remembered).toBeUndefined()
    const half = line('1122223', { unit_price: '60', sum: '50' })
    expect(read([half], {}).text).toEqual(receiptTextOfModel(ARMENIAN_RECEIPTS, answer([half])))
  })
})

describe('the shop’s memory on Tesseract’s reading (MOL-291)', () => {
  const ocrLine = (over: Partial<ReceiptTextLine>): ReceiptTextLine => ({
    printed: 'Պոլիէթիլենային տոպրակ',
    hs: '3923',
    sku: '1122223',
    quantityMilli: 1_000,
    unit: 'piece',
    priceHundredths: 5_000,
    sumHundredths: 5_000,
    discountHundredths: 0,
    settled: true,
    asPrinted: false,
    read: {
      quantityMilli: 1_000,
      priceHundredths: 6_000,
      discountHundredths: 0,
      sumHundredths: 5_000,
    },
    rows: [],
    ...over,
  })
  const reading = (lines: ReceiptTextLine[], total: number | null = null): ReceiptText => ({
    layout: 'card',
    tin: '01234567',
    date: null,
    time: null,
    receiptNo: null,
    totalHundredths: total,
    readTotalHundredths: total,
    balanced: false,
    lines,
  })
  const swaps = ARMENIAN_RECEIPTS.swaps

  it('puts a price right by the card’s swaps, every other figure as printed', () => {
    const text = rememberedReading(reading([ocrLine({})]), prices({ '1122223': 5_000 }), swaps)
    const shown = verifiedReading(text)
    expect(figuresOf(shown.lines[0])).toEqual([1_000, 5_000, 0, 5_000])
    expect(shown.lines[0]).toMatchObject({ repaired: true, remembered: 'repaired' })
  })

  it('bends no other figure: the sum read «51» stays as the parse left it', () => {
    const bent = ocrLine({
      read: {
        quantityMilli: 1_000,
        priceHundredths: 6_000,
        discountHundredths: 0,
        sumHundredths: 5_100,
      },
    })
    const text = rememberedReading(reading([bent]), prices({ '1122223': 5_000 }), swaps)
    expect(text.lines[0]?.remembered).toBeUndefined()
    expect(verifiedReading(text).lines[0]?.sumHundredths).toBeNull()
  })

  it('leaves a receipt proven whole as read, and a line with no figures as printed', () => {
    const printed = ocrLine({
      asPrinted: true,
      priceHundredths: 6_000,
      sumHundredths: 6_000,
      read: {
        quantityMilli: 1_000,
        priceHundredths: 6_000,
        discountHundredths: 0,
        sumHundredths: 6_000,
      },
    })
    const whole = reading([printed], 6_000)
    expect(rememberedReading(whole, prices({ '1122223': 5_000 }), swaps)).toBe(whole)
    // a row of two bare figures prints no price apart (the card's plain row)
    const plain = ocrLine({
      read: {
        quantityMilli: 1_000,
        priceHundredths: null,
        discountHundredths: 0,
        sumHundredths: 6_000,
      },
    })
    const none = rememberedReading(reading([plain]), prices({ '1122223': 5_000 }), swaps)
    expect(none.lines[0]?.remembered).toBeUndefined()
  })

  it('tries no line past its ceiling, and no receipt past its budget', () => {
    // sixteen fives read 137 ways with two swaps: a quantity and a sum of them are 18 769 readings
    const fives = Number('5'.repeat(16))
    const dear = ocrLine({
      read: {
        quantityMilli: fives,
        priceHundredths: 6_000,
        discountHundredths: 0,
        sumHundredths: fives,
      },
    })
    const both = { price: ARMENIAN_RECEIPTS.modelSwaps, others: ARMENIAN_RECEIPTS.modelSwaps }
    let before = rememberedTries.count
    const once = rememberedLines([dear], prices({ '1122223': 5_000 }), both, null)
    expect([once[0]?.remembered, rememberedTries.count - before]).toEqual([undefined, 0])
    // eight fives in a quantity and a sum, 37 × 37 readings a line: the 37th is past the receipt's budget
    const eight = Number('5'.repeat(8))
    const cheap = ocrLine({
      read: {
        quantityMilli: eight,
        priceHundredths: 6_000,
        discountHundredths: 0,
        sumHundredths: eight,
      },
    })
    before = rememberedTries.count
    rememberedLines(Array(40).fill(cheap), prices({ '1122223': 5_000 }), both, null)
    expect(rememberedTries.count - before).toBe(
      REMEMBERED_RECEIPT_COMBINATIONS_MAX - (REMEMBERED_RECEIPT_COMBINATIONS_MAX % (37 * 37)),
    )
  })
})
