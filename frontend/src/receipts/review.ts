import { RECEIPT_CURRENCY, receiptBalance } from '@molvia/model'
import type {
  Money,
  Quantity,
  ReceiptBalance,
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
}

/** The name a new item is written under: the person's, else the gloss, else the line as printed. */
function newName(line: ReceiptReviewLine): string {
  return (line.itemName ?? line.translation ?? line.printed).trim()
}

export function reviewLines(detail: ReceiptDetail, draft: ReceiptDraft | null): ReviewLine[] {
  return detail.lines.map((line, position) => {
    const edit = draft?.lines[position]
    if (edit) {
      const itemId = 'id' in edit.item ? edit.item.id : null
      return {
        position,
        line,
        itemId,
        name: edit.item.name,
        isNew: itemId === null,
        check: false,
        mismatch: false,
        quantity: edit.quantity,
        amount: edit.amount,
        skip: edit.skip,
        edited: true,
      }
    }
    const isNew = line.itemId === null
    return {
      position,
      line,
      itemId: line.itemId,
      name: isNew ? newName(line) : (line.itemName ?? newName(line)),
      isNew,
      check: line.match === 'weak',
      mismatch: !line.settled && line.sum !== null,
      quantity: line.quantity,
      amount: line.amount,
      skip: false,
      edited: false,
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
): ReceiptRecordBody | null {
  const place = reviewPlace(detail, draft)
  if (!place) return null
  const id = placeIdOf(place)
  return {
    tripId,
    place: id ? { id } : { name: place.name, city: place.city },
    purchasedOn: reviewDay(detail, draft, taken),
    ...(draft?.total ? { total: draft.total } : {}),
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
