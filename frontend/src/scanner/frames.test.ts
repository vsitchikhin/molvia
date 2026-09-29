import { describe, expect, it } from 'vitest'
import { cropOf, createReadStreak } from './frames'

describe('cropOf', () => {
  it('maps the frame through a picture that fits the box exactly', () => {
    // A 1280×720 picture shown at 320×180: one screen pixel is four of the picture.
    const crop = cropOf(
      { width: 1280, height: 720 },
      { x: 0, y: 0, width: 320, height: 180 },
      { x: 40, y: 60, width: 240, height: 60 },
    )
    // The frame grown by 15 % each way (36 × 9 screen pixels), times four.
    expect(crop).toEqual({ x: 16, y: 204, width: 1248, height: 312 })
  })

  it('accounts for the sides a cover fit cuts off', () => {
    // A 1280×720 picture in a tall 300×400 box: scaled to 711×400, 205.5 px cut on each side.
    const crop = cropOf(
      { width: 1280, height: 720 },
      { x: 0, y: 0, width: 300, height: 400 },
      { x: 30, y: 150, width: 240, height: 80 },
    )
    const scale = 400 / 720
    expect(crop.x).toBe(Math.round((30 - 36 + 205.5555) / scale))
    expect(crop.width).toBe(Math.round((240 + 72) / scale))
    expect(crop.y).toBe(Math.round((150 - 12) / scale))
  })

  it('keeps the crop inside the picture when the margin runs past its edge', () => {
    const crop = cropOf(
      { width: 640, height: 480 },
      { x: 0, y: 0, width: 640, height: 480 },
      { x: 0, y: 0, width: 640, height: 480 },
    )
    expect(crop).toEqual({ x: 0, y: 0, width: 640, height: 480 })
  })

  it('cuts nothing while the video or the frame has no size yet, never a crop of NaN', () => {
    const picture = { width: 1280, height: 720 }
    const none = { x: 0, y: 0, width: 0, height: 0 }
    const box = { x: 0, y: 0, width: 320, height: 180 }
    expect(cropOf(picture, none, box)).toEqual(none)
    expect(cropOf(picture, box, none)).toEqual(none)
  })
})

describe('createReadStreak', () => {
  it('takes a code on its second read in a row, not its first', () => {
    const push = createReadStreak()
    expect(push('4850000000007')).toBeNull()
    expect(push('4850000000007')).toBe('4850000000007')
  })

  it('must not take two different codes in a row', () => {
    const push = createReadStreak()
    expect(push('4850000000007')).toBeNull()
    expect(push('96385074')).toBeNull()
    // …and the second one now counts as the first of its own streak.
    expect(push('96385074')).toBe('96385074')
  })

  it('starts over after a frame that reads nothing', () => {
    const push = createReadStreak()
    expect(push('4850000000007')).toBeNull()
    expect(push(null)).toBeNull()
    expect(push('4850000000007')).toBeNull()
    expect(push('4850000000007')).toBe('4850000000007')
  })

  it('starts over after a code is taken, so a third frame is not a second take', () => {
    const push = createReadStreak()
    push('4850000000007')
    expect(push('4850000000007')).toBe('4850000000007')
    expect(push('4850000000007')).toBeNull()
  })
})
