// MOL-272 — a receipt read by a model (Claude Haiku) into the parse's own `ReceiptText`, so that every
// rule after it is the one Tesseract's reading goes through: `verifiedReading`, `readPartly`, the lines'
// items, the wire. The model copies what is printed, every number of a line in its place and every amount
// of the summary with its word (MOL-268, «Дальше»); which amount is the total is decided here, by the
// country's card, never by the model.

import { DEPARTMENT, TOLERANCE_HUNDREDTHS } from '#model/entities/receipt-text'
import type { PhotoReading } from '#model/entities/receipt-card'
import type { ReceiptText, ReceiptTextLine, TextRow } from '#model/entities/receipt-text'
import { z } from 'zod'

/** The most lines an answer may carry: the longest receipt of the bench has 33, a till's roll some 200. */
export const MODEL_RECEIPT_LINES_MAX = 300
/** The most summary amounts: the bench's longest summary has 12. */
export const MODEL_RECEIPT_TOTALS_MAX = 40

// what the model writes is read, never trusted: a figure that is no number of its kind is no figure
const text = z.string().max(300).nullable()

/**
 * The model's answer, as the reader asks for it (structured output) and parses it back. Numbers are
 * strings with a decimal point, as printed — never JSON numbers, which a model rounds and a parser floats.
 */
export const modelReceiptSchema = z.strictObject({
  shop: text,
  address: text,
  tin: text,
  receipt_no: text,
  date: text,
  time: text,
  lines: z
    .array(
      z.strictObject({
        printed: z.string().max(300),
        code: text,
        article: text,
        quantity: text,
        unit: z.enum(['pcs', 'kg', 'l']).nullable(),
        unit_price: text,
        discount: text,
        sum: text,
      }),
    )
    .max(MODEL_RECEIPT_LINES_MAX),
  totals: z
    .array(z.strictObject({ label: z.string().max(300), amount: z.string().max(300) }))
    .max(MODEL_RECEIPT_TOTALS_MAX),
})
export type ModelReceipt = z.infer<typeof modelReceiptSchema>

/** «5403.12» as hundredths, «0.452» as thousandths; a figure with more digits after the point is none. */
function figureOf(value: string | null, digits: number): number | null {
  const found = value === null ? null : /^(\d{1,9})(?:\.(\d+))?$/.exec(value.trim())
  if (found === null) return null
  const [, whole = '', part = ''] = found
  if (part.length > digits) return null
  return Number(whole) * 10 ** digits + Number(part.padEnd(digits, '0'))
}

/** The class code of a line as the parse keeps it: a heading of four digits, a service class «56.10». */
function classOf(code: string | null): string | null {
  return /(?<![\d.])(\d{2}\.\d{2}|\d{4})(?![\d.])/.exec(code ?? '')?.[1] ?? null
}

const articleOf = (article: string | null): string | null => {
  const trimmed = article?.trim() ?? ''
  return /^[\p{L}\d_./-]{1,40}$/u.test(trimmed) ? trimmed : null
}

const dayOf = (date: string | null): string | null =>
  /^\d{4}-\d{2}-\d{2}$/.test(date ?? '') ? date : null
const clockOf = (time: string | null): string | null => {
  const found = /^(\d{2}):(\d{2})$/.exec(time ?? '')
  return found !== null && Number(found[1]) < 24 && Number(found[2]) < 60 ? (time ?? null) : null
}

/**
 * A line as the model wrote it. Its figures are printed by the model's nature — it copies, the arithmetic
 * is ours — so a line is as printed exactly where it settles: quantity × price = sum + discount, to the
 * hundredth or, on a till that prints a shelf price apart from what was paid, to its rounding.
 */
function lineOf(line: ModelReceipt['lines'][number], rounding: number): ReceiptTextLine {
  const quantityMilli = figureOf(line.quantity, 3)
  const priceHundredths = figureOf(line.unit_price, 2)
  const sumHundredths = figureOf(line.sum, 2)
  const discountHundredths = figureOf(line.discount, 2)
  const settled =
    quantityMilli !== null &&
    priceHundredths !== null &&
    sumHundredths !== null &&
    Math.abs(
      Math.round((quantityMilli * priceHundredths) / 1_000) -
        (sumHundredths + (discountHundredths ?? 0)),
    ) <= rounding
  return {
    printed: line.printed.trim(),
    hs: classOf(line.code),
    sku: articleOf(line.article),
    quantityMilli,
    unit: line.unit === 'kg' ? 'kg' : line.unit === 'l' ? 'l' : 'piece',
    priceHundredths,
    sumHundredths,
    discountHundredths,
    settled,
    asPrinted: settled,
    // no boxes: a model's lines are not cut out for the reader's training (MOL-272, Р-4)
    rows: [],
  }
}

/**
 * The total two places vouch for (MOL-244), as the parse's `votedTotal` decides it: the lines that met a
 * printed total every one as read, else the one amount at least two of the total, the payment and — on a
 * receipt with no items — the section printed. A prepayment («Կանխավճար») is none of them: the card's
 * payment words are a till's, and a prepayment slip printed above the receipt names its own total, which
 * meets neither the lines nor the payment.
 */
function totalOf(
  reading: PhotoReading,
  answer: ModelReceipt,
  lines: readonly ReceiptTextLine[],
): { total: number | null; read: number | null; met: boolean } {
  const w = reading.words
  const total = new RegExp(`(?:${w.totalKept})`, 'u')
  const discount = new RegExp(`(?:${w.discountKept})`, 'u')
  const paid = new RegExp(`(?:${w.paid.join('|')})`, 'u')
  const places = new Map<string, Set<number>>([
    ['total', new Set()],
    ['paid', new Set()],
    ['section', new Set()],
  ])
  for (const { label, amount } of answer.totals) {
    const hundredths = figureOf(amount, 2)
    if (hundredths === null || hundredths <= 0) continue
    if (total.test(label) && !discount.test(label)) places.get('total')?.add(hundredths)
    else if (paid.test(label)) places.get('paid')?.add(hundredths)
    else if (lines.length === 0 && DEPARTMENT.test(label)) places.get('section')?.add(hundredths)
  }
  const totals = [...(places.get('total') ?? [])]
  // the largest the total's word stands by: a prepayment slip's total is smaller and the one before the
  // card's discount larger, so «Прочитали не всё» errs only towards being said (MOL-244)
  const read = totals.length === 0 ? null : Math.max(...totals)
  const sum = lines.reduce((all, line) => all + (line.sumHundredths ?? 0), 0)
  const met = lines.length > 0 && lines.every((line) => line.asPrinted) && totals.includes(sum)
  if (met) return { total: sum, read, met }
  const votes = new Map<number, number>()
  for (const amounts of places.values()) {
    for (const amount of amounts) votes.set(amount, (votes.get(amount) ?? 0) + 1)
  }
  const backed = [...votes].filter(([, n]) => n >= 2)
  const most = Math.max(0, ...backed.map(([, n]) => n))
  const voted = backed.filter(([, n]) => n === most)
  return { total: voted.length === 1 ? (voted[0]?.[0] ?? null) : null, read, met }
}

/**
 * The model's answer as the parse's reading of the receipt (MOL-272, Т-2). The layout is the card's where
 * any line prints a discount, a zero one too — «Ереван Сити»'s till rounds what was paid off its shelf
 * price, «250 249,99» — the class code's where lines print none, and a section's where there is no line.
 * Then `verifiedReading(text, { byModel: true })`, as for Tesseract's reading.
 */
export function receiptTextOfModel(reading: PhotoReading, answer: ModelReceipt): ReceiptText {
  const layout =
    answer.lines.length === 0
      ? 'department'
      : answer.lines.some((line) => figureOf(line.discount, 2) !== null)
        ? 'card'
        : 'class'
  const rounding = layout === 'card' ? TOLERANCE_HUNDREDTHS : 0
  const lines = answer.lines.map((line) => lineOf(line, rounding))
  const { total, read, met } = totalOf(reading, answer, lines)
  return {
    layout,
    tin: /^\d{8}$/.test(answer.tin?.trim() ?? '') ? (answer.tin?.trim() ?? null) : null,
    date: dayOf(answer.date),
    time: clockOf(answer.time),
    receiptNo:
      answer.receipt_no === null || answer.receipt_no.trim() === ''
        ? null
        : answer.receipt_no.trim(),
    totalHundredths: total,
    readTotalHundredths: read,
    balanced: met,
    lines,
  }
}

/** The head the model read as rows of a reading: where `receiptCityOf` looks for the city. */
export function modelHeadRows(answer: ModelReceipt): TextRow[] {
  return [answer.shop, answer.address]
    .filter((row): row is string => row !== null && row.trim() !== '')
    .map((row, line) => ({ text: row, part: 0, line }))
}
