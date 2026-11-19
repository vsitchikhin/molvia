import { THOUSANDTHS } from '#model/entities/receipt-card'
import {
  TOLERANCE_HUNDREDTHS,
  linesTotalHundredths,
  printedMeets,
  printedSum,
  printedThousandths,
} from '#model/entities/receipt-text'
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
  /** A bill's quantity and sum with no price printed, on a receipt not proven whole (MOL-310). */
  'no_price_unproven',
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
  /**
   * For each line, in their order: why the check emptied it or took its price; `null` — shown as read. The check's
   * word, whatever a witness gave back after it (MOL-405): a line it shows again stands under «проверьте» with its
   * reason kept.
   */
  readonly lines: readonly (ReceiptLineReason | null)[]
  /** Why the receipt is not proven whole; `null` — it is. */
  readonly receipt: ReceiptReason | null
}

/**
 * A line put right by the total alone (MOL-290): the one choice that meets a total two places print — never the shop's
 * memory's, whose price was chosen by nothing but itself (MOL-291).
 */
const chosenByTotal = (line: ReceiptTextLine): boolean =>
  line.repaired === true && line.remembered === undefined

/**
 * Every line copied with a sum of its own, above nought, and none put right by the memory (MOL-310, round 2): a sum
 * the memory chose was chosen to meet the total, so it vouches for nothing. One the total chose is the total's own
 * second source, the one choice that met it (MOL-420): a sum alone misread by 5↔6 is no line lost.
 */
function sumsCopied(lines: readonly ReceiptTextLine[]): boolean {
  return (
    lines.length > 0 &&
    lines.every(
      (line) =>
        line.sumHundredths !== null &&
        line.sumHundredths > 0 &&
        (line.repaired !== true || chosenByTotal(line)),
    )
  )
}

/**
 * `verifiedReading`, with the reasons of what it did not show (MOL-309) — and, given another reading of the same
 * paper by a second model (MOL-405), with what that reading vouches for (`witnessed`): shown under «проверьте», the
 * check's reason of the line kept.
 */
export function explainedReading(
  text: ReceiptText,
  { byModel = false, witness }: { byModel?: boolean; witness?: ReceiptText } = {},
): ExplainedReading {
  const receipt = notWhole(text)
  const proven = receipt === null
  // a model's sums as copied that meet the total shown — on a receipt not proven whole, one two places print — vouch
  // for every sum (MOL-310, round 2; owner, 13.11.2026: «улучшать чтение, а не стирать прочитанное»): a line whose
  // quantity or price does not hold keeps its sum alone
  const summed = byModel && !proven && sumsMeet(text)
  const checked = text.lines.map((line) => ({
    read: line,
    ...verifiedLine(line, proven, text.layout, byModel, summed),
  }))
  const shown = checked.map((one) => one.line)
  return {
    shown: {
      ...text,
      lines:
        witness === undefined
          ? shown
          : witnessed(
              checked,
              witness.lines,
              (line) => verifiedLine(line, true, text.layout, byModel).line,
            ),
      balanced: proven,
    },
    lines: checked.map((one) => one.reason),
    receipt,
  }
}

/**
 * Which of two readings of one receipt goes to the review (MOL-405): the bench's rule R3 (owner's В-1 «а») — the one
 * proven whole; else the one with a total shown; else the one with more lines shown as read; a tie, the first — with
 * two steps before the total, adversarial А1's, Б1's and Г1's: **the one that found lines, where the other found
 * none** — a section of one sum would take the lines the other found, shown or to type (MOL-227: a section only where no
 * reading found a line); **then the one that shows a line as read, where the other shows none** — lines found with no
 * figure read would take the lines the other read and showed.
 * The code knows no truth, only what each reading proves: a second reading with more lines and no total took four wrong
 * figures and lost a total on the bench (am-34, am-07b), where the total comes before the count — and a reading with
 * the total and fewer lines shown takes the lines it lost with it, the price named (`receipts.md`).
 */
export function betterReading(
  first: ExplainedReading,
  second: ExplainedReading,
): 'first' | 'second' {
  const by = (proves: (one: ExplainedReading) => boolean): 'first' | 'second' | null =>
    proves(first) === proves(second) ? null : proves(second) ? 'second' : 'first'
  return (
    by((one) => one.receipt === null) ??
    by((one) => one.shown.lines.length > 0) ??
    by((one) => shownAsRead(one) > 0) ??
    by((one) => one.shown.totalHundredths !== null) ??
    (shownAsRead(second) > shownAsRead(first) ? 'second' : 'first')
  )
}

function shownAsRead(one: ExplainedReading): number {
  return one.shown.lines.filter((line) => line.sumHundredths !== null).length
}

const WITNESSED = [
  'quantityMilli',
  'priceHundredths',
  'sumHundredths',
  'discountHundredths',
] as const
type Witnessed = (typeof WITNESSED)[number]

/**
 * The check's reasons a witness answers: a line whose figures hold, emptied only for want of a second source (MOL-255
 * В-2, MOL-310). Never one the check proved wrong — its arithmetic, a zero, a figure missing, a swap, the memory's doubt
 * (adversarial А2, А3в): two readings alike do not make «2 × 335 = 770» true.
 */
const WITNESS_ANSWERS: ReadonlySet<ReceiptLineReason> = new Set([
  'one_alike_unproven',
  'no_price_unproven',
])

/**
 * A figure the check emptied, shown again where the other reading has a line of the very same figures (MOL-405,
 * owner's В-4 «а»): two models read the paper apart, and a figure both copied alike is the paper's — but for the font's
 * 5, which both read as a 6 alike, so a figure with a 6 in it is never vouched for so. **Shown under «проверьте»**
 * (`repaired`, owner's В-5 «а»): the check's own arithmetic did not prove it. Only a line the check emptied whole and for
 * want of a second source (`WITNESS_ANSWERS`): a sum the total vouched for stays as read, and an earlier build, which
 * gets a line under «проверьте» empty, loses none of it (adversarial А4). The other reading's lines are each a witness
 * once, in order, and of the same article where both print one (adversarial А3).
 */
function witnessed(
  checked: readonly (CheckedLine & { readonly read: ReceiptTextLine })[],
  witness: readonly ReceiptTextLine[],
  /** The line as the check shows it on a receipt proven whole: a figure even proof would not show is never vouched. */
  asProven: (line: ReceiptTextLine) => ReceiptTextLine,
): ReceiptTextLine[] {
  const shown: ReceiptTextLine[] = []
  // in order: a witness line is never one before the last taken
  let next = 0
  for (const { read: line, line: kept, reason } of checked) {
    const answered =
      reason !== null && WITNESS_ANSWERS.has(reason) && WITNESSED.every((key) => kept[key] === null)
    const at = answered ? witness.findIndex((other, k) => k >= next && agrees(line, other)) : -1
    if (at < 0) {
      shown.push(kept)
      continue
    }
    next = at + 1
    const proven = asProven(line)
    // a gift's price and discount are one number twice, never shown even on a receipt proven whole (adversarial Б2)
    const back = (key: Witnessed): number | null => {
      const figure = line[key]
      return figure !== null && proven[key] === figure && !String(figure).includes('6')
        ? figure
        : null
    }
    const again: Record<Witnessed, number | null> = {
      quantityMilli: back('quantityMilli'),
      priceHundredths: back('priceHundredths'),
      sumHundredths: back('sumHundredths'),
      discountHundredths: back('discountHundredths'),
    }
    shown.push(
      WITNESSED.every((key) => again[key] === null) ? kept : { ...kept, ...again, repaired: true },
    )
  }
  return shown
}

/** The very same figures, none missing on one side alone — and the same article, where both print one. */
function agrees(line: ReceiptTextLine, other: ReceiptTextLine): boolean {
  return (
    WITNESSED.every((key) => line[key] === other[key]) &&
    (line.sku === null || other.sku === null || line.sku === other.sku)
  )
}

function notWhole(text: ReceiptText): ReceiptReason | null {
  if (text.lines.length === 0) return 'no_lines'
  if (text.totalHundredths === null) return 'no_total'
  // a line the memory doubts is no line proven (MOL-291)
  if (text.lines.some((line) => line.remembered === 'doubted')) return 'line_doubted'
  // a sum alone the total chose holds no arithmetic of its own: no line proven (MOL-420)
  const asRead = (line: ReceiptTextLine) =>
    (line.asPrinted || line.repaired === true) && line.settled && line.sumHundredths !== null
  if (!text.lines.every(asRead)) return 'line_not_as_printed'
  // a card that sends its discount to the card prints the total without it (MOL-289)
  const total = linesTotalHundredths(text, text.totalHundredths)
  const sum = text.lines.reduce((all, line) => all + (line.sumHundredths ?? 0), 0)
  if (sum !== total) return sum < total ? 'lines_lost' : 'lines_over'
  const milli = pharmacySum(text)
  if (milli === null || printedMeets(milli, text.totalHundredths, text.totalThousandths))
    return null
  return milli < (text.totalThousandths ?? text.totalHundredths * 10) ? 'lines_lost' : 'lines_over'
}

/**
 * A pharmacy's lines' sums as printed, in thousandths (MOL-421): what they meet its total by, never the tetri alone — a
 * total two places vouch for in tetri, «ლარი 26.698» and «ბარათი 26.70», proves no thousandth misread (adversarial
 * Б1). None where a line has none, or a card's cashback or a café's service stands between the lines and the total.
 */
function pharmacySum(text: ReceiptText): number | null {
  return (text.cashbackHundredths ?? null) === null && (text.serviceHundredths ?? null) === null
    ? printedSum(text.lines)
    : null
}

function sumsMeet(text: ReceiptText): boolean {
  if (text.totalHundredths === null || !sumsCopied(text.lines)) return false
  if (text.lines.some((line) => line.remembered === 'doubted')) return false
  const sum = text.lines.reduce((all, line) => all + (line.sumHundredths ?? 0), 0)
  if (sum !== linesTotalHundredths(text, text.totalHundredths)) return false
  const milli = pharmacySum(text)
  return milli === null || printedMeets(milli, text.totalHundredths, text.totalThousandths)
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
  /** The model's sums as copied meet the total shown: each sum is vouched for, its quantity and price are not. */
  summed = false,
): CheckedLine {
  const { quantityMilli: qty, priceHundredths: price, sumHundredths: sum } = line
  const discount = line.discountHundredths ?? 0
  // a sum the total chose keeps its «проверьте» shown alone (MOL-420): else it reads as copied
  const emptied = (reason: ReceiptLineReason): CheckedLine =>
    summed && sum !== null && sum > 0
      ? {
          line: {
            ...blank(line),
            sumHundredths: sum,
            ...(chosenByTotal(line) ? { repaired: true } : {}),
          },
          reason,
        }
      : { line: blank(line), reason }
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
  // a model's line of a bill that prints no price (MOL-310): its quantity and sum hold nothing up between them, so
  // only a total they meet vouches for them — for the sums alone. Kept on a receipt proven whole, its price the sum by
  // the quantity where that is a figure to the hundredth (owner's В-4 «а»), else none — under «проверьте», since no
  // second source holds the quantity (owner's В-6 «а», adversarial А2): a count copied wrong is a price made up. A sum
  // of nothing holds any total and goes the way of any other (review №4)
  if (byModel && price === null && discount === 0 && sum > 0) {
    if (!proven) return emptied('no_price_unproven')
    const priced = (sum * 1_000) % qty === 0 ? (sum * 1_000) / qty : null
    return {
      line: { ...line, priceHundredths: priced, asPrinted: false, repaired: true },
      reason: null,
    }
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
  // the till's tolerance by the layout — a card's till rounds what was paid off its shelf price — where the reading's
  // own `holds` reads it off the line's discount
  const tolerance = layout === 'card' ? TOLERANCE_HUNDREDTHS : 0
  // within the tolerance a price and a sum hold either way round: OCR takes the columns from the paper,
  // a model names them itself — «389,99 390» answered as price 389,99 and sum 390 (MOL-272)
  const apart = byModel ? tolerance : 0
  const oneAlike =
    qty === 1_000 && discount === 0 && price !== null && Math.abs(price - sum) <= apart
  // the memory's price is the second source of one number printed twice (MOL-291)
  if (oneAlike && !proven && !byMemory) return emptied('one_alike_unproven')
  // quantity × price = sum + discount, the money in one scale: tetri, or a pharmacy's thousandths (`scale` 10)
  const arithmetic = (p: number | null, s: number | null, d: number, scale: number): boolean =>
    p !== null &&
    s !== null &&
    Math.abs(Math.round((qty * p) / 1_000) - (s + d)) <= tolerance * scale
  const inTetri = arithmetic(price, sum, discount, 1)
  // a pharmacy's line is judged as printed, in thousandths, as the reading judged it (MOL-421, Р-2, adversarial А2):
  // 3 × 0.255 = 0.765 holds, 3 × 0,26 against 0,77 would not. Its price stays where it holds so in tetri too, or on a
  // receipt proven whole: the sum recorded is quantity × price unless the total confirms the lines (`recordedSums`),
  // and 3 × 0,26 is 0,78, not the 0,77 shown (adversarial Б3)
  const printed = printedThousandths(line)
  const holds =
    printed === null
      ? inTetri
      : arithmetic(printed.price, printed.sum, printed.discount ?? 0, 10 ** (THOUSANDTHS - 2)) &&
        (inTetri || proven)
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
