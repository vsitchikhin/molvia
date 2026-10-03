import { ocrSwapApart } from '#model/entities/receipt-text'
import { divideRounded } from '#model/support/decimal'
import { MINOR_EXPONENT, minorPerMajor } from '#model/values/money'
import type { Currency, Money } from '#model/values/money'
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
  /** «Строки»: every line, the ones left out too — they were paid for (MOL-124 Р-5). */
  readonly lines: Money | null
  /** Total less the lines; `null` when the total was not read or a line has no amount. */
  readonly difference: Money | null
  /** The line the difference most likely sits in, by position; `null` — «не знаем». */
  readonly suspect: number | null
  /** «Записать N»: the lines not left out. */
  readonly recorded: number
}

/**
 * «Строки», the difference with the printed total and the line it most likely sits in: the one whose
 * printed sum differs from what it is recorded at by exactly that difference («Разница 90 ֏ — похоже,
 * в строке «Шоколад»»). Only one such line names it; two or none — «не знаем».
 */
export function receiptBalance(
  entries: readonly ReceiptEntry[],
  total: Money | null,
  currency: Currency,
): ReceiptBalance {
  const recorded = entries.filter((entry) => !entry.skip).length
  let sum: bigint | null = 0n
  for (const entry of entries) {
    if (sum === null || entry.amount?.currency !== currency) sum = null
    else sum += entry.amount.minor
  }
  const lines = sum === null ? null : { minor: sum, currency }
  if (lines === null || total?.currency !== currency) {
    return { lines, difference: null, suspect: null, recorded }
  }
  const gap = total.minor - lines.minor
  const difference = { minor: gap, currency }
  if (gap === 0n) return { lines, difference, suspect: null, recorded }
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
  }
}

/**
 * The price read differs from the one the shop's memory holds for this article by one digit OCR confuses
 * (5↔6, 1↔4, 3↔8, 0↔9) — «60 60» read for «50 50» adds up either way, and only the memory can tell
 * (owner, В-1, 03.10.2026). A hint for the person, never a correction: the figures stay as read.
 */
export function priceInDoubt(read: Money | null, remembered: Money | null): boolean {
  if (read === null || read.currency !== remembered?.currency) return false
  return ocrSwapApart(String(read.minor), String(remembered.minor))
}
