import type { LineFigures, ReceiptText, ReceiptTextLine } from '#model/entities/receipt-text'

/**
 * The shelf price the shop's memory holds for each article of the receipt's seller (MOL-291), in hundredths of
 * the receipt's currency: the person's own, else the lower median of three prices or more (owner's В-1 «в»).
 */
export type RememberedPrices = ReadonlyMap<string, number>

/** The most swaps in the price the memory is set against: «550» read «660» is two (as MOL-290's В-2). */
export const REMEMBERED_PRICE_SWAPS = 2

/**
 * Past this many readings of one line the memory says nothing of it, and past `REMEMBERED_RECEIPT_COMBINATIONS_MAX`
 * over a receipt nothing more: it runs in the API's process. A line of the bench tries a few dozen, a receipt some
 * hundreds; the worst a line may — sixteen fives in its quantity and its sum, 18 769 — is past the line's.
 */
export const REMEMBERED_COMBINATIONS_MAX = 10_000
export const REMEMBERED_RECEIPT_COMBINATIONS_MAX = 50_000

/** The work of the vote in this process — read by tests alone: a ceiling is held by the work it saves. */
export const rememberedTries = { count: 0 }

/** The digits a reader confuses: in the price the memory is set against, and in the line's other figures. */
export interface RememberedSwaps {
  readonly price: Readonly<Record<string, string>>
  /** Tesseract's other figures stand as printed (`{}`): two lines it bent besides the price were wrong. */
  readonly others: Readonly<Record<string, string>>
}

/**
 * The card's rate the lines as read share: the discount over the shelf price, to a tenth of a per cent, most of
 * them at it — «Ереван Сити»'s 1 %, 0,5 %. None where no line prints a discount.
 */
export function cardRate(lines: readonly ReceiptTextLine[]): number | null {
  const counts = new Map<number, number>()
  for (const line of lines) {
    const { quantityMilli: qty, priceHundredths: price, discountHundredths: discount } = line
    if (!line.settled || qty === null || price === null || discount === null || discount <= 0)
      continue
    const shelf = Math.round((qty * price) / 1_000)
    if (shelf <= 0) continue
    const rate = Math.round((discount * 1_000) / shelf) / 1_000
    counts.set(rate, (counts.get(rate) ?? 0) + 1)
  }
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
}

/** A figure and every way the swaps read it, at most `depth` of them; a number's digits are its hundredths'. */
function variantsOf(
  swaps: Readonly<Record<string, string>>,
  value: number,
  depth: number,
): Map<number, number> {
  const out = new Map<number, number>()
  const walk = (text: string, from: number, taken: number): void => {
    const n = Number(text)
    if (!out.has(n) || (out.get(n) ?? Infinity) > taken) out.set(n, taken)
    if (taken === depth) return
    for (let i = from; i < text.length; i += 1) {
      const swapped = swaps[text.charAt(i)]
      if (swapped !== undefined)
        walk(text.slice(0, i) + swapped + text.slice(i + 1), i + 1, taken + 1)
    }
  }
  walk(String(value), 0, 0)
  return out
}

/** Whether the price read is the remembered one or within the swaps of it. */
const nearPrice = (swaps: RememberedSwaps, read: number, remembered: number): boolean =>
  variantsOf(swaps.price, read, REMEMBERED_PRICE_SWAPS).has(remembered)

/**
 * The one reading of a line at the remembered price: its quantity, discount and sum as read or by the swaps of
 * `others` (two a figure, as MOL-290), holding the line's arithmetic **to the hundredth**, the discount exactly the
 * card's rate of the shelf price. Not to the till's three luma, as a line's own reading is: Tesseract read
 * «60 / 0,26 / 49,76» for 50 / 0,25 / 49,75 — every 5 a 6 — and at the remembered 50 its sum held within them
 * (am-39); on the model's bench the exact rule loses nothing. `null` — none, two, or past the ceiling.
 */
function readingAt(
  swaps: RememberedSwaps,
  read: LineFigures,
  price: number,
  rate: number | null,
  budget: { left: number },
): LineFigures | null {
  const { quantityMilli: qty, discountHundredths: discount, sumHundredths: sum } = read
  if (qty === null || qty <= 0 || sum === null) return null
  // a discount the receipt shares no rate for: nothing would hold it (MOL-290, review round 1, №3)
  if (discount !== null && discount > 0 && rate === null) return null
  const qtys = variantsOf(swaps.others, qty, 2)
  const discounts = discount === null ? new Map([[0, 0]]) : variantsOf(swaps.others, discount, 2)
  const sums = variantsOf(swaps.others, sum, 2)
  const combinations = qtys.size * sums.size
  if (combinations > REMEMBERED_COMBINATIONS_MAX || combinations > budget.left) {
    budget.left = 0
    return null
  }
  budget.left -= combinations
  rememberedTries.count += combinations
  const found: LineFigures[] = []
  for (const q of qtys.keys()) {
    if (q <= 0) continue
    const shelf = Math.round((q * price) / 1_000)
    for (const s of sums.keys()) {
      const d = shelf - s
      if (s < 0 || !discounts.has(d)) continue
      if (d > 0 && rate !== null && d !== Math.round(shelf * rate)) continue
      found.push({
        quantityMilli: q,
        priceHundredths: price,
        discountHundredths: discount === null ? null : d,
        sumHundredths: s,
      })
    }
  }
  return found.length === 1 ? (found[0] ?? null) : null
}

/** A line as the memory reads it: its figures, holding, and never as printed. */
const withFigures = (line: ReceiptTextLine, figures: LineFigures): ReceiptTextLine => ({
  ...line,
  ...figures,
  settled: true,
  asPrinted: false,
  repaired: true,
  remembered: 'repaired',
})

/**
 * The lines with the shop's memory's word on them (MOL-291): a third voice beside the line's arithmetic and the
 * total, weaker than both — a shelf price changes. It vouches for the price alone, and only one the reader may
 * have confused the remembered one with; a price further off is a price that changed, and it says nothing.
 *
 * - **Confirmed**: a line as printed whose price is the remembered one — a line of one piece whose price is its
 *   sum is one number printed twice, emptied on its own by MOL-255; the memory is its second source.
 * - **Repaired**: a line that does not hold as read, whose price the swaps make the remembered one — read otherwise, and whose
 *   other figures then hold it one way — as read, or by `others` — the discount at the card's rate. «60 60» read
 *   for «50 50», «650 / 5,6 / 644,6» for 550 / 5,5 / 544,5. Shown with «проверьте».
 * - **Doubted** (owner's В-2 «б»): a line that holds as printed one confused digit off the memory — misread alike
 *   in its price and sum (am-34's 540 / 5,4 / 534,6 for 640), or the price went up by just that digit. The text
 *   cannot tell them, and a wrong figure is worse than none: emptied by the check. Unless `owed` — the total two
 *   places vouch for, less what went to the card — is met by the lines only with the memory's reading of it:
 *   then that reading is taken, repaired.
 */
export function rememberedLines(
  lines: readonly ReceiptTextLine[],
  prices: RememberedPrices,
  swaps: RememberedSwaps,
  owed: number | null,
): ReceiptTextLine[] {
  if (prices.size === 0) return [...lines]
  const rate = cardRate(lines)
  const budget = { left: REMEMBERED_RECEIPT_COMBINATIONS_MAX }
  const doubts = new Map<number, LineFigures | null>()
  const out = lines.map((line, i): ReceiptTextLine => {
    const remembered = line.sku === null ? undefined : prices.get(line.sku)
    const read = line.read
    if (remembered === undefined || read?.priceHundredths === undefined) return line
    if (read.priceHundredths === null) return line
    const price = read.priceHundredths
    if (line.asPrinted) {
      if (price === remembered) return { ...line, remembered: 'confirmed' }
      if (!nearPrice(swaps, price, remembered)) return line
      doubts.set(i, readingAt(swaps, read, remembered, rate, budget))
      return { ...line, remembered: 'doubted' }
    }
    // the memory's word is the price: a line whose price reads as remembered and whose other figures do not hold
    // is the arithmetic's to put right, by the total (MOL-290) — with no total, a sum bent within the till's
    // rounding passed (am-39's 49,76 for 49,75), and a price misread into a changed one was «confirmed» by it
    if (price === remembered || !nearPrice(swaps, price, remembered)) return line
    const figures = readingAt(swaps, read, remembered, rate, budget)
    return figures === null ? line : withFigures(line, figures)
  })
  if (doubts.size === 0 || owed === null) return out
  // the total vouches for the memory's reading of every doubted line, or for none of them
  const taken = out.map((line, i) => {
    const figures = doubts.get(i)
    return figures === undefined || figures === null ? line : withFigures(line, figures)
  })
  const whole =
    [...doubts.values()].every((figures) => figures !== null) &&
    taken.every((line) => line.settled && line.sumHundredths !== null) &&
    taken.reduce((all, line) => all + (line.sumHundredths ?? 0), 0) === owed
  return whole ? taken : out
}

/**
 * Tesseract's reading with the shop's memory's word on it (MOL-291): after the parse chose its reading, a line at
 * a time, by the figures as printed — the price by the card's swaps, every other figure as printed. A receipt
 * proven whole as read is not touched: the memory is weaker than the total.
 */
export function rememberedReading(
  text: ReceiptText,
  prices: RememberedPrices,
  swaps: Readonly<Record<string, string>>,
): ReceiptText {
  if (prices.size === 0 || text.lines.length === 0) return text
  const owed =
    text.totalHundredths === null ? null : text.totalHundredths - (text.cashbackHundredths ?? 0)
  const asRead = text.lines.every((line) => line.asPrinted && line.sumHundredths !== null)
  const sum = text.lines.reduce((all, line) => all + (line.sumHundredths ?? 0), 0)
  if (asRead && owed !== null && sum === owed) return text
  return { ...text, lines: rememberedLines(text.lines, prices, { price: swaps, others: {} }, owed) }
}
