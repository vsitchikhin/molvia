import { describe, expect, it } from 'vitest'
import {
  boundsOf,
  homography,
  orderCorners,
  rectOf,
  shifted,
  snapped,
  turned,
  warp,
  within,
} from '@/receipts/warp'
import type { Pixels, Quad } from '@/receipts/warp'

const quad = (...xy: number[]): Quad => [
  { x: xy[0] ?? 0, y: xy[1] ?? 0 },
  { x: xy[2] ?? 0, y: xy[3] ?? 0 },
  { x: xy[4] ?? 0, y: xy[5] ?? 0 },
  { x: xy[6] ?? 0, y: xy[7] ?? 0 },
]

/** A photo of `width × height`, grey `ground`, with the rectangle `[x0, y0, x1, y1)` in `paper`. */
function photo(width: number, height: number, box: number[], ground = 40, paper = 240): Pixels {
  const data = new Uint8ClampedArray(width * height * 4)
  const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = box
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const value = x >= x0 && x < x1 && y >= y0 && y < y1 ? paper : ground
      data.set([value, value, value, 255], (y * width + x) * 4)
    }
  }
  return { data, width, height }
}

const grey = (pixels: Pixels, x: number, y: number) => pixels.data[(y * pixels.width + x) * 4]

describe('the corners in reading order', () => {
  it('takes the four corners in any order', () => {
    const expected = quad(10, 10, 90, 12, 88, 190, 8, 188)
    const [tl, tr, br, bl] = expected
    expect(orderCorners([br, tl, bl, tr])).toEqual(expected)
    expect(orderCorners([bl, br, tr, tl])).toEqual(expected)
  })

  it('takes a receipt leaning to either side', () => {
    expect(orderCorners(quad(60, 0, 100, 60, 40, 100, 0, 40))[0]).toEqual({ x: 0, y: 40 })
  })

  it('turns by reading from the next corner: four quarters are none', () => {
    const q = quad(0, 0, 10, 0, 10, 30, 0, 30)
    expect(turned(q, 1)).toEqual(quad(0, 30, 0, 0, 10, 0, 10, 30))
    expect(rectOf(turned(q, 1))).toEqual({ width: 30, height: 10 })
    expect(turned(q, 4)).toEqual(q)
    expect(turned(q, -1)).toEqual(turned(q, 3))
  })
})

describe('the receipt’s own size', () => {
  it('is the longer edge of each pair: a receipt leaning away is not squeezed', () => {
    expect(rectOf(quad(20, 0, 80, 0, 100, 300, 0, 300))).toEqual({ width: 100, height: 301 })
  })

  it('is brought within the long side, proportions kept, never enlarged', () => {
    expect(within({ width: 1000, height: 6400 }, 3200)).toEqual({ width: 500, height: 3200 })
    expect(within({ width: 700, height: 2800 }, 3200)).toEqual({ width: 700, height: 2800 })
  })

  it('reads only the box around the corners, inside the photo', () => {
    const box = boundsOf(quad(-5, 10.4, 50.2, 9, 60, 80.7, 2, 90), { width: 55, height: 85 })
    expect(box).toEqual({ x: 0, y: 9, width: 55, height: 76 })
    expect(shifted(quad(10, 20, 30, 20, 30, 40, 10, 40), 10, 20)[2]).toEqual({ x: 20, y: 20 })
  })
})

describe('the perspective', () => {
  it('takes the rectangle onto its own corners', () => {
    const q = quad(12, 7, 95, 15, 101, 240, 3, 228)
    const h = homography({ width: 80, height: 200 }, q)
    const map = (x: number, y: number) => {
      const w = (h[6] ?? 0) * x + (h[7] ?? 0) * y + 1
      return [
        ((h[0] ?? 0) * x + (h[1] ?? 0) * y + (h[2] ?? 0)) / w,
        ((h[3] ?? 0) * x + (h[4] ?? 0) * y + (h[5] ?? 0)) / w,
      ]
    }
    for (const [[x, y], corner] of [
      [[0, 0], q[0]],
      [[80, 0], q[1]],
      [[80, 200], q[2]],
      [[0, 200], q[3]],
    ] as const) {
      const [mx = 0, my = 0] = map(x, y)
      expect(mx).toBeCloseTo(corner.x, 6)
      expect(my).toBeCloseTo(corner.y, 6)
    }
  })

  it('refuses corners that make no receipt', () => {
    expect(() => homography({ width: 10, height: 10 }, quad(0, 0, 0, 0, 0, 0, 0, 0))).toThrow()
  })
})

describe('the warp', () => {
  it('cuts out the paper of a square photo exactly', () => {
    const src = photo(40, 40, [10, 5, 30, 35])
    const out = warp(src, quad(10, 5, 30, 5, 30, 35, 10, 35), { width: 20, height: 30 })
    expect([out.width, out.height]).toEqual([20, 30])
    expect(grey(out, 0, 0)).toBe(240)
    expect(grey(out, 19, 29)).toBe(240)
    expect(grey(out, 10, 15)).toBe(240)
  })

  it('draws a receipt turned a quarter on its side upright', () => {
    // the paper lies across: 30 wide, 10 high; its top edge is on the right
    const src = photo(50, 30, [10, 10, 40, 20])
    const across = quad(40, 10, 40, 20, 10, 20, 10, 10)
    expect(rectOf(across)).toEqual({ width: 10, height: 30 })
    const out = warp(src, across, rectOf(across))
    expect([out.width, out.height]).toEqual([10, 30])
    expect(grey(out, 5, 15)).toBe(240)
  })

  it('paints outside the photo white, never black ink', () => {
    const src = photo(20, 20, [0, 0, 20, 20], 0, 0)
    const out = warp(src, quad(-10, -10, 10, -10, 10, 10, -10, 10), { width: 20, height: 20 })
    expect(grey(out, 1, 1)).toBe(255)
    expect(grey(out, 18, 18)).toBe(0)
  })
})

describe('on whole pixels, and square when square enough (MOL-222)', () => {
  it('rounds the corners and takes the box of a receipt tilted under the slack', () => {
    // 1 px off over a side of 100: under 1.5 %
    expect(snapped(quad(10.4, 10, 110, 11, 111, 300.6, 9.6, 300))).toEqual(
      quad(10, 10, 111, 10, 111, 301, 10, 301),
    )
  })

  it('keeps a receipt tilted past the slack as its corners', () => {
    const tilted = quad(10, 10, 110, 30, 100, 330, 0, 310)
    expect(snapped(tilted)).toEqual(tilted)
  })

  it('copies a square receipt’s own pixels, nothing blended', () => {
    const src = photo(40, 40, [10, 5, 30, 35])
    src.data[(20 * 40 + 15) * 4] = 7
    const out = warp(src, quad(10, 5, 30, 5, 30, 35, 10, 35), { width: 20, height: 30 })
    expect(grey(out, 5, 15)).toBe(7)
    expect(grey(out, 6, 15)).toBe(240)
  })
})
