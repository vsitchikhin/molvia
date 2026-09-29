import { readBarcodes, type ReaderOptions } from 'zxing-wasm/reader'
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url'
import { barcodeSchema } from '@molvia/model'

// From our own origin, never the library's default CDN (MOL-98): the scanner works at a shelf
// with no connection, from the precache, and no third party learns who opened it.
export function locateWasm(path: string, prefix: string): string {
  return path.endsWith('.wasm') ? wasmUrl : prefix + path
}

// Retail codes only (MOL-98): a QR or a Code 128 on the same package is not the item's code,
// and every format read beyond these is one more chance of a false read at the shelf.
export const READER_OPTIONS: ReaderOptions = {
  formats: ['EAN13', 'EAN8', 'UPCA', 'UPCE'],
  tryHarder: true,
  maxNumberOfSymbols: 1,
}

/**
 * The code in a frame, as zxing gives it — UPC-A and UPC-E already as thirteen digits, the
 * form `typedBarcode` gives a code typed by hand — or null when there is none.
 */
export async function decodeFrame(frame: ImageData): Promise<string | null> {
  const [result] = await readBarcodes(frame, READER_OPTIONS)
  if (!result?.isValid) return null
  const code = barcodeSchema.safeParse(result.text)
  return code.success ? code.data : null
}
