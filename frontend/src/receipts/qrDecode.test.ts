// @vitest-environment node
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { beforeAll, describe, expect, it } from 'vitest'
import { prepareZXingModule } from 'zxing-wasm/reader'
import { prepareZXingModule as prepareWriter, writeBarcode } from 'zxing-wasm/writer'
import type { WriteInputBarcodeFormat } from 'zxing-wasm/writer'
import { decodeReceiptQr } from './qrDecode'

const require = createRequire(import.meta.url)
const wasm = (path: string) => readFileSync(require.resolve(path))

beforeAll(async () => {
  await prepareZXingModule({
    overrides: { wasmBinary: wasm('zxing-wasm/reader/zxing_reader.wasm').buffer },
    fireImmediately: true,
  })
  await prepareWriter({
    overrides: { wasmBinary: wasm('zxing-wasm/writer/zxing_writer.wasm').buffer },
    fireImmediately: true,
  })
})

interface Placed {
  readonly text: string
  readonly format?: WriteInputBarcodeFormat
  /** Pixels a module, as the photo gives them. */
  readonly scale: number
  readonly left: number
  readonly top: number
}

/**
 * A photo the way a phone gives one: paper grey, the codes drawn where they stand, a module a few
 * pixels wide — a receipt's QR at four is what a 12 Mp shot of an 80 mm roll makes (MOL-223).
 */
async function photoOf(width: number, height: number, codes: Placed[]): Promise<ImageData> {
  const data = new Uint8ClampedArray(width * height * 4).fill(210)
  for (const code of codes) {
    // TAP's QR is at correction L (MOL-223): the densest form, the one a photo must read
    const format = code.format ?? 'QRCode'
    const { symbol, error } = await writeBarcode(code.text, {
      format,
      ...(format === 'QRCode' ? { ecLevel: 'L' } : {}),
    })
    if (error) throw new Error(error)
    const quiet = 4
    const side = (symbol.width + quiet * 2) * code.scale
    for (let y = 0; y < side; y++) {
      for (let x = 0; x < side; x++) {
        const mx = Math.floor(x / code.scale) - quiet
        const my = Math.floor(y / code.scale) - quiet
        const inside = mx >= 0 && my >= 0 && mx < symbol.width && my < symbol.height
        const dark = inside && symbol.data[my * symbol.width + mx] === 0
        const at = ((code.top + y) * width + code.left + x) * 4
        data.fill(dark ? 25 : 245, at, at + 3)
      }
    }
  }
  return { data, width, height, colorSpace: 'srgb' }
}

// a sale made up by the model's `madeUpSerbianLink`, as in `LinkReceiptSheet.test.ts`: a test of `src`
// may not import the package's testing export
const link =
  'https://suf.purs.gov.rs/v/?vl=A1RFU1RBQUFBVEVTVEJCQkIBAAAAAQAAANQ2SgAAAAAAAAABmBxSTwgAAABUc5Kx0O8OLUxriqnI5wYlRGOCocDf%2Fh08W3qZuNf2FTRTcpGwz%2B4NLEtqiajH5gUkQ2KBoL%2Fe%2FRw7WnmYt9b1FDNScZCvzu0MK0ppiKfG5QQjQmGAn77d%2FBs6WXiXttX0EzJRcI%2BuzewLKkloh6bF5AMiQWB%2Fnr3c%2Bxo5WHeWtdTzEjFQb46tzOsKKUhnhqXE4wIhQF9%2Bnbzb%2Bhk4V3aVtNPyETBPbo2sy%2BoJKEdmhaTD4gEgP159nLva%2BRg3VnWUs9LxEC9ObYyryukIJ0ZlhKPC4QAfPl18m7rZ%2BBc2VXSTstHwDy5NbIuqyegHJkVkg6LB4P8ePVx7mrnY9xY1VHOSsdDvDi1Ma4qpyOcGJURjgqHA3%2F4dPFt6mbjX9hU0U3KRsM%2FuDSxLaomox%2BYFJENigaC%2F3v0cO1p5mLfW9RQzUnGQr87tDCtKaYinxuUEI0JhgJ%2B%2B3fwbOll4l7bV9BMyUXCPrs3sCypJaIemxeQDIkFgf5693PsaOVh3lrXU8xIxUG%2BOrczrCilIZ4alxOMCIUBffp282%2FoZOFd2lbTT8hEwT26NrMvqCShHZoWkw%2BIBID9efZy72vkYN1Z1lLPS8RAvTm2Mq8rpCCdGZYSjwuEAHz5dfJu62fgXNlV0k7LR8A8uTWyLqsnoByZFZIOiweD%2FHj1ce5q52PcWNQ87U0RqxUqXGlv0IC2EMdY%3D'

describe('decodeReceiptQr', () => {
  it('reads a Serbian receipt’s dense QR at four pixels a module', async () => {
    expect(link.length).toBeGreaterThan(790)
    const photo = await photoOf(1400, 1400, [{ text: link, scale: 4, left: 300, top: 700 }])
    expect(await decodeReceiptQr(photo)).toEqual([link])
  })

  it('reads every QR on the photo — a shop prints its own beside the tax office’s', async () => {
    const shop = 'https://shop.example/partner-discount'
    const photo = await photoOf(1400, 1400, [
      { text: shop, scale: 6, left: 100, top: 100 },
      { text: link, scale: 4, left: 400, top: 700 },
    ])
    expect(await decodeReceiptQr(photo)).toEqual(expect.arrayContaining([shop, link]))
  })

  it('must not read a barcode — a receipt’s codes are QR codes only', async () => {
    const photo = await photoOf(900, 400, [
      { text: '4850000000007', format: 'EAN13', scale: 3, left: 100, top: 100 },
    ])
    expect(await decodeReceiptQr(photo)).toEqual([])
  })

  it('finds nothing on a photo with no code', async () => {
    expect(await decodeReceiptQr(await photoOf(640, 480, []))).toEqual([])
  })
})
