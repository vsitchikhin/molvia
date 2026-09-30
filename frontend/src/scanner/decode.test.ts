// @vitest-environment node
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { beforeAll, describe, expect, it } from 'vitest'
import { prepareZXingModule } from 'zxing-wasm/reader'
import {
  prepareZXingModule as prepareWriter,
  writeBarcode,
  type WriteInputBarcodeFormat,
} from 'zxing-wasm/writer'
import { typedBarcode } from '@molvia/model'
import { decodeFrame, locateWasm } from './decode'

const require = createRequire(import.meta.url)
const wasm = (path: string) => readFileSync(require.resolve(path))

beforeAll(async () => {
  // Node has no fetch for a file path, so the tests hand both modules their binaries.
  await prepareZXingModule({
    overrides: { wasmBinary: wasm('zxing-wasm/reader/zxing_reader.wasm').buffer },
    fireImmediately: true,
  })
  await prepareWriter({
    overrides: { wasmBinary: wasm('zxing-wasm/writer/zxing_writer.wasm').buffer },
    fireImmediately: true,
  })
})

/**
 * A frame the way the viewfinder cuts it: the code drawn a few pixels a module wide on grey,
 * off centre, in a frame wider than the code — not a clean symbol filling the picture.
 */
async function frameOf(text: string, format: WriteInputBarcodeFormat): Promise<ImageData> {
  const { symbol, error } = await writeBarcode(text, { format })
  if (error) throw new Error(error)
  const scale = 3
  const width = 640
  const height = 240
  const left = 90
  const top = 40
  const data = new Uint8ClampedArray(width * height * 4).fill(200)
  for (let y = 0; y < symbol.height * scale; y++) {
    for (let x = 0; x < (symbol.width + 20) * scale; x++) {
      const module = x / scale - 10
      const dark =
        module >= 0 &&
        module < symbol.width &&
        symbol.data[Math.floor(y / scale) * symbol.width + Math.floor(module)] === 0
      const at = ((top + y) * width + left + x) * 4
      data.fill(dark ? 20 : 250, at, at + 3)
    }
  }
  return { data, width, height, colorSpace: 'srgb' }
}

describe('decodeFrame', () => {
  it('reads the four retail formats', async () => {
    expect(await decodeFrame(await frameOf('4850000000007', 'EAN13'))).toBe('4850000000007')
    expect(await decodeFrame(await frameOf('96385074', 'EAN8'))).toBe('96385074')
  })

  it('gives UPC-A and UPC-E as thirteen digits — the form a code typed by hand takes', async () => {
    const upcA = await decodeFrame(await frameOf('012345678905', 'UPCA'))
    const upcE = await decodeFrame(await frameOf('06543217', 'UPCE'))
    expect(upcA).toBe('0012345678905')
    expect(upcE).toBe('0065100004327')
    // One package, one code, whichever way it came in.
    expect(typedBarcode('012345678905')).toEqual({ ok: true, code: upcA })
    expect(typedBarcode('06543217')).toEqual({ ok: true, code: upcE })
  })

  it('reads a UPC-E whose digits also check as EAN-8 by its print — typed, the digits are EAN-8', async () => {
    // The price of MOL-100 В-7: typed, eight that check as EAN-8 are the shop's label the scanner
    // reads such a print as; only the scan of the UPC-E print gives its thirteen.
    expect(await decodeFrame(await frameOf('01234565', 'UPCE'))).toBe('0012345000065')
    expect(await decodeFrame(await frameOf('01234565', 'EAN8'))).toBe('01234565')
    expect(typedBarcode('01234565')).toEqual({ ok: true, code: '01234565' })
  })

  it('must not read a QR or a Code 128 on the same package', async () => {
    expect(await decodeFrame(await frameOf('4850000000007', 'Code128'))).toBeNull()
    expect(await decodeFrame(await frameOf('4850000000007', 'QRCode'))).toBeNull()
  })

  it('finds nothing in a frame with no code', async () => {
    const width = 640
    const height = 240
    const data = new Uint8ClampedArray(width * height * 4).fill(200)
    expect(await decodeFrame({ data, width, height, colorSpace: 'srgb' })).toBeNull()
  })
})

describe('locateWasm', () => {
  it('points at the app’s own copy, never at the library’s CDN', () => {
    const url = locateWasm(
      'zxing_reader.wasm',
      'https://cdn.jsdelivr.net/npm/zxing-wasm@3/dist/reader/',
    )
    expect(url).not.toContain('jsdelivr')
    expect(url).toMatch(/zxing_reader.*\.wasm/)
  })
})
