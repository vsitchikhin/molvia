import {
  linesTotalOf,
  packedQuantity,
  receiptBalance,
  receiptCard,
  receiptDigits,
  receiptLineName,
  recordedSums,
} from '@molvia/model'
import type {
  Money,
  Quantity,
  ReceiptBalance,
  ReceiptCountry,
  ReceiptDetail,
  ReceiptRecordBody,
  ReceiptReviewLine,
  TripPaymentBody,
} from '@molvia/model'
import { placeIdOf } from '@/stores/receiptDrafts'
import type { AddedLineDraft, PlaceDraft, ReceiptDraft } from '@/stores/receiptDrafts'

/**
 * A line of the review as it stands now (MOL-127, Т-7): the server's reading, with the person's edit
 * over it if there is one. Nothing here adds anything up — «Строки», the difference and «Записать N»
 * are `receiptBalance` of the model, the function the server records by (В-6).
 */
export interface ReviewLine {
  /** Its place on the review: a line of the receipt's own, or after them one typed (`added`). */
  readonly position: number
  /**
   * A line the reader lost, typed on the review (MOL-273): its key in the drafts. Its `line` holds no
   * reading — nothing printed, the figures the person's — and «Записать» sends it apart from the
   * receipt's lines, which keep their positions.
   */
  readonly added?: string
  readonly line: ReceiptReviewLine
  /** The item: one of the catalogue (`id`), or a new one by its name. */
  readonly itemId: string | null
  readonly name: string
  readonly isNew: boolean
  /** «проверьте» — found from far (`match: weak`), until the person settled the item. */
  readonly check: boolean
  /**
   * «проверьте» of the figures — put right by the digits the till's font confuses (MOL-290) — until the
   * person typed their own.
   */
  readonly repaired: boolean
  /** The printed sum differs from quantity × price — highlighted, never refused (Р-3 of MOL-113). */
  readonly mismatch: boolean
  /**
   * What the line is recorded at: the till's pieces times the package its name prints (MOL-264) — the till's own
   * count and price stay on `line` — or the person's figure once edited.
   */
  readonly quantity: Quantity | null
  /** What the line will be recorded at (В-5 on the server; the person's figure once edited). */
  readonly amount: Money | null
  readonly skip: boolean
  readonly edited: boolean
  /** The quantity and the sum are the person's, not the reading's (review 28). */
  readonly ownFigures: boolean
  /**
   * What the person put right against what this review showed (MOL-222, the measure of 0.2): another
   * item than the one shown — a new one kept new under another name is no edit, the reading gave no
   * name to correct — and figures that differ from the ones the server showed before any edit. A total
   * put right moves no line.
   */
  readonly changed: { readonly item: boolean; readonly figures: boolean }
}

const sameMoney = (a: Money | null, b: Money | null) =>
  a === null || b === null ? a === b : a.minor === b.minor && a.currency === b.currency
const sameQuantity = (a: Quantity | null, b: Quantity | null) =>
  a === null || b === null ? a === b : a.milli === b.milli && a.unit === b.unit

/**
 * The name a new item is written under: the person's, else the gloss, else the line's own — a Serbian
 * till's name less its unit word (MOL-232) — else as printed.
 */
function newName(line: ReceiptReviewLine, country: ReceiptCountry): string {
  return (line.itemName ?? line.translation ?? receiptLineName(line.printed, country)).trim()
}

/**
 * What each line is recorded at when the person corrected the total (Р-8, review 4): the server
 * worked the amounts out by the total OCR read, and В-5 turns on the total — the printed sum of a
 * line that does not add up stands when the total confirms it. So the very `recordedSums` of the
 * model is run again over the lines' figures and the person's total; without one, the server's.
 */
function amountsOf(detail: ReceiptDetail, draft: ReceiptDraft | null) {
  const total = draft?.total
  if (!total) return detail.lines.map((line) => line.amount)
  const figures = detail.lines.map(({ quantity, price, sum, discount }) => ({
    quantity,
    price,
    sum,
    discount,
  }))
  const digits = receiptDigits(total.currency, [
    total,
    ...detail.lines.flatMap((line) => [line.price, line.sum, line.discount]),
  ])
  // the lines make the total less what a card sent to the card (MOL-289)
  return recordedSums(figures, linesTotalOf(total, detail.cashback ?? null), digits)
}

/** The quantity the review shows a line at before any edit: the purchase its package makes (MOL-264). */
const shownQuantity = (line: ReceiptReviewLine) => packedQuantity(line.quantity, line.pack ?? null)

export function reviewLines(
  detail: ReceiptDetail,
  draft: ReceiptDraft | null,
  /** The item each line showed at its first edit (`receiptDrafts.shownOf`, adversarial В1). */
  shown: Readonly<Record<number, string | null>> = {},
  /** The lines typed on the review (`receiptDrafts.addedOf`, MOL-273), after the receipt's own. */
  added: readonly AddedLineDraft[] = [],
): ReviewLine[] {
  return [
    ...readLines(detail, draft, shown),
    ...added.map((one, i) => addedLine(one, detail.lines.length + i)),
  ]
}

/** A line typed on the review, as the rows and the balance read a line: nothing printed, nothing to check. */
function addedLine(one: AddedLineDraft, position: number): ReviewLine {
  const itemId = 'id' in one.item ? one.item.id : null
  return {
    position,
    added: one.key,
    line: {
      printed: '',
      hs: null,
      sku: null,
      quantity: one.figures.quantity,
      price: null,
      sum: null,
      discount: null,
      settled: true,
      itemId,
      itemName: one.item.name,
      match: itemId === null ? 'new' : 'search',
      translation: null,
      amount: one.figures.amount,
      rememberedPrice: null,
    },
    itemId,
    name: one.item.name,
    isNew: itemId === null,
    check: false,
    repaired: false,
    mismatch: false,
    quantity: one.figures.quantity,
    amount: one.figures.amount,
    skip: false,
    edited: true,
    ownFigures: true,
    // counted apart, as added (MOL-273, В-1 «а»): not a line of the reading put right
    changed: { item: false, figures: false },
  }
}

function readLines(
  detail: ReceiptDetail,
  draft: ReceiptDraft | null,
  shown: Readonly<Record<number, string | null>>,
): ReviewLine[] {
  const amounts = amountsOf(detail, draft)
  const country = detail.receipt.country
  return detail.lines.map((line, position) => {
    const edit = draft?.lines[position]
    const amount = amounts[position] ?? line.amount
    if (edit) {
      const itemId = 'id' in edit.item ? edit.item.id : null
      const figures = edit.figures
      return {
        position,
        line,
        itemId,
        name: edit.item.name,
        isNew: itemId === null,
        // «проверьте» goes only once the person chose the item, not with any edit (review 16).
        check: line.match === 'weak' && edit.confirmed !== true && itemId === line.itemId,
        repaired: line.repaired === true && figures === undefined,
        // Figures typed are what was paid, and «≠» of the reading no longer describes the line; an
        // item chosen alone leaves the figures, and the sum, to the reading (review 28).
        mismatch: figures ? false : !line.settled && line.sum !== null,
        quantity: figures ? figures.quantity : shownQuantity(line),
        amount: figures ? figures.amount : amount,
        skip: edit.skip,
        edited: true,
        ownFigures: figures !== undefined,
        changed: {
          // against what the review showed when the person put it right: read again after the memory
          // learnt the same correction elsewhere, it shows their own word as the reading's (В1)
          item: ((was) => (itemId !== null ? itemId !== was : was !== null))(
            position in shown ? (shown[position] ?? null) : line.itemId,
          ),
          // against the figures the review showed before any edit — the server's — never the ones a
          // total typed since would show: a line put right stays put right whatever came after it
          // (adversarial Б3)
          figures:
            figures !== undefined &&
            (!sameQuantity(figures.quantity, shownQuantity(line)) ||
              !sameMoney(figures.amount, line.amount)),
        },
      }
    }
    const isNew = line.itemId === null
    return {
      position,
      line,
      itemId: line.itemId,
      name: isNew ? newName(line, country) : (line.itemName ?? newName(line, country)),
      isNew,
      check: line.match === 'weak',
      repaired: line.repaired === true,
      mismatch: !line.settled && line.sum !== null,
      quantity: shownQuantity(line),
      amount,
      skip: false,
      edited: false,
      ownFigures: false,
      changed: { item: false, figures: false },
    }
  })
}

/** «Строки», the difference with the total, the line it likely sits in and «Записать N» (Т-8). */
export function reviewBalance(
  detail: ReceiptDetail,
  lines: readonly ReviewLine[],
  draft: ReceiptDraft | null,
): ReceiptBalance {
  return receiptBalance(
    lines.map((one) => ({ printed: one.line.sum, amount: one.amount, skip: one.skip })),
    linesTotalOf(draft?.total ?? detail.receipt.total, detail.cashback ?? null),
    receiptCard(detail.receipt.country).currency,
  )
}

/** The place the receipt will be recorded at: the person's choice, else the one the server found. */
export function reviewPlace(detail: ReceiptDetail, draft: ReceiptDraft | null): PlaceDraft | null {
  if (draft?.place) return draft.place
  const place = detail.receipt.place
  return place ? { id: place.id, name: place.name, city: place.city } : null
}

/** The day of the purchases: the person's, else the one printed, else the day the photo was taken. */
export function reviewDay(
  detail: ReceiptDetail,
  draft: ReceiptDraft | null,
  taken: string,
): string {
  return draft?.purchasedOn ?? detail.receipt.header?.date ?? taken
}

/**
 * «Записать N» (Т-12): the whole receipt as the phone holds it — every line once, by its position
 * (Р-4 of MOL-126) — under the trip the phone names. Null without a place: «Записать» asks for it.
 */
export function recordBody(
  detail: ReceiptDetail,
  draft: ReceiptDraft | null,
  lines: readonly ReviewLine[],
  tripId: string,
  taken: string,
  /** The lines whose code the person binds (MOL-234): absent — none was asked about. */
  barcodes?: readonly number[],
  /** The account it was paid from (MOL-312): absent — «Без счёта», or no account at all. */
  account?: TripPaymentBody,
): ReceiptRecordBody | null {
  const place = reviewPlace(detail, draft)
  if (!place) return null
  const id = placeIdOf(place)
  const read = lines.filter((one) => one.added === undefined)
  const typed = lines.filter((one) => one.added !== undefined)
  return {
    tripId,
    place: id ? { id } : { name: place.name, city: place.city },
    purchasedOn: reviewDay(detail, draft, taken),
    ...(draft?.total ? { total: draft.total } : {}),
    ...(barcodes === undefined ? {} : { barcodes: [...barcodes] }),
    ...(account === undefined ? {} : { account }),
    // what was put right, which only the phone knows (MOL-222): counted by the server, never recorded
    edited: {
      item: read.filter((one) => !one.skip && one.changed.item).map((one) => one.position),
      figures: read.filter((one) => !one.skip && one.changed.figures).map((one) => one.position),
    },
    // the lines the reader lost, apart: the receipt's own keep their positions (MOL-273)
    ...(typed.length === 0
      ? {}
      : {
          added: typed.map((one) => ({
            item: one.itemId ? { id: one.itemId } : { name: one.name },
            quantity: one.quantity,
            amount: one.amount,
          })),
        }),
    lines: read.map((one) =>
      one.skip
        ? { position: one.position, skip: true as const }
        : {
            position: one.position,
            skip: false as const,
            item: one.itemId ? { id: one.itemId } : { name: one.name },
            quantity: one.quantity,
            amount: one.amount,
          },
    ),
  }
}
