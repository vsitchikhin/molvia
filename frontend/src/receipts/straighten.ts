import { RECEIPT_SIDE_MIN } from '@molvia/model'
import { RECEIPT_PHOTO_SIDE } from '@/receipts/photo'
import { halvedSource, halvingSteps, proposedCorners } from '@/receipts/edges'
import { boundsOf, orderCorners, rectOf, shifted, snapped, warp, within } from '@/receipts/warp'
import type { Quad, Size } from '@/receipts/warp'
import type { WarpReply, WarpRequest } from '@/receipts/warpWorker'

/**
 * Below this width a receipt cut out is too small to read (MOL-127 В-3, MOL-222 Т-4): an 80 mm roll
 * prints 42 characters a line, and Tesseract loses a till's digits under about 14 px a character. A
 * warning, never a refusal — measured on the bench, width did not tell am-06 from am-03.
 */
export const RECEIPT_PHOTO_NARROW = 600

/** What runs the warp: the worker on a phone, the page itself where there is none (tests). */
export interface Warper {
  warp(request: Omit<WarpRequest, 'id'>): Promise<{ pixels: Uint8ClampedArray } & Size>
}

let shared: Warper | null = null

const pageWarper: Warper = {
  warp: ({ pixels, width, height, quad, size }) => {
    const out = warp({ data: pixels, width, height }, quad, size)
    return Promise.resolve({ pixels: out.data, width: out.width, height: out.height })
  },
}

function workerWarper(): Warper {
  const worker = new Worker(new URL('./warpWorker.ts', import.meta.url), { type: 'module' })
  const waiting = new Map<number, (reply: WarpReply) => void>()
  let next = 0
  worker.addEventListener('message', ({ data }: MessageEvent<WarpReply>) => {
    waiting.get(data.id)?.(data)
    waiting.delete(data.id)
  })
  worker.addEventListener('error', () => {
    for (const reply of waiting.values()) reply({ id: -1, ok: false })
    waiting.clear()
    // the page warps from here on: a worker that failed to load fails again
    shared = pageWarper
  })
  return {
    warp: (request) =>
      new Promise((resolve, reject) => {
        next += 1
        waiting.set(next, (reply) => {
          if (reply.ok) resolve({ pixels: reply.pixels, width: reply.width, height: reply.height })
          else reject(new Error('warp failed'))
        })
        worker.postMessage({ ...request, id: next }, [request.pixels.buffer])
      }),
  }
}

function warper(): Warper {
  shared ??= typeof Worker === 'undefined' ? pageWarper : workerWarper()
  return shared
}

function canvasOf(size: Size): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  return canvas
}

/** A copy's memory let go at once, not when the collector gets to it; the photo itself is kept. */
function letGo(copy: HTMLCanvasElement, photo: HTMLCanvasElement): void {
  if (copy === photo) return
  copy.width = 0
  copy.height = 0
}

/**
 * Where the phone proposes the corners (Т-2): looked for on a copy halved down to at most
 * `EDGES_HALVED_SIDE` — each step exactly half, a mean of 2 × 2 in any engine, as the bench's
 * `halvedCopy`, never one `drawImage` straight to the size, which samples (MOL-259) — read whole by
 * `grayOf` to `EDGES_LONG_SIDE`, and carried back to the photo.
 */
export function proposeCorners(photo: HTMLCanvasElement): { quad: Quad; found: boolean } {
  const whole: Quad = [
    { x: 0, y: 0 },
    { x: photo.width, y: 0 },
    { x: photo.width, y: photo.height },
    { x: 0, y: photo.height },
  ]
  let copy = photo
  for (const step of halvingSteps(photo)) {
    const next = canvasOf(step)
    // no `willReadFrequently`, not even on the last step: read once, it only cost more — WebKit 6 → 9…11 ms,
    // Chromium on the GPU 0.6…2 ms, the step pulled off it to be read
    const drawn = next.getContext('2d')
    if (!drawn) {
      letGo(copy, photo)
      return { quad: whole, found: false }
    }
    const source = halvedSource(copy, step)
    drawn.drawImage(copy, 0, 0, source.width, source.height, 0, 0, step.width, step.height)
    letGo(copy, photo)
    copy = next
  }
  const context = copy.getContext('2d')
  if (!context) {
    letGo(copy, photo)
    return { quad: whole, found: false }
  }
  const pixels = context.getImageData(0, 0, copy.width, copy.height)
  letGo(copy, photo)
  const { quad, found } = proposedCorners(pixels)
  if (!found) return { quad: whole, found: false }
  // the odd pixels the steps left out are under one pixel of the copy: the copy stands for the whole photo
  const sx = photo.width / pixels.width
  const sy = photo.height / pixels.height
  return {
    quad: quad.map((p) => ({ x: p.x * sx, y: p.y * sy })) as unknown as Quad,
    found: true,
  }
}

/** «Повернуть»: the photo a quarter clockwise, on a canvas of its own; the old one is let go. */
export function turnedPhoto(photo: HTMLCanvasElement): HTMLCanvasElement | null {
  const canvas = canvasOf({ width: photo.height, height: photo.width })
  const context = canvas.getContext('2d')
  if (!context) return null
  context.translate(canvas.width, 0)
  context.rotate(Math.PI / 2)
  context.drawImage(photo, 0, 0)
  return canvas
}

/**
 * The corners of a photo turned a quarter clockwise, where they now stand on it, in reading order
 * again: what was the receipt's left edge is its top now.
 */
export function turnedCorners(quad: Quad, photo: Size): Quad {
  // a point (x, y) of the old photo is (height − y, x) on the turned one
  return orderCorners(quad.map((p) => ({ x: photo.height - p.y, y: p.x })))
}

/**
 * The receipt cut out and drawn straight (Т-3): only the pixels around the corners leave the photo,
 * the warp runs off the page, and the result is the receipt at its own size in the photo, at most
 * `RECEIPT_PHOTO_SIDE` long. Null — the canvas could not be read or the warp failed.
 */
export async function straighten(
  photo: HTMLCanvasElement,
  quad: Quad,
  run: Warper = warper(),
): Promise<HTMLCanvasElement | null> {
  quad = snapped(quad)
  const box = boundsOf(quad, photo)
  const context = photo.getContext('2d')
  if (!context) return null
  const cut = context.getImageData(box.x, box.y, box.width, box.height)
  const size = within(rectOf(quad), RECEIPT_PHOTO_SIDE)
  const request = { width: box.width, height: box.height, quad: shifted(quad, box.x, box.y), size }
  let out: { pixels: Uint8ClampedArray } & Size
  try {
    // the pixels move to the worker: a copy stays for the page, should the worker fail
    out = await run.warp({ ...request, pixels: run === pageWarper ? cut.data : cut.data.slice() })
  } catch {
    // a worker that did not start — its script not loaded with no connection, a WebView without
    // module workers — or that fell: the page draws it itself, slower but the same receipt
    try {
      out = await pageWarper.warp({ ...request, pixels: cut.data })
    } catch {
      return null
    }
  }
  // a side under what the server takes is paper added, white, to its sides — «Оставить так» on a
  // receipt of 180 px is a receipt, never «файл не открылся» (adversarial А2)
  const side = {
    width: Math.max(out.width, RECEIPT_SIDE_MIN),
    height: Math.max(out.height, RECEIPT_SIDE_MIN),
  }
  const canvas = canvasOf(side)
  const drawn = canvas.getContext('2d')
  if (!drawn) return null
  if (side.width !== out.width || side.height !== out.height) {
    drawn.fillStyle = '#fff'
    drawn.fillRect(0, 0, side.width, side.height)
  }
  drawn.putImageData(
    new ImageData(new Uint8ClampedArray(out.pixels), out.width, out.height),
    Math.floor((side.width - out.width) / 2),
    Math.floor((side.height - out.height) / 2),
  )
  return canvas
}
