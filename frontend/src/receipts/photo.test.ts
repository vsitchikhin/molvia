import { describe, expect, it } from 'vitest'
import { RECEIPT_PART_BYTES_MAX } from '@molvia/model'
import { CANVAS_PIXELS_MAX, RECEIPT_PHOTO_SIDE, fittedSize, sendable } from '@/receipts/photo'

describe('the size a photo of a receipt is brought to', () => {
  it('a long receipt cut out keeps its full resolution up to 3 200 px', () => {
    expect(fittedSize({ width: 719, height: 3326 }, RECEIPT_PHOTO_SIDE)).toEqual({
      width: 692,
      height: 3200,
    })
  })

  it('a small one is never enlarged', () => {
    expect(fittedSize({ width: 1000, height: 1400 }, RECEIPT_PHOTO_SIDE)).toEqual({
      width: 1000,
      height: 1400,
    })
  })

  it('a 24 Mp frame of an iPhone is drawn under the 16 Mp a canvas of iOS allows (Р-11)', () => {
    const size = fittedSize({ width: 5712, height: 4284 }, Infinity)
    expect(size.width * size.height).toBeLessThanOrEqual(CANVAS_PIXELS_MAX + 6000)
    expect(size.width / size.height).toBeCloseTo(5712 / 4284, 2)
  })

  it('a 12 Mp frame is drawn as it is', () => {
    expect(fittedSize({ width: 4032, height: 3024 }, Infinity)).toEqual({
      width: 4032,
      height: 3024,
    })
  })
})

describe('what the server would take', () => {
  it('refuses a short side under 200 px and a part over 8 MiB, as the server does', () => {
    expect(sendable({ width: 700, height: 3200 }, 900_000)).toBe(true)
    expect(sendable({ width: 199, height: 3200 }, 900_000)).toBe(false)
    expect(sendable({ width: 200, height: 3200 }, RECEIPT_PART_BYTES_MAX)).toBe(true)
    expect(sendable({ width: 700, height: 3200 }, RECEIPT_PART_BYTES_MAX + 1)).toBe(false)
  })
})
