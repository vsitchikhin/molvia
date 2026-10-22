import type { PhotoReading } from '#model/entities/receipt-card'
import type { LineFigures, ReceiptText, ReceiptTextLine } from '#model/entities/receipt-text'

/**
 * The shelf price the shop's memory holds for an article of the receipt's seller (MOL-291), in hundredths of the
 * receipt's currency: the person's own (`own`), else the lower median of three prices or more (owner's В-1 «в»).
 */
export interface RememberedPrice {
  readonly hundredths: number
  readonly own: boolean
}

/** The shop's memory for a receipt, by article. */
export type RememberedPrices = ReadonlyMap<string, RememberedPrice>

/** The totals a reading has, less what went to the card: two places vouching for it, and read in one place. */
export interface RememberedTotals {
  readonly owed: number | null
  readonly read: number | null
}

/** The most swaps in the price the memory is set against: «550» read «660» is two (as MOL-290's В-2). */
export const REMEMBERED_PRICE_SWAPS = 2

/**
 * Past this many readings of one line the memory says nothing of it, and past `REMEMBERED_RECEIPT_COMBINATIONS_MAX`
 * over a receipt nothing more: it runs in the API's process. A line of the bench tries a few dozen, a receipt some
 * hundreds; the worst a line may — sixteen fives in its quantity and its sum, 18 769 — is past the line's.
 */
export const REMEMBERED_COMBINATIONS_MAX = 10_000
export const REMEMBERED_RECEIPT_COMBINATIONS_MAX = 50_000

/** Past this many steps the paper's own readings are taken to meet the total, and the memory's are not (В2). */
export const REMEMBERED_WAYS_MAX = 10_000

/** The work of the vote in this process — read by tests alone: a ceiling is held by the work it saves. */
export const rememberedTries = { count: 0 }

/** The digits a reader confuses: in the price the memory is set against, and in the line's other figures. */
export interface RememberedSwaps {
  readonly price: Readonly<Record<string, string>>
  /** Tesseract's other figures stand as printed (`{}`): two lines it bent besides the price were wrong. */
  readonly others: Readonly<Record<string, string>>
  /**
   * The pair a doubt is of, for either reader: the font's 5↔6, as the owner was asked (В-2 «б»). Tesseract's other
   * pairs are as many ordinary changes of a price — 990 → 999, 1 100 → 1 400 (adversarial А4, review №2).
   */
  readonly doubt: Readonly<Record<string, string>>
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
const nearPrice = (
  swaps: Readonly<Record<string, string>>,
  read: number,
  remembered: number,
): boolean => variantsOf(swaps, read, REMEMBERED_PRICE_SWAPS).has(remembered)

/**
 * The readings of a line at a price: its quantity, discount and sum as read or by the swaps of
 * `others` (two a figure, as MOL-290), holding the line's arithmetic **to the hundredth**, the discount exactly the
 * card's rate of the shelf price. Not to the till's three luma, as a line's own reading is: Tesseract read
 * «60 / 0,26 / 49,76» for 50 / 0,25 / 49,75 — every 5 a 6 — and at the remembered 50 its sum held within them
 * (am-39); on the model's bench the exact rule loses nothing. **The sum as read** unless `paid` — what was paid is
 * the total's to vouch for, never the memory's (adversarial А1). `null` past a ceiling: past the line's the memory
 * says nothing of that line alone, the receipt's budget untouched (А5).
 */
function readingsAt(
  swaps: RememberedSwaps,
  read: LineFigures,
  price: number,
  rate: number | null,
  budget: { left: number },
  paid: boolean,
): LineFigures[] | null {
  const { quantityMilli: qty, discountHundredths: discount, sumHundredths: sum } = read
  if (qty === null || qty <= 0 || sum === null) return []
  // a discount the receipt shares no rate for: nothing would hold it (MOL-290, review round 1, №3)
  if (discount !== null && discount > 0 && rate === null) return []
  const qtys = variantsOf(swaps.others, qty, 2)
  const discounts = discount === null ? new Map([[0, 0]]) : variantsOf(swaps.others, discount, 2)
  const sums = paid ? variantsOf(swaps.others, sum, 2) : new Map([[sum, 0]])
  const combinations = qtys.size * sums.size
  if (combinations > REMEMBERED_COMBINATIONS_MAX || combinations > budget.left) return null
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
  return found
}

/** The one reading of a line at a price, or none: two are a doubt, and past a ceiling nothing is said. */
const oneOf = (found: LineFigures[] | null): LineFigures | null =>
  found?.length === 1 ? (found[0] ?? null) : null

/**
 * The sums a line may come to by the reader's own swaps at any price but the remembered one — what it may be without the
 * memory (review 3, №8, №9; adversarial В1). `null` past a ceiling: nobody knows, and the memory says nothing.
 */
function withoutMemory(
  swaps: RememberedSwaps,
  read: LineFigures,
  at: number,
  rate: number | null,
  budget: { left: number },
): Set<number> | null {
  const sums = new Set<number>()
  if (read.priceHundredths === null) return sums
  for (const price of variantsOf(
    swaps.price,
    read.priceHundredths,
    REMEMBERED_PRICE_SWAPS,
  ).keys()) {
    if (price === at || price <= 0) continue
    const found = readingsAt(swaps, read, price, rate, budget, true)
    if (found === null) return null
    for (const one of found) if (one.sumHundredths !== null) sums.add(one.sumHundredths)
  }
  return sums
}

/** Whether one sum of each set, with `fixed`, makes `owed` — a walk of at most `REMEMBERED_WAYS_MAX` steps. */
function meets(sets: readonly ReadonlySet<number>[], fixed: number, owed: number): boolean {
  let steps = 0
  const walk = (k: number, sum: number): boolean => {
    steps += 1
    // past the ceiling nobody knows: as good as met, and the memory's readings are not taken
    if (steps > REMEMBERED_WAYS_MAX) return true
    const at = sets[k]
    if (at === undefined) return sum === owed
    for (const one of at) if (walk(k + 1, sum + one)) return true
    return false
  }
  return walk(0, fixed)
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
 * - **Repaired**: a line that does not hold as read, whose price the swaps make the remembered one — read otherwise
 *   — and whose quantity and discount then hold it with **the sum as read**, one way — as read, or by `others` — the
 *   discount at the card's rate. «60 50» read for «50 50», «650 / 5,6 / 544,5» for 550 / 5,5 / 544,5. Shown with
 *   «проверьте». **Not where another digit misread explains the line as well** — at its price as read, the sum as read
 *   (adversarial Б1 of review 2): «0.6 / 660 / 3,3 / 326,7» is 0,6 × 550 with the price misread, or 0,5 × 660 with the
 *   weight misread and a cheese gone up to 660; the memory cannot tell them. A reading that changes the sum is what
 *   was paid, the total's: taken only as below. «660 / 650» for a butter gone up to 650, against a remembered 550,
 *   read 1 × 550 = 550 under a total of 650 (adversarial А1).
 * - **Doubted** (owner's В-2 «б»): a line that holds as printed one 5↔6 off **the person's own** price — misread
 *   alike in its price and sum (am-34's 540 / 5,4 / 534,6 for 640), or the price went up by just that digit. The text
 *   cannot tell them, and a wrong figure is worse than none: emptied by the check, the remembered price the hint. Never
 *   by other people's price: the hint shows it only with access, and a newcomer's line would go empty with nothing to
 *   type it by (review №4).
 *
 * **The total settles it, whatever the memory said.** Every line with its figures meeting the total two places vouch
 * for — the doubted ones as printed — vouches for those lines: no doubt (adversarial Б2). The memory's readings that
 * need the total — every doubted line's, every sum changed — are taken together, or none: only where they then meet it,
 * and the lines' sums as read do not meet it too (Б3: two prices changed the opposite ways). **And a total refutes what
 * the memory said**: where every line has its figures and they miss the total — vouched, or read in one place — the
 * lines it put right go back as read (adversarial А1), and a line it confirmed loses its word where its own 5↔6
 * alone closes the gap — the one line the total points at (review 2, №7).
 */
export function rememberedLines(
  lines: readonly ReceiptTextLine[],
  prices: RememberedPrices,
  swaps: RememberedSwaps,
  totals: RememberedTotals,
): ReceiptTextLine[] {
  if (prices.size === 0) return [...lines]
  const rate = cardRate(lines)
  const budget = { left: REMEMBERED_RECEIPT_COMBINATIONS_MAX }
  // the readings only the total may take: a doubted line's, and one that changes what was paid; and the sums each
  // such line may come to without the memory — the paper's own readings, which the total must not meet as well
  const pending = new Map<number, LineFigures | null>()
  const paper = new Map<number, Set<number> | null>()
  const out = lines.map((line, i): ReceiptTextLine => {
    const remembered = line.sku === null ? undefined : prices.get(line.sku)
    const read = line.read
    if (remembered === undefined || read?.priceHundredths === undefined) return line
    if (read.priceHundredths === null) return line
    const price = read.priceHundredths
    const at = remembered.hundredths
    if (line.asPrinted) {
      if (price === at) return { ...line, remembered: 'confirmed' }
      if (!remembered.own || !nearPrice(swaps.doubt, price, at)) return line
      pending.set(i, oneOf(readingsAt(swaps, read, at, rate, budget, true)))
      paper.set(i, withoutMemory(swaps, read, at, rate, budget))
      return { ...line, remembered: 'doubted' }
    }
    // the memory's word is the price: a line whose price reads as remembered and whose other figures do not hold
    // is the arithmetic's to put right, by the total (MOL-290) — with no total, a sum bent within the till's
    // rounding passed (am-39's 49,76 for 49,75), and a price misread into a changed one was «confirmed» by it
    if (price === at || !nearPrice(swaps.price, price, at)) return line
    // the reader's own swaps explain it at another price — the weight or the sum misread, the price misread into
    // another one, one number copied two ways: the memory cannot choose among them (Б1, review 3, №8, №9, В1)
    const others = withoutMemory(swaps, read, at, rate, budget)
    if (others === null || others.size > 0) return line
    const kept = oneOf(readingsAt(swaps, read, at, rate, budget, false))
    if (kept !== null) return withFigures(line, kept)
    pending.set(i, oneOf(readingsAt(swaps, read, at, rate, budget, true)))
    paper.set(i, others)
    return line
  })
  const sumOf = (all: readonly ReceiptTextLine[]): number =>
    all.reduce((sum, line) => sum + (line.sumHundredths ?? 0), 0)
  const whole = (all: readonly ReceiptTextLine[]): boolean =>
    all.every((line) => line.settled && line.sumHundredths !== null)
  const { owed } = totals
  // the total vouches for the lines as they stand, a doubted one as printed among them (Б2)
  if (owed !== null && whole(out) && sumOf(out) === owed) {
    return out.map((line, i) => (line.remembered === 'doubted' ? (lines[i] ?? line) : line))
  }
  if (pending.size > 0 && owed !== null) {
    const taken = out.map((line, i) => {
      const figures = pending.get(i)
      return figures === undefined || figures === null ? line : withFigures(line, figures)
    })
    // the paper's own readings meet the total too — a doubted line as printed or by the swaps: one as good (Б3, В2)
    const kept = out.filter((_, i) => !pending.has(i))
    const sets = [...paper.values()]
    const paperMeets =
      whole(kept) &&
      (sets.some((set) => set === null) ||
        meets(
          sets.filter((set): set is Set<number> => set !== null),
          sumOf(kept),
          owed,
        ))
    if (
      !paperMeets &&
      [...pending.values()].every((figures) => figures !== null) &&
      whole(taken) &&
      sumOf(taken) === owed
    ) {
      return taken
    }
  }
  const judge = owed ?? totals.read
  if (judge === null || !whole(out) || sumOf(out) === judge) return out
  // refuted: what the memory put right goes back as read (А1); a line it confirmed loses its word where the font's 5↔6
  // in that line alone closes the gap to the total — the one line the total points at (review 2, №7)
  const gap = judge - sumOf(out)
  const pointed = out.flatMap((line, i) => {
    if (line.remembered !== 'confirmed' || line.sumHundredths === null) return []
    const sum = line.sumHundredths
    return variantsOf(swaps.doubt, sum, REMEMBERED_PRICE_SWAPS).has(sum + gap) ? [i] : []
  })
  // every confirmation dropped instead lost 3 and 12 right fields of the bench for 0 and 2 made up: the gap is most
  // often another line's misread, and the total does not say whose
  const refuted = pointed.length === 1 ? pointed : []
  return out.map((line, i) =>
    line.remembered === 'repaired' || refuted.includes(i) ? (lines[i] ?? line) : line,
  )
}

/**
 * Tesseract's reading with the shop's memory's word on it (MOL-291): after the parse chose its reading, a line at
 * a time, by the figures as printed — the price by the card's swaps, every other figure as printed, a doubt by the
 * font's 5↔6. A receipt proven whole as read is not touched: the memory is weaker than the total.
 */
export function rememberedReading(
  text: ReceiptText,
  prices: RememberedPrices,
  reading: Pick<PhotoReading, 'swaps' | 'modelSwaps'>,
): ReceiptText {
  if (prices.size === 0 || text.lines.length === 0) return text
  const less = (total: number | null): number | null =>
    total === null ? null : total - (text.cashbackHundredths ?? 0)
  const owed = less(text.totalHundredths)
  const asRead = text.lines.every((line) => line.asPrinted && line.sumHundredths !== null)
  const sum = text.lines.reduce((all, line) => all + (line.sumHundredths ?? 0), 0)
  if (asRead && owed !== null && sum === owed) return text
  const swaps = { price: reading.swaps, others: {}, doubt: reading.modelSwaps }
  const totals = { owed, read: less(text.readTotalHundredths) }
  return { ...text, lines: rememberedLines(text.lines, prices, swaps, totals) }
}
