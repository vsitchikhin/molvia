// MOL-125 — a receipt's text, as Tesseract read it, into lines with their figures. A port of the
// prototype of MOL-114 (`hybrid.mjs` of its bench): the same rules give the same lines on the
// bench's readings, which a test holds. Amounts are counted in whole hundredths — what a till
// prints, whatever the currency's own minor unit — and quantities in thousandths; a ratio is a
// float only where it ranks candidates, never where it is money.
//
// The figures are code's, not a model's: OCR's own slips in this font (5 read as 6, 1 as 4) are
// undone by the line's arithmetic — paid + discount = quantity × shelf price — by the receipt's
// one card discount rate, and last by the printed total.

/** One row of a reading: its text and where it stands on the photo of its part. */
export interface TextRow {
  readonly text: string
  readonly part: number
  readonly line: number
}

export interface ReceiptTextLine {
  /** The item's name as printed, after the row number. */
  readonly printed: string
  /**
   * The class code printed on the line, or null: a customs heading of four digits for goods, a class
   * of services «56.10» for food service (MOL-226).
   */
  readonly hs: string | null
  /** The till's own article after the heading: «0401/1163909». */
  readonly sku: string | null
  /** Thousandths of a kilogram or of a piece; null when nothing readable fits the unit. */
  readonly quantityMilli: number | null
  readonly unit: 'kg' | 'piece'
  readonly priceHundredths: number | null
  readonly sumHundredths: number | null
  readonly discountHundredths: number | null
  /** The line's own arithmetic holds for the figures given. */
  readonly settled: boolean
  /**
   * The rows the line may be cut out from for the reader's training (MOL-169): its figures, and its
   * name only when the item's number was read on it. A name row is the first row above the figures,
   * and above the first item that is the head — the VAT, a buyer's name — when OCR lost the name: the
   * number is what says it is an item. A table gives its heading row only: its last row runs on into
   * the total when OCR misreads the total's word.
   */
  readonly rows: readonly TextRow[]
}

/** How the lines were found: «Ереван Сити»'s card, Dog City's table, or the class code (MOL-226). */
export const RECEIPT_LAYOUTS = ['card', 'table', 'class'] as const
export type ReceiptLayout = (typeof RECEIPT_LAYOUTS)[number]

export interface ReceiptText {
  readonly layout: ReceiptLayout
  /** The seller's tax number (ՀՎՀՀ), eight digits. */
  readonly tin: string | null
  /** The day and time printed, as written on the receipt: `YYYY-MM-DD`, `HH:MM`. */
  readonly date: string | null
  readonly time: string | null
  readonly receiptNo: string | null
  readonly totalHundredths: number | null
  /** The lines add up to the printed total. */
  readonly balanced: boolean
  readonly lines: readonly ReceiptTextLine[]
}

// «1 260,5» — what OCR printed — as a number; NaN for what is not one, as the prototype had it.
const number = (text: string): number => Number(text.replace(/\s/g, '').replace(',', '.'))
const hundredthsOf = (text: string): number => Math.round(number(text) * 100)
const milliOf = (text: string): number => Math.round(number(text) * 1000)
const finite = (value: number | null | undefined): number | null =>
  value === null || value === undefined || !Number.isFinite(value) ? null : value

// Digits OCR confuses in this font; a figure is tried with each of them swapped in.
const CONFUSED: Readonly<Record<string, string>> = {
  5: '6',
  6: '5',
  1: '4',
  4: '1',
  3: '8',
  8: '3',
  0: '9',
  9: '0',
}

function variants(text: string, depth = 2): string[] {
  const out = new Set([text])
  let edge = [text]
  for (let k = 0; k < depth; k++) {
    const next: string[] = []
    for (const value of edge) {
      for (let i = 0; i < value.length; i++) {
        const swapped = CONFUSED[value.charAt(i)]
        if (swapped === undefined) continue
        const variant = value.slice(0, i) + swapped + value.slice(i + 1)
        if (!out.has(variant)) {
          out.add(variant)
          next.push(variant)
        }
      }
    }
    edge = next
  }
  // «1,3124q» is 1,312 kg with «կգ» read as «4q»: a weight has three decimals at most
  const weight = /^(\d+[.,]\d{3})\d$/.exec(text)
  if (weight?.[1] !== undefined) out.add(weight[1])
  return [...out]
}

const diff = (a: string, b: string): number =>
  a.length !== b.length ? 1 : Array.from(a).filter((c, i) => c !== b.charAt(i)).length

// «130 603,87» is «1Հտ» glued to 603,87 as often as it is a thousand-group: try without it too.
function dropGroup(text: string): string[] {
  const glued = /^(\d{1,3}) (\d{3}[.,].*)$/.exec(text)
  return glued?.[2] !== undefined ? [glued[2]] : []
}

interface Candidate {
  readonly qty: number
  readonly paid: number
  readonly disc: number
  readonly price: number
  readonly swaps: number
  readonly rate: number
}

// The till rounds to a few luma: 609,97 paid for 610.
const TOLERANCE_HUNDREDTHS = 3

/**
 * Past this many combinations a line's figures are taken as read, with no reading tried: the
 * search grows as a power of the digits OCR can confuse in every field, and it runs in the API's
 * process — twelve glued twelve-digit figures held it for half a minute (review, MOL-125). The
 * bench's worst line has 55 176 (am-03), a quarter of it.
 */
export const LINE_COMBINATIONS_MAX = 200_000

/**
 * And past this many over one reading the lines left are taken as read: a line under the ceiling
 * still costs a tenth of a second, and twelve of them stalled every request of the API for one. The
 * bench's busiest reading tries 122 161 (am-03).
 */
export const READING_COMBINATIONS_MAX = 300_000

/**
 * What every line may try whatever the reading has spent (review Р15): rows of an item's shape above
 * the list — a stamp, a code, a smudge — would otherwise drain the budget before the first item, and
 * every real line would keep its confusions. A real line tries a few thousand (am-05: 1 694 at most).
 * The floors draw on a budget of their own (review Р18), or four hundred rows of junk under it would
 * buy seconds again.
 */
export const LINE_COMBINATIONS_FLOOR = 10_000
export const FLOOR_COMBINATIONS_MAX = 200_000

/** What a reading may still try: its own budget, and the floors' beside it. */
interface Budget {
  left: number
  floors: number
}

// Takes `combinations` from a budget, or says the line is to be taken as read.
function afford(budget: Budget, combinations: number): boolean {
  if (combinations > LINE_COMBINATIONS_MAX) return false
  if (combinations <= budget.left) {
    budget.left -= combinations
    return true
  }
  if (combinations <= LINE_COMBINATIONS_FLOOR && combinations <= budget.floors) {
    budget.floors -= combinations
    return true
  }
  return false
}

// One pass over the figures of a line: every combination that satisfies paid + discount =
// quantity × price is a candidate; the receipt's own discount rate then picks among them (a card
// discount is one percentage), and after it the fewest swaps.
function candidates(
  budget: Budget,
  qtyS: string,
  paidS: string,
  discS: string,
  priceS: string | null,
): Candidate[] {
  const out: Candidate[] = []
  const qtys = variants(qtyS)
  const paids = [paidS, ...dropGroup(paidS)].map((p0) => ({ p0, all: variants(p0) }))
  const discs = variants(discS)
  const prices = priceS === null ? [null] : variants(priceS)
  const combinations =
    qtys.length * paids.reduce((n, p) => n + p.all.length, 0) * discs.length * prices.length
  if (!afford(budget, combinations)) return out
  for (const q of qtys) {
    for (const { p0, all } of paids) {
      for (const p of all) {
        for (const d of discs) {
          for (const pr of prices) {
            const qty = milliOf(q)
            const paid = hundredthsOf(p)
            const disc = hundredthsOf(d)
            const price = pr === null ? Math.round(((paid + disc) * 1000) / qty) : hundredthsOf(pr)
            const swaps =
              diff(q, qtyS) +
              diff(p, p0) +
              diff(d, discS) +
              diff(pr ?? '', priceS ?? '') +
              (p0 !== paidS ? 1 : 0) +
              (pr === null ? 1 : 0)
            if (Math.abs(paid + disc - Math.round((qty * price) / 1000)) <= TOLERANCE_HUNDREDTHS) {
              out.push({ qty, paid, disc, price, swaps, rate: disc / (paid + disc) })
            }
          }
        }
      }
    }
  }
  return out
}

function mode(values: readonly number[]): number | null {
  const counts = new Map<number, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
}

const off = (a: number, rate: number): number => Math.round(Math.abs(a - rate) * 1000)

/**
 * The rate the lines as read share, for the total to choose by (review Р20): a till that prints no
 * shelf price has no line read with no swap — its price is worked out — so `settle` has no rate to
 * order by, and two fixes of one digit cost the total the same. The lines with their fewest swaps
 * still say the rate, and a fix that leaves a line off it costs a little more there. Only there: as
 * an order of a line's readings it «fixed» am-01's right sum to fit (65 of 162 on the bench).
 */
function asReadRate(all: readonly Candidate[][]): number | null {
  return mode(
    all
      .flatMap((list) => {
        // a loop, not `Math.min(...)`: a list of ninety thousand readings is past the stack (review 10)
        const fewest = list.reduce((least, x) => Math.min(least, x.swaps), Infinity)
        return list.filter((x) => x.swaps === fewest).slice(0, 1)
      })
      .map((x) => Math.round(x.rate * 1000) / 1000),
  )
}

// What a reading off the rate the lines share costs the total beyond its swaps.
const OFF_RATE_COST = 0.25

function settle(all: Candidate[][]): Candidate[][] {
  const clean = all
    .flatMap((list) => list.filter((x) => x.swaps === 0).slice(0, 1))
    .map((x) => Math.round(x.rate * 1000) / 1000)
  const rate = mode(clean)
  return all.map((list) =>
    list.sort(
      (a, b) =>
        Number(a.swaps > 0) - Number(b.swaps > 0) ||
        (rate === null ? 0 : off(a.rate, rate) - off(b.rate, rate)) ||
        a.swaps - b.swaps,
    ),
  )
}

// The digits of an amount as a till prints them: 128991 for 1 289,91.
const printedDigits = (hundredths: number): string =>
  String(Math.floor(hundredths / 100)) + String(hundredths % 100).padStart(2, '0')

// The blank must still look like what is printed there: the rest differs from the printed figure
// by one digit at most (1 289,91 read as «1 209,91»), or anything could be poured into it.
function looksLike(rest: number, printed: string): boolean {
  const digits = printedDigits(rest)
  return [digits, digits.endsWith('00') ? digits.slice(0, -2) : null].some((d) => {
    if (d === null) return false
    const head = printed.slice(0, d.length)
    return (
      head.length === d.length && Array.from(d).filter((c, i) => c !== head.charAt(i)).length <= 1
    )
  })
}

interface State {
  readonly sum: number
  readonly cost: number
  // the line's pick and the state it was made from: a chain, not a copied list — the copy made the
  // search quadratic in the lines and a receipt of fifteen of them held the API for a minute
  readonly pick: Candidate | null
  readonly prev: State | null
  readonly blank: number
  // another reading of the same cost reached the same sum: the total cannot tell which (review Р20)
  readonly tied: boolean
}

/**
 * Past this many steps the total no longer chooses among the readings (review Р14, 8): the lines keep
 * their first reading, as when no total was read. The search runs in the API's process; the bench's
 * longest takes 94 445 (am-03), ninety ordinary lines of a till with no shelf price fit, and the worst
 * shape the review found — four hundred rows of junk and a total — costs half a second a reading.
 */
export const RECONCILE_STEPS_MAX = 500_000

/**
 * The readings the search carries from one line to the next: the cheapest — fewest swaps — when there
 * are more (review Р14, 8). A till that prints no shelf price lets every swap of a line «fit» the line,
 * and the readings multiply by dozens a line; the cheapest are the ones the total would choose among.
 * The bench carries up to 9 732 (am-03) and reads the same with three hundred; thirty such lines are
 * settled against their total in a tenth of a second, ninety in under a third.
 */
export const RECONCILE_STATES_MAX = 300

function picksOf(state: State): (Candidate | null)[] {
  const picks: (Candidate | null)[] = []
  // every state but the start made a pick: the start is the one with nothing before it
  for (let at = state; at.prev !== null; at = at.prev) picks.push(at.pick)
  return picks.reverse()
}

// The printed total is the last judge. OCR can misread both columns alike — «60 60» for «50 50» —
// and the line's arithmetic holds either way; the reading whose lines add up to the total wins,
// changing as few lines as possible. One line with no reading at all (a discount the till did not
// print, a figure OCR lost) takes what the total leaves.
function reconcile(
  lists: readonly Candidate[][],
  total: number | null,
  printed: readonly string[],
  rate: number | null,
): { picks: (Candidate | null)[]; balanced: boolean; tied: boolean } {
  const first = lists.map((list) => list[0] ?? null)
  if (total === null || !Number.isFinite(total))
    return { picks: first, balanced: false, tied: false }

  // what the lines after each one come to as first read: a reading whose sum with them lands nearer
  // the total is kept before another of the same cost when the beam is full (review П11)
  const ahead = lists.map((_, i) =>
    lists.slice(i + 1).reduce((sum, list) => sum + (list[0]?.paid ?? 0), 0),
  )
  const start: State = { sum: 0, cost: 0, pick: null, prev: null, blank: -1, tied: false }
  let states = new Map<string, State>([['0|false', start]])
  let steps = 0
  for (const [i, list] of lists.entries()) {
    const next = new Map<string, State>()
    const put = (state: State): void => {
      steps += 1
      const key = `${String(state.sum)}|${String(state.blank >= 0)}`
      const was = next.get(key)
      if (was === undefined || state.cost < was.cost) next.set(key, state)
      else if (state.cost === was.cost && !was.tied) next.set(key, { ...was, tied: true })
    }
    for (const state of states.values()) {
      if (steps > RECONCILE_STEPS_MAX) break
      if (list.length === 0) {
        if (state.blank < 0) {
          put({
            sum: state.sum,
            cost: state.cost + 4,
            pick: null,
            prev: state,
            blank: i,
            tied: state.tied,
          })
        }
        continue
      }
      const seen = new Set<number>()
      for (const [k, x] of list.entries()) {
        if (seen.has(x.paid)) continue
        seen.add(x.paid)
        const sum = state.sum + x.paid
        if (sum > total) continue
        put({
          sum,
          cost:
            state.cost +
            x.swaps +
            (k > 0 ? 0.5 : 0) +
            (rate !== null && off(x.rate, rate) > 5 ? OFF_RATE_COST : 0),
          pick: x,
          prev: state,
          blank: state.blank,
          tied: state.tied,
        })
      }
    }
    if (steps > RECONCILE_STEPS_MAX) return { picks: first, balanced: false, tied: false }
    states =
      next.size > RECONCILE_STATES_MAX
        ? new Map(
            [...next]
              .sort(
                (a, b) =>
                  a[1].cost - b[1].cost ||
                  Math.abs(total - a[1].sum - (ahead[i] ?? 0)) -
                    Math.abs(total - b[1].sum - (ahead[i] ?? 0)),
              )
              .slice(0, RECONCILE_STATES_MAX),
          )
        : next
  }

  let best: State | null = null
  for (const state of states.values()) {
    const rest = total - state.sum
    const ok =
      state.blank < 0
        ? rest === 0 || Math.abs(rest) <= 1
        : rest > 0 && looksLike(rest, printed[state.blank] ?? '')
    if (ok && (best === null || state.cost < best.cost)) best = state
  }
  return best === null
    ? { picks: first, balanced: false, tied: false }
    : { picks: picksOf(best), balanced: true, tied: best.tied }
}

/**
 * The lines' readings judged by the printed total: the pick of each, whether they met it, what the
 * one line with no reading takes, and which lines the total changed or could not tell apart.
 */
function judged(
  found: Candidate[][],
  total: number | null,
  printed: readonly string[],
): {
  picks: (Candidate | null)[]
  balanced: boolean
  blankSum: number | null
  doubt: ReadonlySet<number>
} {
  const lists = settle(found)
  // the shared rate counts in the total's choice only where `settle` had none to order by
  const shared = lists.some((list) => list.some((x) => x.swaps === 0)) ? null : asReadRate(lists)
  const { picks, balanced, tied } = reconcile(lists, total, printed, shared)
  // what the total leaves goes to the one line with no reading only when the lines met the total —
  // otherwise «the rest» is a guess, and a line that took it would cover a receipt barely read
  // (review Р6)
  const blankSum =
    balanced && total !== null && picks.filter((x) => x === null).length === 1
      ? total - picks.reduce((a, x) => a + (x?.paid ?? 0), 0)
      : null
  // A line the total changed from its reading is not vouched for (review Р27): the total sets any
  // difference right by one swap in some line whose own arithmetic holds — a line read twice or lost
  // at a seam included — so «balanced» is «balanced as read», and a change by the total is one look of
  // the person's. In a tie the total could have made its change in another line just as well: every
  // line with a reading of its own that differs by the same amount is in doubt too (review Р20, Р24).
  const moves = picks.flatMap((pick, i) => {
    const first = lists[i]?.[0]
    return pick !== null && first !== undefined && pick !== first
      ? [[i, pick.paid - first.paid]]
      : []
  })
  const doubt = new Set<number>(moves.map(([i]) => i ?? -1))
  if (tied) {
    lists.forEach((list, j) => {
      const first = list[0]
      if (first === undefined || doubt.has(j)) return
      if (moves.some(([, move]) => list.some((x) => x !== first && x.paid - first.paid === move))) {
        doubt.add(j)
      }
    })
  }
  return { picks, balanced, blankSum, doubt }
}

const ITEM = /^\s*(\d{1,2})\s*[.,]?\s*(\S.*)$/
// An item's number for cutting a name row out (review Р16): one or two digits and then a letter — a
// date «01.10.2026 …» or a phone «091 123456 …» above the list is not an item, and its row is the head.
const NUMBERED = /^\s*\d{1,2}(?!\d)\s*[.,]?\s*\p{L}/u
// «8506/119112 1Հտ 760,75/89,25 850» — code, quantity, paid/discount, shelf price (old/new).
const FIGURES =
  /^\s*(\d{1,4})\s*\/\s*([\d.]{5,})\s+(.*?)\s*(\d[\d ]*[.,]\d{1,2})\s*\/\s*(\d[\d ]*(?:[.,]\d{1,2})?)(?:\s+(?:\d[\d ]*\/\s*)?(\d[\d ]*\d|\d))?\s*$/
// Letters Tesseract puts where this font has digits.
const DIGIT_LIKE: Readonly<Record<string, string>> = {
  Յ: '3',
  З: '3',
  б: '6',
  О: '0',
  O: '0',
  o: '0',
}

// A shadow or the paper's edge puts junk at both ends of a row: «=, 0401/1183903 2 732,17,4 370 М».
// A row that has a code «dddd/ddddd» keeps what lies from the code to its last digit.
function margins(row: string): string {
  const code = /\d{4}\s*\/\s*\d{5}/.exec(row)
  if (code === null) return row
  const end = row.search(/\d[^\d]*$/)
  return row.slice(code.index, end + 1)
}

const digits = (row: string): string =>
  margins(row).replace(/[ՅЗбОOo](?=[\d,.])/g, (c) => DIGIT_LIKE[c] ?? c)

const WEIGHT = /(\d+[.,]\d+)\s*\S*$/

// A receipt with no card discount (a Yandex Eats order) prints «0401/1163909 2Հտ 740 370»: code,
// quantity, paid, shelf price — no «/discount».
const PLAIN = /^\s*(\d{1,4})\s*\/\s*([\d.]{5,})\s+(\S+)\s+(\d[\d ,.]*\d)\s*$/

interface Found {
  readonly head: string
  readonly hs: string
  readonly sku: string
  readonly qtyS: string
  readonly weighed: boolean
  readonly plain: readonly string[] | null
  readonly paidS: string
  readonly discS: string
  readonly priceS: string | null
  readonly rows: readonly TextRow[]
}

// «0,694q» for 0,89 kg: when no reading of the weight fits, the weight is paid ÷ price, if that
// comes out in whole grams — at a cost of two swaps, so a readable weight always wins.
function byWeight(budget: Budget, paidS: string, priceS: string): Candidate[] {
  const out: Candidate[] = []
  const paids = variants(paidS)
  const prices = variants(priceS)
  if (!afford(budget, paids.length * prices.length)) return out
  for (const p of paids) {
    for (const pr of prices) {
      const paid = hundredthsOf(p)
      const price = hundredthsOf(pr)
      const qty = Math.round((paid * 1000) / price)
      if (qty > 0 && Math.round((qty * price) / 1000) === paid) {
        out.push({
          qty,
          paid,
          disc: 0,
          price,
          swaps: 2 + diff(p, paidS) + diff(pr, priceS),
          rate: 0,
        })
      }
    }
  }
  return out
}

// Every way to cut the numbers into «paid» and «price»: «1 260 630» is 1 260 and 630, or 1 and
// 260 630; a count of pieces is what paid ÷ price makes whole.
function plainCandidates(budget: Budget, found: Found): Candidate[] {
  const tokens = found.plain ?? []
  const group = (g: readonly string[]): boolean =>
    g.length === 1 ||
    (/^\d{1,3}$/.test(g[0] ?? '') && g.slice(1).every((x) => /^\d{3}([.,]\d+)?$/.test(x)))
  const out: Candidate[] = []
  for (let k = 1; k < tokens.length; k++) {
    const a = tokens.slice(0, k)
    const b = tokens.slice(k)
    if (!group(a) || !group(b)) continue
    const paidS = a.join(' ')
    const priceS = b.join('')
    if (found.weighed)
      out.push(
        ...candidates(budget, found.qtyS, paidS, '0', priceS),
        ...byWeight(budget, paidS, priceS),
      )
    else
      for (let q = 1; q <= 20; q++) out.push(...candidates(budget, String(q), paidS, '0', priceS))
  }
  // with no discount the paid sum is qty × price to the luma, not «about» it
  return out.filter((x) => Math.round((x.qty * x.price) / 1000) === x.paid)
}

const TOTAL = /Ընդամենը\s+(\d[\d ]*\.\d{1,2})\b/
const DATE = /(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})/

function dateOf(text: string): { date: string | null; time: string | null } {
  const found = DATE.exec(text)
  const [, day, month, year, hour, minute] = found ?? []
  if (
    day === undefined ||
    month === undefined ||
    year === undefined ||
    hour === undefined ||
    minute === undefined
  ) {
    return { date: null, time: null }
  }
  return { date: `${year}-${month}-${day}`, time: `${hour}:${minute}` }
}

function cardReceipt(rows: readonly TextRow[]): ReceiptText {
  const text = rows.map((r) => r.text).join('\n')
  const mapped = rows.map((r) => digits(r.text))
  const found: Found[] = []
  let lastFigures = -1
  for (let i = 1; i < mapped.length; i++) {
    const row = mapped[i] ?? ''
    const figures = FIGURES.exec(row)
    const plain = figures === null ? PLAIN.exec(row) : null
    if (figures === null && plain === null) continue
    let j = i - 1
    while (j > 0 && (mapped[j] ?? '').trim() === '') j-- // OCR leaves blank lines between the halves
    const headRow = mapped[j] ?? ''
    const head = ITEM.exec(headRow)?.[2] ?? headRow
    // the name row is cut out only between two items: right below the figures of the one before
    // (review Р19) — above the first item is the head, whatever OCR reads at its edge
    let above = j - 1
    while (above > 0 && (mapped[above] ?? '').trim() === '') above--
    const betweenItems = above >= 0 && above === lastFigures
    const numbered = betweenItems && NUMBERED.test(headRow)
    const source = rows.filter((_, k) => (k === j && numbered) || k === i)
    lastFigures = i
    if (figures !== null) {
      const mid = figures[3] ?? ''
      const weight = WEIGHT.exec(mid)
      const weighed = weight !== null && !/^1[^\d,.]/.test(mid.trim())
      found.push({
        head,
        hs: figures[1] ?? '',
        sku: figures[2] ?? '',
        qtyS: weighed ? (weight[1] ?? '').replace('.', ',') : '1',
        weighed,
        plain: null,
        paidS: (figures[4] ?? '').trim(),
        discS: (figures[5] ?? '').replace(/\s/g, ''),
        priceS: figures[6]?.replace(/\s/g, '') ?? null,
        rows: source,
      })
    } else if (plain !== null) {
      const mid = plain[3] ?? ''
      const weight = WEIGHT.exec(mid)
      const weighed = weight !== null && !/^1[^\d,.]/.test(mid.trim())
      found.push({
        head,
        hs: plain[1] ?? '',
        sku: plain[2] ?? '',
        qtyS: weighed ? (weight[1] ?? '').replace('.', ',') : '1',
        weighed,
        plain: (plain[4] ?? '').trim().split(/\s+/),
        paidS: (plain[4] ?? '').trim(),
        discS: '0',
        priceS: null,
        rows: source,
      })
    }
  }

  const printedTotal = TOTAL.exec(text)
  const total = printedTotal?.[1] === undefined ? null : hundredthsOf(printedTotal[1])
  const budget: Budget = { left: READING_COMBINATIONS_MAX, floors: FLOOR_COMBINATIONS_MAX }
  const { picks, balanced, blankSum, doubt } = judged(
    found.map((f) =>
      f.plain !== null
        ? plainCandidates(budget, f)
        : candidates(budget, f.qtyS, f.paidS, f.discS, f.priceS),
    ),
    total,
    found.map((f) => (f.plain !== null ? f.plain.join('') : f.paidS).replace(/\D/g, '')),
  )
  const lines = found.map((f, i): ReceiptTextLine => {
    const pick = picks[i] ?? null
    return {
      printed: f.head.trim(),
      hs: f.hs.padStart(4, '0'),
      sku: f.sku,
      quantityMilli: finite(pick?.qty ?? milliOf(f.qtyS)),
      unit: f.weighed ? 'kg' : 'piece',
      priceHundredths: finite(pick?.price ?? (f.priceS === null ? null : hundredthsOf(f.priceS))),
      sumHundredths: finite(pick?.paid ?? blankSum ?? hundredthsOf(f.paidS)),
      discountHundredths: finite(pick?.disc ?? hundredthsOf(f.discS)),
      // what the total changed or could not tell apart: highlighted for the person to check
      settled: pick !== null && !doubt.has(i),
      rows: f.rows,
    }
  })

  const tin = /(\d{8})\b/.exec(/ՀՎՀՀ.{0,4}:?\s*\S+|:\s*0\d{7}/.exec(text)?.[0] ?? '')?.[1] ?? null
  return {
    layout: 'card',
    tin,
    ...dateOf(text),
    receiptNo: /Ֆիսկալ\s+\S+\s+(\d{6,})/.exec(text)?.[1] ?? null,
    totalHundredths: total,
    balanced,
    lines,
  }
}

// Every way to read space-separated digit groups as numbers: «2 200» is one number or two. Values
// are thousandths, so that «1,5» kg and «2 200» ֏ are both whole.
function splits(tokens: readonly string[]): number[][] {
  const out: number[][] = []
  const walk = (i: number, acc: number[]): void => {
    if (i === tokens.length) {
      out.push(acc)
      return
    }
    for (let j = i + 1; j <= tokens.length; j++) {
      const group = tokens.slice(i, j)
      if (group.length > 1 && !group.slice(1).every((g) => /^\d{3}([.,]\d+)?$/.test(g))) break
      if (group.length > 1 && !/^\d{1,3}$/.test(group[0] ?? '')) break
      walk(j, [...acc, milliOf(group.join(''))])
    }
  }
  walk(0, [])
  return out
}

interface TableOption {
  readonly qty: number | null
  readonly price: number | null
  readonly sum: number | null
  readonly settled: boolean
}

// Past this many combinations the total no longer chooses among the readings of a table: a long
// table would otherwise hold the queue for minutes. The bench's tables are far below it.
const TABLE_COMBINATIONS_MAX = 100_000

// The second layout family: a table «name | qty | price | sum» with the heading in brackets —
// «(3824) ՏՈՖՈՒ ՀՈՂ …» (Dog City). A row runs from one «(dddd)» to the next; the figures are the
// numbers at the ends of its lines, and how «1 2 200 2 200» splits into qty, price and sum is
// decided by qty × price = sum. A row whose figures OCR lost takes what the total leaves over.
function tableLines(rows: readonly TextRow[]): { lines: ReceiptTextLine[]; total: number | null } {
  const text = rows.map((r) => r.text).join('\n')
  const items: { hs: string; words: string[]; rows: TextRow[] }[] = []
  for (const row of rows) {
    const mapped = digits(row.text)
    const heading = /\((\d{4})\)\s*(.*)$/.exec(mapped)
    const last = items.at(-1)
    if (heading !== null)
      items.push({ hs: heading[1] ?? '', words: [heading[2] ?? ''], rows: [row] })
    else if (last !== undefined && !/Ընդամենը|Հսկիչ|\(Ֆ/.test(mapped)) {
      last.words.push(mapped)
      last.rows.push(row)
    } else if (last !== undefined) break
  }
  const printedTotal = /Ընդամենը:?\s+(\d[\d ]*[.,]\d{2})/.exec(text)?.[1]
  const total = printedTotal === undefined ? null : hundredthsOf(printedTotal)

  const options = items.map((item) => {
    // a row number at the start of a line («| 1|», «ւ 2/») is not a figure
    const body = item.words
      .map((w, k) => (k > 0 ? w.replace(/^[^\p{L}\d]*\p{L}?\s*\d{1,2}\s*[|/[]/u, ' ') : w))
      .join(' ')
    const tokens = body.match(/(?<![\p{L}\d])\d+(?:[.,]\d+)?(?![\p{L}\d(])/gu) ?? []
    const tail = tokens.slice(-5)
    const out: TableOption[] = []
    for (let k = tail.length; k >= 1; k--) {
      for (const sp of splits(tail.slice(-k))) {
        const [a, b, c] = sp
        if (sp.length === 3 && a !== undefined && b !== undefined && c !== undefined) {
          // thousandths × thousandths against thousandths: within a luma, as the prototype allowed
          if (Math.abs(a * b - c * 1000) < 11_000) {
            out.push({ qty: a, price: Math.round(b / 10), sum: Math.round(c / 10), settled: true })
          }
        }
        if (sp.length === 2 && a !== undefined && b !== undefined && a > 0 && a < 100_000) {
          out.push({
            qty: a,
            price: Math.round(b / 10),
            sum: Math.round((a * b) / 10_000),
            settled: false,
          })
          out.push({
            qty: a,
            price: Math.round((b * 100) / a),
            sum: Math.round(b / 10),
            settled: false,
          })
        }
      }
    }
    if (out.length === 0)
      out.push({ qty: milliOf(tail[0] ?? '1'), price: null, sum: null, settled: false })
    const name = body
      .replace(/[|[\]{}]/g, ' ')
      .replace(/(?:^|\s)\d+(?:[.,]\d+)?(?=\s|$)/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    return { item, name, weighed: /[կԿ][գԳ]\)/.test(body), out: out.slice(0, 6) }
  })

  // The receipt's total decides among the readings of rows OCR left short (one row may be blank and
  // takes what is left); among readings that add up, the one with rounder prices wins — a shop
  // prices in whole tens, 2 200 and 900, not 1 525.
  let chosen: TableOption[] = options.map(
    (o) => o.out[0] ?? { qty: null, price: null, sum: null, settled: false },
  )
  const round = (x: number | null): number => (x !== null && x % 1000 === 0 ? 1 : 0)
  let bestScore = -Infinity
  const pick = (i: number, acc: TableOption[]): void => {
    if (total === null) return
    if (i === options.length) {
      const known = acc.filter((x) => x.sum !== null)
      const rest = total - known.reduce((a, x) => a + (x.sum ?? 0), 0)
      const blanks = acc.length - known.length
      if (!((blanks === 0 && Math.abs(rest) <= 1) || (blanks === 1 && rest > 0))) return
      const score =
        -10 * blanks +
        acc.filter((x) => x.settled).length +
        acc.reduce((a, x) => a + round(x.price) + round(x.sum), 0) +
        (blanks > 0 ? round(rest) * 2 : 0)
      if (score > bestScore) {
        bestScore = score
        chosen = acc
      }
      return
    }
    for (const o of options[i]?.out ?? []) pick(i + 1, [...acc, o])
  }
  const combinations = options.reduce((n, o) => n * o.out.length, 1)
  if (total !== null && combinations <= TABLE_COMBINATIONS_MAX) pick(0, [])

  const chosenSum = chosen.reduce((a, x) => a + (x.sum ?? 0), 0)
  const lines = options.map((o, i): ReceiptTextLine => {
    const c = chosen[i] ?? { qty: null, price: null, sum: null, settled: false }
    let { sum, price } = c
    if (sum === null && total !== null) {
      sum = total - chosenSum
      price = c.qty ? Math.round((sum * 1000) / c.qty) : null
    }
    return {
      printed: o.name,
      hs: o.item.hs,
      sku: null,
      quantityMilli: finite(c.qty),
      unit: o.weighed ? 'kg' : 'piece',
      priceHundredths: finite(price),
      sumHundredths: finite(sum),
      discountHundredths: null,
      settled: c.settled,
      rows: o.item.rows.slice(0, 1),
    }
  })
  return { lines, total }
}

function tableReceipt(rows: readonly TextRow[], table: ReturnType<typeof tableLines>): ReceiptText {
  const text = rows.map((r) => r.text).join('\n')
  return {
    layout: 'table',
    tin: /(?:ՀՎՀՀ|ՎՎՀՀ|ՀՎՀ)\S{0,2}\s*(\d{8})/.exec(text)?.[1] ?? null,
    ...dateOf(text),
    receiptNo:
      /Ֆիսկալ\s*\S*\s+(\d{6,})/.exec(text)?.[1] ??
      /ԿՀ:?\s*(\d[\d ]{2,})/.exec(text)?.[1]?.replace(/\s/g, '') ??
      null,
    totalHundredths: table.total,
    // the prototype's table reading never said whether its lines met the total
    balanced: false,
    lines: table.lines,
  }
}

// The third reading (MOL-226). An Armenian fiscal till marks every item with its class code after
// «Դաս.»: a customs heading of four digits for goods, a class of services «dd.dd» for food service —
// often with its own article, «Ն/Կ 745030». Where the name and the figures stand differs by print:
// the till's table puts the code, the article and the figures on one row and the name under them;
// the fiscal terminal (ՀԴՄ) prints the code, the name, then «688.09x1.0 հատ=688.09դրամ» and no
// article. So the code is a boundary rather than a layout: a row of figures is an item, its code
// the last one above it, and its name on the side the receipt's coded items put it.

// What OCR keeps of «Դաս» — «Դաս.», «աս,», «հաս ‘» — and the class after it: «56.10», «56 10», «5610».
// «աս» is the word «Դաս», at most one letter before it: never inside a name, «Կվաս», «Անանաս». And the
// class is no figure that goes on (reviews 1, 2): not an amount after it — «1 հաս 1300 1300», «Բաքեթ
// 5610 5610», «5610 00х10», «5610.00x1.0» — nor a unit of volume or weight, glued or apart, «1000 մլ».
// Letters right after it are the article's, «56.10Ն/Կ 745030»: OCR eats the comma and the space.
const CLASS_TAIL =
  '(?!\\d|[.,]\\d|\\s*[xх×*]|\\s+\\d{1,4}(?:[.,]\\d+)?(?:\\s*[xх×*]|(?![\\d\\p{L}]))|\\s*(?:մլ|լ|գ|կգ)(?!\\p{L}))'
export const CLASS_MARK = new RegExp(
  `(?<!\\p{L}\\p{L})(?<!\\d\\s?հ)աս[^\\p{L}\\d]{0,4}(\\d{2})\\s?[.,]?\\s?(\\d{2})${CLASS_TAIL}`,
  'u',
)
// The till's article after the class: «Ն/Կ 745030», read «ՆԿ», «ԽԿ».
const CLASS_ARTICLE = /^[^\d]{0,8}?(\d{5,7})(?!\d)/
const CLASS_END = /Հսկիչ|Ընդամենը/
const CLASS_TOTAL = /Ընդամենը:?\s+(\d[\d ]*(?:[.,]\d{1,2})?)(?![\d.,])/
// A count before its unit: «1հատ», «4 հատ», «0.742 կգ».
const CLASS_UNIT = /(\d+(?:[.,]\d+)?)\s*(հ\S?տ|կգ)/u
// The terminal's figures: «price x qty unit = sum դրամ»; OCR reads «=» as «-», «x» as «х» or «:».
const TERMINAL_SUM = /[-=—–]\s*(\d+(?:[.,]\d+| \d{2})?)\s*դր/u
const TERMINAL_TIMES = /(\d+(?:[.,]\d+| \d{2})?)\s*[xх×*:]\s*(\d+(?:[.,]\d+| \d)?)\s*(\S*)\s*$/u

interface ClassFigures {
  readonly qtyS: string | null
  readonly priceS: string | null
  readonly sumS: string
  readonly weighed: boolean
  // the terminal prints its sum with two decimals always, its count with one
  readonly terminal: boolean
  // the row's own letters: «16 Թև 1հատ 3931.91 3931.91» names its item on the same row
  readonly words: string
}

const ARMENIAN = /[Ա-և]/u

// «688 09» is 688.09 whose point OCR read as a space.
const pointed = (text: string): string => text.replace(/^(\d+) (\d{1,2})$/, '$1.$2')

// A figure whose decimal point OCR lost: «393191» for 3931.91, «10» for 1.0.
function unpointed(text: string, places: number): string[] {
  return /^\d+$/.test(text) && text.length > places
    ? [`${text.slice(0, -places)}.${text.slice(-places)}`]
    : []
}

// The words of a name on a row: a number before a word stays — a count «16 Թև», a volume «1000 մլ» —
// figures and units of the till go.
function wordsOf(text: string): string {
  const tokens = text
    .replace(/(?:հ\S?տ|կգ|դրամ|դրա)(?=\s|$)/gu, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/^[^\p{L}\d]+|[^\p{L}\d]+$/gu, ''))
  const kept = tokens.filter(
    (w, i) =>
      (w.match(/\p{L}/gu) ?? []).length >= 2 ||
      (/^\d{1,4}(?:[.,]\d+)?$/.test(w) && /\p{L}/u.test(tokens[i + 1] ?? '')) ||
      (/^[լգ]$/u.test(w) && /^\d/.test(tokens[i - 1] ?? '')),
  )
  return kept.join(' ')
}

// OCR reads smudges as Latin or Cyrillic («Ստրիպս Thuin ‘Al»): in a name with Armenian words, a word
// with no Armenian letter is dropped.
const nameOf = (parts: readonly string[]): string => {
  const words = parts
    .join(' ')
    .split(' ')
    .filter((w) => w !== '')
  const armenian = words.filter((w) => !/\p{L}/u.test(w) || ARMENIAN.test(w))
  return (armenian.some((w) => ARMENIAN.test(w)) ? armenian : words).join(' ')
}

function classFigures(row: string): ClassFigures | null {
  const sum = TERMINAL_SUM.exec(row)
  if (sum?.[1] !== undefined) {
    const left = row.slice(0, sum.index).replace(/\s*(?:հ\S{1,2}|կգ)\s*$/u, '')
    const times = TERMINAL_TIMES.exec(left)
    return {
      qtyS: times?.[2] === undefined ? null : pointed(times[2]),
      priceS: times?.[1] === undefined ? null : pointed(times[1]),
      sumS: pointed(sum[1]),
      weighed: row.slice(0, sum.index).includes('կգ'),
      terminal: true,
      words: wordsOf(row.slice(0, times?.index ?? sum.index)),
    }
  }
  const unit = CLASS_UNIT.exec(row)
  const tail = unit === null ? row : row.slice(unit.index + unit[0].length)
  const numbers = tail.match(/(?<![\p{L}\d])\d+(?:[.,]\d+)?(?![\p{L}\d])/gu) ?? []
  // with no unit read, a row of figures is one that ends in two amounts: «624.44 624.41»
  if (unit === null && !/\d[.,]?\d*\s+\d[\d.,]*\s*$/.test(row)) return null
  const sumS = numbers.at(-1)
  if (sumS === undefined) return null
  return {
    qtyS: unit?.[1] ?? null,
    priceS: numbers.length > 1 ? (numbers.at(-2) ?? null) : null,
    sumS,
    weighed: unit?.[2] === 'կգ',
    terminal: false,
    words: wordsOf(unit === null ? row.replace(/[\d\s.,]+$/, '') : row.slice(0, unit.index)),
  }
}

// Every reading of a line's figures that holds quantity × price = sum, as the card's are found; a
// figure whose point OCR lost costs one swap more. A line whose price nobody read takes the sum
// alone, which `guessed` marks: it says nothing of the line's arithmetic.
function classCandidates(budget: Budget, f: ClassFigures, guessed: Set<Candidate>): Candidate[] {
  // each figure as read, then with its point put back; the terminal's sum has its two decimals always
  const read = (text: string, places: number, free: boolean): { text: string; cost: number }[] => [
    ...(free && unpointed(text, places).length > 0 ? [] : [{ text, cost: 0 }]),
    ...unpointed(text, places).map((t) => ({ text: t, cost: free ? 0 : 1 })),
  ]
  const sums = read(f.sumS, 2, f.terminal)
  const prices = f.priceS === null ? [] : read(f.priceS, 2, false)
  const qtys =
    f.qtyS === null
      ? Array.from({ length: 20 }, (_, q) => ({ text: String(q + 1), cost: 0 }))
      : read(f.qtyS, f.weighed ? 3 : 1, false).filter((q) => f.terminal || q.cost === 0)
  const out: Candidate[] = []
  for (const sum of sums) {
    for (const price of prices) {
      for (const qty of qtys) {
        for (const x of candidates(budget, qty.text, sum.text, '0', price.text)) {
          out.push({ ...x, swaps: x.swaps + sum.cost + price.cost + qty.cost })
        }
      }
    }
  }
  // no price read, or none that fits: the sum alone, at the count read — a line, not its arithmetic
  const sum = sums[0]
  if (out.length === 0 && sum !== undefined && (f.priceS === null || f.terminal)) {
    const qty = f.qtyS === null ? 1000 : milliOf(qtys[qtys.length - 1]?.text ?? f.qtyS)
    const paid = hundredthsOf(sum.text)
    if (Number.isFinite(paid) && paid > 0 && qty > 0) {
      const sole = { qty, paid, disc: 0, price: Math.round((paid * 1000) / qty), swaps: 2, rate: 0 }
      guessed.add(sole)
      out.push(sole)
    }
  }
  return out
}

// How far above the first code the figures of an item whose code row OCR lost are looked for.
const CLASS_LOOKBACK = 3

interface ClassAnchor {
  readonly hs: string
  readonly sku: string | null
  readonly rest: string
}

/** The rows as the class reading reads them, how it finds a code, and where its list begins. */
function classList(rows: readonly TextRow[]): {
  mapped: string[]
  anchorOf: (row: string) => ClassAnchor | null
  start: number
} {
  const mapped = rows.map((r) => r.text.replace(/[ՅЗбОOo](?=[\d,.])/g, (c) => DIGIT_LIKE[c] ?? c))
  // a class of services read with its point anywhere on the receipt is the receipt's: «5610» and
  // «56 10» on the other rows are it, and so is a row whose «Դաս» OCR lost
  const services = new Set(
    mapped.flatMap((row) => {
      const mark = CLASS_MARK.exec(row)
      return mark !== null && /\d{2}[.,]\d{2}/.test(mark[0])
        ? [`${mark[1] ?? ''}${mark[2] ?? ''}`]
        : []
    }),
  )
  const anchorOf = (row: string): ClassAnchor | null => {
    let mark: RegExpExecArray | null = CLASS_MARK.exec(row)
    if (mark === null) {
      for (const service of services) {
        const loose = new RegExp(
          `^[^\\d]{0,12}?(${service.slice(0, 2)})\\s?[.,]?\\s?(${service.slice(2)})${CLASS_TAIL}`,
          'u',
        ).exec(row)
        if (loose !== null) mark = loose
      }
    }
    if (mark === null) return null
    const digits = `${mark[1] ?? ''}${mark[2] ?? ''}`
    const after = row.slice(mark.index + mark[0].length)
    const article = CLASS_ARTICLE.exec(after)
    return {
      hs: services.has(digits) ? `${digits.slice(0, 2)}.${digits.slice(2)}` : digits,
      sku: article?.[1] ?? null,
      rest: article === null ? after : after.slice(article.index + article[0].length),
    }
  }
  // The list begins at the first code — or at the item above it whose code row OCR lost whole (review
  // А2): its figures, with a unit or the terminal's sum, within three rows of names over the code.
  let start = mapped.findIndex((row) => anchorOf(row) !== null)
  for (let i = start - 1, seen = 0; start > 0 && i >= 0 && seen < CLASS_LOOKBACK; i--) {
    const row = mapped[i] ?? ''
    if (row.trim() === '') continue
    seen += 1
    const figures = classFigures(row)
    if (figures !== null && (figures.terminal || CLASS_UNIT.test(row))) {
      start = i
      // the terminal prints the name over its figures: the name rows right above them are the item's,
      // or the dish is left nameless and its name is read as the head (review 2, Б1) — rows with no
      // digit but a count before the name, at most two
      for (let j = i - 1, names = 0; j >= 0 && names < 2; j--) {
        const above = mapped[j] ?? ''
        if (above.trim() === '') continue
        if (wordsOf(above) === '' || /\d/.test(above.replace(/^\s*\d{1,3}\s+(?=\p{L})/u, ''))) break
        start = j
        names += 1
      }
      break
    }
  }
  return { mapped, anchorOf, start }
}

/** Where a fiscal till's list of items begins: its first class code, or -1 (MOL-226). */
export function classListStart(rows: readonly TextRow[]): number {
  return classList(rows).start
}

function classReceipt(rows: readonly TextRow[]): ReceiptText {
  const text = rows.map((r) => r.text).join('\n')
  const { mapped, anchorOf, start: first } = classList(rows)
  const end = first < 0 ? -1 : mapped.findIndex((row, i) => i > first && CLASS_END.test(row))
  const list = first < 0 ? [] : mapped.slice(first, end < 0 ? undefined : end)
  type Kind =
    | { kind: 'anchor'; hs: string; sku: string | null; figures: ClassFigures | null }
    | { kind: 'figures'; figures: ClassFigures }
    | { kind: 'name'; words: string }
    | { kind: 'other' }
  const kinds = list.map((row): Kind => {
    const anchor = anchorOf(row)
    if (anchor !== null) return { kind: 'anchor', ...anchor, figures: classFigures(anchor.rest) }
    const figures = classFigures(row)
    if (figures !== null) return { kind: 'figures', figures }
    const words = wordsOf(row)
    // an article or a code is no name: «Ан Ц 56. յ wit 70211»
    return words !== '' && !/\d{5}/.test(row) ? { kind: 'name', words } : { kind: 'other' }
  })

  interface Item {
    readonly at: number
    readonly hs: string | null
    readonly sku: string | null
    readonly figures: ClassFigures
    readonly anchored: number | null
  }
  const items: Item[] = []
  let anchor: { at: number; hs: string; sku: string | null } | null = null
  for (const [at, k] of kinds.entries()) {
    if (k.kind === 'anchor') anchor = { at, hs: k.hs, sku: k.sku }
    const figures = k.kind === 'anchor' ? k.figures : k.kind === 'figures' ? k.figures : null
    if (figures === null) continue
    items.push({
      at,
      hs: anchor?.hs ?? null,
      sku: anchor?.sku ?? null,
      figures,
      anchored: anchor?.at ?? null,
    })
    anchor = null
  }
  // a line whose code OCR lost is of the receipt's class where every code read is one class of
  // services: a dish of KFC is no product for the matcher because one row of it was smudged (А1b)
  const classes = new Set(items.flatMap((item) => (item.hs === null ? [] : [item.hs])))
  const [sole] = classes
  const lostHs = classes.size === 1 && sole?.includes('.') ? sole : null
  const namesBetween = (from: number, to: number): string[] =>
    kinds.slice(from, to).flatMap((k) => (k.kind === 'name' ? [k.words] : []))
  // the side the names stand on: the terminal's between the code and the figures, the till's under
  const above = items.filter(
    (item) =>
      item.anchored !== null &&
      item.anchored < item.at &&
      namesBetween(item.anchored + 1, item.at).length > 0,
  ).length
  const nameAbove = above * 2 > items.filter((item) => item.anchored !== null).length
  const names = items.map((item, i) => {
    const own = ARMENIAN.test(item.figures.words) ? [item.figures.words] : []
    if (nameAbove) {
      const from = item.anchored ?? items[i - 1]?.at ?? -1
      return [...namesBetween(from + 1, item.at), ...own]
    }
    const next = items[i + 1]?.at ?? kinds.length
    const below: string[] = []
    for (const k of kinds.slice(item.at + 1, next)) {
      if (k.kind !== 'name' || below.length === 2) break
      below.push(k.words)
    }
    return [...own, ...below]
  })

  const printedTotal = CLASS_TOTAL.exec(text)?.[1]
  const total = printedTotal === undefined ? null : hundredthsOf(printedTotal)
  const budget: Budget = { left: READING_COMBINATIONS_MAX, floors: FLOOR_COMBINATIONS_MAX }
  const guessed = new Set<Candidate>()
  const { picks, balanced, blankSum, doubt } = judged(
    items.map((item) => classCandidates(budget, item.figures, guessed)),
    total,
    items.map((item) => item.figures.sumS.replace(/\D/g, '')),
  )
  const lines = items.map((item, i): ReceiptTextLine => {
    const pick = picks[i] ?? null
    const f = item.figures
    const sumAsRead = f.terminal ? (unpointed(f.sumS, 2)[0] ?? f.sumS) : f.sumS
    return {
      printed: nameOf(names[i] ?? []),
      hs: item.hs ?? lostHs,
      sku: item.sku,
      quantityMilli: finite(pick?.qty ?? (f.qtyS === null ? 1000 : milliOf(f.qtyS))),
      unit: f.weighed ? 'kg' : 'piece',
      priceHundredths: finite(pick?.price ?? (f.priceS === null ? null : hundredthsOf(f.priceS))),
      sumHundredths: finite(pick?.paid ?? blankSum ?? hundredthsOf(sumAsRead)),
      discountHundredths: 0,
      settled: pick !== null && !guessed.has(pick) && !doubt.has(i),
      rows: [rows[first + item.at]].filter((row): row is TextRow => row !== undefined),
    }
  })
  return {
    layout: 'class',
    tin: /ՀՎՀՀ\S{0,2}\s*(\d{8})(?!\d)/.exec(text)?.[1] ?? null,
    ...dateOf(text),
    receiptNo: /Ֆիսկալ\S*(?:\s+\S*համար\S*)?\s+(\d{6,})/.exec(text)?.[1] ?? null,
    totalHundredths: total,
    balanced,
    lines,
  }
}

/** One reading of a receipt — the rows of its parts, joined — into lines with figures. */
export function parseReceiptText(rows: readonly TextRow[]): ReceiptText {
  return withTwins(readingOf(rows))
}

/**
 * An item read twice at a seam, its article one swap of OCR off, is a line of its own the total cannot
 * see (review Р27): two lines of one sum whose articles are so close are both a look away. Marked after
 * the reading is chosen, never in the choice: it says nothing of how well a reading read (am-13 on the
 * bench lost four right lines to a reading chosen so).
 */
function withTwins(read: ReceiptText): ReceiptText {
  // only across a seam: in one photo an item has nowhere to be read twice, and two flavours of one
  // price numbered …5 and …6 are two items read right (review Р28)
  const parts = (line: ReceiptTextLine) => new Set(line.rows.map((row) => row.part))
  const apart = (a: ReceiptTextLine, b: ReceiptTextLine) => {
    const theirs = parts(b)
    return [...parts(a)].some((part) => !theirs.has(part))
  }
  const twin = (line: ReceiptTextLine) =>
    read.lines.some(
      (other) =>
        other !== line &&
        apart(line, other) &&
        line.sku !== null &&
        other.sku !== null &&
        line.sku !== other.sku &&
        near(line.sku, other.sku) &&
        line.sumHundredths !== null &&
        other.sumHundredths === line.sumHundredths,
    )
  if (!read.lines.some(twin)) return read
  return {
    ...read,
    lines: read.lines.map((line) => (twin(line) ? { ...line, settled: false } : line)),
  }
}

function readingOf(rows: readonly TextRow[]): ReceiptText {
  const card = cardReceipt(rows)
  const text = rows.map((r) => r.text).join('\n')
  let read = card
  if (/\(\d{4}\)/.test(text)) {
    const table = tableLines(rows)
    if (table.lines.length > card.lines.length) read = tableReceipt(rows, table)
  }
  // the class code reads a till neither layout knows; where one of them reads, it keeps the receipt
  const coded = classReceipt(rows)
  return coded.lines.length > read.lines.length ? coded : read
}

/** The rows of a part's text, numbered as the reader numbered them. */
export function rowsOf(text: string, part: number): TextRow[] {
  return text.split('\n').map((line, index) => ({ text: line, part, line: index }))
}

// A long receipt comes in parts shot with an overlap (MOL-124 В-1). The seam is found by the till's
// articles: the last article of the text so far that the next part also has (exactly, else with one
// digit off — OCR), and the next part is taken from the row after it. A seam must be one an overlap
// can make (review Р7–Р9): the next part starts inside the text so far, so it holds no more articles
// before the seam than the text so far does; and what the text so far holds after the seam is in the
// next part after it too. Another item's near article, or the first of two bags, makes no such seam.
// No seam — an overlap of a name row only — joins the parts, dropping the rows both of them hold.
const ARTICLE = /\d{4}\s*\/\s*(\d{5,})/

/** Two figures one digit OCR confuses apart (5↔6, 1↔4, 3↔8, 0↔9) — not the same figure. */
export function ocrSwapApart(a: string, b: string): boolean {
  return a !== b && near(a, b)
}

// One digit off the way OCR misreads this font (5 for 6, 1 for 4, 3 for 8, 0 for 9) — not any
// digit: a till numbers one maker's line in a row, and 1160033 and 1160036 are two flavours of one
// yoghurt, not one article read twice (review Р23).
function near(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let off = -1
  for (let i = 0; i < a.length; i++) {
    if (a.charAt(i) === b.charAt(i)) continue
    if (off >= 0) return false
    off = i
  }
  return off < 0 || CONFUSED[a.charAt(off)] === b.charAt(off)
}
const articleOf = (row: TextRow): string => ARTICLE.exec(row.text)?.[1] ?? ''

interface Article {
  readonly article: string
  readonly at: number
}

function articlesOf(rows: readonly TextRow[]): Article[] {
  return rows.flatMap((row, at) => {
    const article = articleOf(row)
    return article === '' ? [] : [{ article, at }]
  })
}

// How alike two rows read: 1 for the same text, 0 for nothing in common (Levenshtein over the longer).
// Only the start of a row counts (review Р22): a row of a thousand letters — a picture read as text —
// made one seam cost seconds, and a till's row is under a hundred.
const LIKENESS_CHARS = 80

export function likeness(a: string, b: string): number {
  const x = a.replace(/\s+/g, '').slice(0, LIKENESS_CHARS)
  const y = b.replace(/\s+/g, '').slice(0, LIKENESS_CHARS)
  if (x === '' || y === '') return 0
  let previous = Array.from({ length: y.length + 1 }, (_, k) => k)
  for (let i = 1; i <= x.length; i++) {
    const current = [i]
    for (let k = 1; k <= y.length; k++) {
      current[k] = Math.min(
        (previous[k] ?? 0) + 1,
        (current[k - 1] ?? 0) + 1,
        (previous[k - 1] ?? 0) + (x.charAt(i - 1) === y.charAt(k - 1) ? 0 : 1),
      )
    }
    previous = current
  }
  return 1 - (previous[y.length] ?? 0) / Math.max(x.length, y.length)
}

// The rows of an overlap read twice look alike even where OCR read one of them worse.
const ALIKE = 0.7

const NUMBER = /^\s*(\d{1,2})(?!\d)\s*[.,]?\s*\p{L}/u

/**
 * Two rows the overlap could hold twice: read alike, and not two items — not two numbers of the list,
 * not two articles (review Р23, Р25). Two flavours of one yoghurt read alike letter for letter,
 * «8.Յոգուրտ … դեղձ» and «9.Յոգուրտ … ելակ», and their articles may be one swap of OCR apart,
 * 1160035 and 1160036: an article read wrong is told by the name above it, never by its digits.
 */
function sameRow(a: string, b: string): boolean {
  const [na, nb] = [NUMBER.exec(a)?.[1], NUMBER.exec(b)?.[1]]
  if (na !== undefined && nb !== undefined && na !== nb) return false
  const [aa, ab] = [ARTICLE.exec(a)?.[1], ARTICLE.exec(b)?.[1]]
  if (aa !== undefined && ab !== undefined && aa !== ab) return false
  return likeness(a, b) >= ALIKE
}

// Two articles one could be the other misread: two digits off at most, each by a swap OCR makes.
function misread(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  const off = Array.from(a).flatMap((c, i) => (c === b.charAt(i) ? [] : [[c, b.charAt(i)]]))
  return off.length <= 2 && off.every(([x, y]) => CONFUSED[x ?? ''] === y)
}

// The name above an article, as one row and as two — OCR splits a long one (review Р21), and its upper
// row then starts with the item's number: none where the row above is blank, another article or not
// there. A cut row of figures above a name is not its first half (review Р25).
function namesAbove(rows: readonly TextRow[], at: number): string[] {
  const isName = (text: string) => text.trim() !== '' && !ARTICLE.test(text)
  const [one, two] = [rows[at - 1]?.text ?? '', rows[at - 2]?.text ?? '']
  if (!isName(one)) return []
  return isName(two) && NUMBER.test(two) && !NUMBER.test(one) ? [one, `${two} ${one}`] : [one]
}

/**
 * Two articles misread one for the other stand under one item's name. Neighbours of one maker's line
 * are numbered in a row, and one pair in ten of them — 1160035 and 1160036 — differs by a swap OCR
 * makes (review Р25): the digits alone cannot tell them, the names can. A name on one side only is no
 * agreement: the top edge of a part cuts between an item's name and its figures as often as anywhere,
 * and the strawberry yoghurt was lost there (review Р26). An item read twice with no name to agree is
 * left to show as twice, unbalanced, rather than an item lost behind a balanced total. Only a till that
 * prints no name above its articles at all leaves the digits to decide.
 */
function namesAgree(rows: readonly TextRow[], at: number, next: readonly TextRow[], to: number) {
  const [mine, theirs] = [namesAbove(rows, at), namesAbove(next, to)]
  if (mine.length === 0 && theirs.length === 0) return true
  return mine.some((x) => theirs.some((y) => sameRow(x, y)))
}

/** How many rows of either part an overlap is looked for in: an overlap is a few items, not a page. */
const OVERLAP_ROWS = 16
/**
 * Rows at the next part's top edge that may precede the overlap, and at the first part's foot that may
 * follow it: a cut row, a blank, a smudge.
 */
const OVERLAP_LEAD = 3

interface Seam {
  readonly mine: number
  readonly theirs: number
}

/** The strict seam: by the till's articles, as above; one swap of OCR off only under one name. */
function articleSeam(
  rows: readonly TextRow[],
  next: readonly TextRow[],
  exactOnly: boolean,
): Seam | null {
  const mine = articlesOf(rows)
  const theirs = articlesOf(next)
  const twin = (a: Article, b: Article) =>
    a.article === b.article || (near(a.article, b.article) && namesAgree(rows, a.at, next, b.at))
  for (let i = mine.length - 1; i >= 0; i--) {
    const a = mine[i]
    if (a === undefined) continue
    const j = theirs.findIndex((b) => (exactOnly ? a.article === b.article : twin(a, b)))
    const b = theirs[j]
    if (b === undefined || j > i) continue
    const later = theirs.slice(j + 1)
    const kept = mine.slice(i + 1).every((m) => later.some((t) => twin(m, t)))
    if (kept) return { mine: a.at, theirs: b.at }
  }
  return null
}

/**
 * The overlap where an article does not show it — read worse in the next part: an article two digits
 * off, figures cut at its top edge, a name lost or split, a row cut through at the first part's foot
 * (review Р17, Р21, 9, Р23). The first part's last rows and the next part's first are aligned, row for
 * row in order (`sameRow`), the longest alignment that starts near the next part's top: the next part
 * goes on after the last row aligned, and the first part keeps its own reading of the overlap.
 */
function alignedSeam(rows: readonly TextRow[], next: readonly TextRow[]): number | null {
  const tail = rows.flatMap((row, at) => (row.text.trim() === '' ? [] : [at])).slice(-OVERLAP_ROWS)
  const head = next
    .flatMap((row, at) => (row.text.trim() === '' ? [] : [at]))
    .slice(0, OVERLAP_ROWS)
  const mineText = (i: number) => rows[tail[i] ?? 0]?.text ?? ''
  const theirText = (j: number) => next[head[j] ?? 0]?.text ?? ''
  // rows read alike — an article misread only under one name, or, where one part lost the name, right
  // after the rows aligned above it (review Р21, Р26); and the figures right below an item's name read
  // alike in both are that item's, whatever article OCR made of them there
  const alike: boolean[][] = []
  const aligned = (i: number, j: number) => alike[i]?.[j] === true
  const placed = (i: number, j: number) => {
    const mineNamed = namesAbove(rows, tail[i] ?? 0).length > 0
    const theirNamed = namesAbove(next, head[j] ?? 0).length > 0
    if (mineNamed && !theirNamed) return aligned(i - 2, j - 1) || aligned(i - 3, j - 1)
    if (!mineNamed && theirNamed) return aligned(i - 1, j - 2) || aligned(i - 1, j - 3)
    return false
  }
  for (let i = 0; i < tail.length; i++) {
    const row: boolean[] = []
    alike.push(row)
    for (let j = 0; j < head.length; j++) {
      const [a, b] = [ARTICLE.exec(mineText(i))?.[1], ARTICLE.exec(theirText(j))?.[1]]
      const misreadOne =
        a !== undefined &&
        b !== undefined &&
        a !== b &&
        misread(a, b) &&
        (namesAgree(rows, tail[i] ?? 0, next, head[j] ?? 0) || placed(i, j))
      const unarticled = mineText(i).replace(ARTICLE, '')
      const theirs = theirText(j).replace(ARTICLE, '')
      const named =
        i > 0 && j > 0 && NUMBER.test(mineText(i - 1)) && sameRow(mineText(i - 1), theirText(j - 1))
      row.push(
        (misreadOne && likeness(unarticled, theirs) >= ALIKE) ||
          sameRow(mineText(i), theirText(j)) ||
          (named && a !== undefined && b !== undefined),
      )
    }
  }
  // the longest common run, in order, by rows read alike
  const best = Array.from({ length: tail.length + 1 }, () =>
    Array.from({ length: head.length + 1 }, () => 0),
  )
  for (let i = tail.length - 1; i >= 0; i--) {
    const row = best[i] ?? []
    for (let j = head.length - 1; j >= 0; j--) {
      row[j] = aligned(i, j)
        ? 1 + (best[i + 1]?.[j + 1] ?? 0)
        : Math.max(best[i + 1]?.[j] ?? 0, row[j + 1] ?? 0)
    }
  }
  // walk it, and keep where the next part's rows were last aligned
  let [i, j, first, last, mineLast] = [0, 0, -1, -1, -1]
  while (i < tail.length && j < head.length) {
    if (aligned(i, j)) {
      if (first < 0) first = j
      last = j
      mineLast = i
      i++
      j++
    } else if ((best[i + 1]?.[j] ?? 0) >= (best[i]?.[j + 1] ?? 0)) i++
    else j++
  }
  // the overlap is the first part's foot and the next part's top, or it is no overlap but rows alike
  // in the middle — a rule under the head and a rule above the total (review 11)
  if (last < 0 || first > OVERLAP_LEAD || tail.length - 1 - mineLast > OVERLAP_LEAD) return null
  return head[last] ?? null
}

export function mergeParts(parts: readonly (readonly TextRow[])[]): TextRow[] {
  let rows = [...(parts[0] ?? [])]
  for (const next of parts.slice(1)) {
    const seam = articleSeam(rows, next, true) ?? articleSeam(rows, next, false)
    if (seam !== null) {
      rows = [...rows.slice(0, seam.mine + 1), ...next.slice(seam.theirs + 1)]
      continue
    }
    const aligned = alignedSeam(rows, next)
    rows = [...rows, ...next.slice(aligned === null ? 0 : aligned + 1)]
  }
  return rows
}

/**
 * The receipt from its readings — Tesseract in two page modes, each with the parts merged: the
 * reading whose lines add up, else the one with more lines settled. The receipt's own arithmetic is
 * the judge; no truth is needed.
 */
export function bestReading(readings: readonly (readonly TextRow[])[]): ReceiptText {
  const parsed = readings.map(readingOf)
  const settledCount = (r: ReceiptText): number => r.lines.filter((l) => l.settled).length
  const sorted = [...parsed].sort(
    (a, b) => Number(b.balanced) - Number(a.balanced) || settledCount(b) - settledCount(a),
  )
  const best = sorted[0]
  if (best === undefined) throw new RangeError('a receipt needs at least one reading')
  return withTwins(best)
}
