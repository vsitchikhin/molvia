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
 * nothing the total gave) with a quantity and a sum above zero. **A line of one piece whose price is its
 * sum is not, on its own**: the till prints one number twice, and a digit misread alike in both columns
 * — «660 660» for 560 — holds that arithmetic (owner's В-2 «а»; 18 of the bench's 207 fields read so were
 * wrong); it is verified only on a receipt proven whole — every line as printed and their sums the total
 * shown. **The price is kept only where quantity × price is the sum and the discount to the hundredth**
 * (Т-4) — on a till that prints a shelf price apart from what was paid (the card's layout), to the few
 * luma it rounds by, «419,98/0 490/420»; elsewhere one of two figures meant to be one was misread:
 * 624,44 for a sum of 624,41.
 *
 * The bench, 54 receipts and 1 038 fields: 478 right and 166 made up before, 110 right and none after
 * (`.scratch/tasks/research/MOL-255.md`). A receipt by the tax office's link is not read and not judged.
 */
export function verifiedReading(text: ReceiptText): ReceiptText {
  const proven = provenWhole(text)
  const lines = text.lines.map((line) => verifiedLine(line, proven, text.layout))
  return { ...text, lines, balanced: proven }
}

function provenWhole(text: ReceiptText): boolean {
  const total = text.totalHundredths
  if (total === null || text.lines.length === 0) return false
  let sum = 0
  for (const line of text.lines) {
    if (!line.asPrinted || line.sumHundredths === null) return false
    sum += line.sumHundredths
  }
  return sum === total
}

function verifiedLine(
  line: ReceiptTextLine,
  proven: boolean,
  layout: ReceiptLayout,
): ReceiptTextLine {
  const { quantityMilli: qty, priceHundredths: price, sumHundredths: sum } = line
  const discount = line.discountHundredths ?? 0
  if (!line.asPrinted || qty === null || qty <= 0 || sum === null || sum <= 0) return blank(line)
  const onePieceAlike = line.unit === 'piece' && qty === 1_000 && price === sum && discount === 0
  if (onePieceAlike && !proven) return blank(line)
  const rounding = layout === 'card' ? TOLERANCE_HUNDREDTHS : 0
  const holds =
    price !== null && Math.abs(Math.round((qty * price) / 1_000) - (sum + discount)) <= rounding
  return holds ? line : { ...line, priceHundredths: null, discountHundredths: null }
}

function blank(line: ReceiptTextLine): ReceiptTextLine {
  return {
    ...line,
    quantityMilli: null,
    priceHundredths: null,
    sumHundredths: null,
    discountHundredths: null,
    settled: false,
    asPrinted: false,
  }
}
