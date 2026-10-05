// MOL-222 — where the receipt is on the photo: four corners the phone proposes and the person moves.
// No DOM, so the bench of MOL-114 measures the very code the phone runs (Т-2, Р-2).

import { orderCorners } from '@/receipts/warp'
import type { Pixels, Point, Quad, Size } from '@/receipts/warp'

const ORIGIN: Point = { x: 0, y: 0 }

/** A photo in shades of grey, small: what the corners are looked for in. */
export interface Gray extends Size {
  readonly data: Uint8Array
  /** How coloured each pixel is — the spread of its channels: paper has none, skin and wood have. */
  readonly chroma: Uint8Array
}

/** The long side corners are looked for at: the paper's edge is a few pixels wide even here. */
export const EDGES_LONG_SIDE = 640

/** Below this share of the photo it is no receipt but a label, above it no edge was found. */
const AREA_MIN = 0.03
const AREA_MAX = 0.97

/** The photo brought down to `longSide`, each pixel the mean of the ones it covers, in luma. */
export function grayOf(photo: Pixels, longSide = EDGES_LONG_SIDE): Gray {
  const scale = Math.min(1, longSide / Math.max(photo.width, photo.height))
  const width = Math.max(1, Math.round(photo.width * scale))
  const height = Math.max(1, Math.round(photo.height * scale))
  const sum = new Float64Array(width * height)
  const spread = new Float64Array(width * height)
  const count = new Uint32Array(width * height)
  const { data } = photo
  for (let y = 0; y < photo.height; y++) {
    const ty = Math.min(height - 1, Math.floor(y * scale))
    for (let x = 0; x < photo.width; x++) {
      const tx = Math.min(width - 1, Math.floor(x * scale))
      const at = (y * photo.width + x) * 4
      const r = data[at] ?? 0
      const g = data[at + 1] ?? 0
      const b = data[at + 2] ?? 0
      const luma = 0.299 * r + 0.587 * g + 0.114 * b
      sum[ty * width + tx] = (sum[ty * width + tx] ?? 0) + luma
      spread[ty * width + tx] =
        (spread[ty * width + tx] ?? 0) + Math.max(r, g, b) - Math.min(r, g, b)
      count[ty * width + tx] = (count[ty * width + tx] ?? 0) + 1
    }
  }
  const out = new Uint8Array(width * height)
  const chroma = new Uint8Array(width * height)
  for (let i = 0; i < out.length; i++) {
    const n = Math.max(1, count[i] ?? 0)
    out[i] = Math.round((sum[i] ?? 0) / n)
    chroma[i] = Math.round((spread[i] ?? 0) / n)
  }
  return { data: out, chroma, width, height }
}

/** Otsu's threshold of a histogram: the one that best splits it in two. */
function otsu(values: Uint8Array | Float64Array): number {
  const histogram = new Float64Array(256)
  for (const value of values) {
    const v = Math.min(255, Math.max(0, Math.round(value)))
    histogram[v] = (histogram[v] ?? 0) + 1
  }
  const total = values.length
  let sumAll = 0
  for (let v = 0; v < 256; v++) sumAll += v * (histogram[v] ?? 0)
  let sumBelow = 0
  let below = 0
  let best = 0
  let threshold = 128
  for (let v = 0; v < 256; v++) {
    below += histogram[v] ?? 0
    if (below === 0) continue
    const above = total - below
    if (above === 0) break
    sumBelow += v * (histogram[v] ?? 0)
    const meanBelow = sumBelow / below
    const meanAbove = (sumAll - sumBelow) / above
    const between = below * above * (meanBelow - meanAbove) ** 2
    if (between > best) {
      best = between
      threshold = v
    }
  }
  return threshold
}

/** The largest 4-connected region of `mask`, as a mask of its own, and its size. */
function largestRegion(mask: Uint8Array, size: Size): { region: Uint8Array; area: number } {
  const { width, height } = size
  const label = new Int32Array(width * height)
  const queue = new Int32Array(width * height)
  let bestLabel = 0
  let bestArea = 0
  let next = 0
  for (let start = 0; start < mask.length; start++) {
    if (mask[start] === 0 || label[start] !== 0) continue
    next += 1
    let head = 0
    let tail = 0
    queue[tail++] = start
    label[start] = next
    while (head < tail) {
      const at = queue[head++] ?? 0
      const x = at % width
      const neighbours = [
        x > 0 ? at - 1 : -1,
        x < width - 1 ? at + 1 : -1,
        at >= width ? at - width : -1,
        at < width * (height - 1) ? at + width : -1,
      ]
      for (const n of neighbours) {
        if (n >= 0 && mask[n] !== 0 && label[n] === 0) {
          label[n] = next
          queue[tail++] = n
        }
      }
    }
    if (tail > bestArea) {
      bestArea = tail
      bestLabel = next
    }
  }
  const region = new Uint8Array(width * height)
  if (bestLabel !== 0)
    for (let i = 0; i < label.length; i++) if (label[i] === bestLabel) region[i] = 1
  return { region, area: bestArea }
}

/**
 * The corners of a region as the points furthest along the two diagonals — the top-left nearest
 * `x + y` low, and so on. A receipt lies roughly upright on a photo of it; one lying at 45° is the
 * person's to drag.
 */
function cornersOf(region: Uint8Array, area: number, size: Size): Quad | null {
  const share = area / (size.width * size.height)
  if (share < AREA_MIN || share > AREA_MAX) return null
  let tl = { x: 0, y: 0, s: Infinity }
  let tr = { x: 0, y: 0, s: -Infinity }
  let br = { x: 0, y: 0, s: -Infinity }
  let bl = { x: 0, y: 0, s: -Infinity }
  for (let i = 0; i < region.length; i++) {
    if (region[i] === 0) continue
    const x = i % size.width
    const y = Math.floor(i / size.width)
    if (x + y < tl.s) tl = { x, y, s: x + y }
    if (x - y > tr.s) tr = { x: x + 1, y, s: x - y }
    if (x + y > br.s) br = { x: x + 1, y: y + 1, s: x + y }
    if (y - x > bl.s) bl = { x, y: y + 1, s: y - x }
  }
  return [tl, tr, br, bl].map(({ x, y }) => ({ x, y })) as unknown as Quad
}

/** Candidate (1): the largest region brighter than Otsu's threshold — what glare defeats (MOL-114). */
export function brightCorners(gray: Gray): Quad | null {
  const threshold = otsu(gray.data)
  const mask = new Uint8Array(gray.data.length)
  for (let i = 0; i < mask.length; i++) mask[i] = (gray.data[i] ?? 0) > threshold ? 1 : 0
  const { region, area } = largestRegion(mask, gray)
  return cornersOf(region, area, gray)
}

/** A box blur of radius `r`, by summed areas. */
function blurred(gray: Gray, r: number): Float64Array {
  const { width, height, data } = gray
  const sums = new Float64Array((width + 1) * (height + 1))
  for (let y = 0; y < height; y++) {
    let row = 0
    for (let x = 0; x < width; x++) {
      row += data[y * width + x] ?? 0
      sums[(y + 1) * (width + 1) + x + 1] = (sums[y * (width + 1) + x + 1] ?? 0) + row
    }
  }
  const out = new Float64Array(width * height)
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - r)
    const y1 = Math.min(height, y + r + 1)
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - r)
      const x1 = Math.min(width, x + r + 1)
      const s =
        (sums[y1 * (width + 1) + x1] ?? 0) -
        (sums[y0 * (width + 1) + x1] ?? 0) -
        (sums[y1 * (width + 1) + x0] ?? 0) +
        (sums[y0 * (width + 1) + x0] ?? 0)
      out[y * width + x] = s / ((x1 - x0) * (y1 - y0))
    }
  }
  return out
}

/**
 * Candidate (3): the light flattened first — each pixel against a wide blur of its surroundings — so
 * a broad patch of glare is as dull as the table it lies on, a shadow on the paper is lifted with
 * it, and the paper stands out as the one thing brighter than what is around it.
 */
export function flattenedCorners(gray: Gray): Quad | null {
  const r = Math.max(4, Math.round(Math.max(gray.width, gray.height) / 6))
  const around = blurred(gray, r)
  const ratio = new Float64Array(gray.data.length)
  for (let i = 0; i < ratio.length; i++) {
    ratio[i] = Math.min(255, (128 * (gray.data[i] ?? 0)) / Math.max(1, around[i] ?? 0))
  }
  const threshold = otsu(ratio)
  const mask = new Uint8Array(ratio.length)
  for (let i = 0; i < mask.length; i++) mask[i] = (ratio[i] ?? 0) > threshold ? 1 : 0
  const { region, area } = largestRegion(mask, gray)
  return cornersOf(region, area, gray)
}

/**
 * Candidate (2): what the paper's edge closes. Edges by the gradient, thickened by a pixel; the
 * background flooded in from the photo's border over everything that is not an edge; what the flood
 * never reached is inside a closed edge, and the largest such region is the receipt. Glare and shadow
 * draw no closed edge of a receipt's size; a gap in the paper's edge lets the flood in, and then
 * nothing is found.
 */
export function enclosedCorners(gray: Gray): Quad | null {
  const { width, height, data } = gray
  const magnitude = new Float64Array(width * height)
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const p = (dx: number, dy: number) => data[(y + dy) * width + x + dx] ?? 0
      const gx = p(1, -1) + 2 * p(1, 0) + p(1, 1) - p(-1, -1) - 2 * p(-1, 0) - p(-1, 1)
      const gy = p(-1, 1) + 2 * p(0, 1) + p(1, 1) - p(-1, -1) - 2 * p(0, -1) - p(1, -1)
      magnitude[y * width + x] = Math.hypot(gx, gy)
    }
  }
  const sorted = Float64Array.from(magnitude).sort()
  const strong = Math.max(24, sorted[Math.floor(sorted.length * 0.9)] ?? 0)
  const edge = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if ((magnitude[y * width + x] ?? 0) < strong) continue
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx
          const ny = y + dy
          if (nx >= 0 && ny >= 0 && nx < width && ny < height) edge[ny * width + nx] = 1
        }
      }
    }
  }
  // the flood from the border over what is not an edge
  const outside = new Uint8Array(width * height)
  const queue = new Int32Array(width * height)
  let tail = 0
  const seed = (at: number) => {
    if (edge[at] === 0 && outside[at] === 0) {
      outside[at] = 1
      queue[tail++] = at
    }
  }
  for (let x = 0; x < width; x++) {
    seed(x)
    seed((height - 1) * width + x)
  }
  for (let y = 0; y < height; y++) {
    seed(y * width)
    seed(y * width + width - 1)
  }
  for (let head = 0; head < tail; head++) {
    const at = queue[head] ?? 0
    const x = at % width
    if (x > 0) seed(at - 1)
    if (x < width - 1) seed(at + 1)
    if (at >= width) seed(at - width)
    if (at < width * (height - 1)) seed(at + width)
  }
  const inside = new Uint8Array(width * height)
  for (let i = 0; i < inside.length; i++) inside[i] = outside[i] === 0 ? 1 : 0
  const { region, area } = largestRegion(inside, gray)
  return cornersOf(region, area, gray)
}

/** `mask` eroded and then dilated by `r`: a bridge thinner than 2r — a wrist, a cable — is cut. */
function opened(mask: Uint8Array, size: Size, r: number): Uint8Array {
  const pass = (from: Uint8Array, keep: 0 | 1): Uint8Array => {
    // a square of 2r + 1 by two passes of a line, as a box filter would
    const { width, height } = size
    const rows = new Uint8Array(from.length)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let all = 1 - keep
        for (let d = -r; d <= r; d++) {
          const nx = Math.min(width - 1, Math.max(0, x + d))
          if (from[y * width + nx] === keep) {
            all = keep
            break
          }
        }
        rows[y * width + x] = all
      }
    }
    const out = new Uint8Array(from.length)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let all = 1 - keep
        for (let d = -r; d <= r; d++) {
          const ny = Math.min(height - 1, Math.max(0, y + d))
          if (rows[ny * width + x] === keep) {
            all = keep
            break
          }
        }
        out[y * width + x] = all
      }
    }
    return out
  }
  // erosion: a pixel stays only if no zero is near; dilation: it comes if any one is near
  return pass(pass(mask, 0), 1)
}

/** The convex hull of a region's boundary pixels, counter-clockwise (Andrew's monotone chain). */
function hullOf(region: Uint8Array, size: Size): Point[] {
  const points: Point[] = []
  const { width, height } = size
  for (let y = 0; y < height; y++) {
    let first = -1
    let last = -1
    for (let x = 0; x < width; x++) {
      if (region[y * width + x] === 0) continue
      if (first < 0) first = x
      last = x
    }
    if (first >= 0)
      points.push(
        { x: first, y },
        { x: last + 1, y },
        { x: first, y: y + 1 },
        { x: last + 1, y: y + 1 },
      )
  }
  points.sort((a, b) => a.x - b.x || a.y - b.y)
  const cross = (o: Point, a: Point, b: Point) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
  const lower: Point[] = []
  for (const p of points) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2] ?? ORIGIN, lower[lower.length - 1] ?? ORIGIN, p) <= 0
    )
      lower.pop()
    lower.push(p)
  }
  const upper: Point[] = []
  for (const p of [...points].reverse()) {
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2] ?? ORIGIN, upper[upper.length - 1] ?? ORIGIN, p) <= 0
    )
      upper.pop()
    upper.push(p)
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)]
}

/**
 * The rectangle of least area around a hull, by its edges in turn (rotating calipers): a receipt is a
 * rectangle, seen nearly from above, so a corner torn off or a thumb over it does not move the rest.
 */
function leastRectangle(hull: readonly Point[]): Quad | null {
  if (hull.length < 3) return null
  let best: { area: number; quad: Point[] } | null = null
  for (let i = 0; i < hull.length; i++) {
    const p = hull[i] ?? ORIGIN
    const q = hull[(i + 1) % hull.length] ?? ORIGIN
    const length = Math.hypot(q.x - p.x, q.y - p.y)
    if (length === 0) continue
    const ux = (q.x - p.x) / length
    const uy = (q.y - p.y) / length
    let [minU, maxU, minV, maxV] = [Infinity, -Infinity, Infinity, -Infinity]
    for (const r of hull) {
      const u = (r.x - p.x) * ux + (r.y - p.y) * uy
      const v = -(r.x - p.x) * uy + (r.y - p.y) * ux
      minU = Math.min(minU, u)
      maxU = Math.max(maxU, u)
      minV = Math.min(minV, v)
      maxV = Math.max(maxV, v)
    }
    const area = (maxU - minU) * (maxV - minV)
    if (best === null || area < best.area) {
      const at = (u: number, v: number) => ({ x: p.x + u * ux - v * uy, y: p.y + u * uy + v * ux })
      best = { area, quad: [at(minU, minV), at(maxU, minV), at(maxU, maxV), at(minU, maxV)] }
    }
  }
  return best === null ? null : orderCorners(best.quad)
}

/** The chroma above which a pixel is not paper: skin, wood, a coloured cloth. */
const PAPER_CHROMA = 40

/**
 * Candidate (4): paper, by what paper is — brighter than its surroundings once the light is flattened
 * (3), and without colour, which takes a hand and a wooden table out though both are light; thin
 * bridges cut, and the corners those of the least rectangle around the region rather than its
 * extreme points, which a thumb or a second receipt on top pulled into a trapezoid.
 */
export function paperCorners(gray: Gray): Quad | null {
  const r = Math.max(4, Math.round(Math.max(gray.width, gray.height) / 6))
  const around = blurred(gray, r)
  const ratio = new Float64Array(gray.data.length)
  for (let i = 0; i < ratio.length; i++) {
    ratio[i] = Math.min(255, (128 * (gray.data[i] ?? 0)) / Math.max(1, around[i] ?? 0))
  }
  const threshold = otsu(ratio)
  const mask = new Uint8Array(ratio.length)
  for (let i = 0; i < mask.length; i++) {
    mask[i] = (ratio[i] ?? 0) > threshold && (gray.chroma[i] ?? 0) < PAPER_CHROMA ? 1 : 0
  }
  const { region, area } = largestRegion(opened(mask, gray, 2), gray)
  const share = area / (gray.width * gray.height)
  if (share < AREA_MIN || share > AREA_MAX) return null
  return leastRectangle(hullOf(region, gray))
}

/** The candidates the bench measures, by name. */
export const CANDIDATES = {
  bright: brightCorners,
  enclosed: enclosedCorners,
  flattened: flattenedCorners,
  paper: paperCorners,
} as const satisfies Record<string, (gray: Gray) => Quad | null>

/** Corners found on `gray`, carried back to the photo of `photo`'s size. */
export function scaledTo(quad: Quad, gray: Size, photo: Size): Quad {
  const sx = photo.width / gray.width
  const sy = photo.height / gray.height
  const at = (p: Point) => ({ x: p.x * sx, y: p.y * sy })
  return [at(quad[0]), at(quad[1]), at(quad[2]), at(quad[3])]
}

/**
 * Where the phone puts the corners as the step opens (Т-2): what the measured candidate finds; not
 * found — the corners of the photo itself, so nothing is cut that the person did not move (Р-4).
 */
export function proposedCorners(
  photo: Pixels,
  find: (gray: Gray) => Quad | null = CANDIDATES.paper,
): { quad: Quad; found: boolean } {
  const gray = grayOf(photo)
  const found = find(gray)
  if (found !== null) {
    // the least rectangle of a receipt running off the frame stands past its edge (review 3): kept
    // in the photo, its corners make a trapezoid, and the warp straightens it rather than paint white
    const inside = (p: Point) => ({
      x: Math.min(photo.width, Math.max(0, p.x)),
      y: Math.min(photo.height, Math.max(0, p.y)),
    })
    const quad = scaledTo(found, gray, photo)
    return {
      quad: [inside(quad[0]), inside(quad[1]), inside(quad[2]), inside(quad[3])],
      found: true,
    }
  }
  const { width, height } = photo
  return {
    quad: [
      { x: 0, y: 0 },
      { x: width, y: 0 },
      { x: width, y: height },
      { x: 0, y: height },
    ],
    found: false,
  }
}
