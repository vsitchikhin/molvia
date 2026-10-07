import { readBarcodes, type ReaderOptions } from 'zxing-wasm/reader'

/**
 * QR codes on a receipt's photo (MOL-233), never the scanner's (MOL-98 keeps it to retail codes).
 * `tryHarder` — without it the bench's code at four pixels a module on a 12 Mp photo was not found;
 * several symbols — a receipt prints a shop's own QR beside the tax office's (am-03 carries one).
 */
export const RECEIPT_QR_OPTIONS: ReaderOptions = {
  formats: ['QRCode'],
  tryHarder: true,
  maxNumberOfSymbols: 4,
}

/** The text of every QR code on the photo zxing could read whole, in the order it found them. */
export async function decodeReceiptQr(frame: ImageData): Promise<string[]> {
  const results = await readBarcodes(frame, RECEIPT_QR_OPTIONS)
  return results.filter((result) => result.isValid).map((result) => result.text)
}
