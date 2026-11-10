// MOL-272 — a receipt read by a model (Claude Haiku) into the parse's own `ReceiptText`, so that every
// rule after it is the one Tesseract's reading goes through: `verifiedReading`, `readPartly`, the lines'
// items, the wire. The model copies what is printed, every number of a line in its place and every amount
// of the summary with its word (MOL-268, «Дальше»); which amount is the total is decided here, by the
// country's card, never by the model.

import { cardRate, rememberedLines } from '#model/entities/receipt-remembered'
import type { RememberedPrices } from '#model/entities/receipt-remembered'
import {
  DEPARTMENT,
  TOLERANCE_HUNDREDTHS,
  linesTotalHundredths,
  paidByOf,
  printedDayOf,
} from '#model/entities/receipt-text'
import type { ReceiptPaidBy } from '#model/entities/receipt'
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
  // no ceiling of rows: they give only the key, and a bank slip under the receipt, rows of its own, never throws
  // the paid reading away (adversarial А7); the output's cap bounds them, and two fiscal numbers are no key
  id_rows: z.array(z.string().max(300)),
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

// thousands grouped by a space as printed, a no-break or a narrow one: «1 000,00», «19 097.86»
const GROUPED = /^\d{1,3}(?:[ \u00a0\u202f]\d{3})+(?:[.,]\d+)?$/u

/**
 * A figure as the model wrote it in the one form `figureOf` reads (MOL-294): thousands grouped by spaces,
 * a comma for the point where it is the only one and no point stands («0,50»), and a minus before a
 * discount — its size, «-0.50» for 0,50 off. A minus before anything else is no figure: a negative sum or
 * total is a refund, never a purchase. Anything else is left as written, and stays no figure.
 */
function canonicalFigure(value: string | null, signed: boolean): string | null {
  if (value === null) return null
  let text = value.trim()
  if (signed) text = text.replace(/^[-−]\s*/u, '')
  if (GROUPED.test(text)) text = text.replace(/[ \u00a0\u202f]/gu, '')
  if (/^\d+,\d+$/u.test(text)) text = text.replace(',', '.')
  return /^\d{1,9}(?:\.\d+)?$/u.test(text) ? text : value
}

/**
 * The answer with its figures in the one form, and how many of them are still no figure of their kind — a
 * count for the log, never the figures (Т-8): the next spelling we do not read shows there, not by a guess.
 */
function canonicalAnswer(
  reading: PhotoReading,
  answer: ModelReceipt,
): { answer: ModelReceipt; unparsed: number } {
  let unparsed = 0
  const one = (value: string | null, digits: number, signed = false): string | null => {
    const figure = canonicalFigure(value, signed)
    if (figure !== null && figureOf(figure, digits) === null) unparsed += 1
    return figure
  }
  const discount = new RegExp(`(?:${reading.words.discountKept})`, 'u')
  const lines = answer.lines.map((line) => ({
    ...line,
    quantity: one(line.quantity, 3),
    unit_price: one(line.unit_price, 2),
    discount: one(line.discount, 2, true),
    sum: one(line.sum, 2),
  }))
  const totals = answer.totals.map(({ label, amount }) => ({
    label,
    amount: one(amount, 2, discount.test(label)) ?? amount,
  }))
  return { answer: { ...answer, lines, totals }, unparsed }
}

/** How many of the model's figures no rule reads (MOL-294): the count the log of a reading carries. */
export const unparsedFigures = (reading: PhotoReading, answer: ModelReceipt): number =>
  canonicalAnswer(reading, answer).unparsed

/** The class code of a line as the parse keeps it: a heading of four digits, a service class «56.10». */
function classOf(code: string | null): string | null {
  return /(?<![\d.])(\d{2}\.\d{2}|\d{4})(?![\d.])/.exec(code ?? '')?.[1] ?? null
}

const articleOf = (article: string | null): string | null => {
  const trimmed = article?.trim() ?? ''
  return /^[\p{L}\d_./-]{1,40}$/u.test(trimmed) ? trimmed : null
}

// a time with its seconds is its minutes (MOL-305): «23:49:53» is 23:49, never none
const clockOf = (time: string | null): string | null => {
  const [, hour = '', minute = ''] = /^(\d{2}):(\d{2})(?::[0-5]\d)?$/.exec(time?.trim() ?? '') ?? []
  return hour !== '' && Number(hour) < 24 && Number(minute) < 60 ? `${hour}:${minute}` : null
}

/**
 * Every number of eight digits the rows the model copied print after a word of the card. The model copies the
 * rows with their labels and never says which number is which (review №10, adversarial А6): asked for the tax
 * number, it gave «Ереван Сити»'s till registration «ԳՀ» printed under it, and the shop's tax number as the
 * fiscal one — the key of every receipt of that till, and the next one «recorded before».
 */
function labelled(answer: ModelReceipt, word: string, between: string): string[] {
  const pattern = new RegExp(`(?:${word})${between}(?<!\\d)(\\d{8})(?!\\d)`, 'giu')
  return answer.id_rows.flatMap((row) => [...row.matchAll(pattern)].map((found) => found[1] ?? ''))
}

/** The one number of them, or none — two tax numbers are two sellers. */
const oneOf = (numbers: string[]): string | null =>
  numbers.length > 0 && numbers.every((number) => number === numbers[0])
    ? (numbers[0] ?? null)
    : null

/** How many times the rows print a number, under whatever label. */
const timesPrinted = (answer: ModelReceipt, number: string): number =>
  answer.id_rows.flatMap((row) => row.match(new RegExp(`(?<!\\d)${number}(?!\\d)`, 'g')) ?? [])
    .length

/**
 * The seller's tax number and the receipt's number, the key against a second record (Т-11), in Tesseract's
 * form and by its words — or one paper read by the two readers is two keys and recorded twice (adversarial
 * А5, А6): the eight digits after «ՀՎՀՀ», and the fiscal number, eight digits after «Ֆիսկալ», leading zeros
 * kept. **Never «ԿՀ»**: a till's own count, repeated by the shop's other tills. **Never a number the rows
 * print under another label too** — the shop's tax number, the till's registration: the same on every
 * receipt of the till, and every one after the first «recorded before» (adversarial А6, round 4). The tax
 * number keeps no such guard: it is the same on every receipt anyway, and the bench's one number under two
 * labels was the tax number under «ՀՎՀՀ» and «ՀԴՄ» both, right. Two fiscal numbers are a pair (MOL-293);
 * three are none.
 */
function keyOf(
  reading: PhotoReading,
  answer: ModelReceipt,
): { tin: string | null; number: string | null } {
  const fiscals = labelled(answer, reading.words.fiscal, '\\S*(?:\\s+\\S*)?\\s*')
  const distinct = [...new Set(fiscals)].sort()
  // each under its own label alone: one printed under another too is a constant of the till (А6, round 4)
  const own = distinct.every(
    (fiscal) => timesPrinted(answer, fiscal) === fiscals.filter((one) => one === fiscal).length,
  )
  return {
    tin: oneOf(labelled(answer, reading.words.tin, '\\S{0,2}\\s*')),
    // a prepayment slip printed over «Ереван Сити»'s receipt has a fiscal number of its own, and the model
    // copies the two in either order: the pair is the paper's key, as either alone would be (MOL-293, В-3 «а»)
    number: !own || distinct.length === 0 || distinct.length > 2 ? null : distinct.join('+'),
  }
}

/**
 * A line as the model wrote it. Its figures are printed by the model's nature — it copies, the arithmetic
 * is ours — so a line is as printed exactly where it settles: quantity × price = sum + discount, to the
 * hundredth or, where the line itself prints a discount — a till that prints a shelf price apart from what
 * was paid — to that till's rounding. Never by another line's word: a «0» the model wrote under the bread
 * gave the milk's 3 × 130 its 389,97 (adversarial А4).
 */
function lineOf(line: ModelReceipt['lines'][number]): ReceiptTextLine {
  const quantityMilli = figureOf(line.quantity, 3)
  const priceHundredths = figureOf(line.unit_price, 2)
  const sumHundredths = figureOf(line.sum, 2)
  const discountHundredths = figureOf(line.discount, 2)
  const rounding = discountHundredths === null ? 0 : TOLERANCE_HUNDREDTHS
  // a bill that prints no price — «Блюдо, Кол-во, Сумма» (MOL-310) — has no arithmetic to hold: its quantity and
  // sum are as printed, and only a total they meet vouches for them (`verifiedReading`)
  const priceless =
    line.unit_price === null &&
    discountHundredths === null &&
    quantityMilli !== null &&
    sumHundredths !== null
  const settled =
    priceless ||
    (quantityMilli !== null &&
      priceHundredths !== null &&
      sumHundredths !== null &&
      Math.abs(
        Math.round((quantityMilli * priceHundredths) / 1_000) -
          (sumHundredths + (discountHundredths ?? 0)),
      ) <= rounding)
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
    read: { quantityMilli, priceHundredths, discountHundredths, sumHundredths },
    // no boxes: a model's lines are not cut out for the reader's training (MOL-272, Р-4)
    rows: [],
  }
}

/** What a label prints around its word: spaces, a colon, «=», a slash, a dash. */
const MARKS = '[\\s:=/-]*'

/**
 * A café's service by its word alone, a percent after it at most — «Service 10%», «Հավելավճար 10%:» (MOL-310): one
 * rule for a line and a summary's label, so «Итого с обслуживанием», a total that names the word, stays a total
 * (review №3, adversarial А4) and «Салат Service» a dish. In any case.
 */
const serviceWordOf = (reading: PhotoReading): RegExp =>
  new RegExp(
    `^${MARKS}(?:${reading.words.service})${MARKS}(?:\\(?\\d{1,2}(?:[.,]\\d+)?\\s*%\\)?)?${MARKS}$`,
    'iu',
  )

/** The percent a service's label or line prints beside its word — «Service 10%», «Հավելավճար (12,5%)» — or none. */
function servicePercentOf(text: string): number | null {
  const [, percent = ''] = /(\d{1,2}(?:[.,]\d+)?)\s*%/u.exec(text) ?? []
  return percent === '' ? null : Number(percent.replace(',', '.'))
}

/** A service amount as printed, with the percent printed beside it, if any (MOL-310). */
interface Served {
  readonly sum: number | null
  readonly percent: number | null
}

/**
 * A café's service the model copied as a line — «Service 10%  1.00  1950.00» (MOL-310). It is no dish: its sum goes
 * to the surcharge, and the line out of the lines — only where the surcharge is taken (`receiptTextOfModel`).
 */
function serviceApart(
  reading: PhotoReading,
  answer: ModelReceipt,
): { answer: ModelReceipt; served: Served[]; isService: readonly boolean[] } {
  const word = serviceWordOf(reading)
  // which of the model's lines are the service, marked once (review №16)
  const isService = answer.lines.map((line) => word.test(line.printed))
  const served = answer.lines.filter((_, i) => isService[i])
  if (served.length === 0) return { answer, served: [], isService }
  return {
    answer: { ...answer, lines: answer.lines.filter((_, i) => !isService[i]) },
    served: served.map((line) => ({
      sum: figureOf(line.sum, 2),
      percent: servicePercentOf(line.printed),
    })),
    isService,
  }
}

/**
 * How far a service may stand from the percent printed beside it (MOL-310): to the dram, as a till rounds it —
 * 10 % of 19 500 is 1 950, of 22 899,50 is 2 290.
 */
const SERVICE_PERCENT_ROUNDING_HUNDREDTHS = 50

/** What a till rounds a card's payment by: to the dram, «19 098,00» paid for 19 097,86. */
const PAYMENT_ROUNDING_HUNDREDTHS = 50

/** The one amount of them, or none — two are a doubt, not a choice. */
const sole = (amounts: ReadonlySet<number>): number | null =>
  amounts.size === 1 ? ([...amounts][0] ?? null) : null

/**
 * The card's discount the model copied under another word (MOL-310, Р-1): «Ереван Сити» prints it as the prepayment
 * slip over the receipt, «Կանխավճար … Ընդամենը 169,34», and again under the total — where the model wrote
 * «կանխավճարին ավել. մանր» or «Կանխավճար» for «Զեղչ գործարքից». The slip's sum is the cashback where a second
 * place vouches for it, as for the total (MOL-244): the same sum under another word, or a total less the sum taxed
 * with VAT («ԱԱՀ-ով հարկվող»). One place is none, and two sums so vouched are a doubt.
 */
function misnamedCashback(
  slips: ReadonlySet<number>,
  unnamed: ReadonlySet<number>,
  totals: readonly number[],
  taxed: ReadonlySet<number>,
): number | null {
  const vouched = [...slips].filter(
    (slip) =>
      unnamed.has(slip) ||
      totals.some((total) => total > slip && [...taxed].some((sum) => total - sum === slip)),
  )
  return vouched.length === 1 ? (vouched[0] ?? null) : null
}

/**
 * The total two places vouch for (MOL-244), as the parse's `votedTotal` decides it: the lines that met a
 * printed total every one as read, else the one amount at least two of the total, the payment and — on a
 * receipt with no items — the section printed. A prepayment («Կանխավճար») is none of them: the card's
 * payment words are a till's, and a prepayment slip printed above the receipt names its own total, which
 * meets neither the lines nor the payment.
 *
 * **A card that sends its discount to the card** (MOL-289, «Ереван Сити»): the lines are what was paid with
 * the discount, and the total «Ընդամենը:» is without it — what left the card, the trip's money (owner, В-5
 * «а») — the discount printed apart as «Զեղչ գործարքից». So the lines meet the total less it, and its second
 * place is the sum taxed with VAT, «ԱԱՀ-ով հարկվող»; else the total itself, where two places print it — the
 * total and a payment equal to it to the luma, as before (review round 1, А2). The total
 * under the list, 0,02 off the lines where the till rounds a price with its discount (am-39, am-44), is no
 * place of it. The bonus a receipt is partly paid with, «Կանխավճարի մարում», is kept only where the card's
 * payment is the total less it, to the dram — the total shown, else one printed — and the trip's money is then what
 * left the card.
 *
 * `owed` is what the lines must make for the font's swaps to put any right: the total, less what went to the card
 * only where a second place vouches for that difference — the lines or «ԱԱՀ-ով հարկվող» (review round 2, owner's Б1
 * «а»). The cashback is one figure the model copies with the same 5↔6, and the total vouched by itself and a payment
 * says nothing of it: 54,00 copied for 64,00 made water at 160 the one choice that met 6 550 less it.
 *
 * **A café's bill** (MOL-310): its total in words no fiscal till prints — «ՎՃԱՐՄԱՆ», «Всего», «Итого к оплате» — and a
 * service under the dishes, «Հավելավճար 10%», which the lines make the total less, as a cashback: the lines that meet
 * the total with it prove the bill whole, and the trip is the total. A total voted by two places with a service the
 * lines did not meet is shown with it, and the font's swaps put no line right under it.
 */
function totalOf(
  reading: PhotoReading,
  answer: ModelReceipt,
  lines: readonly ReceiptTextLine[],
  /**
   * The service's amounts the model copied as lines; `null` — the service was decided against already and its line
   * stays a line, so none is taken, by a label or a vote (review №9, adversarial В2, review №14).
   */
  served: readonly Served[] | null = [],
): {
  total: number | null
  read: number | null
  met: boolean
  owed: number | null
  cashback: number | null
  redeemed: number | null
  service: number | null
} {
  const w = reading.words
  const word = (fragment: string): RegExp => new RegExp(`(?:${fragment})`, 'u')
  // a café's words are printed in capitals as often as not, «ՎՃԱՐՄԱՆ» (MOL-310)
  const [service, bill] = [serviceWordOf(reading), new RegExp(`(?:${w.billTotal})`, 'iu')]
  const [total, discount, cashbacks, taxedSum, redemption] = [
    word(w.totalKept),
    word(w.discountKept),
    word(w.cashback),
    word(w.taxed),
    word(w.redeemed),
  ]
  // a sum since the start of the year is what a card bought this year (MOL-288): the largest the total's word
  // stands by, it was the total read — «Прочитали не всё» short by 120 000 ֏
  const sinceStart = word(w.sinceStart)
  const paid = word(w.paid.join('|'))
  const places = new Map<string, Set<number>>([
    ['total', new Set()],
    ['paid', new Set()],
    ['section', new Set()],
  ])
  const [sentToCard, taxed, spent] = [new Set<number>(), new Set<number>(), new Set<number>()]
  const surcharges = new Set((served ?? []).map((one) => one.sum))
  const percents = (served ?? []).flatMap((one) => (one.percent === null ? [] : [one.percent]))
  // what the card's words do not name, and the prepayment slip's own sum (MOL-310, Р-1)
  const prepaid = new RegExp(`^${MARKS}(?:${w.prepayment})${MARKS}$`, 'u')
  const [slips, unnamed] = [new Set<number>(), new Set<number>()]
  for (const { label, amount } of answer.totals) {
    const hundredths = figureOf(amount, 2)
    if (hundredths === null || hundredths <= 0) continue
    if (discount.test(label) && cashbacks.test(label)) sentToCard.add(hundredths)
    else if (redemption.test(label)) spent.add(hundredths)
    else if (taxedSum.test(label)) taxed.add(hundredths)
    else if (service.test(label)) {
      surcharges.add(hundredths)
      const percent = servicePercentOf(label)
      if (percent !== null) percents.push(percent)
    } else if (
      (total.test(label) || bill.test(label)) &&
      !discount.test(label) &&
      !sinceStart.test(label)
    )
      places.get('total')?.add(hundredths)
    else if (paid.test(label)) places.get('paid')?.add(hundredths)
    else if (lines.length === 0 && DEPARTMENT.test(label)) places.get('section')?.add(hundredths)
    else if (prepaid.test(label)) slips.add(hundredths)
    else unnamed.add(hundredths)
  }
  const totals = [...(places.get('total') ?? [])]
  // the largest the total's word stands by: a prepayment slip's total is smaller and the one before the
  // card's discount larger, so «Прочитали не всё» errs only towards being said (MOL-244)
  const read = totals.length === 0 ? null : Math.max(...totals)
  const cashback =
    sentToCard.size > 0 ? sole(sentToCard) : misnamedCashback(slips, unnamed, totals, taxed)
  const sum = lines.reduce((all, line) => all + (line.sumHundredths ?? 0), 0)
  const asPrinted = lines.length > 0 && lines.every((line) => line.asPrinted)
  const vote = (all: Iterable<ReadonlySet<number>>): number | null => {
    const votes = new Map<number, number>()
    for (const amounts of all) {
      for (const amount of amounts) votes.set(amount, (votes.get(amount) ?? 0) + 1)
    }
    const backed = [...votes].filter(([, n]) => n >= 2)
    const most = Math.max(0, ...backed.map(([, n]) => n))
    const voted = backed.filter(([, n]) => n === most)
    return voted.length === 1 ? (voted[0]?.[0] ?? null) : null
  }
  // a café's service, one amount read wherever it is printed (MOL-310); two, or one not read, are a doubt
  const fee = surcharges.size === 1 ? ([...surcharges][0] ?? null) : null
  // a percent printed beside the service is its second place, in either way the total is vouched for: the service is
  // that percent of the dishes, to the dram, or no service (adversarial Е1, Ж1); with none printed it stands as copied
  const percentHolds = (dishes: number, service: number): boolean =>
    percents.every(
      (percent) =>
        Math.abs((dishes * percent) / 100 - service) <= SERVICE_PERCENT_ROUNDING_HUNDREDTHS,
    )
  const surcharge = served !== null && fee !== null && fee > 0 ? fee : null
  if (cashback === null) {
    // the service counts only where the total takes it: a bill that prints it apart, «not included», meets its
    // total without it, and the trip is what was paid
    if (
      asPrinted &&
      surcharge !== null &&
      totals.includes(sum + surcharge) &&
      percentHolds(sum, surcharge)
    ) {
      return {
        total: sum + surcharge,
        read,
        met: true,
        owed: sum,
        cashback,
        redeemed: null,
        service: surcharge,
      }
    }
    const met = asPrinted && totals.includes(sum)
    if (met) return { total: sum, read, met, owed: sum, cashback, redeemed: null, service: null }
    // a total voted by its places took the service: every bill seen prints it so — ZERO, Bakery, Аракс (owner's В-7
    // «а», adversarial Б1) — so the lines make it less the service, the font's swaps putting them right to that
    const voted = vote(places.values())
    // the service alone is one figure the model may copy 5↔6: where a percent is printed beside it, that is its second
    // place — the percent of the dishes, to the dram (adversarial Е1); with none it stands as printed (В-7 «а»)
    const service =
      voted !== null &&
      surcharge !== null &&
      surcharge < voted &&
      percentHolds(voted - surcharge, surcharge)
        ? surcharge
        : null
    const owed =
      voted === null
        ? null
        : linesTotalHundredths({ cashbackHundredths: null, serviceHundredths: service }, voted)
    return { total: voted, read, met, owed, cashback, redeemed: null, service }
  }
  // what the lines make: a total less what went to the card
  const owed = new Set(totals.map((one) => one - cashback).filter((one) => one > 0))
  const met = asPrinted && owed.has(sum)
  const lined = met ? sum : vote([owed, taxed])
  // the total itself, two places printing it — a card's payment to the luma among them — vouches as before the
  // discount went to the card (review round 1, А2): «ԱԱՀ-ով հարկվող» misread alike lost a total master showed
  const shown =
    lined === null ? vote([new Set(totals), places.get('paid') ?? new Set()]) : lined + cashback
  const bonus = sole(spent)
  const payments = [...(places.get('paid') ?? [])]
  // the total less the bonus is what the card paid, to the dram: the total shown, else the one printed — a trip of
  // the lines and the cashback, no total vouched for, is the bonus less too (review round 6, Г5)
  const before = shown === null ? totals : [shown]
  const redeemed =
    bonus !== null &&
    before.some(
      (total) =>
        bonus < total &&
        payments.some((one) => Math.abs(total - bonus - one) <= PAYMENT_ROUNDING_HUNDREDTHS),
    )
      ? bonus
      : null
  // a card's discount and a café's service on one paper are no receipt seen: the cashback's rule alone
  return { total: shown, read, met, owed: lined, cashback, redeemed, service: null }
}

/** The most swaps in one figure: «550» copied as «660» is two (owner, В-2 of MOL-290). */
export const REPAIR_SWAPS_PER_FIGURE = 2

/**
 * Past this many readings of one line's quantity, price and discount the line is not put right, and nor is
 * its receipt; past `REPAIR_RECEIPT_COMBINATIONS_MAX` over a receipt, none is. A figure of nine digits all
 * fives and sixes reads 46 ways with two swaps, three of them 97 336 — and it runs in the API's process.
 * A line of the bench tries at most a few hundred.
 */
export const REPAIR_COMBINATIONS_MAX = 20_000
export const REPAIR_RECEIPT_COMBINATIONS_MAX = 200_000

/**
 * Past this many steps the total no longer chooses among the lines' readings, and the receipt is not put right:
 * a line read two or three ways is common, ten lines each read three ways are 59 049 ways at most.
 */
export const REPAIR_ASSIGNMENTS_MAX = 100_000

/**
 * Past this many ways the lines read whole as copied may read whole by the font's swaps too, the receipt is not put
 * right (review round 2, Б2): a line of one at 96 is one at 95 as well, and ten such lines are a thousand ways.
 */
export const REPAIR_SHIFTS_MAX = 4_096

/**
 * The work of the repair in this process — read by tests alone: a ceiling is held by the work it saves. `count`
 * the readings of lines tried, `walked` the figures read with the font's swaps, `chose` the steps of the total's
 * choice among them.
 */
export const repairTries = { count: 0, walked: 0, chose: 0 }

/** A figure as the model wrote it and each way the font's swaps read it, with how many each took. */
function readingsOf(
  swaps: Readonly<Record<string, string>>,
  value: string | null,
  digits: number,
): { value: number | null; swaps: number }[] {
  if (value === null) return [{ value: null, swaps: 0 }]
  // a digit swapped for a digit leaves a figure's form as it was: what is no number as copied is none in any
  // reading, and walking three hundred fives of junk took 0,4 s (review round 1, №1)
  if (figureOf(value, digits) === null) return []
  repairTries.walked += 1
  // a figure is digits and a point: a character is a code unit
  const at: number[] = []
  for (let i = 0; i < value.length; i += 1) if (swaps[value.charAt(i)] !== undefined) at.push(i)
  const out: { value: number | null; swaps: number }[] = []
  const walk = (text: string, from: number, taken: number): void => {
    out.push({ value: figureOf(text, digits), swaps: taken })
    if (taken === REPAIR_SWAPS_PER_FIGURE) return
    for (const i of at.filter((one) => one >= from)) {
      const swapped = swaps[text.charAt(i)] ?? text.charAt(i)
      walk(text.slice(0, i) + swapped + text.slice(i + 1), i + 1, taken + 1)
    }
  }
  walk(value, 0, 0)
  return out.filter((one) => one.value !== null)
}

/** A line's figures as one reading takes them. */
interface LineReading {
  readonly qty: number
  readonly price: number
  readonly discount: number | null
  readonly sum: number
}

/**
 * The readings of a line whose arithmetic does not hold as the model copied it, by the font's swaps (MOL-290):
 * each holds as `lineOf` judges a line — to the till's rounding only where the line prints a discount — and its
 * discount is the card's rate of its shelf price, to that rounding (the till's discount is not the rate rounded
 * either way on 21 of the bench's 254 lines: 395 → 3,96). A line that prints a discount on a receipt with no rate
 * to hold it to has none (review round 1, №3). One reading for each quantity, price and sum the swaps allow,
 * with its discount at the fewest swaps of theirs — two discounts there are a doubt, and that reading is none:
 * the total cannot tell them, the sum being one. `null` — past the line's ceiling or the receipt's.
 *
 * **Not the reading with the fewest swaps** (review round 1, А1): the model copies 550 as 660 — two swaps,
 * owner's В-2 — and 0,5 × 660 = 330, one swap in the quantity, is the same sum with the same 1 %; the fewest
 * swaps chose it, and the review showed 0,5 kg at 660. Every reading stays, and the total chooses among them.
 *
 * **Only among the fewest swaps' sums** (review round 2, owner's Б2 «а»): the readings kept are those whose sum is,
 * to the till's rounding, one a reading with the fewest swaps gives — 0,6 × 550 beside 0,5 × 660, 567,15 beside
 * 567,16. A reading three swaps off is the total's to choose no more: a line the model bent to fit (am-34, 99,00
 * short) made the curd's 615,78 the one choice that met the total. **And the total chooses no sum** (review round 3,
 * owner's Г1 «а»): where the fewest swaps give sums more than the till's rounding apart — «160» at 150 read either
 * way, «622 / 6.22» at 516,78 — the line is a doubt. The total confirms the line's one sum, never picks it: with two
 * readings equally cheap, the curd's 615,78 still paid for am-34. Both hold the line put right (`broken`); a line
 * read whole is asked only how its swaps may move it, every sum of its fewest (review round 4, №9).
 */
function choicesOf(
  swaps: Readonly<Record<string, string>>,
  line: ModelReceipt['lines'][number],
  slipped: readonly { value: number | null; swaps: number }[],
  rate: number | null,
  budget: { left: number },
  broken: boolean,
): LineReading[] | null {
  // a discount of 0 is no card's and needs no rate (review round 2, №6), as in `cardRate`
  const discount = figureOf(line.discount, 2)
  if (discount !== null && discount > 0 && rate === null) return []
  const qtys = [...readingsOf(swaps, line.quantity, 3), ...slipped]
  const prices = readingsOf(swaps, line.unit_price, 2)
  const discounts = readingsOf(swaps, line.discount, 2)
  const sums = new Map<number, number>()
  for (const one of readingsOf(swaps, line.sum, 2)) {
    if (one.value === null) continue
    sums.set(one.value, Math.min(sums.get(one.value) ?? Infinity, one.swaps))
  }
  const combinations = qtys.length * prices.length * discounts.length
  if (combinations > REPAIR_COMBINATIONS_MAX || combinations > budget.left) return null
  budget.left -= combinations
  repairTries.count += combinations
  const rounding = line.discount === null ? 0 : TOLERANCE_HUNDREDTHS
  // by quantity, price and sum: the discounts that reading takes, and the fewest swaps of each
  const found = new Map<string, { reading: LineReading; swaps: number; tied: boolean }>()
  for (const q of qtys) {
    for (const p of prices) {
      for (const d of discounts) {
        if (q.value === null || p.value === null || q.value <= 0 || p.value <= 0) continue
        const shelf = Math.round((q.value * p.value) / 1_000)
        const off = d.value ?? 0
        if (rate !== null && off > 0 && Math.abs(off - Math.round(shelf * rate)) > rounding)
          continue
        for (let sum = shelf - off - rounding; sum <= shelf - off + rounding; sum += 1) {
          const sumSwaps = sums.get(sum)
          if (sumSwaps === undefined || sum < 0) continue
          const swapped = q.swaps + p.swaps + d.swaps + sumSwaps
          if (swapped === 0) continue
          const key = `${String(q.value)}|${String(p.value)}|${String(sum)}`
          const was = found.get(key)
          const reading = { qty: q.value, price: p.value, discount: d.value, sum }
          if (was === undefined || swapped < was.swaps)
            found.set(key, { reading, swaps: swapped, tied: false })
          else if (swapped === was.swaps && was.reading.discount !== d.value) was.tied = true
        }
      }
    }
  }
  const kept = [...found.values()].filter((one) => !one.tied)
  const fewest = Math.min(...kept.map((one) => one.swaps))
  const cheapest = kept.filter((one) => one.swaps === fewest).map((one) => one.reading)
  const near = (one: LineReading, to: LineReading): boolean =>
    Math.abs(one.sum - to.sum) <= TOLERANCE_HUNDREDTHS
  // a line read whole: every way its fewest swaps may move it, two sums apart too (review round 4, №9)
  if (!broken) {
    return kept
      .filter((one) => cheapest.some((to) => near(one.reading, to)))
      .map((one) => one.reading)
  }
  const totals = cheapest.map((one) => one.sum)
  if (Math.max(...totals) - Math.min(...totals) > TOLERANCE_HUNDREDTHS) return []
  // the cheapest readings differ by the sum alone, or the line is a doubt: 0,61 × 515 = 314,15 and 0,51 × 616 =
  // 314,16, two swaps each, are a quantity the total would choose (review round 5, Г4)
  if (new Set(cheapest.map((one) => `${String(one.qty)}|${String(one.price)}`)).size > 1) return []
  // the same sum split another way stays, a doubt (0,6 × 550 beside 0,5 × 660); a luma off only at the fewest
  // swaps' quantity and price — the total chooses a luma, never a quantity (review round 4, Г3: 0,51 × 665 = 339,15
  // read as 0,61 × 556 = 339,16)
  return kept
    .filter(({ reading: one }) =>
      cheapest.some(
        (to) =>
          one.sum === to.sum || (one.qty === to.qty && one.price === to.price && near(one, to)),
      ),
    )
    .map((one) => one.reading)
}

/** Whether any figure of a line holds a digit the swaps take, or a slip of copying: else it reads one way. */
function swappable(
  swaps: Readonly<Record<string, string>>,
  line: ModelReceipt['lines'][number],
  slipped: readonly unknown[],
): boolean {
  const digits = Object.keys(swaps)
  return (
    [line.quantity, line.unit_price, line.discount, line.sum].some(
      (figure) => figure !== null && digits.some((digit) => figure.includes(digit)),
    ) || slipped.length > 0
  )
}

/** The digits the repair swaps on a model's line: the font's, and those seen only where the total put it right. */
const repairSwapsOf = (reading: PhotoReading): Readonly<Record<string, string>> => ({
  ...reading.modelSwaps,
  ...reading.modelRepairSwaps,
})

/**
 * A line's quantity as the model's copying slips it (MOL-310, owner's В-5 «а»), each one slip more than the swaps
 * its figure took: a weight whose «կգ» the model glued on as a 4 — «0,65կգ» copied 0.654 — and a count of one the
 * model took from the name, «Հավկիթ … 10հտ» bought once copied as 10. The repair's other readings, never on their
 * own: the total confirms one, as it confirms a swap.
 */
function slippedQuantities(
  swaps: Readonly<Record<string, string>>,
  piece: string,
  line: ModelReceipt['lines'][number],
): { value: number | null; swaps: number }[] {
  const copied = line.quantity
  if (copied === null) return []
  const glued =
    line.unit === 'kg' && /^\d+\.\d{2}4$/u.test(copied)
      ? readingsOf(swaps, copied.slice(0, -1), 3)
      : []
  const count = figureOf(copied, 3)
  const named =
    line.unit === 'pcs' &&
    count !== null &&
    count > 1_000 &&
    count % 1_000 === 0 &&
    new RegExp(`(?<!\\d)${String(count / 1_000)}\\s*(?:${piece})`, 'u').test(line.printed)
  return [
    ...glued.map((one) => ({ ...one, swaps: one.swaps + 1 })),
    ...(named ? [{ value: 1_000, swaps: 1 }] : []),
  ]
}

/**
 * A model's reading put right by the digits the till's font confuses (MOL-290, owner's В-1…В-4): every
 * line whose arithmetic does not hold as copied takes a reading by the font's swaps, and the lines then meet, to
 * the hundredth, the total two places vouch for (`owed`, less what went to the card) — the second source, and the
 * judge among a line's readings: only one choice of them may meet it (review round 1, owner's А1 «а»). Anything
 * short of it — a line with no reading, two choices meeting the total, none — and the reading is as the model
 * copied it, its lines emptied by the check as before. The model is never asked to do the sum:
 * copying, it bends the digits to fit (MOL-268); the arithmetic is ours.
 */
function repaired(
  reading: PhotoReading,
  answer: ModelReceipt,
  lines: readonly ReceiptTextLine[],
  owed: number,
): ReceiptTextLine[] | null {
  if (lines.length === 0 || lines.every((line) => line.settled)) return null
  const rate = cardRate(lines)
  const budget = { left: REPAIR_RECEIPT_COMBINATIONS_MAX }
  // the swaps once a reading, a line's slips once a line (review №8)
  const swaps = repairSwapsOf(reading)
  const slipsOf = (copied: ModelReceipt['lines'][number]) =>
    slippedQuantities(swaps, reading.words.units.piece, copied)
  const options: (LineReading[] | null)[] = []
  let read = 0
  // how far the lines read whole as copied may be off, each read whole by the swaps as well: 0 where none is
  let shifts = new Set([0])
  for (const [i, line] of lines.entries()) {
    const copied = answer.lines[i]
    if (line.settled) {
      const own = line.sumHundredths ?? 0
      read += own
      options.push(null)
      if (copied === undefined || line.sumHundredths === null) continue
      const slipped = slipsOf(copied)
      if (!swappable(swaps, copied, slipped)) continue
      const other = choicesOf(swaps, copied, slipped, rate, budget, false)
      if (other === null) return null
      const offs = new Set(other.map((one) => one.sum - own).filter((off) => off !== 0))
      if (offs.size === 0) continue
      shifts = new Set(
        [...shifts].flatMap((shift) => [shift, ...[...offs].map((off) => shift + off)]),
      )
      if (shifts.size > REPAIR_SHIFTS_MAX) return null
      continue
    }
    const found =
      copied === undefined ? null : choicesOf(swaps, copied, slipsOf(copied), rate, budget, true)
    if (found === null || found.length === 0) return null
    options.push(found)
  }
  // the readings of every line put right, one each, whose sums with the lines as copied make the total — the
  // only such choice; two are a doubt (0,5 × 660 and 0,6 × 550, one sum), and none is no repair. A choice that
  // makes it with a line read whole moved by its swaps is a second (review round 2, Б2: a bun copied 96 for 95
  // pays for the juice read 105 for 106), and the one choice must make it with them as copied
  const broken = options.flatMap((found, i) => (found === null ? [] : [{ i, found }]))
  const lowest = Math.min(...shifts)
  const picks: number[] = []
  // what the walk found, read after it: a state of the walk, never narrowed by the flow around it
  const choice: { ways: number; steps: number; picked: number[]; shift: number } = {
    ways: 0,
    steps: 0,
    picked: [],
    shift: 0,
  }
  const walk = (k: number, sum: number): void => {
    if (choice.ways > 1 || choice.steps > REPAIR_ASSIGNMENTS_MAX) return
    choice.steps += 1
    repairTries.chose += 1
    const at = broken[k]
    if (at === undefined) {
      if (shifts.has(owed - sum)) {
        choice.ways += 1
        choice.picked = [...picks]
        choice.shift = owed - sum
      }
      return
    }
    for (const [j, one] of at.found.entries()) {
      if (sum + one.sum > owed - lowest) continue
      picks.push(j)
      walk(k + 1, sum + one.sum)
      picks.pop()
    }
  }
  walk(0, read)
  if (choice.ways !== 1 || choice.shift !== 0 || choice.steps > REPAIR_ASSIGNMENTS_MAX) return null
  return lines.map((line, i) => {
    const k = broken.findIndex((one) => one.i === i)
    const one = k < 0 ? undefined : broken[k]?.found[choice.picked[k] ?? -1]
    if (one === undefined) return line
    return {
      ...line,
      quantityMilli: one.qty,
      priceHundredths: one.price,
      discountHundredths: one.discount,
      sumHundredths: one.sum,
      settled: true,
      asPrinted: false,
      repaired: true,
    }
  })
}

/**
 * The model's answer as the parse's reading of the receipt (MOL-272, Т-2). The layout is the card's where
 * any line prints a discount, a zero one too — «Ереван Сити»'s till rounds what was paid off its shelf
 * price, «250 249,99» — the class code's where lines print none, and a section's where there is no line
 * and a section «Բաժին» is printed or a total vouched for, a terminal's slip's where its rows name the terminal
 * (MOL-310); no line and none of them is a reading of nothing. Then `verifiedReading(text, { byModel: true })`, as
 * for Tesseract's reading.
 */
export function receiptTextOfModel(
  reading: PhotoReading,
  written: ModelReceipt,
  prices: RememberedPrices = new Map(),
): ReceiptText {
  const whole = canonicalAnswer(reading, written).answer
  const apart = serviceApart(reading, whole)
  const apartLines = apart.answer.lines.map(lineOf)
  const tried = totalOf(reading, apart.answer, apartLines, apart.served)
  // the service line goes out of the lines only where the surcharge is taken: else it stays the model's line, for the
  // foot's shortfall to show (review №5). Never where the lines met the total without it (adversarial Г1, Д1): that is
  // a bill «not included» as often as a subtotal whose total with the service the model lost, and a wrong total is worse
  // than none (MOL-255, Р-2)
  const keptApart = apart.served.length === 0 || tried.service !== null
  const answer = keptApart ? apart.answer : whole
  // a service line left among the lines is no dish read: «проверьте», never a line that proves the bill whole with the
  // service in doubt (adversarial Е2)
  const copied = keptApart
    ? apartLines
    : whole.lines.map((line, i) =>
        apart.isService[i] === true
          ? { ...lineOf(line), settled: false, asPrinted: false }
          : lineOf(line),
      )
  // the service decided against stays decided: its line a line, no service taken by a label or a vote — taken, it was
  // counted twice, as a line and as the surcharge (review №9, adversarial В2)
  const { total, read, met, owed, cashback, redeemed, service } = keptApart
    ? tried
    : totalOf(reading, whole, copied, null)
  const discounted = answer.lines.some((line) => figureOf(line.discount, 2) !== null)
  // a total two places vouch for that the lines do not meet: put right by the font's swaps, or not. The total first,
  // and on its own (MOL-291): a line it vouches for as copied is no doubt of the memory's, nor are the lines it put
  // right (adversarial А3, review №1); and the memory chooses none of a line's readings — between 0,6 × 550 and
  // 0,5 × 660 its old price is the one a changed shelf price makes wrong (review 2, №6, Б1)
  const byTotal = owed === null || met ? null : repaired(reading, answer, copied, owed)
  // else the shop's memory, a line at a time, and the total again over what it decided
  const swaps = { price: reading.modelSwaps, others: reading.modelSwaps, doubt: reading.modelSwaps }
  const less = (amount: number | null): number | null =>
    amount === null
      ? null
      : linesTotalHundredths({ cashbackHundredths: cashback, serviceHundredths: service }, amount)
  const voiced =
    met || byTotal !== null
      ? copied
      : rememberedLines(copied, prices, swaps, { owed, read: less(read) })
  // the total again only where the memory decided a line: the same lines would be the same walk, twice its work
  const moved = voiced.some((line, i) => line !== copied[i])
  const fixed =
    byTotal ?? (owed === null || met || !moved ? null : repaired(reading, answer, voiced, owed))
  const lines = fixed ?? voiced
  // a receipt with no line is a sum to record where it prints a section or two places vouch for its
  // total (MOL-227) — the model names a sole trader's «Բաժին 1» as a total no more often than not; with
  // neither it is a reading of nothing, «переснимите» as Tesseract's (`needsReshoot`)
  const section = answer.totals.some(({ label }) => DEPARTMENT.test(label))
  const slip =
    lines.length === 0 && !section && total === null ? slipAmountOf(reading, answer) : null
  const layout =
    slip !== null
      ? 'slip'
      : lines.length === 0
        ? section || total !== null
          ? 'department'
          : 'class'
        : discounted
          ? 'card'
          : 'class'
  const { tin, number } = keyOf(reading, answer)
  return {
    layout,
    tin,
    // as asked, or as printed in the card's order (MOL-305); a short year the model put first is the window's
    date: printedDayOf(answer.date, reading),
    time: clockOf(answer.time),
    receiptNo: number,
    totalHundredths: total ?? slip,
    readTotalHundredths: read ?? slip,
    balanced:
      met ||
      fixed !== null ||
      (owed !== null &&
        lines.length > 0 &&
        lines.every((line) => line.settled) &&
        lines.reduce((all, line) => all + (line.sumHundredths ?? 0), 0) === owed),
    cashbackHundredths: cashback,
    redeemedHundredths: redeemed,
    serviceHundredths: service,
    lines,
  }
}

/**
 * A bank terminal's slip with no bill beside it (MOL-310, owner's В-3 «а»): no line, rows naming the terminal, and
 * one amount after its word — the sum the card paid. Printed once, it is the one total no second place vouches for:
 * shown as the slip's, for the person to check, and the trip's money. Two amounts, or none, are no slip.
 */
function slipAmountOf(reading: PhotoReading, answer: ModelReceipt): number | null {
  const terminal = new RegExp(`(?:${reading.words.slipTerminal})`, 'u')
  if (!answer.id_rows.some((row) => terminal.test(row))) return null
  const word = new RegExp(`(?:${reading.words.slipAmount})`, 'iu')
  // every amount the slip's: a fiscal receipt shot with its slip prints «Ընդամենը» beside it, and lines lost there are
  // «переснимите», never a slip with no items (adversarial А5)
  // an amount read as nothing says nothing — tips of 0 (adversarial Б3); one not read at all may be any label's total
  // (review №12)
  const said = answer.totals.filter(({ amount }) => figureOf(amount, 2) !== 0)
  if (!said.every(({ label }) => word.test(label))) return null
  const amounts = new Set(
    said
      .map(({ amount }) => figureOf(amount, 2))
      .filter((amount): amount is number => amount !== null && amount > 0),
  )
  return amounts.size === 1 ? ([...amounts][0] ?? null) : null
}

/**
 * How the model's summary says the receipt was paid (MOL-312): its rows as copied, each word beside its amount —
 * the rule Tesseract's readings are read by (`paidByOf`).
 */
export function modelPaidBy(reading: PhotoReading, written: ModelReceipt): ReceiptPaidBy | null {
  const { answer } = canonicalAnswer(reading, written)
  return paidByOf(
    reading,
    answer.totals.map(({ label, amount }) => ({
      text: label,
      amounts: [figureOf(amount, 2) ?? 0],
    })),
  )
}

/** The head the model read as rows of a reading: where `receiptCityOf` looks for the city. */
export function modelHeadRows(answer: ModelReceipt): TextRow[] {
  return [answer.shop, answer.address]
    .filter((row): row is string => row !== null && row.trim() !== '')
    .map((row, line) => ({ text: row, part: 0, line }))
}
