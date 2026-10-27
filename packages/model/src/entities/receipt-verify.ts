import { TOLERANCE_HUNDREDTHS } from '#model/entities/receipt-text'
import type { ReceiptLayout, ReceiptText, ReceiptTextLine } from '#model/entities/receipt-text'

/**
 * What of a reading goes to the review as read (MOL-255; owner, 08.10.2026: «неправильно прочитанный
 * чек хуже вообще не прочитанного»): every receipt is read, but a line keeps its figures only where they
 * are verified — the rest is an empty field the person fills, never a guess they must find and erase.
 * One rule for any reader: Tesseract's parse says which lines are as printed, and a model's answer is
 * printed by its nature (MOL-272).
 *
 * A line is verified when it is as printed (`asPrinted`: settled with no swap, nothing worked out,
 * nothing the total gave) with a quantity and a sum above zero — or a sum of nothing where the shelf
 * price is the discount to the hundredth, a gift by the card (review round 2, А7 «а») — of a quantity of
 * one, its price and discount are no figures a total vouches for, and go (round 4, А11 «а»). **A line of
 * a quantity of one whose price is its sum, or its discount where it is a gift, is not, on its own** — a
 * piece or a kilogram (review round 1, А2 «а»; round 3, А9 «а»): the till prints one number twice, and a
 * digit misread alike in both columns — «660 660» for 560 — holds that arithmetic (owner's В-2 «а»; 18 of
 * the bench's 207 fields read so were wrong); it is verified only on a receipt proven whole — every line
 * as printed and their sums the total shown. **The price is kept only where quantity × price is the sum
 * and the discount to the hundredth** (Т-4) — on a till that prints a shelf price apart from what was
 * paid (the card's layout), to the few luma it rounds by, «419,98/0 490/420»; elsewhere one of two
 * figures meant to be one was misread: 624,44 for a sum of 624,41. **A model's line of a quantity of one
 * whose price is within that rounding of its sum is one alike too** (MOL-272, `byModel`): the model
 * names the columns itself, and «389,99 390» holds either way round.
 *
 * The bench, 54 receipts and 1 038 fields: 478 right and 166 made up before, 105 right and none after
 * (`.scratch/tasks/research/MOL-255.md`). A receipt by the tax office's link is not read and not judged.
 */
export function verifiedReading(text: ReceiptText, { byModel = false } = {}): ReceiptText {
  return explainedReading(text, { byModel }).shown
}

/**
 * Why a line went to the review emptied, or without its price (MOL-309): the very branch of the check
 * that took the figures names it — never a second copy of the rule. By kind, with no figure in it.
 */
export const RECEIPT_LINE_REASONS = [
  /** The shop's memory doubts its price (MOL-291). */
  'doubted',
  /** No quantity or no sum read — or one below zero. */
  'missing_figure',
  /** Put right by the font's 5↔6 on a receipt not proven whole (MOL-290). */
  'repaired_unproven',
  /** Its own arithmetic does not hold. */
  'unsettled',
  /** It held only by swapped digits, a count worked out or the total's rest — not as printed. */
  'bent',
  /** A sum of nothing that is no gift of the card. */
  'zero_not_gift',
  /** «1 × цена = сумма», one number twice, on a receipt not proven whole (MOL-255, В-2 «а»). */
  'one_alike_unproven',
  /** The sum kept, the price taken off: quantity × price is not the sum and the discount. */
  'price_dropped',
] as const
export type ReceiptLineReason = (typeof RECEIPT_LINE_REASONS)[number]

/**
 * Why a receipt was not proven whole (MOL-309), one a receipt — the first that holds, in this order.
 * `failed` is the reading's own: not one line found, or nothing readable.
 */
export const RECEIPT_REASONS = [
  'failed',
  'no_lines',
  /** No total two sources vouch for (MOL-244). */
  'no_total',
  'line_doubted',
  'line_not_as_printed',
  /**
   * Every line as printed, and still they make less than the total: a line lost, at a seam or past a fold.
   * After the lines' own reasons, never before (adversarial А1, А2 of MOL-309): a sum not read, or one read
   * low by the font's 5↔6, makes the lines short as well — and that is the line's miss, not a line lost.
   */
  'lines_lost',
  'lines_over',
] as const
export type ReceiptReason = (typeof RECEIPT_REASONS)[number]

/** What goes to the review as read, and why the rest did not (MOL-309). */
export interface ExplainedReading {
  readonly shown: ReceiptText
  /** For each line, in their order: why it was emptied or lost its price; `null` — shown as read. */
  readonly lines: readonly (ReceiptLineReason | null)[]
  /** Why the receipt is not proven whole; `null` — it is. */
  readonly receipt: ReceiptReason | null
}

/** `verifiedReading`, with the reasons of what it did not show (MOL-309). */
export function explainedReading(text: ReceiptText, { byModel = false } = {}): ExplainedReading {
  const receipt = notWhole(text)
  const proven = receipt === null
  const checked = text.lines.map((line) => verifiedLine(line, proven, text.layout, byModel))
  return {
    shown: { ...text, lines: checked.map((one) => one.line), balanced: proven },
    lines: checked.map((one) => one.reason),
    receipt,
  }
}

function notWhole(text: ReceiptText): ReceiptReason | null {
  if (text.lines.length === 0) return 'no_lines'
  if (text.totalHundredths === null) return 'no_total'
  // a line the memory doubts is no line proven (MOL-291)
  if (text.lines.some((line) => line.remembered === 'doubted')) return 'line_doubted'
  const asRead = (line: ReceiptTextLine) =>
    (line.asPrinted || line.repaired === true) && line.sumHundredths !== null
  if (!text.lines.every(asRead)) return 'line_not_as_printed'
  // a card that sends its discount to the card prints the total without it (MOL-289)
  const total = text.totalHundredths - (text.cashbackHundredths ?? 0)
  const sum = text.lines.reduce((all, line) => all + (line.sumHundredths ?? 0), 0)
  if (sum === total) return null
  return sum < total ? 'lines_lost' : 'lines_over'
}

interface CheckedLine {
  readonly line: ReceiptTextLine
  readonly reason: ReceiptLineReason | null
}

function verifiedLine(
  line: ReceiptTextLine,
  proven: boolean,
  layout: ReceiptLayout,
  byModel: boolean,
): CheckedLine {
  const { quantityMilli: qty, priceHundredths: price, sumHundredths: sum } = line
  const discount = line.discountHundredths ?? 0
  const emptied = (reason: ReceiptLineReason): CheckedLine => ({ line: blank(line), reason })
  // a line put right by the font's swaps stands only on the receipt it proved whole (MOL-290); one the shop's
  // memory put right, on its own word; one it doubts, never (MOL-291, owner's В-2 «б»)
  if (line.remembered === 'doubted') return emptied('doubted')
  const byMemory = line.remembered === 'repaired' || line.remembered === 'confirmed'
  const read =
    line.asPrinted || (line.repaired === true && (proven || line.remembered === 'repaired'))
  if (qty === null || qty <= 0 || sum === null || sum < 0) return emptied('missing_figure')
  if (!read) {
    if (line.repaired === true) return emptied('repaired_unproven')
    return emptied(line.settled ? 'bent' : 'unsettled')
  }
  // a gift — its whole price the discount — is nothing paid only where that holds to the hundredth
  // (review round 2, А7 «а»): «0 0» or a stray «0,00» holds any arithmetic
  if (sum === 0) {
    const gift = price !== null && price > 0 && Math.round((qty * price) / 1_000) === discount
    if (!gift) return emptied('zero_not_gift')
    if (qty !== 1_000) return { line, reason: null }
    // of a quantity of one its price and discount are one number twice, as «660 660» is (round 3, А9
    // «а»), and the total vouches only for the nothing paid: misread alike, they leave every sum as it
    // was (round 4, А11 «а») — kept on a receipt proven whole, with no price and no discount
    return proven
      ? { line: { ...line, priceHundredths: null, discountHundredths: null }, reason: null }
      : emptied('one_alike_unproven')
  }
  const rounding = layout === 'card' ? TOLERANCE_HUNDREDTHS : 0
  // within the rounding a price and a sum hold either way round: OCR takes the columns from the paper,
  // a model names them itself — «389,99 390» answered as price 389,99 and sum 390 (MOL-272)
  const apart = byModel ? rounding : 0
  const oneAlike =
    qty === 1_000 && discount === 0 && price !== null && Math.abs(price - sum) <= apart
  // the memory's price is the second source of one number printed twice (MOL-291)
  if (oneAlike && !proven && !byMemory) return emptied('one_alike_unproven')
  const holds =
    price !== null && Math.abs(Math.round((qty * price) / 1_000) - (sum + discount)) <= rounding
  return holds
    ? { line, reason: null }
    : {
        line: { ...line, priceHundredths: null, discountHundredths: null },
        // a line printed with no price has none to lose
        reason: price === null ? null : 'price_dropped',
      }
}

function blank(line: ReceiptTextLine): ReceiptTextLine {
  return {
    ...line,
    // emptied, a line put right is no longer one — by the total or by the memory (MOL-291)
    ...(line.repaired === true ? { repaired: false } : {}),
    quantityMilli: null,
    priceHundredths: null,
    sumHundredths: null,
    discountHundredths: null,
    settled: false,
    asPrinted: false,
  }
}
