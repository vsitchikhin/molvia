import {
  RECEIPT_CURRENCY,
  receiptBalance,
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
} from '@molvia/model'
import { placeIdOf } from '@/stores/receiptDrafts'
import type { PlaceDraft, ReceiptDraft } from '@/stores/receiptDrafts'

/**
 * A line of the review as it stands now (MOL-127, Т-7): the server's reading, with the person's edit
 * over it if there is one. Nothing here adds anything up — «Строки», the difference and «Записать N»
 * are `receiptBalance` of the model, the function the server records by (В-6).
 */
export interface ReviewLine {
  readonly position: number
  readonly line: ReceiptReviewLine
  /** The item: one of the catalogue (`id`), or a new one by its name. */
  readonly itemId: string | null
  readonly name: string
  readonly isNew: boolean
  /** «проверьте» — found from far (`match: weak`), until the person settled the item. */
  readonly check: boolean
  /** The printed sum differs from quantity × price — highlighted, never refused (Р-3 of MOL-113). */
  readonly mismatch: boolean
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
  return recordedSums(figures, total, digits)
}

export function reviewLines(
  detail: ReceiptDetail,
  draft: ReceiptDraft | null,
  /** The item each line showed at its first edit (`receiptDrafts.shownOf`, adversarial В1). */
  shown: Readonly<Record<number, string | null>> = {},
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
        // Figures typed are what was paid, and «≠» of the reading no longer describes the line; an
        // item chosen alone leaves the figures, and the sum, to the reading (review 28).
        mismatch: figures ? false : !line.settled && line.sum !== null,
        quantity: figures ? figures.quantity : line.quantity,
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
            (!sameQuantity(figures.quantity, line.quantity) ||
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
      mismatch: !line.settled && line.sum !== null,
      quantity: line.quantity,
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
    draft?.total ?? detail.receipt.total,
    RECEIPT_CURRENCY[detail.receipt.country],
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
): ReceiptRecordBody | null {
  const place = reviewPlace(detail, draft)
  if (!place) return null
  const id = placeIdOf(place)
  return {
    tripId,
    place: id ? { id } : { name: place.name, city: place.city },
    purchasedOn: reviewDay(detail, draft, taken),
    ...(draft?.total ? { total: draft.total } : {}),
    ...(barcodes === undefined ? {} : { barcodes: [...barcodes] }),
    // what was put right, which only the phone knows (MOL-222): counted by the server, never recorded
    edited: {
      item: lines.filter((one) => !one.skip && one.changed.item).map((one) => one.position),
      figures: lines.filter((one) => !one.skip && one.changed.figures).map((one) => one.position),
    },
    lines: lines.map((one) =>
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
