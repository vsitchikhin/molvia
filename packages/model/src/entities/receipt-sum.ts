import { receiptCard } from '#model/entities/receipt-card'
import { REMEMBERED_PRICE_SWAPS } from '#model/entities/receipt-remembered'
import { swapApart } from '#model/entities/receipt-text'
import { divideRounded } from '#model/support/decimal'
import { MINOR_EXPONENT, minorPerMajor } from '#model/values/money'
import type { Currency, Money } from '#model/values/money'
import type { ReceiptCountry } from '#model/entities/receipt'
import type { Quantity } from '#model/values/units'

// MOL-126 — the arithmetic of a receipt being looked at before it is recorded. The phone calls these
// very functions while the person corrects lines (MOL-124 В-6), the server calls them again when the
// receipt is recorded and trusts nothing the phone worked out: one implementation, both ends.

/** A line's figures as printed: the shelf price per unit, what was paid for the line, its discount. */
export interface ReceiptFigures {
  readonly quantity: Quantity | null
  readonly price: Money | null
  readonly sum: Money | null
  readonly discount: Money | null
}

/**
 * The digits a receipt prints its amounts with: none when every amount on it is whole — a till that
 * prints «957» for 0,742 kg × 1 290 = 957,18 — else the currency's own (П-2). A receipt with
 * hundredths anywhere prints them on every line, the weighed ones included.
 */
export function receiptDigits(currency: Currency, amounts: readonly (Money | null)[]): number {
  const whole = minorPerMajor(currency)
  return amounts.every((amount) => amount === null || amount.minor % whole === 0n)
    ? 0
    : MINOR_EXPONENT[currency]
}

/** Quantity × price, rounded half up to the digits the receipt prints (П-2). */
export function lineProduct(quantity: Quantity, price: Money, digits: number): Money {
  // one rounding, never two: 0,4995 rounded to hundredths and then to units would be 1
  const step = 10n ** BigInt(Math.max(0, MINOR_EXPONENT[price.currency] - digits))
  return {
    minor: divideRounded(quantity.milli * price.minor, 1000n * step) * step,
    currency: price.currency,
  }
}

/**
 * The line's own arithmetic holds: quantity × price = paid + discount, the product rounded to the
 * receipt's digits. A line missing a figure, or with one in another currency, does not add up.
 */
export function lineAddsUp(line: ReceiptFigures, digits: number): boolean {
  const { quantity, price, sum } = line
  if (quantity === null || price === null || sum === null) return false
  const discount = line.discount?.minor ?? 0n
  if (sum.currency !== price.currency) return false
  if (line.discount !== null && line.discount.currency !== price.currency) return false
  return lineProduct(quantity, price, digits).minor === sum.minor + discount
}

/** What the line comes to by its quantity and price: quantity × price less its discount. */
function computedSum(line: ReceiptFigures, digits: number): Money | null {
  if (line.quantity === null || line.price === null) return null
  const product = lineProduct(line.quantity, line.price, digits)
  const minor = product.minor - (line.discount?.minor ?? 0n)
  return minor < 0n ? null : { minor, currency: product.currency }
}

/**
 * What the lines of a receipt come to by its total (MOL-289): the total less what a card sent to the card
 * as a bonus — «Ереван Сити» prints the total without the card's discount, what left the card, and the
 * lines with it («Զեղչ գործարքից»). Every comparison of the lines with the total goes through it — the
 * sums recorded, the difference on the review, «Прочитали не всё» — and the trip's money never does.
 */
export function linesTotalOf(total: Money | null, cashback: Money | null): Money | null {
  return less(total, cashback)
}

/**
 * What left the card for a receipt (MOL-289, owner's В-5 «а»): its total less the card's bonus it was
 * partly paid with («Կանխավճարի մարում») — what that bonus covered was recorded when it was sent to the
 * card. The trip's money, and what the review says it is in the person's currency.
 */
export function receiptPaidOf(total: Money | null, redeemed: Money | null): Money | null {
  return less(total, redeemed)
}

// A total less a part of it in its currency; a part that is the whole of it or more is no reading.
function less(total: Money | null, part: Money | null): Money | null {
  if (total === null || part?.currency !== total.currency) return total
  const minor = total.minor - part.minor
  return minor > 0n ? { minor, currency: total.currency } : total
}

/**
 * What each line is recorded at, the person's corrections aside (MOL-124 В-5, owner, 27.09.2026): a line
 * that adds up — what was paid; one that does not — the printed sum when the printed total confirms it
 * (the lines with it come to the total), else quantity × price. «1 шт × 890», 980 printed, a total that
 * meets 980: 980 is recorded, 980 ֏/шт. A line with neither is `null` — the person types it.
 */
export function recordedSums(
  lines: readonly ReceiptFigures[],
  total: Money | null,
  digits: number,
): (Money | null)[] {
  const printed = lines.reduce<bigint | null>(
    (acc, line) =>
      acc === null || line.sum === null || (total !== null && line.sum.currency !== total.currency)
        ? null
        : acc + line.sum.minor,
    0n,
  )
  const confirmed = total !== null && printed !== null && printed === total.minor
  return lines.map((line) => {
    if (lineAddsUp(line, digits)) return line.sum
    if (confirmed) return line.sum
    return computedSum(line, digits) ?? line.sum
  })
}

/** A line as it stands on the review screen: what it will be recorded at, and whether it is left out. */
export interface ReceiptEntry {
  readonly printed: Money | null
  readonly amount: Money | null
  readonly skip: boolean
}

export interface ReceiptBalance {
  /**
   * «Строки»: every line with an amount, the ones left out too — they were paid for (MOL-124 Р-5);
   * `null` when one is in another currency.
   */
  readonly lines: Money | null
  /** Total less the lines; `null` when the total was not read or the lines are not summed. */
  readonly difference: Money | null
  /** The line the difference most likely sits in, by position; `null` — «не знаем». */
  readonly suspect: number | null
  /** «Записать N»: the lines not left out. */
  readonly recorded: number
  /**
   * The lines with no amount: no figures verified and none typed yet (MOL-255). What the lines leave of
   * the total is theirs, said so on the review (В-5 «а»), and no line is suspected of it.
   */
  readonly blank: number
}

/**
 * «Строки», the difference with the printed total and the line it most likely sits in: the one whose
 * printed sum differs from what it is recorded at by exactly that difference («Разница 90 ֏ — похоже,
 * в строке «Шоколад»»). Only one such line names it; two or none — «не знаем». A line with no amount
 * is left out of «Строки» and counted apart (MOL-255, В-5 «а»): the total less the rest is what it lacks.
 */
export function receiptBalance(
  entries: readonly ReceiptEntry[],
  total: Money | null,
  currency: Currency,
): ReceiptBalance {
  const recorded = entries.filter((entry) => !entry.skip).length
  const blank = entries.filter((entry) => entry.amount === null).length
  let sum: bigint | null = 0n
  for (const entry of entries) {
    if (entry.amount === null) continue
    if (sum === null || entry.amount.currency !== currency) sum = null
    else sum += entry.amount.minor
  }
  const lines = sum === null ? null : { minor: sum, currency }
  if (lines === null || total?.currency !== currency) {
    return { lines, difference: null, suspect: null, recorded, blank }
  }
  const gap = total.minor - lines.minor
  const difference = { minor: gap, currency }
  if (gap === 0n || blank > 0) return { lines, difference, suspect: null, recorded, blank }
  const suspects = entries.flatMap((entry, position) =>
    entry.printed !== null &&
    entry.amount !== null &&
    entry.printed.currency === currency &&
    entry.printed.minor - entry.amount.minor === gap
      ? [position]
      : [],
  )
  return {
    lines,
    difference,
    suspect: suspects.length === 1 ? (suspects[0] ?? null) : null,
    recorded,
    blank,
  }
}

/** A line as read: whether its own arithmetic held, and what was paid for it. */
export interface ReadFigures {
  readonly settled: boolean
  readonly sum: Money | null
}

/**
 * What the lines read make up of the printed total (MOL-222): each line's sum in the total's currency
 * and not past the total itself — a sum past it or in another currency covers nothing (review Р11):
 * junk OCR would otherwise vouch for a receipt barely read. `null` without a total. The one count the
 * hint «строки дают X из Y» and `readPartly` both read.
 */
export function readCovered(lines: readonly ReadFigures[], total: Money | null): Money | null {
  if (total === null || total.minor <= 0n) return null
  let read = 0n
  for (const { sum } of lines) {
    if (sum !== null && sum.currency === total.currency && sum.minor <= total.minor)
      read += sum.minor
  }
  return { minor: read, currency: total.currency }
}

/**
 * Read only in part (MOL-222, В-1 — the «переснимите» of before, now a hint on the review that never
 * keeps the receipt from being recorded): no lines; or the total was read and the lines make up less
 * than it (`readCovered`) — any shortfall, said with its sum (MOL-255, В-7 «а»: 74 % of a total read in
 * three parts went unsaid under the 70 % of before, five lines lost at the seams); or the total was not
 * read and fewer than half of the lines add up by their own arithmetic. A total that was not read
 * decides nothing alone — OCR missed it on 9 of the bench's 16 readings, most of them good ones. Of what
 * was read, never of the person's edits: the server counts it at the reading, before the check empties
 * a line (MOL-255, А5 «а»), the phone shows it on the review.
 */
export function readPartly(lines: readonly ReadFigures[], total: Money | null): boolean {
  if (lines.length === 0) return true
  const covered = readCovered(lines, total)
  if (covered !== null && total !== null) {
    return covered.minor < total.minor
  }
  const settled = lines.filter((line) => line.settled).length
  return settled * 2 < lines.length
}

/**
 * The price read differs from the one the shop's memory holds for this article by one digit its reader confuses
 * in the country's tills (5↔6, 1↔4, 3↔8, 0↔9 Tesseract's in Armenia) — «60 60» read for «50 50» adds up either
 * way, and only the memory can tell (owner, В-1, 03.10.2026). A hint for the person, never a correction: the
 * figures stay as read. A receipt the tax office gave (MOL-232) was read by nobody: no digit of it is in doubt,
 * and a price off the memory's is a price changed (owner, В-1 «а» of MOL-270). One the model read is doubted by
 * the model's pairs alone, 5↔6 (MOL-315): its 1 100 → 1 400 is a price changed — and by two of them in the figure, as
 * MOL-290 measured it and MOL-291's doubt at reading takes it: «660» copied for 550 (adversarial А2, owner's «в»).
 * Tesseract's own receipt (`byModel: false`) by its one digit, as before. With no reader named, either — the phone
 * knows no reader, and so holds every hint the server sent; the server alone narrows.
 */
export function priceInDoubt(
  country: ReceiptCountry,
  read: Money | null,
  remembered: Money | null,
  { byModel }: { byModel?: boolean } = {},
): boolean {
  const reading = receiptCard(country).photo
  if (reading === null || read === null || read.currency !== remembered?.currency) return false
  const [a, b] = [String(read.minor), String(remembered.minor)]
  const model = swapApart(reading.modelSwaps, a, b, REMEMBERED_PRICE_SWAPS)
  const ocr = swapApart(reading.swaps, a, b)
  if (byModel === undefined) return model || ocr
  return byModel ? model : ocr
}
