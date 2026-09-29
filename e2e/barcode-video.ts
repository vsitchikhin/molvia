import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import process from 'node:process'

/**
 * What the fake camera films in end-to-end (MOL-98): an EAN-13 on a light ground, one frame that
 * Chromium plays in a loop (`--use-file-for-fake-video-capture`). Drawn at every run rather than
 * kept in git — no binary in the repository and no ffmpeg in CI — and drawn by this encoder, not by
 * zxing's own writer, so the reader is checked against a hand that is not its own.
 */
export const BARCODE = '4850000000007'

const L = ['0001101', '0011001', '0010011', '0111101', '0100011'].concat([
  '0110001',
  '0101111',
  '0111011',
  '0110111',
  '0001011',
])
// R is L inverted; G is R read backwards.
const R = L.map((code) => Array.from(code, (bit) => (bit === '0' ? '1' : '0')).join(''))
const G = R.map((code) => Array.from(code).reverse().join(''))
// Which of the left six digits are G, by the first digit, which is written by that choice alone.
const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG'].concat([
  'LGGLLG',
  'LGGGLL',
  'LGLGLG',
  'LGLGGL',
  'LGGLGL',
])

/** The 95 modules of an EAN-13, `1` for a bar. */
export function ean13Modules(code: string): string {
  const digits = Array.from(code, Number)
  const parity = PARITY[digits[0] ?? 0] ?? ''
  const left = digits
    .slice(1, 7)
    .map((digit, i) => (parity[i] === 'G' ? G : L)[digit] ?? '')
    .join('')
  const right = digits
    .slice(7)
    .map((digit) => R[digit] ?? '')
    .join('')
  return `101${left}01010${right}101`
}

const WIDTH = 640
const HEIGHT = 480
const MODULE = 4
const BAR_HEIGHT = 200

/** One Y4M frame: the grey plane carries the picture, both colour planes are neutral. */
function frame(modules: string): Buffer {
  const luma = Buffer.alloc(WIDTH * HEIGHT, 235)
  const left = Math.floor((WIDTH - modules.length * MODULE) / 2)
  const top = Math.floor((HEIGHT - BAR_HEIGHT) / 2)
  for (let y = top; y < top + BAR_HEIGHT; y++) {
    for (let x = 0; x < modules.length * MODULE; x++) {
      if (modules[Math.floor(x / MODULE)] === '1') luma[y * WIDTH + left + x] = 16
    }
  }
  const chroma = Buffer.alloc((WIDTH / 2) * (HEIGHT / 2) * 2, 128)
  const header = `YUV4MPEG2 W${String(WIDTH)} H${String(HEIGHT)} F30:1 Ip A1:1 C420jpeg\n`
  return Buffer.concat([Buffer.from(header), Buffer.from('FRAME\n'), luma, chroma])
}

/**
 * Playwright's global setup: the video is there before any browser starts, at the path the config
 * hands the camera — named by the config, which runs first in this same process.
 */
export default function writeBarcodeVideo(): void {
  const path = process.env.MOLVIA_BARCODE_VIDEO
  if (!path) throw new Error('MOLVIA_BARCODE_VIDEO is not set: playwright.config.ts names it')
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, frame(ean13Modules(BARCODE)))
}
