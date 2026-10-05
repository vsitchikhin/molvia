// MOL-222 — the receipt straightened by its four corners: the geometry, with no DOM, so the bench of
// MOL-114 runs the very code the phone does (Р-2).

export interface Point {
  readonly x: number
  readonly y: number
}

/** Four corners in order: top-left, top-right, bottom-right, bottom-left — as the receipt reads. */
export type Quad = readonly [Point, Point, Point, Point]

/** Pixels as a canvas holds them: RGBA, row by row. */
export interface Pixels {
  readonly data: Uint8ClampedArray
  readonly width: number
  readonly height: number
}

export interface Size {
  readonly width: number
  readonly height: number
}

const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y)

const ORIGIN: Point = { x: 0, y: 0 }

/**
 * Any four points put in reading order: by their angle around the middle, starting from the one
 * nearest the top-left — so a drag that crosses two handles still gives a receipt, not a bow tie.
 */
export function orderCorners(points: readonly Point[]): Quad {
  if (points.length !== 4) throw new Error('a receipt has four corners')
  const cx = points.reduce((sum, p) => sum + p.x, 0) / 4
  const cy = points.reduce((sum, p) => sum + p.y, 0) / 4
  // clockwise on the screen, y down: from the left round over the top
  const around = [...points].sort(
    (a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx),
  )
  let first = 0
  around.forEach((p, i) => {
    const best = around[first] ?? ORIGIN
    if (p.x + p.y < best.x + best.y) first = i
  })
  const at = (i: number) => around[(first + i) % 4] ?? ORIGIN
  return [at(0), at(1), at(2), at(3)]
}

/**
 * «Повернуть»: the receipt turned a quarter clockwise is the same four corners, read from the next —
 * no pixel moves until the warp, which draws it turned.
 */
export function turned(quad: Quad, quarters: number): Quad {
  const k = ((quarters % 4) + 4) % 4
  const at = (i: number) => quad[(i + 4 - k) % 4] ?? ORIGIN
  return [at(0), at(1), at(2), at(3)]
}

/**
 * The receipt's own size in the photo's pixels: the longer of each pair of opposite edges, so nothing
 * of it is squeezed — a receipt leaning away keeps the length of its nearer edge.
 */
export function rectOf([tl, tr, br, bl]: Quad): Size {
  return {
    width: Math.max(1, Math.round(Math.max(distance(tl, tr), distance(bl, br)))),
    height: Math.max(1, Math.round(Math.max(distance(tl, bl), distance(tr, br)))),
  }
}

/** Brought within `longSide`, the proportions kept — `RECEIPT_PHOTO_SIDE` for a part (П-7). */
export function within(size: Size, longSide: number): Size {
  const scale = Math.min(1, longSide / Math.max(size.width, size.height))
  return {
    width: Math.max(1, Math.round(size.width * scale)),
    height: Math.max(1, Math.round(size.height * scale)),
  }
}

/** The pixels a warp reads: the box around the corners, inside the photo, in whole pixels. */
export function boundsOf(quad: Quad, photo: Size): { x: number; y: number } & Size {
  const xs = quad.map((p) => p.x)
  const ys = quad.map((p) => p.y)
  const x = Math.max(0, Math.floor(Math.min(...xs)))
  const y = Math.max(0, Math.floor(Math.min(...ys)))
  const right = Math.min(photo.width, Math.ceil(Math.max(...xs)) + 1)
  const bottom = Math.min(photo.height, Math.ceil(Math.max(...ys)) + 1)
  return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) }
}

/**
 * Below this share of its side a corner off the box around the receipt is no tilt worth a warp: the
 * reader straightens a degree or two itself, and a warp redraws every pixel (below).
 */
export const SQUARE_ENOUGH = 0.015

/**
 * The corners as the warp takes them (MOL-222): on whole pixels — a finger is not that precise, and a
 * receipt cut on whole pixels is the photo's own pixels, never a blend of neighbours — and, when the
 * receipt stands square enough, the box around it. On the bench every redraw cost lines: am-01..14
 * cut by hand read 64 lines of 132 as the photo's pixels and 54 drawn anew at the same corners.
 */
export function snapped(quad: Quad): Quad {
  const round = (p: Point) => ({ x: Math.round(p.x), y: Math.round(p.y) })
  const [tl, tr, br, bl] = [round(quad[0]), round(quad[1]), round(quad[2]), round(quad[3])]
  const left = Math.min(tl.x, bl.x)
  const right = Math.max(tr.x, br.x)
  const top = Math.min(tl.y, tr.y)
  const bottom = Math.max(bl.y, br.y)
  const slackX = (right - left) * SQUARE_ENOUGH
  const slackY = (bottom - top) * SQUARE_ENOUGH
  const square =
    Math.abs(tl.x - bl.x) <= slackX &&
    Math.abs(tr.x - br.x) <= slackX &&
    Math.abs(tl.y - tr.y) <= slackY &&
    Math.abs(bl.y - br.y) <= slackY
  if (!square) return [tl, tr, br, bl]
  return [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom },
  ]
}

/** The corners moved by `(-dx, -dy)`: into the coordinates of the box `boundsOf` cut out. */
export function shifted(quad: Quad, dx: number, dy: number): Quad {
  const at = (p: Point) => ({ x: p.x - dx, y: p.y - dy })
  return [at(quad[0]), at(quad[1]), at(quad[2]), at(quad[3])]
}

/**
 * The perspective taking the rectangle `size` onto `quad`: nine numbers, the last one 1. Solved from
 * the eight equations of four corners by elimination with the largest pivot.
 */
export function homography(size: Size, quad: Quad): number[] {
  const from: Point[] = [
    { x: 0, y: 0 },
    { x: size.width, y: 0 },
    { x: size.width, y: size.height },
    { x: 0, y: size.height },
  ]
  // eight rows of nine: the eight unknowns and the right-hand side
  const m = new Float64Array(8 * 9)
  from.forEach((src, i) => {
    const dst = quad[i] ?? ORIGIN
    m.set([src.x, src.y, 1, 0, 0, 0, -src.x * dst.x, -src.y * dst.x, dst.x], 2 * i * 9)
    m.set([0, 0, 0, src.x, src.y, 1, -src.x * dst.y, -src.y * dst.y, dst.y], (2 * i + 1) * 9)
  })
  const cell = (r: number, c: number) => m[r * 9 + c] ?? 0
  for (let col = 0; col < 8; col++) {
    let pivot = col
    for (let r = col + 1; r < 8; r++) {
      if (Math.abs(cell(r, col)) > Math.abs(cell(pivot, col))) pivot = r
    }
    if (pivot !== col) {
      const swap = m.slice(col * 9, col * 9 + 9)
      m.copyWithin(col * 9, pivot * 9, pivot * 9 + 9)
      m.set(swap, pivot * 9)
    }
    const lead = cell(col, col)
    if (Math.abs(lead) < 1e-12) throw new Error('the corners do not make a receipt')
    for (let c = col; c < 9; c++) m[col * 9 + c] = cell(col, c) / lead
    for (let r = 0; r < 8; r++) {
      const factor = cell(r, col)
      if (r === col || factor === 0) continue
      for (let c = col; c < 9; c++) m[r * 9 + c] = cell(r, c) - factor * cell(col, c)
    }
  }
  return [...Array.from({ length: 8 }, (_, r) => cell(r, 8)), 1]
}

/**
 * A square receipt on whole pixels at its own size is the photo's pixels as they are: copied row by
 * row, with nothing blended. `null` for any other.
 */
function copiedBox(photo: Pixels, quad: Quad, size: Size): Pixels | null {
  const [tl, tr, br, bl] = quad
  const x = tl.x
  const y = tl.y
  const whole = [tl, tr, br, bl].every((p) => Number.isInteger(p.x) && Number.isInteger(p.y))
  if (
    !whole ||
    tr.y !== y ||
    bl.x !== x ||
    br.x !== tr.x ||
    br.y !== bl.y ||
    tr.x - x !== size.width ||
    bl.y - y !== size.height ||
    x < 0 ||
    y < 0 ||
    tr.x > photo.width ||
    bl.y > photo.height
  ) {
    return null
  }
  const out = new Uint8ClampedArray(size.width * size.height * 4)
  for (let row = 0; row < size.height; row++) {
    const from = ((y + row) * photo.width + x) * 4
    out.set(photo.data.subarray(from, from + size.width * 4), row * size.width * 4)
  }
  return { data: out, width: size.width, height: size.height }
}

/** Keys' cubic, a = −0.5: the weight of a neighbour `t` pixels away. */
function cubic(t: number): number {
  const x = Math.abs(t)
  if (x <= 1) return 1.5 * x * x * x - 2.5 * x * x + 1
  if (x < 2) return -0.5 * x * x * x + 2.5 * x * x - 4 * x + 2
  return 0
}

/**
 * The receipt drawn straight: every pixel of `size` looked up in `photo` through the perspective of
 * `quad` (in the photo's own coordinates) and drawn from its sixteen neighbours by Keys' cubic. Not
 * from four: a blend of four at the half-pixel every corner falls on halves the sharpness of a stroke,
 * and on the bench am-01 cut by hand read 1 line of 3 so against 3 of 3 cut whole (MOL-222). Outside
 * the photo is white — paper, never black that OCR would read as ink.
 */
export function warp(photo: Pixels, quad: Quad, size: Size): Pixels {
  const copied = copiedBox(photo, quad, size)
  if (copied !== null) return copied
  const h = homography(size, quad)
  const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0, g = 0, k = 0] = h
  const out = new Uint8ClampedArray(size.width * size.height * 4)
  const { data, width, height } = photo
  const wx = new Float64Array(4)
  const wy = new Float64Array(4)
  const xs = new Int32Array(4)
  const ys = new Int32Array(4)
  for (let v = 0; v < size.height; v++) {
    const cy = v + 0.5
    for (let u = 0; u < size.width; u++) {
      const cx = u + 0.5
      const w = g * cx + k * cy + 1
      const sx = (a * cx + b * cy + c) / w - 0.5
      const sy = (d * cx + e * cy + f) / w - 0.5
      const at = (v * size.width + u) * 4
      if (sx < -0.5 || sy < -0.5 || sx > width - 0.5 || sy > height - 0.5) {
        out[at] = out[at + 1] = out[at + 2] = out[at + 3] = 255
        continue
      }
      const x0 = Math.floor(sx)
      const y0 = Math.floor(sy)
      for (let i = 0; i < 4; i++) {
        xs[i] = Math.min(width - 1, Math.max(0, x0 - 1 + i))
        ys[i] = Math.min(height - 1, Math.max(0, y0 - 1 + i))
        wx[i] = cubic(sx - (x0 - 1 + i))
        wy[i] = cubic(sy - (y0 - 1 + i))
      }
      for (let ch = 0; ch < 3; ch++) {
        let sum = 0
        for (let j = 0; j < 4; j++) {
          const row = (ys[j] ?? 0) * width
          let line = 0
          for (let i = 0; i < 4; i++)
            line += (data[(row + (xs[i] ?? 0)) * 4 + ch] ?? 0) * (wx[i] ?? 0)
          sum += line * (wy[j] ?? 0)
        }
        out[at + ch] = sum
      }
      out[at + 3] = 255
    }
  }
  return { data: out, width: size.width, height: size.height }
}
