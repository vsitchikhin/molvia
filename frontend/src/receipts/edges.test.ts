import { describe, expect, it } from 'vitest'
import {
  EDGES_LONG_SIDE,
  halved,
  halvedCopy,
  halvedSource,
  halvingSteps,
  proposedCorners,
} from '@/receipts/edges'
import type { Pixels } from '@/receipts/warp'

/** A grey photo of `width × height` with the values given row by row. */
function photoOf(width: number, height: number, values: number[]): Pixels {
  const data = new Uint8ClampedArray(width * height * 4)
  values.forEach((value, i) => {
    data.set([value, value, value, 255], i * 4)
  })
  return { data, width, height }
}

const greys = (pixels: Pixels) => Array.from(pixels.data.filter((_, i) => i % 4 === 0))

/**
 * A long receipt on a dark table as a phone shoots it: rows of print, the sensor's noise and a crease
 * across its middle — the shape of am-05c (MOL-259). Seeded, so every run draws the same photo.
 */
function longReceipt(): Pixels & { paper: { top: number; bottom: number } } {
  const width = 1512
  const height = 2016
  let seed = 1
  const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32
  const [x0, x1, y0, y1] = [575, 975, 125, 1900]
  const ink = new Uint8Array((x1 - x0) * (y1 - y0))
  for (let y = 20; y < y1 - y0 - 20; y += 23)
    for (let x = 20; x < x1 - x0 - 20; x += 11)
      if (random() < 0.75) {
        for (let d = 0; d < 11; d++) ink[(y + d) * (x1 - x0) + x] = 1
        for (let d = 0; d < 7; d++) ink[y * (x1 - x0) + x + d] = 1
      }
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const onPaper = x >= x0 && x < x1 && y >= y0 && y < y1
      const crease = 50 * Math.exp(-(((y - (y0 + y1) / 2) / 30) ** 2))
      const paper = ink[(y - y0) * (x1 - x0) + x - x0] === 1 ? 40 : 235 - crease
      const noise = 40 * 1.73 * (random() + random() + random() + random() - 2)
      const [r, g, b] = onPaper ? [paper, paper, paper] : [70, 48, 38]
      data.set([r + noise, g + noise, b + noise, 255], (y * width + x) * 4)
    }
  }
  return { data, width, height, paper: { top: y0, bottom: y1 } }
}

/** One step straight to 640 as a canvas samples it by default: bilinear, four pixels of each forty. */
function sampled(photo: Pixels): Pixels {
  const scale = EDGES_LONG_SIDE / Math.max(photo.width, photo.height)
  const width = Math.round(photo.width * scale)
  const height = Math.round(photo.height * scale)
  const data = new Uint8ClampedArray(width * height * 4)
  const at = (x: number, y: number, c: number) => photo.data[(y * photo.width + x) * 4 + c] ?? 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const fx = (x + 0.5) / scale - 0.5
      const fy = (y + 0.5) / scale - 0.5
      const [x0, y0] = [Math.floor(fx), Math.floor(fy)]
      const [ax, ay] = [fx - x0, fy - y0]
      for (let c = 0; c < 4; c++) {
        const top = (1 - ax) * at(x0, y0, c) + ax * at(x0 + 1, y0, c)
        const bottom = (1 - ax) * at(x0, y0 + 1, c) + ax * at(x0 + 1, y0 + 1, c)
        data[(y * width + x) * 4 + c] = (1 - ay) * top + ay * bottom
      }
    }
  }
  return { data, width, height }
}

describe('the copy the corners are looked for on (MOL-259)', () => {
  it('halves a photo until its long side is within twice the copy', () => {
    expect(halvingSteps({ width: 3024, height: 4032 })).toEqual([
      { width: 1512, height: 2016 },
      { width: 756, height: 1008 },
    ])
    expect(halvingSteps({ width: 4762, height: 3571 })).toEqual([
      { width: 2381, height: 1785 },
      { width: 1190, height: 892 },
    ])
  })

  it('halves an odd side exactly, its last pixel left out — 24 Mp brought under 16 Mp', () => {
    expect(halvingSteps({ width: 4619, height: 3464 })).toEqual([
      { width: 2309, height: 1732 },
      { width: 1154, height: 866 },
    ])
    expect(halvedSource({ width: 4619, height: 3464 }, { width: 2309, height: 1732 })).toEqual({
      width: 4618,
      height: 3464,
    })
  })

  it('leaves a photo already within it alone, and halves one a pixel over', () => {
    expect(halvingSteps({ width: 960, height: 1280 })).toEqual([])
    expect(halvingSteps({ width: 200, height: 300 })).toEqual([])
    expect(halvingSteps({ width: 961, height: 1281 })).toEqual([{ width: 480, height: 640 }])
    expect(halvingSteps({ width: 1, height: 1500 })).toEqual([{ width: 1, height: 750 }])
  })

  it('takes every pixel of a step as the mean of the 2 × 2 it covers', () => {
    expect(
      greys(halved(photoOf(4, 2, [0, 100, 200, 200, 100, 0, 40, 40]), { width: 2, height: 1 })),
    ).toEqual([50, 120])
  })

  it('leaves the odd last pixel of a side out, as the canvas does drawing twice the step', () => {
    expect(greys(halved(photoOf(3, 1, [10, 30, 90]), { width: 1, height: 1 }))).toEqual([20])
    expect(greys(halved(photoOf(1, 2, [10, 30]), { width: 1, height: 1 }))).toEqual([20])
  })

  it('makes the copy by the steps alone, the photo untouched', () => {
    const photo = photoOf(3000, 2, new Array<number>(6000).fill(120))
    const copy = halvedCopy(photo)
    expect([copy.width, copy.height]).toEqual([750, 1])
    expect(greys(copy).every((v) => v === 120)).toBe(true)
    expect(halvedCopy(photoOf(2, 2, [1, 2, 3, 4]))).toEqual(photoOf(2, 2, [1, 2, 3, 4]))
  })

  it('finds a long receipt whole, where one sampled step tore it at its crease', () => {
    const photo = longReceipt()
    const { paper } = photo
    const copy = halvedCopy(photo)
    const whole = proposedCorners(copy)
    const k = photo.height / copy.height
    expect(whole.found).toBe(true)
    expect(Math.abs(whole.quad[0].y * k - paper.top)).toBeLessThan(8)
    expect(Math.abs(whole.quad[2].y * k - paper.bottom)).toBeLessThan(8)
    // the photo is one the old copy cuts: drop `halvedCopy` from the phone and this is what it proposes
    const sample = sampled(photo)
    const torn = proposedCorners(sample)
    const j = photo.height / sample.height
    expect(torn.quad[2].y * j).toBeLessThan(paper.bottom - (paper.bottom - paper.top) / 3)
  }, 20_000)
})
