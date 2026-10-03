import {
  DomainError,
  ERROR,
  RECEIPT_PARTS_MAX,
  RECEIPT_PART_BYTES_MAX,
  RECEIPT_SIDE_MAX,
  RECEIPT_SIDE_MIN,
} from '@molvia/model'
import type { ReceiptBody, ReceiptDetail, ReceiptSummary } from '@molvia/model'
import type { ReceiptRepository } from '@/db/receipts-repository'
import { jpegSize } from '@/receipts/jpeg'

/** «Отправить чек» (MOL-125): 201 for a new receipt, the same answer for the queue sending it again. */
export function sendReceipt(
  receipts: ReceiptRepository,
  actorId: string,
  body: ReceiptBody,
): Promise<{ receipt: ReceiptSummary; created: boolean }> {
  return receipts.create(actorId, body)
}

/**
 * A part of the photo, as the phone sent it. What is not a photo of a receipt is refused here, at
 * once — «не принят» on the phone, never retried: not a JPEG, too small to hold a receipt's print, or
 * larger than a phone sends. The part's number is the address's: one outside the receipt is a page
 * that does not exist.
 */
export async function putReceiptPart(
  receipts: ReceiptRepository,
  actorId: string,
  id: string,
  part: string,
  photo: Buffer,
): Promise<{ receipt: ReceiptSummary; queued: boolean }> {
  const position = /^[1-9]$/.test(part) ? Number(part) : 0
  if (position < 1 || position > RECEIPT_PARTS_MAX) throw new DomainError(ERROR.NOT_FOUND)
  if (photo.length > RECEIPT_PART_BYTES_MAX) throw new DomainError(ERROR.RECEIPT_TOO_LARGE)
  const size = jpegSize(photo)
  if (size === null || Math.min(size.width, size.height) < RECEIPT_SIDE_MIN) {
    throw new DomainError(ERROR.RECEIPT_NOT_PHOTO)
  }
  if (Math.max(size.width, size.height) > RECEIPT_SIDE_MAX) {
    throw new DomainError(ERROR.RECEIPT_TOO_LARGE)
  }
  return receipts.putPart(actorId, id, position, { photo, ...size })
}

export function receiptsOf(
  receipts: ReceiptRepository,
  actorId: string,
): Promise<ReceiptSummary[]> {
  return receipts.list(actorId)
}

/** One receipt with its lines: 404 for a missing, removed or someone else's one alike. */
export async function receiptOfOwner(
  receipts: ReceiptRepository,
  actorId: string,
  id: string,
): Promise<ReceiptDetail> {
  const found = await receipts.one(actorId, id)
  if (found === null) throw new DomainError(ERROR.NOT_FOUND)
  return found
}

/** «Удалить чек»: a mark; the photo and the lines go when «Вернуть» is over (П-8). */
export function removeReceipt(
  receipts: ReceiptRepository,
  actorId: string,
  id: string,
): Promise<void> {
  return receipts.remove(actorId, id)
}

export async function restoreReceipt(
  receipts: ReceiptRepository,
  actorId: string,
  id: string,
): Promise<ReceiptSummary> {
  if (!(await receipts.restore(actorId, id))) throw new DomainError(ERROR.NOT_FOUND)
  return (await receiptOfOwner(receipts, actorId, id)).receipt
}
