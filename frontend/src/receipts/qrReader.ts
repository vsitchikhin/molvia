import { serbianReceiptLink } from '@molvia/model'
import type { SerbianReceiptLink } from '@molvia/model'
import { createFrameReader } from '@/scanner/barcodeReader'
import type { FrameReader, ReaderWorker } from '@/scanner/barcodeReader'

/** The worker reading the QR codes of a receipt's photo (MOL-233): every text it read whole. */
export type ReceiptQrReader = FrameReader<string[]>

/** The reader of a receipt's QR codes — its own worker beside the scanner's, the same wasm. */
export function createReceiptQrReader(worker?: ReaderWorker<string[]>): ReceiptQrReader {
  return createFrameReader(
    worker ?? new Worker(new URL('./qrWorker.ts', import.meta.url), { type: 'module' }),
  )
}

/**
 * What the QR codes of a photo say of a Serbian receipt: its link; a link of the tax office to a
 * receipt that is no purchase (a refund, a copy) — said by its reason, as under the paste field; or
 * nothing to record — no code, a shop's own, a link whose MD5 does not hold.
 */
export type ReceiptLinkOnPhoto =
  | { readonly kind: 'link'; readonly link: SerbianReceiptLink }
  | { readonly kind: 'refused'; readonly reason: 'not_sale' | 'refund' }
  | { readonly kind: 'none' }

/** The first code that is a receipt's link by the model's own check (`serbianReceiptLink`). */
export function receiptLinkOfCodes(texts: readonly string[]): ReceiptLinkOnPhoto {
  let refused: ReceiptLinkOnPhoto = { kind: 'none' }
  for (const text of texts) {
    const read = serbianReceiptLink(text)
    if (read.ok) {
      return {
        kind: 'link',
        link: { link: read.link, total: read.total, at: read.at, number: read.number },
      }
    }
    if (refused.kind === 'none' && (read.reason === 'refund' || read.reason === 'not_sale')) {
      refused = { kind: 'refused', reason: read.reason }
    }
  }
  return refused
}

/**
 * The link on a photo, read whole as `decodePhoto` drew it (Р-1): a receipt's QR is a few hundred
 * pixels of a 12 Mp photo, and every pixel of it counts. The pixels move to the worker; the photo
 * stays the caller's to let go. A failed worker throws `ReaderFailed`.
 */
export async function receiptLinkOnPhoto(
  photo: HTMLCanvasElement,
  reader: ReceiptQrReader,
): Promise<ReceiptLinkOnPhoto> {
  const context = photo.getContext('2d')
  if (!context) return { kind: 'none' }
  const frame = context.getImageData(0, 0, photo.width, photo.height)
  return receiptLinkOfCodes((await reader.read(frame)) ?? [])
}
